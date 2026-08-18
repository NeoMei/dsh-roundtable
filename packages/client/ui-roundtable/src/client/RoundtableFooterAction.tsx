/** Sidebar-foot "新讨论组" action: start a new session and hand off to the roundtable skill. */

import { useState } from 'react'
import { IconUserOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { RoundtableFooterActionInjected } from './slots.ts'
import css from './RoundtableFooterAction.module.css'

/** Full props composed by the sidebar footer-action slot. */
export type RoundtableFooterActionProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<RoundtableFooterActionInjected> & PropsLocale<'roundtable'>

/**
 * Render the roundtable entry beside Settings. The button starts a NEW
 * session (never reuses the current one), so it is disabled while no
 * Workspace can be resolved as the target — mirroring the shell's New Session
 * resolution: the current Session's Workspace, then the recent Workspace.
 */
export function RoundtableFooterAction({
  wide, useSessions, useWorkspaces, startRoundtableSession, t,
}: RoundtableFooterActionProps) {
  const current = useSessions(state => state.current)
  const items = useWorkspaces(state => state.items)
  const recentWorkspaceId = useWorkspaces(state => state.recentWorkspaceId)
  const currentWorkspaceId = current === undefined
    ? undefined
    : items.find(item => item.sessionIds.includes(current))?.workspaceId
  const target = currentWorkspaceId ?? recentWorkspaceId

  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const onClick = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setFailure(null)
    const error = await startRoundtableSession()
    setPending(false)
    if (error !== null) setFailure(error)
  }

  return (
    <div className={wide ? css.layer : `${css.layer} ${css.rail}`}>
      <Tooltip label={t('footer.action')} side="bottom" delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.button}
          data-roundtable-footer
          disabled={target === undefined || pending}
          aria-label={t('footer.action')}
          onClick={() => { void onClick() }}
        >
          <IconUserOutline16 size={wide ? 14 : 18} />
          {wide && <span className={css.label}>{t('footer.action')}</span>}
        </button>
      </Tooltip>
      {failure !== null && (
        <span className={css.failure} data-roundtable-footer-error role="alert">{failure}</span>
      )}
    </div>
  )
}
