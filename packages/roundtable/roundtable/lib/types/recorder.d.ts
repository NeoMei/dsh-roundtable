/**
 * Minutes store: project each settled round's minutes and the terminal
 * settlement into the calling parent Session as durable `roundtable/*` events.
 * Mirrors `createWorkflowRecorder` in packages/workflow/tool-workflow.
 * @module @neomei/dsh-roundtable/recorder
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { RoundtableId, RoundtableInfo, RoundtableStopReason } from './types.ts';
/** Projects live `roundtable/*` events into durable parent-Session records. */
export interface RoundtableRecorder {
    /** Register the parent Session that will receive this discussion's records. */
    start(session: Session, info: RoundtableInfo): void;
    /**
     * Re-register a discussion whose `roundtable/start` record is ALREADY in the
     * session log (cross-process recovery): continuation `roundtable/round-end`
     * and `roundtable/end` records append to the same session, without writing a
     * duplicate `roundtable/start`.
     */
    resume(session: Session, info: RoundtableInfo): void;
    /** Append the terminal settlement and drop the discussion. */
    finish(discussionId: RoundtableId, stopReason: RoundtableStopReason): void;
    /** Drop the discussion without appending a terminal record. */
    abandon(discussionId: RoundtableId): void;
}
/**
 * Recorder plus its own teardown. The `roundtable/round-end` listener is
 * registered on the SHARED context, so a per-agent recorder (host-driver per
 * agent) would otherwise accumulate one listener per agent forever: `dispose()`
 * detaches it and drops the active-discussion map.
 */
export interface RoundtableRecorderHandle extends RoundtableRecorder {
    /** Detach the shared round-* listeners and drop all active discussions. */
    dispose(): void;
}
/**
 * Project active roundtable discussions into their parent Sessions without
 * letting recording failure affect discussion execution.
 */
export declare function createRoundtableRecorder(ctx: Context): RoundtableRecorderHandle;
//# sourceMappingURL=recorder.d.ts.map