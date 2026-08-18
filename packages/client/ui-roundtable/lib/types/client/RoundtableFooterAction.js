import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Sidebar-foot "新讨论组" action: start a new session and hand off to the roundtable skill. */
import { useState } from 'react';
import { IconUserOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './RoundtableFooterAction.module.css';
/**
 * Render the roundtable entry beside Settings. The button starts a NEW
 * session (never reuses the current one), so it is disabled while no
 * Workspace can be resolved as the target — mirroring the shell's New Session
 * resolution: the current Session's Workspace, then the recent Workspace.
 */
export function RoundtableFooterAction({ wide, useSessions, useWorkspaces, startRoundtableSession, t, }) {
    const current = useSessions(state => state.current);
    const items = useWorkspaces(state => state.items);
    const recentWorkspaceId = useWorkspaces(state => state.recentWorkspaceId);
    const currentWorkspaceId = current === undefined
        ? undefined
        : items.find(item => item.sessionIds.includes(current))?.workspaceId;
    const target = currentWorkspaceId ?? recentWorkspaceId;
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState(null);
    const onClick = async () => {
        if (pending)
            return;
        setPending(true);
        setFailure(null);
        const error = await startRoundtableSession();
        setPending(false);
        if (error !== null)
            setFailure(error);
    };
    return (_jsxs("div", { className: wide ? css.layer : `${css.layer} ${css.rail}`, children: [_jsx(Tooltip, { label: t('footer.action'), side: "bottom", delayMs: 500, disabled: wide, children: _jsxs("button", { type: "button", className: css.button, "data-roundtable-footer": true, disabled: target === undefined || pending, "aria-label": t('footer.action'), onClick: () => { void onClick(); }, children: [_jsx(IconUserOutline16, { size: wide ? 14 : 18 }), wide && _jsx("span", { className: css.label, children: t('footer.action') })] }) }), failure !== null && (_jsx("span", { className: css.failure, "data-roundtable-footer-error": true, role: "alert", children: failure }))] }));
}
//# sourceMappingURL=RoundtableFooterAction.js.map