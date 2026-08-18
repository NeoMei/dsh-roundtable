import { RoundtableError } from "./service.js";
import { runRound } from "./executor.js";
import { serializeRoundtableMarkdown } from "./markdown.js";
import { createMemberRunner } from "./member-runner.js";
import { createRoundtableRecorder } from "./recorder.js";
import { recoverRoundtableDiscussions } from "./recovery.js";
import { RoundtableId } from "./types.js";
/** 纪要弧上限：只把最近 K 轮的纪要（与人类意见）喂给后续轮次的成员与主持人，约束 prompt 长度（review #5）。 */
const MAX_PRIOR_ROUNDS = 3;
/** Command words recognized as "stop" (matched case-insensitively, on the leading word). Longer first so "停止讨论" wins over "停止" (mirrors "继续讨论" over "继续"). */
const STOP_WORDS = ['停止讨论', '停止', '结束', '终止', 'stop', 'end', 'quit'];
/** Command words recognized as "continue" (longer first so "继续讨论" wins over "继续"). */
const CONTINUE_WORDS = ['继续讨论', '下一轮', '继续', 'continue', 'next'];
/** Short-message fallback length cap: beyond this the reply is treated as an opinion, never a gate. */
const SHORT_REPLY_LIMIT = 16;
/** Light lead-ins that may precede a directive word inside a short reply. */
const SHORT_LEAD_INS = new Set([
    '', '我们', '咱们', '请', '先', '好', '好的', '行', '行吧', '就', '那', '那么', '那就',
    '我们就', '那我们就', '那咱们', '嗯', '哦', '可以', 'please', 'ok', 'okay',
]);
/** Only particles/separators may follow a directive word inside a short reply. */
const TRAILING_PARTICLES = /^[吧啊呀呢哈了哦噢～~！!？?。.,，、:：\s]+$/;
/**
 * Classify a human reply while the host is awaiting the round gate.
 * Returns `undefined` for anything that is not a gate command.
 *
 * Two rules, in order:
 *
 * 1. **Leading word** — the reply is, or starts with, a command word followed
 *    by a separator ("继续", "停止", "继续，再补充细节", "继续。附带意见",
 *    "stop, then…"). Any text after the separator is the trailing new opinion.
 *
 * 2. **Short-message directive** — a short reply (≤ {@link SHORT_REPLY_LIMIT}
 *    chars) whose ONLY gate-relevant content is a single command word is still
 *    a gate reply even when the word is not first: the word may be wrapped in
 *    light lead-ins and trailing particles ("我们继续吧", "先停止",
 *    "好，继续"). A word embedded in a longer statement ("我建议继续推进",
 *    "关于停止旧服务…") is NOT classified — longer text is treated as an
 *    opinion/steer, never a gate — and a reply naming both families is
 *    ambiguous and left unclassified.
 */
