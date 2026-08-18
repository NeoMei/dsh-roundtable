/**
 * The roundtable sidebar footer-action's injected business face, provided by
 * the client plugin's `sidebar.footer.action` registration.
 */
/** Business verbs the sidebar footer action receives. */
export interface RoundtableFooterActionInjected {
    /**
     * Start a NEW roundtable session: reuse-or-create a blank session in the
     * current/recent Workspace, open it, and send the bare「圆桌讨论」message so
     * the host agent's `roundtable` skill takes over. Resolves `null` on
     * success or a short failure message.
     */
    startRoundtableSession: () => Promise<string | null>;
}
//# sourceMappingURL=slots.d.ts.map