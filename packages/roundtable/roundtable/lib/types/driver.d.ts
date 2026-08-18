/**
 * Multi-round roundtable driver: discussion state machine, human gate, and
 * mid-round steering, layered over the single-round {@link runRound} executor.
 *
 * Two layers, mirroring how `runRound` itself is built as a pure injectable core:
 *
 * - {@link createRoundtableDriver}: pure, injectable, stateful discussion core.
 *   It owns one {@link RoundtableDiscussion}, runs rounds sequentially via
 *   `runRound`, classifies the human gate ("继续/停止"), claims mid-round
 *   steers through an injected `claimSteer`, and on stop serializes every round
 *   to markdown and hands it to an injected `writeMarkdown`. No live agent loop
 *   is touched, so it is fully unit-testable with fakes.
 *
 * - {@link createRoundtableHostDriver}: thin host-agent adapter. It wires the
 *   core to the real seams — `ctx.subagents` (members + a host-persona
 *   summarizer), the host `Agent.inbox` (mid-round steer claim), the
 *   `roundtable/*` event bus and {@link createRoundtableRecorder} — and exposes
 *   the discussion-level API `startDiscussion` / `continueRound` /
 *   `stopDiscussion` / `cancelDiscussion`.
 *
 * The live-loop seam is shipped by the `roundtable-host` plugin (`host.ts`,
 * module `@neomei/dsh-roundtable/host`): an `agent/pre-step` interception
 * routes a human message into the steer queue while a round runs, versus the
 * gate reply while the host is awaiting it, and the host presents
 * "是否进入下一轮？" as its own follow-up turn. The gate classification,
 * next-round/stop routing, and steer injection all live here in the testable
 * core; `host.ts` only adds the
 * {@link @deepseek-ai/dsh-agent#Agent} loop wiring on top.
 *
 * @module @neomei/dsh-roundtable/driver
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import { type RunRoundDeps } from './executor.ts';
import { RoundtableId } from './types.ts';
import type { RoundMinutes, RoundtableDiscussion, RoundtableMember, RoundtableStopReason } from './types.ts';
/** The two human-gate commands that drive a discussion between rounds. */
export type RoundtableGate = 'continue' | 'stop';
/** A classified gate reply: which command, plus any trailing new opinion. */
export interface RoundtableGateReply {
    gate: RoundtableGate;
    /** Text after the command word ("继续" 时附带的新意见); empty for a bare command. */
    opinion: string;
}
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
export declare function parseGateReply(text: string): RoundtableGateReply | undefined;
/** Lifecycle phase of one discussion, finer than `RoundtableDiscussion.status`. */
export type RoundtableDriverPhase = 'idle' | 'running' | 'awaitingGate' | RoundtableStopReason;
/** Injected seams for the discussion core (extends the single-round executor deps). */
export interface RoundtableDriverDeps extends RunRoundDeps {
    /**
     * On stop: write the serialized markdown (host `ctx.fs.writeText` wiring).
     * Only wired when an output file was explicitly requested — without one
     * `stop()` skips the write and returns the markdown (the skill/client owns
     * writing the final file), so no UUID-default artifact is dropped at the
     * fs root.
     */
    writeMarkdown?(markdown: string): Promise<void>;
    /** After each round: the host presents the minutes and asks "是否进入下一轮？". */
    askNextRound(minutes: RoundMinutes): void;
}
export interface RoundtableDriverInput {
    id?: RoundtableId;
    topic: string;
    members: RoundtableMember[];
    signal: AbortSignal;
    /**
     * Rounds recovered from the durable `roundtable/round-end` log (cross-process
     * recovery). When non-empty the discussion is reconstructed as already
     * started and awaiting the human gate, so `continueRound`/`stop` resume it
     * instead of re-running round 1.
     */
    seedRounds?: readonly RoundMinutes[];
    /**
     * True for a discussion recovered mid-round-1: only `roundtable/start`
     * settled (the durable payload carries the topic), so no round has minutes
     * yet, but the discussion is already open and awaiting the gate — the first
     * "继续" re-runs round 1 from the durable topic.
     */
    resumedUnsettled?: boolean;
}
/** The pure, injectable, stateful multi-round discussion core. */
export interface RoundtableDriver {
    readonly discussion: RoundtableDiscussion;
    readonly phase: RoundtableDriverPhase;
    /** Run round 1. Rejects on member/summarize infrastructure failure or abort. */
    start(): Promise<RoundMinutes>;
    /** Run the next round; `opinion` is the human "继续" reply's trailing opinion. */
    continueRound(opinion?: string): Promise<RoundMinutes>;
    /**
     * Serialize every round to markdown, hand it to `writeMarkdown` when wired,
     * and settle `completed`. The terminal transition happens SYNCHRONOUSLY at
     * entry — before the async write — so a "继续" racing the write is rejected
     * instead of starting a round that would be silently discarded. If the write
     * throws, the terminal status is corrected to `error`: no artifact exists.
     */
    stop(): Promise<string>;
    /** Idempotently settle the discussion as `cancelled` or `error`. */
    fail(reason: Exclude<RoundtableStopReason, 'completed'>): void;
}
export declare function createRoundtableDriver(deps: RoundtableDriverDeps, input: RoundtableDriverInput): RoundtableDriver;
export interface HostSummarizerDeps {
    subagents: SubagentRuntime;
    provider: string;
    parent: Agent;
    persona?: string;
    signal: AbortSignal;
}
/** Render a thrown value into a loggable string without trusting it. */
export declare function renderDriverError(error: unknown): string;
/**
 * Build the `summarize` seam: run a dedicated host-persona subagent that turns
 * this round's utterances into `summary` content blocks. From round 2 on it
 * also receives the prior rounds' summaries and human steers, so the summary
 * (and the final conclusion) reflects the whole discussion arc, not just the
 * current round.
 */