export function parseGateReply(text) {
    const trimmed = text.trim();
    if (trimmed === '')
        return undefined;
    const lower = trimmed.toLowerCase();
    const lead = (word) => {
        if (lower === word)
            return '';
        if (lower.startsWith(`${word}，`) || lower.startsWith(`${word},`)
            || lower.startsWith(`${word}.`) || lower.startsWith(`${word}：`)
            || lower.startsWith(`${word}:`) || lower.startsWith(`${word} `)
            || lower.startsWith(`${word}。`) || lower.startsWith(`${word}、`)) {
            return trimmed.slice(word.length).replace(/^[，,.:：。、\s]+/, '');
        }
        return undefined;
    };
    for (const word of STOP_WORDS) {
        const opinion = lead(word);
        if (opinion !== undefined)
            return { gate: 'stop', opinion };
    }
    for (const word of CONTINUE_WORDS) {
        const opinion = lead(word);
        if (opinion !== undefined)
            return { gate: 'continue', opinion };
    }
    // Short-message directive fallback (rule 2 above).
    if (trimmed.length > SHORT_REPLY_LIMIT)
        return undefined;
    const stopWord = STOP_WORDS.find(word => lower.includes(word));
    const continueWord = CONTINUE_WORDS.find(word => lower.includes(word));
    if (stopWord !== undefined && continueWord !== undefined)
        return undefined;
    const directive = stopWord ?? continueWord;
    if (directive === undefined)
        return undefined;
    const at = lower.indexOf(directive);
    const prefix = trimmed.slice(0, at).replace(/[\s，,.:：。、]+$/, '');
    if (!SHORT_LEAD_INS.has(prefix))
        return undefined;
    const trailing = trimmed.slice(at + directive.length).replace(/^[\s，,.:：。、]+/, '');
    if (trailing !== '' && !TRAILING_PARTICLES.test(trailing))
        return undefined;
    return { gate: stopWord !== undefined ? 'stop' : 'continue', opinion: '' };
}
/** Render the topic a round runs under, folding in a "继续" opinion. */
function roundTopic(baseTopic, opinion) {
    if (opinion === undefined || opinion.trim() === '')
        return baseTopic;
    return `${baseTopic}（人类「继续」新意见：${opinion.trim()}）`;
}
export function createRoundtableDriver(deps, input) {
    const { topic, members, signal } = input;
    const seedRounds = input.seedRounds ?? [];
    const resumedUnsettled = input.resumedUnsettled ?? false;
    const discussion = {
        id: input.id ?? RoundtableId(`rt-${crypto.randomUUID()}`),
        roster: members,
        rounds: [...seedRounds],
        status: 'active',
    };
    let phase = seedRounds.length > 0 || resumedUnsettled ? 'awaitingGate' : 'idle';
    let started = seedRounds.length > 0 || resumedUnsettled;
    let terminal = false;
    const assertActive = () => {
        if (terminal || discussion.status !== 'active') {
            throw new Error(`roundtable discussion "${discussion.id}" is ${discussion.status}`);
        }
    };
    async function runNextRound(roundTopicValue) {
        assertActive();
        phase = 'running';
        const roundNumber = discussion.rounds.length + 1;
        try {
            const minutes = await runRound({
                runMember: deps.runMember, summarize: deps.summarize, claimSteer: deps.claimSteer,
            }, {
                roundNumber,
                topic: roundTopicValue,
                members,
                // 每轮一份「轮次号 + 纪要」，供 executor/主持人按轮渲染分隔；只保留
                // 最近 MAX_PRIOR_ROUNDS 轮，约束成员与主持人 prompt 的纪要弧长度。
                priorSummaries: discussion.rounds.slice(-MAX_PRIOR_ROUNDS).map(round => ({
                    roundNumber: round.roundNumber,
                    summary: round.summary,
                })),
                // 前几轮「轮中插入」的人类意见（claimSteer 进入 humanSteers）延续到本轮
                // 成员与主持人上下文；「继续」附带的新意见不进 humanSteers，而是经
                // roundTopic 折叠进当轮话题，随纪要弧传递。与纪要弧同窗口上限（最近
                // MAX_PRIOR_ROUNDS 轮），约束 prompt 长度。
                priorSteers: discussion.rounds.slice(-MAX_PRIOR_ROUNDS).flatMap(round => round.humanSteers),
                signal,
            });
            // The discussion may have settled (stop/cancel/error) while the round was
            // in flight: never mutate a settled discussion with stale minutes, and
            // never present a next-round prompt for it.
            if (terminal || discussion.status !== 'active') {
                throw new Error(`roundtable discussion "${discussion.id}" settled (${discussion.status}) while round ${roundNumber} ran; discarding its minutes`);
            }
            discussion.rounds.push(minutes);
            phase = 'awaitingGate';
            deps.askNextRound(minutes);
            return minutes;
        }
        catch (error) {
            fail(signal.aborted ? 'cancelled' : 'error');
            throw error;
        }
    }
    function start() {
        if (started)
            throw new Error('roundtable discussion already started');
        started = true;
        return runNextRound(topic);
    }
    function continueRound(opinion) {
        if (!started)
            throw new Error('roundtable discussion not started');
        // Re-check the terminal flag: `stop()` transitions terminal SYNCHRONOUSLY
        // before its async markdown write, so a "继续" racing the write is rejected
        // here (and by the phase guard below) instead of starting a round whose
        // minutes would be silently discarded once the write settles the discussion.
        if (terminal)
            throw new Error(`roundtable discussion "${discussion.id}" already ${discussion.status}`);
        if (phase !== 'awaitingGate') {
            throw new Error(`roundtable discussion "${discussion.id}" is not awaiting the gate (phase: ${phase})`);
        }
        return runNextRound(roundTopic(topic, opinion));
    }
    async function stop() {
        assertActive();
        // Stopping mid-round would serialize partial minutes and then let the
        // in-flight round mutate a completed discussion — only stop at a gate
        // boundary (or an idle, never-started discussion, which has nothing to write).
        if (phase !== 'awaitingGate' && phase !== 'idle') {
            throw new Error(`roundtable discussion "${discussion.id}" cannot stop while ${phase} (only awaitingGate or idle)`);
        }
        // Transition terminal SYNCHRONOUSLY, BEFORE the async markdown write: a
        // "继续" arriving while the write is in flight must be rejected by the
        // phase guard (and `assertActive`) instead of starting a round whose
        // minutes would be silently discarded once the write settles the
        // discussion. `fail()` stays idempotent against this pre-transition.
        terminal = true;
        discussion.status = 'completed';
        phase = 'completed';
        const markdown = serializeRoundtableMarkdown(discussion);
        // Only write when an output file was explicitly requested (the seam is
        // unwired otherwise): no `roundtable-rt-<uuid>.md` artifact at the fs root.
        if (deps.writeMarkdown !== undefined) {
            try {
                await deps.writeMarkdown(markdown);
            }
            catch (error) {
                // The write failed AFTER the synchronous terminal transition: no
                // artifact was produced, so correct the terminal status/phase from
                // `completed` to `error` before rethrowing — the host driver then
                // settles the durable `roundtable/end` as `error` (review #6).
                discussion.status = 'error';
                phase = 'error';
                throw error;
            }
        }
        return markdown;
    }
    function fail(reason) {
        if (terminal)
            return;
        terminal = true;
        discussion.status = reason;
        phase = reason;
    }
    return {
        get discussion() { return discussion; },
        get phase() { return phase; },
        start,
        continueRound,
        stop,
        fail,
    };
}
/** Default meeting-host persona used to produce each round's summary. */
const HOST_PERSONA = '你是会议主持人，负责客观汇总本轮圆桌讨论并给出「纪要 + 结论」。';
function textOf(blocks) {
    return blocks.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('');
}
/** Render a thrown value into a loggable string without trusting it. */
export function renderDriverError(error) {
    try {
        return error instanceof Error ? error.message : String(error);
    }
    catch {
        return '[unrenderable thrown value]';
    }
}
/**
 * Build the `summarize` seam: run a dedicated host-persona subagent that turns
 * this round's utterances into `summary` content blocks. From round 2 on it
 * also receives the prior rounds' summaries and human steers, so the summary
 * (and the final conclusion) reflects the whole discussion arc, not just the
 * current round.
 */
