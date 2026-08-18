/** Browser plugin for the roundtable sidebar entry ("新讨论组"). */

import type { ClientContext, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RoundtableFooterAction } from './RoundtableFooterAction.tsx'
import type { RoundtableFooterActionInjected } from './slots.ts'
import { en, NS, type RoundtableKey, zh } from './locales.ts'

export type { RoundtableFooterActionInjected } from './slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Roundtable sidebar-entry copy. */
    roundtable: RoundtableKey
  }
}

/** Required services for the dictionary registration and the sidebar entry. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * The Workspace a new roundtable session would land in — the same resolution
 * the shell's New Session action uses: the current Session's Workspace, then
 * the recent-Workspace projection. `undefined` means no session can start.
 */
function targetWorkspace(ctx: ClientContext): WorkspaceId | undefined {
  const workspace = ctx.workspaces.list.getSnapshot()
  const current = ctx.sessions.list.getSnapshot().current
  const currentWorkspaceId = current === undefined
    ? undefined
    : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
  return currentWorkspaceId ?? workspace.recentWorkspaceId
}

/**
 * Start a NEW roundtable session: connect the resolved Workspace's
 * reuse-or-created blank session (`connectWorkspace` returns the id), open it,
 * and send the bare「圆桌讨论」message so the host agent's `roundtable` skill
 * starts and asks the user for the topic. Resolves `null` on success or a
 * short failure message (shown by the footer action).
 */
async function startRoundtableSession(ctx: ClientContext): Promise<string | null> {
  const target = targetWorkspace(ctx)
  if (target === undefined) return 'no workspace to start a roundtable session in'
  let sessionId: SessionId
  try {
    sessionId = await ctx.workspaces.connectWorkspace(target)
    ctx.sessions.open(sessionId)
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
