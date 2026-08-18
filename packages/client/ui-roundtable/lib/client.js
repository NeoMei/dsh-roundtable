window.__ModuleLoader__.load({
	id: "@neomei/dsh-client-ui-roundtable",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region \0dsh-css:/Users/neomei/项目/deepseek/harness-src/packages/client/ui-roundtable/src/client/RoundtableFooterAction.module.css.mjs
		const css = ".DeIc2G_layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative}.DeIc2G_button{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}.DeIc2G_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.DeIc2G_button:disabled{opacity:.4;cursor:default}.DeIc2G_label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.DeIc2G_layer.DeIc2G_rail{width:36px;height:36px;margin:0}.DeIc2G_rail .DeIc2G_button{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}.DeIc2G_failure{text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;position:absolute;bottom:-18px;left:0;overflow:hidden}";
		const tagId = "@neomei/dsh-client-ui-roundtable/RoundtableFooterAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@neomei/dsh-client-ui-roundtable";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var RoundtableFooterAction_module_css_default = {
			"rail": "DeIc2G_rail",
			"label": "DeIc2G_label",
			"failure": "DeIc2G_failure",
			"button": "DeIc2G_button",
			"layer": "DeIc2G_layer"
		};
		//#endregion
		//#region lib/types/client/RoundtableFooterAction.js
		/** Sidebar-foot "新讨论组" action: start a new session and hand off to the roundtable skill. */
		/**
		* Render the roundtable entry beside Settings. The button starts a NEW
		* session (never reuses the current one), so it is disabled while no
		* Workspace can be resolved as the target — mirroring the shell's New Session
		* resolution: the current Session's Workspace, then the recent Workspace.
		*/
		function RoundtableFooterAction({ wide, useSessions, useWorkspaces, startRoundtableSession, t }) {
			const current = useSessions((state) => state.current);
			const items = useWorkspaces((state) => state.items);
			const recentWorkspaceId = useWorkspaces((state) => state.recentWorkspaceId);
			const target = (current === void 0 ? void 0 : items.find((item) => item.sessionIds.includes(current))?.workspaceId) ?? recentWorkspaceId;
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
			return (0, react_jsx_runtime.jsxs)("div", {
				className: wide ? RoundtableFooterAction_module_css_default.layer : `${RoundtableFooterAction_module_css_default.layer} ${RoundtableFooterAction_module_css_default.rail}`,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("footer.action"),
					side: "bottom",
					delayMs: 500,
					disabled: wide,
					children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: RoundtableFooterAction_module_css_default.button,
						"data-roundtable-footer": true,
						disabled: target === void 0 || pending,
						"aria-label": t("footer.action"),
						onClick: () => {
							onClick();
						},
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUserOutline16, { size: wide ? 14 : 18 }), wide && (0, react_jsx_runtime.jsx)("span", {
							className: RoundtableFooterAction_module_css_default.label,
							children: t("footer.action")
						})]
					})
				}), failure !== null && (0, react_jsx_runtime.jsx)("span", {
					className: RoundtableFooterAction_module_css_default.failure,
					"data-roundtable-footer-error": true,
					role: "alert",
					children: failure
				})]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
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
		//#region lib/types/client/index.js
		/** Browser plugin for the roundtable sidebar entry ("新讨论组"). */
		/** Required services for the dictionary registration and the sidebar entry. */
		const inject = [
			"slots",
			"locale",
			"sessions",
			"workspaces"
		];
		/**
		* The Workspace a new roundtable session would land in — the same resolution
		* the shell's New Session action uses: the current Session's Workspace, then
		* the recent-Workspace projection. `undefined` means no session can start.
		*/
		function targetWorkspace(ctx) {
			const workspace = ctx.workspaces.list.getSnapshot();
			const current = ctx.sessions.list.getSnapshot().current;
			return (current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId) ?? workspace.recentWorkspaceId;
		}
		/**
		* Start a NEW roundtable session: connect the resolved Workspace's
		* reuse-or-created blank session (`connectWorkspace` returns the id), open it,
		* and send the bare「圆桌讨论」message so the host agent's `roundtable` skill
		* starts and asks the user for the topic. Resolves `null` on success or a
		* short failure message (shown by the footer action).
		*/
		async function startRoundtableSession(ctx) {
			const target = targetWorkspace(ctx);
			if (target === void 0) return "no workspace to start a roundtable session in";
			let sessionId;
			try {
				sessionId = await ctx.workspaces.connectWorkspace(target);
				ctx.sessions.open(sessionId);
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