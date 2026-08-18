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
    }
    catch {
        return '[unrenderable thrown value]';
    }
}
/**
 * Project active roundtable discussions into their parent Sessions without
 * letting recording failure affect discussion execution.
 */
export function createRoundtableRecorder(ctx) {
    const active = new Map();
    const disposers = [];
    const append = (session, type, data) => {
        // These package-owned events are all log-only. Narrowing the generic
        // append face here discharges Session.append's conditional options tuple.
        const appendRecord = session.append.bind(session);
        try {
            appendRecord(type, data);
            return true;
        }
        catch (error) {
            ctx.logger.warn(`roundtable: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`);
            return false;
        }
    };
    disposers.push(ctx.on('roundtable/round-end', (info, minutes) => {
        const session = active.get(info.id);
        if (session === undefined)
            return;
        if (!append(session, 'roundtable/round-end', { discussionId: info.id, minutes }))
            active.delete(info.id);
    }));
    return {
        start(session, info) {
            if (append(session, 'roundtable/start', info))
                active.set(info.id, session);
        },
        resume(session, info) {
            // The start record already exists in the log (recovery replay); only the
            // active-session association must be restored for continuation records.
            active.set(info.id, session);
        },
        finish(discussionId, stopReason) {
            const session = active.get(discussionId);
            if (session !== undefined)
                append(session, 'roundtable/end', { discussionId, stopReason });
            active.delete(discussionId);
        },
        abandon: (discussionId) => { active.delete(discussionId); },
        dispose() {
            for (const dispose of disposers.splice(0)) {
                try {
                    dispose();
                }
                catch (error) {
                    ctx.logger.warn(`roundtable: recorder listener dispose threw: ${renderRecordingError(error)}`);
                }
            }
            active.clear();
        },
    };
}
//# sourceMappingURL=recorder.js.map