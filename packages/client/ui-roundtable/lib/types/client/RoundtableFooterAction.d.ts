/** Sidebar-foot "新讨论组" action: start a new session and hand off to the roundtable skill. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RoundtableFooterActionInjected } from './slots.ts';
/** Full props composed by the sidebar footer-action slot. */
export type RoundtableFooterActionProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<RoundtableFooterActionInjected> & PropsLocale<'roundtable'>;
/**
 * Render the roundtable entry beside Settings. The button starts a NEW
 * session (never reuses the current one), so it is disabled while no
 * Workspace can be resolved as the target — mirroring the shell's New Session
 * resolution: the current Session's Workspace, then the recent Workspace.
 */
export declare function RoundtableFooterAction({ wide, useSessions, useWorkspaces, startRoundtableSession, t, }: RoundtableFooterActionProps): import("react").JSX.Element;
//# sourceMappingURL=RoundtableFooterAction.d.ts.map