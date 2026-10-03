/**
 * Shared Workspace resolution for the roundtable sidebar entry.
 *
 * The DSH 0.2 client contract dropped both the Session list's `current`
 * selection and the Workspace snapshot's `recentWorkspaceId`, so the target is
 * derived from the two projections directly — the same rule the shell's own
 * New Session action falls back to: the Workspace holding the most recently
 * updated Session, with ties following Host Workspace order.
 *
 * @module @neomei/dsh-client-ui-roundtable/target-workspace
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client';
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client';
/**
 * The Workspace holding the most recently updated Session.
 * @param workspaces - the Workspace projection's rows, in Host order.
 * @param sessions - the Session projection, keyed by id.
 * @returns the selected Workspace, or `undefined` when none holds a Session.
 */
export declare function recentWorkspace(workspaces: readonly WorkspaceView[], sessions: Readonly<Record<SessionId, SessionSummary>>): WorkspaceId | undefined;
/**
 * The Workspace a new roundtable session would land in, or `undefined` while
 * either projection is still arriving (the entry stays disabled until then).
 * Takes only the fields the resolution reads, so callers can pass either a
 * full snapshot or the pieces a selector returned.
 * @param workspaces - the Workspace projection's arrival phase and rows.
 * @param sessions - the Session projection's arrival phase and rows.
 * @returns the target Workspace, or `undefined` when no session can start.
 */
export declare function targetWorkspace(workspaces: Pick<WorkspaceSnapshot, 'phase' | 'items'>, sessions: Pick<SessionListState, 'phase' | 'byId'>): WorkspaceId | undefined;
