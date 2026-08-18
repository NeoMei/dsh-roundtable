/**
 * Cross-process recovery fold: rebuild the discussions that never settled from
 * a session's durable `roundtable/*` event log. Mirrors the goal domain's pure
 * replay fold (packages/goal/goal/src/fold.ts): a `roundtable/start` opens a
 * discussion, each `roundtable/round-end` appends one settled round's minutes,
 * and `roundtable/end` closes it. Whatever is still open after the log ends is
 * a discussion that can be resumed ("继续"/"停止") in a later process.
 *
 * @module @deepseek-ai/dsh-roundtable/recovery
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RoundMinutes, RoundtableInfo, RoundtableId } from './types.ts'

/** One durable-but-unsettled discussion reconstructed from the log. */
export interface RecoveredRoundtableDiscussion {
  /** The stable identity and fixed roster from the `roundtable/start` event. */
  readonly info: RoundtableInfo
  /** Settled rounds accumulated from `roundtable/round-end` events, in order. */
  readonly rounds: RoundMinutes[]
}

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
export function recoverRoundtableDiscussions(
  events: readonly SessionEvent[],
): RecoveredRoundtableDiscussion[] {
  const active = new Map<RoundtableId, { info: RoundtableInfo; rounds: RoundMinutes[] }>()
  // Ids closed by a `roundtable/end` must never be re-opened by a stray
  // duplicate `start` (or a round-end after the end): a settled discussion is
  // not resumable.
  const closed = new Set<RoundtableId>()
  for (const event of events) {
    switch (event.type) {
      case 'roundtable/start': {
        const id = event.data.id
        // A start while the discussion is already open, or after it settled,
        // is stale (ids are unique UUIDs) — ignore it rather than resetting
        // the accumulated rounds or re-opening a closed discussion.
        if (active.has(id) || closed.has(id)) break
        active.set(id, { info: event.data, rounds: [] })
        break
      }
      case 'roundtable/round-end': {
        const discussion = active.get(event.data.discussionId)
        if (discussion !== undefined) discussion.rounds.push(event.data.minutes)
        break
      }
      case 'roundtable/end': {
        const id = event.data.discussionId
        closed.add(id)
        active.delete(id)
        break
      }
      default:
        break
    }
  }
  return [...active.values()].map(entry => ({ info: entry.info, rounds: entry.rounds }))
}
