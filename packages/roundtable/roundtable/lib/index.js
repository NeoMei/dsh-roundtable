import { Service } from "@deepseek-ai/cordis";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
//#region lib/types/types.js
function RoundtableId(id) {
	return id;
}
//#endregion
//#region lib/types/markdown.js
function textOf$2(blocks) {
	return blocks.map((b) => b.type === "text" ? b.text ?? "" : `[${b.type}]`).join("");
}
function timestampOf(now) {
	if (typeof now === "string") return now;
	if (typeof now === "number") return new Date(now).toISOString();
	return now.toISOString();
}
function memberLine(m) {
	const model = m.agentOptions?.model;
	const provider = m.agentOptions?.provider;
	if (provider !== void 0 && model !== void 0) return `- **${m.label}** (${provider} · ${model})`;
	if (provider !== void 0) return `- **${m.label}** (${provider})`;
	if (model !== void 0) return `- **${m.label}** (${model})`;
	return `- **${m.label}**`;
}
function serializeRoundtableMarkdown(discussion, opts = {}) {
	const title = opts.title ?? discussion.rounds[0]?.topic ?? "圆桌讨论";
	const roster = discussion.roster.map(memberLine).join("\n");
	const synthesize = opts.synthesize !== false;
	const multiRound = discussion.rounds.length > 1;
	const renderSynthesis = synthesize && multiRound;
	const rounds = discussion.rounds.map((r) => `## 第 ${r.roundNumber} 轮\n\n**议题：** ${r.topic}\n\n**纪要：** ${textOf$2(r.summary)}`).join("\n\n");
	const synthesis = renderSynthesis ? `\n\n## 综合方案\n\n${discussion.rounds.map((r) => `### 第 ${r.roundNumber} 轮纪要\n\n${textOf$2(r.summary)}`).join("\n\n")}` : "";
	return `# ${title} 会议纪要${opts.now === void 0 ? "" : `\n\n_生成时间：${timestampOf(opts.now)}_`}\n\n## 参会人员\n\n${`${roster}\n- **会议主持人**（主持人）`}\n\n${rounds}${synthesis}\n`;
}
//#endregion
//#region lib/types/recorder.js
/**
* Minutes store: project each settled round's minutes and the terminal
* settlement into the calling parent Session as durable `roundtable/*` events.
* Mirrors `createWorkflowRecorder` in packages/workflow/tool-workflow.
* @module @neomei/dsh-roundtable/recorder
*/
/** Render a contained recording failure without trusting the thrown value. */
function renderRecordingError(error) {
	try {
		return String(error);
	} catch {
		return "[unrenderable thrown value]";
	}
}
/**
* Project active roundtable discussions into their parent Sessions without
* letting recording failure affect discussion execution.
*/
function createRoundtableRecorder(ctx) {
	const active = /* @__PURE__ */ new Map();
	const disposers = [];
	const append = (session, type, data) => {
		const appendRecord = session.append.bind(session);
		try {
			appendRecord(type, data);
			return true;
		} catch (error) {
			ctx.logger.warn(`roundtable: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`);
			return false;
		}
	};
	disposers.push(ctx.on("roundtable/round-end", (info, minutes) => {
		const session = active.get(info.id);
		if (session === void 0) return;
		if (!append(session, "roundtable/round-end", {
			discussionId: info.id,
			minutes
		})) active.delete(info.id);
	}));
	return {
		start(session, info) {
			if (append(session, "roundtable/start", info)) active.set(info.id, session);
		},
		resume(session, info) {
			active.set(info.id, session);
		},
		finish(discussionId, stopReason) {
			const session = active.get(discussionId);
			if (session !== void 0) append(session, "roundtable/end", {
				discussionId,
				stopReason
			});
			active.delete(discussionId);
		},
		abandon: (discussionId) => {
			active.delete(discussionId);
		},
		dispose() {
			for (const dispose of disposers.splice(0)) try {
				dispose();
			} catch (error) {
				ctx.logger.warn(`roundtable: recorder listener dispose threw: ${renderRecordingError(error)}`);
			}
			active.clear();
		}
	};
}
//#endregion
//#region lib/types/recovery.js
/**
* Fold a session event log into its still-active roundtable discussions.
*
* Log-only, order-sensitive: the recorder appends events in discussion order,
* so a `roundtable/round-end` always follows the matching `roundtable/start`
* and a `roundtable/end` always terminates the discussion it names. Events for
* an already-closed discussion (a `round-end` after `end`, or a duplicate
* `start` re-opening a settled id) are simply ignored.
*
* @param events - the durable session event log, in seq order.
* @returns every `roundtable/start` without a matching `roundtable/end`,
*   carrying its roster and every settled round, in discussion-open order.
*/
function recoverRoundtableDiscussions(events) {
	const active = /* @__PURE__ */ new Map();
	const closed = /* @__PURE__ */ new Set();
	for (const event of events) switch (event.type) {
		case "roundtable/start": {
			const id = event.data.id;
			if (active.has(id) || closed.has(id)) break;
			active.set(id, {
				info: event.data,
				rounds: []
			});
			break;
		}
		case "roundtable/round-end": {
			const discussion = active.get(event.data.discussionId);
			if (discussion !== void 0) discussion.rounds.push(event.data.minutes);
			break;
		}
		case "roundtable/end": {
			const id = event.data.discussionId;
			closed.add(id);
			active.delete(id);
			break;
		}
		default: break;
	}
	return [...active.values()].map((entry) => ({
		info: entry.info,
		rounds: entry.rounds
	}));
}
//#endregion
//#region lib/types/service.js
/**
* Roundtable capability seam: the `roundtable` Service contract, its error
* type, and the `roundtable/*` event vocabulary. Kept separate from the barrel
* so the concrete provider (`engine.ts`) and the drivers can import the seam
* without a module cycle through `index.ts`.
* @module @neomei/dsh-roundtable/service
*/
var RoundtableError = class extends HarnessError {
	constructor(message, code, options) {
		super(message, code, options);
		this.name = "RoundtableError";
	}
};
/** Abstract roundtable service seam: starts a multi-round discussion and
* returns its live run handle. The concrete provider (`engine.ts`) and the
* host-loop driver implement it. */
var RoundtableEngine = class extends Service {
	constructor(ctx) {
		super(ctx, "roundtable");
	}
	emitRoundtableEvent(name, ...args) {
		for (const callback of this.ctx.events.dispatch("emit", [name, ...args])) try {
			Promise.resolve(callback(...args)).catch((e) => this.ctx.logger.warn(`roundtable: ${name} listener rejected: ${String(e)}`));
		} catch (e) {
			this.ctx.logger.warn(`roundtable: ${name} listener threw: ${String(e)}`);
		}
	}
};
//#endregion
//#region lib/types/executor.js
function textOf$1(blocks) {
	return blocks.map((b) => b.type === "text" ? b.text ?? "" : "").join("");
}
/** 按轮渲染前几轮纪要：每轮一个 `### 第 k 轮纪要` 分节，空行分隔（review #5）。 */
function renderPriorSummaries(prior) {
	return prior.map((round) => `### 第 ${round.roundNumber} 轮纪要\n\n${textOf$1(round.summary)}`).join("\n\n");
}
async function runRound(deps, input) {
	const { members, topic, priorSummaries, signal, roundNumber } = input;
	const priorSteers = input.priorSteers ?? [];
	const utterances = [];
	const humanSteers = [];
	for (const member of members) {
		const promptParts = [`你正在参加一场圆桌讨论。\n\n**本轮话题：** ${topic}`];
		if (priorSummaries.length > 0) promptParts.push(`**前几轮纪要：**\n${renderPriorSummaries(priorSummaries)}`);
		if (priorSteers.length > 0) promptParts.push(`**前几轮人类意见：**\n${priorSteers.join("\n")}`);
		if (utterances.length > 0) {
			const history = utterances.map((u) => `【${u.label}】${textOf$1(u.output)}`).join("\n\n");
			promptParts.push(`**本轮已有发言：**\n${history}`);
		}
		if (humanSteers.length > 0) promptParts.push(`**人类插入的意见：**\n${humanSteers.join("\n")}`);
		promptParts.push(`\n请在圆桌中扮演「${member.label}」，就本轮话题发表你的观点（可回应前面成员的发言）。`);
		const utterance = await deps.runMember(member, promptParts.join("\n\n"), signal);
		utterances.push(utterance);
		for (const steer of deps.claimSteer()) humanSteers.push(steer);
	}
	return {
		roundNumber,
		topic,
		utterances,
		humanSteers,
		summary: await deps.summarize(members, utterances, topic, humanSteers, {
			rounds: priorSummaries,
			steers: priorSteers
		})
	};
}
//#endregion
//#region lib/types/member-runner.js
function createMemberRunner(deps) {
	return async (member, prompt, signal) => {
		const run = await deps.subagents.start(deps.provider, {
			label: member.label,
			prompt: [{
				type: "text",
				text: prompt
			}],
			parent: deps.parent,
			...member.persona !== void 0 ? { persona: member.persona } : {},
			...member.agentOptions !== void 0 ? { agentOptions: member.agentOptions } : {},
			...member.toolFilter !== void 0 ? { toolFilter: member.toolFilter } : {},
			...member.maxDepth !== void 0 ? { maxDepth: member.maxDepth } : {},
			signal
		});
		try {
			const result = await run.result;
			if (result.stopReason !== "completed") throw new Error(`roundtable member "${member.label}" stopped: ${result.stopReason}`);
			return {
				memberId: member.id,
				label: member.label,
				output: result.output,
				stopReason: result.stopReason
			};
		} finally {
			await run.dispose();
		}
	};
}
//#endregion
//#region lib/types/driver.js
/** Command words recognized as "stop" (matched case-insensitively, on the leading word). Longer first so "停止讨论" wins over "停止" (mirrors "继续讨论" over "继续"). */
const STOP_WORDS = [
	"停止讨论",
	"停止",
	"结束",
	"终止",
	"stop",
	"end",
	"quit"
];
/** Command words recognized as "continue" (longer first so "继续讨论" wins over "继续"). */
const CONTINUE_WORDS = [
	"继续讨论",
	"下一轮",
	"继续",
	"continue",
	"next"
];
/** Short-message fallback length cap: beyond this the reply is treated as an opinion, never a gate. */
const SHORT_REPLY_LIMIT = 16;
/** Light lead-ins that may precede a directive word inside a short reply. */
const SHORT_LEAD_INS = new Set([
	"",
	"我们",
	"咱们",
	"请",
	"先",
	"好",
	"好的",
	"行",
	"行吧",
	"就",
	"那",
	"那么",
	"那就",
	"我们就",
	"那我们就",
	"那咱们",
	"嗯",
	"哦",
	"可以",
	"please",
	"ok",
	"okay"
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
function parseGateReply(text) {
	const trimmed = text.trim();
	if (trimmed === "") return void 0;
	const lower = trimmed.toLowerCase();
	const lead = (word) => {
		if (lower === word) return "";
		if (lower.startsWith(`${word}，`) || lower.startsWith(`${word},`) || lower.startsWith(`${word}.`) || lower.startsWith(`${word}：`) || lower.startsWith(`${word}:`) || lower.startsWith(`${word} `) || lower.startsWith(`${word}。`) || lower.startsWith(`${word}、`)) return trimmed.slice(word.length).replace(/^[，,.:：。、\s]+/, "");
	};
	for (const word of STOP_WORDS) {
		const opinion = lead(word);
		if (opinion !== void 0) return {
			gate: "stop",
			opinion
		};
	}
	for (const word of CONTINUE_WORDS) {
		const opinion = lead(word);
		if (opinion !== void 0) return {
			gate: "continue",
			opinion
		};
	}
	if (trimmed.length > SHORT_REPLY_LIMIT) return void 0;
	const stopWord = STOP_WORDS.find((word) => lower.includes(word));
	const continueWord = CONTINUE_WORDS.find((word) => lower.includes(word));
	if (stopWord !== void 0 && continueWord !== void 0) return void 0;
	const directive = stopWord ?? continueWord;
	if (directive === void 0) return void 0;
	const at = lower.indexOf(directive);
	const prefix = trimmed.slice(0, at).replace(/[\s，,.:：。、]+$/, "");
	if (!SHORT_LEAD_INS.has(prefix)) return void 0;
	const trailing = trimmed.slice(at + directive.length).replace(/^[\s，,.:：。、]+/, "");
	if (trailing !== "" && !TRAILING_PARTICLES.test(trailing)) return void 0;
	return {
		gate: stopWord !== void 0 ? "stop" : "continue",
		opinion: ""
	};
}
/** Render the topic a round runs under, folding in a "继续" opinion. */
function roundTopic(baseTopic, opinion) {
	if (opinion === void 0 || opinion.trim() === "") return baseTopic;
	return `${baseTopic}（人类「继续」新意见：${opinion.trim()}）`;
}
function createRoundtableDriver(deps, input) {
	const { topic, members, signal } = input;
	const seedRounds = input.seedRounds ?? [];
	const resumedUnsettled = input.resumedUnsettled ?? false;
	const discussion = {
		id: input.id ?? RoundtableId(`rt-${crypto.randomUUID()}`),
		roster: members,
		rounds: [...seedRounds],
		status: "active"
	};
	let phase = seedRounds.length > 0 || resumedUnsettled ? "awaitingGate" : "idle";
	let started = seedRounds.length > 0 || resumedUnsettled;
	let terminal = false;
	const assertActive = () => {
		if (terminal || discussion.status !== "active") throw new Error(`roundtable discussion "${discussion.id}" is ${discussion.status}`);
	};
	async function runNextRound(roundTopicValue) {
		assertActive();
		phase = "running";
		const roundNumber = discussion.rounds.length + 1;
		try {
			const minutes = await runRound({
				runMember: deps.runMember,
				summarize: deps.summarize,
				claimSteer: deps.claimSteer
			}, {
				roundNumber,
				topic: roundTopicValue,
				members,
				priorSummaries: discussion.rounds.slice(-3).map((round) => ({
					roundNumber: round.roundNumber,
					summary: round.summary
				})),
				priorSteers: discussion.rounds.slice(-3).flatMap((round) => round.humanSteers),
				signal
			});
			if (terminal || discussion.status !== "active") throw new Error(`roundtable discussion "${discussion.id}" settled (${discussion.status}) while round ${roundNumber} ran; discarding its minutes`);
			discussion.rounds.push(minutes);
			phase = "awaitingGate";
			deps.askNextRound(minutes);
			return minutes;
		} catch (error) {
			fail(signal.aborted ? "cancelled" : "error");
			throw error;
		}
	}
	function start() {
		if (started) throw new Error("roundtable discussion already started");
		started = true;
		return runNextRound(topic);
	}
	function continueRound(opinion) {
		if (!started) throw new Error("roundtable discussion not started");
		if (terminal) throw new Error(`roundtable discussion "${discussion.id}" already ${discussion.status}`);
		if (phase !== "awaitingGate") throw new Error(`roundtable discussion "${discussion.id}" is not awaiting the gate (phase: ${phase})`);
		return runNextRound(roundTopic(topic, opinion));
	}
	async function stop() {
		assertActive();
		if (phase !== "awaitingGate" && phase !== "idle") throw new Error(`roundtable discussion "${discussion.id}" cannot stop while ${phase} (only awaitingGate or idle)`);
		terminal = true;
		discussion.status = "completed";
		phase = "completed";
		const markdown = serializeRoundtableMarkdown(discussion);
		if (deps.writeMarkdown !== void 0) try {
			await deps.writeMarkdown(markdown);
		} catch (error) {
			discussion.status = "error";
			phase = "error";
			throw error;
		}
		return markdown;
	}
	function fail(reason) {
		if (terminal) return;
		terminal = true;
		discussion.status = reason;
		phase = reason;
	}
	return {
		get discussion() {
			return discussion;
		},
		get phase() {
			return phase;
		},
		start,
		continueRound,
		stop,
		fail
	};
}
/** Default meeting-host persona used to produce each round's summary. */
const HOST_PERSONA = "你是会议主持人，负责客观汇总本轮圆桌讨论并给出「纪要 + 结论」。";
function textOf(blocks) {
	return blocks.map((block) => block.type === "text" ? block.text ?? "" : "").join("");
}
/** Render a thrown value into a loggable string without trusting it. */
function renderDriverError(error) {
	try {
		return error instanceof Error ? error.message : String(error);
	} catch {
		return "[unrenderable thrown value]";
	}
}
/**
* Build the `summarize` seam: run a dedicated host-persona subagent that turns
* this round's utterances into `summary` content blocks. From round 2 on it
* also receives the prior rounds' summaries and human steers, so the summary
* (and the final conclusion) reflects the whole discussion arc, not just the
* current round.
*/
function createHostSummarizer(deps) {
	const persona = deps.persona ?? HOST_PERSONA;
	return async (members, utterances, topic, humanSteers, prior) => {
		const transcript = utterances.length === 0 ? "（无成员发言）" : utterances.map((u) => `【${u.label}】${textOf(u.output)}`).join("\n\n");
		const steers = humanSteers.length === 0 ? "（无）" : humanSteers.map((s) => `- ${s}`).join("\n");
		const priorSummaries = prior === void 0 || prior.rounds.length === 0 ? "（无，本轮为第 1 轮）" : prior.rounds.map((round) => `### 第 ${round.roundNumber} 轮纪要\n\n${textOf(round.summary)}`).join("\n\n");
		const priorSteers = prior === void 0 || prior.steers.length === 0 ? "（无）" : prior.steers.map((s) => `- ${s}`).join("\n");
		const prompt = [
			"你是本次圆桌讨论的会议主持人，请产出「本轮纪要 + 结论」。",
			`本轮话题：${topic}`,
			`前几轮纪要（用于把握整场讨论脉络，使本轮结论衔接前文）：\n${priorSummaries}`,
			`前几轮人类插入的意见：\n${priorSteers}`,
			`成员（${members.map((m) => m.label).join("、")}）发言：`,
			transcript,
			`本轮人类插入的意见（如无则写「无」，如有则须在纪要中体现）：\n${steers}`
		].join("\n\n");
		const run = await deps.subagents.start(deps.provider, {
			label: "会议主持人",
			prompt: [{
				type: "text",
				text: prompt
			}],
			parent: deps.parent,
			persona,
			signal: deps.signal
		});
		try {
			const result = await run.result;
			if (result.stopReason !== "completed") throw new Error(`roundtable host summarizer stopped: ${result.stopReason}`);
			return result.output;
		} finally {
			await run.dispose();
		}
	};
}
function assertValidRoster(members, maxMembers = 8) {
	if (members.length === 0) throw new RoundtableError("roster is empty", "ROSTER_INVALID");
	if (members.length > maxMembers) throw new RoundtableError(`roster exceeds maxMembers (${maxMembers})`, "ROSTER_INVALID");
	if (new Set(members.map((m) => m.id)).size !== members.length) throw new RoundtableError("duplicate member id", "ROSTER_INVALID");
}
function createRoundtableHostDriver(ctx, deps) {
	const recorder = createRoundtableRecorder(ctx);
	const registry = /* @__PURE__ */ new Map();
	const defaultWriteMarkdown = async (markdown, outputFile) => {
		const fs = ctx.fs;
		const target = await fs.resolve(outputFile);
		await fs.writeText(target, markdown);
	};
	const writeMarkdown = deps.writeMarkdown ?? defaultWriteMarkdown;
	function emitEvent(name, ...args) {
		for (const callback of ctx.events.dispatch("emit", [name, ...args])) try {
			Promise.resolve(callback(...args)).catch((error) => {
				ctx.logger.warn(`roundtable: ${name} listener rejected: ${String(error)}`);
			});
		} catch (error) {
			ctx.logger.warn(`roundtable: ${name} listener threw: ${String(error)}`);
		}
	}
	/** Mid-round steer claim: claim only human `user` steers, leaving other pending input queued. */
	function claimSteer() {
		return deps.host.inbox.claimWhere((message) => message.source.kind === "user", 0).map((message) => textOf(message.content).trim()).filter((text) => text !== "");
	}
	function settle(id, reason) {
		const entry = registry.get(id);
		if (entry === void 0 || entry.settled !== void 0) return;
		entry.settled = reason;
		if (reason !== "completed") entry.core.fail(reason);
		emitEvent("roundtable/end", entry.info, reason);
		recorder.finish(id, reason);
		registry.delete(id);
	}
	function requireEntry(id) {
		const entry = registry.get(id);
		if (entry === void 0) throw new RoundtableError(`unknown discussion "${id}"`, "DISCUSSION_UNKNOWN");
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
				subagents: ctx.subagents,
				provider: deps.provider,
				parent: deps.host
			}),
			summarize: createHostSummarizer({
				subagents: ctx.subagents,
				provider: deps.provider,
				parent: deps.host,
				...deps.hostPersona !== void 0 ? { persona: deps.hostPersona } : {},
				signal
			}),
			claimSteer,
			...outputFile !== void 0 ? { writeMarkdown: (markdown) => writeMarkdown(markdown, outputFile) } : {},
			askNextRound: (minutes) => {
				emitEvent("roundtable/round-end", info, minutes);
				deps.askNextRound?.(info.id, minutes);
			}
		}, {
			id: info.id,
			topic: info.topic,
			members: info.roster,
			signal,
			...seedRounds !== void 0 ? { seedRounds } : {},
			...resumedUnsettled ? { resumedUnsettled: true } : {}
		});
	}
	/** Expose one registry entry through the stable handle face. */
	function handleOf(entry) {
		return {
			id: entry.info.id,
			get discussion() {
				return entry.core.discussion;
			},
			get phase() {
				return entry.core.phase;
			},
			get started() {
				return entry.started;
			}
		};
	}
	return {
		startDiscussion(request) {
			assertValidRoster(request.members, deps.maxMembers ?? 8);
			const controller = new AbortController();
			const signal = request.signal === void 0 ? controller.signal : AbortSignal.any([request.signal, controller.signal]);
			const id = RoundtableId(`rt-${crypto.randomUUID()}`);
			const info = {
				id,
				roster: request.members,
				topic: request.topic,
				...request.outputFile !== void 0 ? { outputFile: request.outputFile } : {}
			};
			const core = buildCore(info, signal);
			const entry = {
				core,
				info,
				controller,
				signal,
				settled: void 0,
				started: Promise.resolve(void 0)
			};
			registry.set(id, entry);
			emitEvent("roundtable/start", info);
			recorder.start(deps.host.session, info);
			entry.started = core.start().catch((error) => {
				const reason = signal.aborted ? "cancelled" : "error";
				if (entry.settled === void 0) settle(id, reason);
				ctx.logger.warn(`roundtable: discussion "${id}" settled ${reason} from round 1: ${renderDriverError(error)}`);
			});
			return handleOf(entry);
		},
		async continueRound(id, opinion) {
			const entry = requireEntry(id);
			try {
				return await entry.core.continueRound(opinion);
			} catch (error) {
				const phase = entry.core.phase;
				if (phase !== "error" && phase !== "cancelled") return;
				settle(id, entry.signal.aborted ? "cancelled" : "error");
				ctx.logger.warn(`roundtable: discussion "${id}" settled ${phase} while running a round: ${renderDriverError(error)}`);
				return;
			}
		},
		async stopDiscussion(id) {
			const entry = requireEntry(id);
			try {
				const markdown = await entry.core.stop();
				settle(id, "completed");
				return markdown;
			} catch (error) {
				const phase = entry.core.phase;
				if (phase === "running" || phase === "idle" || phase === "awaitingGate") throw error;
				settle(id, "error");
				throw error;
			}
		},
		cancelDiscussion(id, reason) {
			const entry = registry.get(id);
			if (entry === void 0) return;
			if (entry.core.phase === "completed") return;
			entry.controller.abort(reason);
			settle(id, "cancelled");
		},
		get: (id) => {
			const entry = registry.get(id);
			if (entry === void 0) return void 0;
			return handleOf(entry);
		},
		recover(session) {
			const handles = [];
			for (const recovered of recoverRoundtableDiscussions(session.events)) {
				const { info, rounds } = recovered;
				if (registry.has(info.id)) continue;
				const controller = new AbortController();
				const entry = {
					core: buildCore(info, controller.signal, rounds.length > 0 ? rounds : void 0, rounds.length === 0),
					info,
					controller,
					signal: controller.signal,
					settled: void 0,
					started: rounds.length > 0 ? Promise.resolve(rounds[0]) : Promise.resolve(void 0)
				};
				registry.set(info.id, entry);
				recorder.resume(session, info);
				handles.push(handleOf(entry));
			}
			return handles;
		},
		dispose() {
			for (const entry of registry.values()) {
				entry.controller.abort("roundtable-host driver disposed");
				if (entry.settled === void 0) settle(entry.info.id, entry.core.phase === "completed" ? "completed" : "cancelled");
			}
			registry.clear();
			recorder.dispose();
		}
	};
}
//#endregion
//#region lib/types/engine.js
/**
* The concrete roundtable engine provider: registers `ctx.roundtable` and runs
* one single-round discussion per `start()` call. Mirrors `WorkerThreadWorkflowEngine`
* (the concrete `WorkflowEngine` provider) — but the roundtable seam `RoundtableEngine`
* and its provider share this package, so this class IS the seam's loadable entry.
*/
var RoundtableEngineProvider = class extends RoundtableEngine {
	static inject = ["subagents", "fs"];
	static Config = z.object({
		provider: z.string().default("spawn"),
		maxMembers: z.number().default(8)
	});
	provider;
	maxMembers;
	recorder;
	constructor(ctx, config) {
		super(ctx);
		this.provider = config.provider ?? "spawn";
		this.maxMembers = config.maxMembers ?? 8;
		this.recorder = createRoundtableRecorder(ctx);
	}
	start(request) {
		if (request.members.length === 0) throw new RoundtableError("roster is empty", "ROSTER_INVALID");
		if (request.members.length > this.maxMembers) throw new RoundtableError(`roster exceeds maxMembers (${this.maxMembers})`, "ROSTER_INVALID");
		if (new Set(request.members.map((m) => m.id)).size !== request.members.length) throw new RoundtableError("duplicate member id", "ROSTER_INVALID");
		const llm = this.ctx.get("llm");
		if (llm !== void 0) {
			const available = new Set(llm.listProviders().map((entry) => entry.id));
			for (const member of request.members) {
				const provider = member.agentOptions?.provider;
				if (provider !== void 0 && !available.has(provider)) throw new RoundtableError(`member "${member.id}" routes to provider "${provider}" which is not registered (available: ${[...available].join(", ") || "none"})`, "ROSTER_INVALID");
			}
		}
		const id = RoundtableId(`rt-${crypto.randomUUID()}`);
		const info = {
			id,
			roster: request.members,
			topic: request.topic,
			...request.outputFile !== void 0 ? { outputFile: request.outputFile } : {}
		};
		const controller = new AbortController();
		const signal = request.signal === void 0 ? controller.signal : AbortSignal.any([request.signal, controller.signal]);
		const provider = request.provider ?? this.provider;
		this.emitRoundtableEvent("roundtable/start", info);
		this.recorder.start(request.parent.session, info);
		const memberRunner = createMemberRunner({
			subagents: this.ctx.subagents,
			provider,
			parent: request.parent
		});
		const summarize = request.synthesize === false ? async () => [] : createHostSummarizer({
			subagents: this.ctx.subagents,
			provider,
			parent: request.parent,
			signal
		});
		const claimSteer = () => [];
		let disposed = false;
		const settledRounds = [];
		let membersStarted = 0;
		const runMember = async (member, prompt, signal) => {
			membersStarted += 1;
			return memberRunner(member, prompt, signal);
		};
		const result = (async () => {
			try {
				const minutes = await runRound({
					runMember,
					summarize,
					claimSteer
				}, {
					roundNumber: 1,
					topic: request.topic,
					members: request.members,
					priorSummaries: [],
					signal
				});
				settledRounds.push(minutes);
				this.emitRoundtableEvent("roundtable/round-end", info, minutes);
				const markdown = serializeRoundtableMarkdown({
					id,
					roster: request.members,
					rounds: [minutes],
					status: "completed"
				}, { synthesize: request.synthesize !== false });
				if (request.outputFile !== void 0) {
					const fs = this.ctx.fs;
					await fs.writeText(await fs.resolve(request.outputFile), markdown);
				}
				this.emitRoundtableEvent("roundtable/end", info, "completed");
				this.recorder.finish(id, "completed");
				return {
					stopReason: "completed",
					agentsStarted: request.members.length,
					rounds: settledRounds
				};
			} catch (error) {
				if (signal.aborted) {
					this.emitRoundtableEvent("roundtable/end", info, "cancelled");
					this.recorder.finish(id, "cancelled");
					return {
						stopReason: "cancelled",
						agentsStarted: membersStarted,
						rounds: settledRounds
					};
				}
				this.ctx.logger.warn(`roundtable: discussion "${id}" settled error: ${renderDriverError(error)}`);
				this.emitRoundtableEvent("roundtable/end", info, "error");
				this.recorder.finish(id, "error");
				return {
					stopReason: "error",
					agentsStarted: membersStarted,
					rounds: settledRounds
				};
			}
		})();
		return {
			id,
			result,
			cancel: (reason) => {
				controller.abort(reason);
			},
			dispose: async () => {
				if (disposed) return;
				disposed = true;
				controller.abort();
				await result;
			}
		};
	}
};
/** Back-compat factory: build the provider instance for direct/in-process use. */
function createRoundtableEngine(ctx, deps) {
	return new RoundtableEngineProvider(ctx, { provider: deps.provider });
}
//#endregion
export { RoundtableEngine, RoundtableEngineProvider, RoundtableEngineProvider as default, RoundtableError, RoundtableId, createHostSummarizer, createRoundtableDriver, createRoundtableEngine, createRoundtableHostDriver, createRoundtableRecorder, parseGateReply, recoverRoundtableDiscussions, serializeRoundtableMarkdown };
