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
export function recoverRoundtableDiscussions(events) {
    const active = new Map();
    // Ids closed by a `roundtable/end` must never be re-opened by a stray
    // duplicate `start` (or a round-end after the end): a settled discussion is
    // not resumable.
    const closed = new Set();
    for (const event of events) {
        switch (event.type) {
            case 'roundtable/start': {
                const id = event.data.id;
                // A start while the discussion is already open, or after it settled,
                // is stale (ids are unique UUIDs) — ignore it rather than resetting
                // the accumulated rounds or re-opening a closed discussion.
                if (active.has(id) || closed.has(id))
                    break;
                active.set(id, { info: event.data, rounds: [] });
                break;
            }
            case 'roundtable/round-end': {
                const discussion = active.get(event.data.discussionId);
                if (discussion !== undefined)
                    discussion.rounds.push(event.data.minutes);
                break;
            }
            case 'roundtable/end': {
                const id = event.data.discussionId;
                closed.add(id);
                active.delete(id);
                break;
            }
            default:
                break;
        }
    }
    return [...active.values()].map(entry => ({ info: entry.info, rounds: entry.rounds }));
}
//# sourceMappingURL=recovery.js.map