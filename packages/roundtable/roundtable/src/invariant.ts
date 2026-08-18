/**
 * Package-owned durable `roundtable/*` invariants: every record the recorder
 * projects into a parent Session must replay with a stable shape, so shape
 * checks here guard the cross-process recovery fold (`recovery.ts`) and the
 * client's structural casts.
 * @module @neomei/dsh-roundtable/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@neomei/dsh-roundtable'
const STOP_REASONS = new Set(['completed', 'cancelled', 'error'])

/** Cordis companion plugin name. */
export const name = 'roundtable-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

function validateStart(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) {
    fail('roundtable/start data must be an object')
    return
  }
  const { id, roster, topic } = value as Record<string, unknown>
  if (typeof id !== 'string' || id.length === 0) fail('roundtable/start id must be a non-empty string')
  if (!Array.isArray(roster) || roster.length === 0) {
    fail('roundtable/start roster must be a non-empty array')
  } else {
    for (const member of roster) {
      if (typeof member !== 'object' || member === null) {
        fail('roundtable/start roster members must be objects')
        continue
      }
      const m = member as Record<string, unknown>
      if (typeof m.id !== 'string' || m.id.length === 0) fail('roundtable/start member id must be a non-empty string')
      if (typeof m.label !== 'string' || m.label.length === 0) fail('roundtable/start member label must be a non-empty string')
    }
  }
  if (typeof topic !== 'string' || topic.trim() === '') fail('roundtable/start topic must be a non-empty string')
}

function validateMinutes(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) {
    fail('roundtable/round-end minutes must be an object')
    return
  }
  const { roundNumber, topic } = value as Record<string, unknown>
  if (typeof roundNumber !== 'number' || !Number.isInteger(roundNumber) || roundNumber < 1) {
    fail('roundtable/round-end minutes roundNumber must be a positive integer')
  }
  if (typeof topic !== 'string') fail('roundtable/round-end minutes topic must be a string')
  for (const key of ['utterances', 'humanSteers', 'summary'] as const) {
    if (!Array.isArray((value as Record<string, unknown>)[key])) {
      fail(`roundtable/round-end minutes ${key} must be an array`)
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  switch (event.type) {
    case 'roundtable/start':
      validateStart(event.data, fail)
      break
    case 'roundtable/round-end': {
      const data = event.data as { discussionId: unknown; minutes: unknown }
      if (typeof data.discussionId !== 'string' || data.discussionId.length === 0) {
        fail('roundtable/round-end discussionId must be a non-empty string')
      }
      validateMinutes(data.minutes, fail)
      break
    }
    case 'roundtable/end': {
      const data = event.data as { discussionId: unknown; stopReason: unknown }
      if (typeof data.discussionId !== 'string' || data.discussionId.length === 0) {
        fail('roundtable/end discussionId must be a non-empty string')
      }
      if (typeof data.stopReason !== 'string' || !STOP_REASONS.has(data.stopReason)) {
        fail(`roundtable/end stopReason must be one of ${[...STOP_REASONS].join(', ')}`)
      }
      break
    }
    default:
      break
  }
}

/** Install validation for loaded and newly appended durable roundtable records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the roundtable invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
