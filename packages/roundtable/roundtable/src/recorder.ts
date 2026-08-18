/**
 * Minutes store: project each settled round's minutes and the terminal
 * settlement into the calling parent Session as durable `roundtable/*` events.
 * Mirrors `createWorkflowRecorder` in packages/workflow/tool-workflow.
 * @module @deepseek-ai/dsh-roundtable/recorder
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type {
  RoundtableEndData, RoundtableId, RoundtableInfo, RoundtableRoundEndData,
  RoundtableStopReason,
} from './types.ts'

interface RoundtableRecordEventMap {
  'roundtable/start': RoundtableInfo
  'roundtable/round-end': RoundtableRoundEndData
  'roundtable/end': RoundtableEndData
}

/** Projects live `roundtable/*` events into durable parent-Session records. */
export interface RoundtableRecorder {
  /** Register the parent Session that will receive this discussion's records. */
  start(session: Session, info: RoundtableInfo): void
  /**
   * Re-register a discussion whose `roundtable/start` record is ALREADY in the
   * session log (cross-process recovery): continuation `roundtable/round-end`
   * and `roundtable/end` records append to the same session, without writing a
   * duplicate `roundtable/start`.
   */
  resume(session: Session, info: RoundtableInfo): void
  /** Append the terminal settlement and drop the discussion. */
  finish(discussionId: RoundtableId, stopReason: RoundtableStopReason): void
  /** Drop the discussion without appending a terminal record. */
  abandon(discussionId: RoundtableId): void
}

/**
 * Recorder plus its own teardown. The `roundtable/round-end` listener is
 * registered on the SHARED context, so a per-agent recorder (host-driver per
 * agent) would otherwise accumulate one listener per agent forever: `dispose()`
 * detaches it and drops the active-discussion map.
 */
export interface RoundtableRecorderHandle extends RoundtableRecorder {
  /** Detach the shared round-* listeners and drop all active discussions. */
  dispose(): void
}

/** Render a contained recording failure without trusting the thrown value. */
function renderRecordingError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Project active roundtable discussions into their parent Sessions without
 * letting recording failure affect discussion execution.
 */
export function createRoundtableRecorder(ctx: Context): RoundtableRecorderHandle {
  const active = new Map<RoundtableId, Session>()
  const disposers: Array<() => void> = []
  const append = <Type extends keyof RoundtableRecordEventMap>(
    session: Session,
    type: Type,
    data: SessionEventMap[Type],
  ): boolean => {
    // These package-owned events are all log-only. Narrowing the generic
    // append face here discharges Session.append's conditional options tuple.
    const appendRecord = session.append.bind(session) as <Event extends keyof RoundtableRecordEventMap>(
      event: Event,
      value: SessionEventMap[Event],
    ) => void
    try {
      appendRecord(type, data)
      return true
    } catch (error: unknown) {
      ctx.logger.warn(`roundtable: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`)
      return false
    }
  }

  disposers.push(ctx.on('roundtable/round-end', (info, minutes) => {
    const session = active.get(info.id)
    if (session === undefined) return
    if (!append(session, 'roundtable/round-end', { discussionId: info.id, minutes })) active.delete(info.id)
  }))

  return {
    start(session, info) {
      if (append(session, 'roundtable/start', info)) active.set(info.id, session)
    },
    resume(session, info) {
      // The start record already exists in the log (recovery replay); only the
      // active-session association must be restored for continuation records.
      active.set(info.id, session)
    },
    finish(discussionId, stopReason) {
      const session = active.get(discussionId)
      if (session !== undefined) append(session, 'roundtable/end', { discussionId, stopReason })
      active.delete(discussionId)
    },
    abandon: (discussionId) => { active.delete(discussionId) },
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch (error: unknown) {
          ctx.logger.warn(`roundtable: recorder listener dispose threw: ${renderRecordingError(error)}`)
        }
      }
      active.clear()
    },
  }
}
