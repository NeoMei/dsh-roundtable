/**
 * Roundtable capability seam: the `roundtable` Service contract, its error
 * type, and the `roundtable/*` event vocabulary. Kept separate from the barrel
 * so the concrete provider (`engine.ts`) and the drivers can import the seam
 * without a module cycle through `index.ts`.
 * @module @deepseek-ai/dsh-roundtable/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  RoundMinutes, RoundtableInfo,
} from './types.ts'
import type { RoundtableRun, RoundtableStartRequest } from './runtime-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { roundtable: RoundtableEngine }
  interface Events {
    /**
     * A roundtable discussion was opened with its fixed roster and topic.
     * Listeners may record the start or prepare discussion-scoped state; the
     * payload carries the topic so a discussion interrupted mid-round-1 can be
     * recovered from the durable log.
     * @param info - the discussion identity, roster, and topic (and output file when requested).
     * @mode emit
     */
    'roundtable/start'(info: RoundtableInfo): void
    /**
     * A round settled: `minutes` carry the summary and member utterances, and
     * the host presents the human gate ("继续"/"停止"). Listeners may persist
     * the minutes (the recorder maps this to a durable session record) or
     * drive the next-round presentation.
     * @param info - the discussion identity, roster, and topic.
     * @param minutes - the settled round's minutes (summary + utterances).
     * @mode emit
     */
    'roundtable/round-end'(info: RoundtableInfo, minutes: RoundMinutes): void
    /**
     * The discussion settled with `stopReason` ('completed' | 'cancelled' |
     * 'error'). Listeners may release discussion-scoped resources or fold the
     * terminal state into a durable status.
     * @param info - the discussion identity, roster, and topic.
     * @param stopReason - why the discussion ended.
     * @mode emit
     */
    'roundtable/end'(info: RoundtableInfo, stopReason: 'completed' | 'cancelled' | 'error'): void
  }
}

/** Roundtable error codes actually thrown across the seam: roster validation (engine + host driver), an unknown discussion id, and the host loop's single-active guard. */
export type RoundtableErrorCode = 'ROSTER_INVALID' | 'DISCUSSION_UNKNOWN' | 'DISCUSSION_ACTIVE'

export class RoundtableError extends HarnessError {
  constructor(message: string, code: RoundtableErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'RoundtableError'
  }
}

/** Abstract roundtable service seam: starts a multi-round discussion and
 * returns its live run handle. The concrete provider (`engine.ts`) and the
 * host-loop driver implement it. */
export abstract class RoundtableEngine extends Service {
  constructor(ctx: Context) { super(ctx, 'roundtable') }
  /**
   * Start a roundtable discussion: run round 1 over the request's roster and
   * topic, emitting the `roundtable/*` events as it progresses.
   * @param request - the topic, roster, and optional output file for the discussion.
   * @returns the live run handle; its result resolves to the exported markdown on stop.
   */
  abstract start(request: RoundtableStartRequest): RoundtableRun
  protected emitRoundtableEvent(name: string, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try { void Promise.resolve((callback as (...a: unknown[]) => unknown)(...args)).catch(e => this.ctx.logger.warn(`roundtable: ${name} listener rejected: ${String(e)}`)) }
      catch (e) { this.ctx.logger.warn(`roundtable: ${name} listener threw: ${String(e)}`) }
    }
  }
}
