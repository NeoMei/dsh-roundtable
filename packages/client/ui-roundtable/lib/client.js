window.__ModuleLoader__.load({
	id: "@neomei/dsh-client-ui-roundtable",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/target-workspace.ts
		/**
		* The Workspace holding the most recently updated Session.
		* @param workspaces - the Workspace projection's rows, in Host order.
		* @param sessions - the Session projection, keyed by id.
		* @returns the selected Workspace, or `undefined` when none holds a Session.
		*/
		function recentWorkspace(workspaces, sessions) {
			let selected;
			let selectedTime = Number.NEGATIVE_INFINITY;
			for (const workspace of workspaces) {
				let latest = Number.NEGATIVE_INFINITY;
				for (const sessionId of workspace.sessionIds) {
					const session = sessions[sessionId];
					if (session !== void 0) latest = Math.max(latest, session.updatedAt);
				}
				if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt);
				if (selected === void 0 || latest > selectedTime) {
					selected = workspace.workspaceId;
					selectedTime = latest;
				}
			}
			return selected;
		}
		/**
		* The Workspace a new roundtable session would land in, or `undefined` while
		* either projection is still arriving (the entry stays disabled until then).
		* Takes only the fields the resolution reads, so callers can pass either a
		* full snapshot or the pieces a selector returned.
		* @param workspaces - the Workspace projection's arrival phase and rows.
		* @param sessions - the Session projection's arrival phase and rows.
		* @returns the target Workspace, or `undefined` when no session can start.
		*/
		function targetWorkspace(workspaces, sessions) {
			if (workspaces.phase !== "ready" || sessions.phase !== "ready") return void 0;
			return recentWorkspace(workspaces.items, sessions.byId);
		}
		//#endregion
		//#region \0rt-css:/private/tmp/harness-020/packages/client/ui-roundtable/src/client/RoundtableFooterAction.module.css.mjs
		const css = "._9JCCWW_layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative}._9JCCWW_button{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}._9JCCWW_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}._9JCCWW_button:disabled{opacity:.4;cursor:default}._9JCCWW_label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}._9JCCWW_layer._9JCCWW_rail{width:36px;height:36px;margin:0}._9JCCWW_rail ._9JCCWW_button{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}._9JCCWW_failure{text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;position:absolute;bottom:-18px;left:0;overflow:hidden}";
		const tagId = "@neomei/dsh-client-ui-roundtable/RoundtableFooterAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@neomei/dsh-client-ui-roundtable";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var RoundtableFooterAction_module_css_default = {
			"button": "_9JCCWW_button",
			"failure": "_9JCCWW_failure",
			"label": "_9JCCWW_label",
			"layer": "_9JCCWW_layer",
			"rail": "_9JCCWW_rail"
		};
		//#endregion
		//#region src/client/RoundtableFooterAction.tsx
		/** Sidebar-foot "新讨论组" action: start a new session and hand off to the roundtable skill. */
		/**
		* Render the roundtable entry beside Settings. The button starts a NEW
		* session (never reuses the current one), so it is disabled while no
		* Workspace can be resolved as the target — mirroring the shell's New Session
		* resolution: the Workspace holding the most recently updated Session.
		*/
		function RoundtableFooterAction({ wide, useSessions, useWorkspaces, startRoundtableSession, t }) {
			const workspacePhase = useWorkspaces((state) => state.phase);
			const workspaceItems = useWorkspaces((state) => state.items);
			const sessionPhase = useSessions((state) => state.phase);
			const sessionsById = useSessions((state) => state.byId);
			const target = workspacePhase === "ready" && sessionPhase === "ready" ? targetWorkspace({
				phase: workspacePhase,
				items: workspaceItems
			}, {
				phase: sessionPhase,
				byId: sessionsById
			}) : void 0;
			const [pending, setPending] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(null);
			const onClick = async () => {
				if (pending) return;
				setPending(true);
				setFailure(null);
				const error = await startRoundtableSession();
				setPending(false);
				if (error !== null) setFailure(error);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: wide ? RoundtableFooterAction_module_css_default.layer : `${RoundtableFooterAction_module_css_default.layer} ${RoundtableFooterAction_module_css_default.rail}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("footer.action"),
					side: "bottom",
					delayMs: 500,
					disabled: wide,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: RoundtableFooterAction_module_css_default.button,
						"data-roundtable-footer": true,
						disabled: target === void 0 || pending,
						"aria-label": t("footer.action"),
						onClick: () => {
							onClick();
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUserOutlineMedium, { size: wide ? 14 : 18 }), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: RoundtableFooterAction_module_css_default.label,
							children: t("footer.action")
						})]
					})
				}), failure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: RoundtableFooterAction_module_css_default.failure,
					"data-roundtable-footer-error": true,
					role: "alert",
					children: failure
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `roundtable` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "roundtable";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "圆桌讨论",
			"footer.action": "新讨论组",
			"roster.empty": "无成员",
			"round.title": "第 {number} 轮",
			"round.topic": "话题",
			"round.steers": "人类意见",
			"round.summary": "本轮纪要",
			"round.empty": "本轮没有成员发言",
			"live.title": "发言中…",
			"export": "导出 Markdown",
			"continue": "继续下一轮",
			"stop": "停止讨论",
			"status.active": "进行中",
			"status.completed": "已完成",
			"status.cancelled": "已取消",
			"status.error": "出错"
		};
		/** English dictionary (same key set). */
		const en = {
			"title": "Roundtable",
			"footer.action": "New discussion",
			"roster.empty": "No members",
			"round.title": "Round {number}",
			"round.topic": "Topic",
			"round.steers": "Human input",
			"round.summary": "Summary",
			"round.empty": "No members spoke this round",
			"live.title": "Speaking…",
			"export": "Export Markdown",
			"continue": "Continue next round",
			"stop": "Stop discussion",
			"status.active": "Active",
			"status.completed": "Completed",
			"status.cancelled": "Cancelled",
			"status.error": "Error"
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services for the dictionary registration and the sidebar entry. */
		const inject = [
			"slots",
			"locale",
			"sessions",
			"workspaces",
			"uiWorkspace"
		];
		/**
		* Start a NEW roundtable session: connect the resolved Workspace's
		* reuse-or-created blank session (`connectWorkspace` returns the id), open it,
		* and send the bare「圆桌讨论」message so the host agent's `roundtable` skill
		* starts and asks the user for the topic. Resolves `null` on success or a
		* short failure message (shown by the footer action).
		*/
		async function startRoundtableSession(ctx) {
			const target = targetWorkspace(ctx.workspaces.list.getSnapshot(), ctx.sessions.list.getSnapshot());
			if (target === void 0) return "no workspace to start a roundtable session in";
			let sessionId;
			try {
				sessionId = await ctx.uiWorkspace.connectWorkspace(target);
				ctx.uiWorkspace.openSession(sessionId);
			} catch (reason) {
				return reason instanceof Error ? reason.message : String(reason);
			}
			const session = ctx.sessions.binding(sessionId)?.session;
			if (session === void 0) return "no session binding for the new roundtable session";
			const result = await session.prompt([{
				type: "text",
				text: "圆桌讨论"
			}], "queue");
			if (!result.ok) return `${result.error.message} (${result.error.code})`;
			return null;
		}
		/**
		* Register the roundtable dictionary and the `sidebar.footer.action` entry —
		* the sidebar "新讨论组" button that starts a fresh session and hands off to
		* the `roundtable` skill. Member utterances render as NORMAL chat messages
		* (the host agent re-emits each member's reply), so there is no special panel.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-roundtable: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "roundtable",
				locale: NS,
				inject: () => ({ startRoundtableSession: () => startRoundtableSession(ctx) })
			}, RoundtableFooterAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map