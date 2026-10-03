/** Browser plugin for the roundtable sidebar entry ("新讨论组"). */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Declaration merges only: they make ctx.sessions / ctx.workspaces / ctx.uiWorkspace / ctx.slots visible.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RoundtableFooterAction } from './RoundtableFooterAction.tsx'
import type { RoundtableFooterActionInjected } from './slots.ts'
import { targetWorkspace } from './target-workspace.ts'
import { en, NS, type RoundtableKey, zh } from './locales.ts'

export type { RoundtableFooterActionInjected } from './slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Roundtable sidebar-entry copy. */
    roundtable: RoundtableKey
  }
}

/** Required services for the dictionary registration and the sidebar entry. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace']

/**
 * Start a NEW roundtable session: connect the resolved Workspace's
 * reuse-or-created blank session (`connectWorkspace` returns the id), open it,
 * and send the bare「圆桌讨论」message so the host agent's `roundtable` skill
 * starts and asks the user for the topic. Resolves `null` on success or a
 * short failure message (shown by the footer action).
 */
async function startRoundtableSession(ctx: ClientContext): Promise<string | null> {
  const target = targetWorkspace(ctx.workspaces.list.getSnapshot(), ctx.sessions.list.getSnapshot())
  if (target === undefined) return 'no workspace to start a roundtable session in'
  let sessionId: SessionId
  try {
    sessionId = await ctx.uiWorkspace.connectWorkspace(target)
    ctx.uiWorkspace.openSession(sessionId)
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason)
  }
  const session = ctx.sessions.binding(sessionId)?.session
  if (session === undefined) return 'no session binding for the new roundtable session'
  const result = await session.prompt([{ type: 'text', text: '圆桌讨论' }], 'queue')
  if (!result.ok) return `${result.error.message} (${result.error.code})`
  return null
}

/**
 * Register the roundtable dictionary and the `sidebar.footer.action` entry —
 * the sidebar "新讨论组" button that starts a fresh session and hands off to
 * the `roundtable` skill. Member utterances render as NORMAL chat messages
 * (the host agent re-emits each member's reply), so there is no special panel.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-roundtable: dictionaries')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'roundtable',
    locale: NS,
    inject: (): RoundtableFooterActionInjected => ({
      startRoundtableSession: () => startRoundtableSession(ctx),
    }),
  }, RoundtableFooterAction))
}