export function createHostSummarizer(deps) {
    const persona = deps.persona ?? HOST_PERSONA;
    return async (members, utterances, topic, humanSteers, prior) => {
        const transcript = utterances.length === 0
            ? '（无成员发言）'
            : utterances.map(u => `【${u.label}】${textOf(u.output)}`).join('\n\n');
        const steers = humanSteers.length === 0
            ? '（无）'
            : humanSteers.map(s => `- ${s}`).join('\n');
        const priorSummaries = prior === undefined || prior.rounds.length === 0
            ? '（无，本轮为第 1 轮）'
            : prior.rounds
                .map(round => `### 第 ${round.roundNumber} 轮纪要\n\n${textOf(round.summary)}`)
                .join('\n\n');
        const priorSteers = prior === undefined || prior.steers.length === 0
            ? '（无）'
            : prior.steers.map(s => `- ${s}`).join('\n');
        const prompt = [
            '你是本次圆桌讨论的会议主持人，请产出「本轮纪要 + 结论」。',
            `本轮话题：${topic}`,
            `前几轮纪要（用于把握整场讨论脉络，使本轮结论衔接前文）：\n${priorSummaries}`,
            `前几轮人类插入的意见：\n${priorSteers}`,
            `成员（${members.map(m => m.label).join('、')}）发言：`,
            transcript,
            `本轮人类插入的意见（如无则写「无」，如有则须在纪要中体现）：\n${steers}`,
        ].join('\n\n');
        const run = await deps.subagents.start(deps.provider, {
            label: '会议主持人',
            prompt: [{ type: 'text', text: prompt }],
            parent: deps.parent,
            persona,
            signal: deps.signal,
        });
        try {
            const result = await run.result;
            // Mirror the member runner: a summarizer that fails (non-'completed'
            // stopReason) must not come back as an empty 纪要 that still marks the
            // round completed.
            if (result.stopReason !== 'completed') {
                throw new Error(`roundtable host summarizer stopped: ${result.stopReason}`);
            }
            return result.output;
        }
        finally {
            await run.dispose();
        }
    };
}
function assertValidRoster(members, maxMembers = 8) {
    if (members.length === 0)
        throw new RoundtableError('roster is empty', 'ROSTER_INVALID');
    if (members.length > maxMembers)
        throw new RoundtableError(`roster exceeds maxMembers (${maxMembers})`, 'ROSTER_INVALID');
    const ids = new Set(members.map(m => m.id));
    if (ids.size !== members.length)
        throw new RoundtableError('duplicate member id', 'ROSTER_INVALID');
}
export function createRoundtableHostDriver(ctx, deps) {
    const recorder = createRoundtableRecorder(ctx);
    const registry = new Map();
    const defaultWriteMarkdown = async (markdown, outputFile) => {
        const fs = ctx.fs;
        const target = await fs.resolve(outputFile);
        await fs.writeText(target, markdown);
    };
    const writeMarkdown = deps.writeMarkdown ?? defaultWriteMarkdown;
    function emitEvent(name, ...args) {
        for (const callback of ctx.events.dispatch('emit', [name, ...args])) {
            try {
                void Promise.resolve(callback(...args)).catch(error => {
                    ctx.logger.warn(`roundtable: ${name} listener rejected: ${String(error)}`);
                });
            }
            catch (error) {
                ctx.logger.warn(`roundtable: ${name} listener threw: ${String(error)}`);
            }
        }
    }
    /** Mid-round steer claim: claim only human `user` steers, leaving other pending input queued. */
    function claimSteer() {
        // The roundtable driver intercepts mid-round, so it has no owning turn number;
        // the claimed-notification turn is informational for observers such as
        // goal-round-driver (which matches on content/source, not turn).
        const claimed = deps.host.inbox.claimWhere(message => message.source.kind === 'user', 0);
        return claimed
            .map(message => textOf(message.content).trim())
            .filter(text => text !== '');
    }
    function settle(id, reason) {
        const entry = registry.get(id);
        if (entry === undefined || entry.settled !== undefined)
            return;
        entry.settled = reason;
        if (reason !== 'completed')
            entry.core.fail(reason);
        emitEvent('roundtable/end', entry.info, reason);
        recorder.finish(id, reason);
        registry.delete(id);
    }
    function requireEntry(id) {
        const entry = registry.get(id);
        if (entry === undefined)
            throw new RoundtableError(`unknown discussion "${id}"`, 'DISCUSSION_UNKNOWN');
        return entry;
    }
    /**
     * Build the discussion core over the shared live seams (members, host summarizer, steer claim).
     * Topic and output-file come from the durable {@link RoundtableInfo}, which carries
     * them so a discussion recovered mid-round-1 re-runs from the same topic and exports
     * to the same place.
     */
    function buildCore(info, signal, seedRounds, resumedUnsettled = false) {
        const outputFile = info.outputFile;
        return createRoundtableDriver({
            runMember: createMemberRunner({
                subagents: ctx.subagents, provider: deps.provider, parent: deps.host,
            }),
            summarize: createHostSummarizer({
                subagents: ctx.subagents, provider: deps.provider, parent: deps.host,
                ...(deps.hostPersona !== undefined ? { persona: deps.hostPersona } : {}),
                signal,
            }),
            claimSteer,
            // Only wire the stop-time markdown write when an output file was
            // EXPLICITLY requested: without one `stop()` skips the write entirely
            // (the skill/client owns writing the final file), so no UUID-default
            // `roundtable-rt-<uuid>.md` artifact lands at the fs root.
            ...(outputFile !== undefined ? { writeMarkdown: markdown => writeMarkdown(markdown, outputFile) } : {}),
            askNextRound: (minutes) => {
                emitEvent('roundtable/round-end', info, minutes);
                deps.askNextRound?.(info.id, minutes);
            },
        }, {
            id: info.id, topic: info.topic, members: info.roster, signal,
            ...(seedRounds !== undefined ? { seedRounds } : {}),
            ...(resumedUnsettled ? { resumedUnsettled: true } : {}),
        });
    }
    /** Expose one registry entry through the stable handle face. */
    function handleOf(entry) {
        return {
            id: entry.info.id,
            get discussion() { return entry.core.discussion; },
            get phase() { return entry.core.phase; },
            get started() { return entry.started; },
        };
    }
    return {
        startDiscussion(request) {
            assertValidRoster(request.members, deps.maxMembers ?? 8);
            const controller = new AbortController();
            const signal = request.signal === undefined
                ? controller.signal
                : AbortSignal.any([request.signal, controller.signal]);
            const id = RoundtableId(`rt-${crypto.randomUUID()}`);
            const info = {
                id,
                roster: request.members,
                topic: request.topic,
                ...(request.outputFile !== undefined ? { outputFile: request.outputFile } : {}),
            };
            const core = buildCore(info, signal);
            const entry = { core, info, controller, signal, settled: undefined, started: Promise.resolve(undefined) };
            // Register BEFORE emitting `roundtable/start`: the emit is synchronous, so
            // a start-listener calling `get(id)` / `cancelDiscussion(id)` must already
            // find the entry (review #6).
            registry.set(id, entry);
            emitEvent('roundtable/start', info);
            recorder.start(deps.host.session, info);
            entry.started = core.start().catch((error) => {
                const reason = signal.aborted ? 'cancelled' : 'error';
                if (entry.settled === undefined)
                    settle(id, reason);
                // A genuine member/summarize failure (or cancellation) settles the
                // discussion but must not vanish silently: surface it in the log.
                ctx.logger.warn(`roundtable: discussion "${id}" settled ${reason} from round 1: ${renderDriverError(error)}`);
                return undefined;
            });
            return handleOf(entry);
        },
        async continueRound(id, opinion) {
            const entry = requireEntry(id);
            try {
                return await entry.core.continueRound(opinion);
            }
            catch (error) {
                // Distinguish a benign phase/guard rejection — e.g. a "继续" racing a
                // "停止" whose synchronous terminal transition already happened, or
                // the discussion already settled — from a genuine member/summarize
                // failure. Only the latter, which `runNextRound` already folded into
                // `core.fail` (phase `error`/`cancelled`), settles the host entry: a
                // guard throw must NEVER record the discussion as 'error'.
                const phase = entry.core.phase;
                if (phase !== 'error' && phase !== 'cancelled') {
                    void error;
                    return undefined;
                }
                settle(id, entry.signal.aborted ? 'cancelled' : 'error');
                // A real member/summarize failure settled the discussion: log it so the
                // failure is visible (the guard-rejection branch above stays silent).
                ctx.logger.warn(`roundtable: discussion "${id}" settled ${phase} while running a round: ${renderDriverError(error)}`);
                return undefined;
            }
        },
        async stopDiscussion(id) {
            const entry = requireEntry(id);
            try {
                const markdown = await entry.core.stop();
                settle(id, 'completed');
                return markdown;
            }
            catch (error) {
                // A guard rejection — stop outside a gate boundary (running/idle) or
                // an already-terminal discussion — is benign: the discussion keeps its
                // state and must not be settled as 'error'. Otherwise the synchronous
                // terminal transition already happened (phase `completed`) and the
                // throw is the markdown write failing after it: NO artifact was
                // produced, so the durable `roundtable/end` must record `error`, never
                // `completed` — and the write error surfaces to the caller.
                const phase = entry.core.phase;
                if (phase === 'running' || phase === 'idle' || phase === 'awaitingGate')
                    throw error;
                settle(id, 'error');
                throw error;
            }
        },
        cancelDiscussion(id, reason) {
            const entry = registry.get(id);
            if (entry === undefined)
                return;
            // A stop() whose synchronous terminal transition already happened (the
            // markdown write is still in flight) has made the core phase `completed`:
            // treat it as terminal and leave the settlement to the in-flight
            // stopDiscussion — never overwrite it with a racing `cancelled`.
            if (entry.core.phase === 'completed')
                return;
            entry.controller.abort(reason);
            settle(id, 'cancelled');
        },
        get: id => {
            const entry = registry.get(id);
            if (entry === undefined)
                return undefined;
            return handleOf(entry);
        },
        recover(session) {
            const handles = [];
            for (const recovered of recoverRoundtableDiscussions(session.events)) {
                const { info, rounds } = recovered;
                if (registry.has(info.id))
                    continue;
                // A settled round 1 is the common resumable case: the discussion is
                // rebuilt awaiting the gate with its settled rounds. A discussion
                // interrupted mid-round-1 (only `roundtable/start`, no rounds) is ALSO
                // resumable now that the durable payload carries the topic: it is
                // rebuilt open-but-unsettled, and the first "继续" re-runs round 1.
                const controller = new AbortController();
                const core = buildCore(info, controller.signal, rounds.length > 0 ? rounds : undefined, rounds.length === 0);
                const entry = {
                    core, info, controller, signal: controller.signal, settled: undefined,
                    started: rounds.length > 0 ? Promise.resolve(rounds[0]) : Promise.resolve(undefined),
                };
                registry.set(info.id, entry);
                // Re-arm the recorder for the rebuilt discussion so its continuation
                // rounds and terminal settlement keep persisting (its original
                // `roundtable/start` is already in the log — resume registers the
                // session without appending a duplicate).
                recorder.resume(session, info);
                handles.push(handleOf(entry));
            }
            return handles;
        },
        dispose() {
            // Defensive teardown: cancel anything still live so in-flight rounds
            // settle `cancelled` instead of dangling, THEN detach the recorder's
            // shared round-* listeners (the per-agent listener leak). A stop() whose
            // synchronous terminal transition already happened (phase `completed`,
            // markdown write still in flight) must settle `completed` — never
            // `cancelled` — and its terminal record lands HERE, before teardown
            // drops the registry/recorder (the pending stopDiscussion's own settle
            // no-ops on the cleared registry). Mirrors cancelDiscussion's
            // stop-before-cancel guard.
            for (const entry of registry.values()) {
                entry.controller.abort('roundtable-host driver disposed');
                if (entry.settled === undefined) {
                    settle(entry.info.id, entry.core.phase === 'completed' ? 'completed' : 'cancelled');
                }
            }
            registry.clear();
            recorder.dispose();
        },
    };
}
//# sourceMappingURL=driver.js.map