/**
 * Live host-loop wiring for multi-round roundtable discussions.
 *
 * Where {@link createRoundtableHostDriver} is the injectable discussion-level
 * adapter, this plugin is the live seam that owns it: it holds one discussion
 * registry per host {@link @deepseek-ai/dsh-agent#Agent}, routes a human chat
 * message into the steer queue versus the round gate, and presents
 * "是否进入下一轮？" as the host's own follow-up turn. It mirrors
 * `@deepseek-ai/dsh-goal-round-driver`'s live-loop seams (`agent/pre-step`,
 * `agent/created` / `agent/disposed` / `agent/session-start`) without touching
 * the host agent's internal driver.
 *
 * The discussion is started through the `ctx.roundtableHost` service
 * (`startDiscussion`), which the member-selection UI (a follow-up task) calls.
 * The human-gated multi-round path is driven from there entirely by chat:
 * "继续" (optionally followed by an opinion) runs the next round, "停止"
 * serializes every round to markdown via `ctx.fs`, and any other human input
 * while a round is running is a mid-round steer claimed by the running round.
 *
 * @module @neomei/dsh-roundtable/host
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { RoundtableDiscussionHandle } from './driver.ts';
import type { RoundMinutes, RoundtableId, RoundtableMember } from './types.ts';
export declare const name = "roundtable-host";
/** Services this plugin injects: member/host subagents and the workspace filesystem. */
export declare const inject: string[];
export interface Config {
    /** `ctx.subagents` provider members and the host summarizer run on. */
    provider?: string;
    /** 成员上限，缺省 8（spec §6）。 */
    maxMembers?: number;
    /** 会议主持人 persona，缺省见 {@link createHostSummarizer}。 */
    hostPersona?: string;
}
export declare const Config: z<Config>;
/** Host's own "是否进入下一轮？" follow-up turn carries this source. */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        roundtable: {
            kind: 'roundtable';
            discussionId: RoundtableId;
        };
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        roundtableHost: RoundtableHostApi;
    }
}
/** Programmatic discussion start (the future member-selection UI's trigger). */
export interface RoundtableHostStartRequest {
    host: Agent;
    topic: string;
    members: RoundtableMember[];
    outputFile?: string;
}
/** Public host-loop surface, registered as `ctx.roundtableHost`. */
export interface RoundtableHostApi {
    /**
     * Start a discussion on the host agent's live loop: validate the roster,
     * register the discussion, and run round 1.
     * @param request - the host agent, topic, roster, and optional output file.
     * @returns the stable discussion handle (started promise, phase, minutes).
     */
    startDiscussion(request: RoundtableHostStartRequest): RoundtableDiscussionHandle;
    /**
     * Cancel a live discussion so it settles `cancelled`.
     * @param host - the host agent whose discussion to cancel.
     * @param id - the discussion id.
     */
    cancelDiscussion(host: Agent, id: RoundtableId): void;
    /**
     * Look up a live discussion on the host agent.
     * @param host - the host agent whose registry to query.
     * @param id - the discussion id.
     * @returns the discussion handle, or undefined when no such discussion is live.
     */
    get(host: Agent, id: RoundtableId): RoundtableDiscussionHandle | undefined;
}
/**
 * The host's own follow-up prompt for one settled round: report the minutes
 * and ask the human whether to enter the next round. Deterministic, mirroring
 * {@link renderGoalRoundPrompt}.
 */
export declare function renderNextRoundPrompt(minutes: RoundMinutes): ContentBlock[];
/** Install the live host loop and register `ctx.roundtableHost`. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=host.d.ts.map