export declare function createHostSummarizer(deps: HostSummarizerDeps): RunRoundDeps['summarize'];
export interface StartDiscussionRequest {
    topic: string;
    members: RoundtableMember[];
    outputFile?: string;
    signal?: AbortSignal;
}
export interface RoundtableDiscussionHandle {
    readonly id: RoundtableId;
    readonly discussion: RoundtableDiscussion;
    readonly phase: RoundtableDriverPhase;
    /** Round-1 minutes, or `undefined` if round 1 settled `cancelled`/`error`. */
    readonly started: Promise<RoundMinutes | undefined>;
}
export interface RoundtableHostDriverDeps {
    provider: string;
    host: Agent;
    hostPersona?: string;
    /** 成员上限，缺省 8（spec §6）。 */
    maxMembers?: number;
    /** Stop-time markdown write; defaults to a `ctx.fs`-backed writer when omitted. */
    writeMarkdown?(markdown: string, outputFile: string): Promise<void>;
    /** Optional per-round "是否进入下一轮？" presentation; default relies on `roundtable/round-end`. */
    askNextRound?(discussionId: RoundtableId, minutes: RoundMinutes): void;
}
export interface RoundtableHostDriver {
    /** Validate the roster, register the discussion, and start round 1. */
    startDiscussion(request: StartDiscussionRequest): RoundtableDiscussionHandle;
    /** Human gate "继续": run the next round with the prior summaries (and any opinion). */
    continueRound(id: RoundtableId, opinion?: string): Promise<RoundMinutes | undefined>;
    /** Human gate "停止": serialize all rounds to markdown, write it, and settle `completed`. */
    stopDiscussion(id: RoundtableId): Promise<string>;
    /** Cancel a live discussion so it settles `cancelled`. */
    cancelDiscussion(id: RoundtableId, reason?: string): void;
    get(id: RoundtableId): RoundtableDiscussionHandle | undefined;
    /**
     * Rebuild every durable-but-unsettled discussion from a session event log
     * into the registry (spec §8 cross-process recovery). A discussion with at
     * least one settled round resumes awaiting the gate with its settled minutes;
     * a discussion interrupted mid-round-1 (only `roundtable/start`) resumes
     * open-but-unsettled from the durable topic, and the first "继续" re-runs
     * round 1.
     */
    recover(session: Session): RoundtableDiscussionHandle[];
    /**
     * Agent teardown: cancel any still-live discussion (settling `cancelled`)
     * and dispose the driver's per-agent recorder — detaching its shared
     * `roundtable/round-*` listeners so no per-agent listener accumulates on the
     * root context (review #1).
     */
    dispose(): void;
}
export declare function createRoundtableHostDriver(ctx: Context, deps: RoundtableHostDriverDeps): RoundtableHostDriver;
//# sourceMappingURL=driver.d.ts.map