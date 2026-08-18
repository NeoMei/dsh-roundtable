import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { serializeRoundtableMarkdown } from "@neomei/dsh-roundtable";
//#region lib/types/index.js
/**
* The model-facing `roundtable` tool: run a single-round multi-agent discussion and return the
* minutes. It owns the model-facing schema and run lifecycle; roster validation, member execution,
* and cancellation live behind `ctx.roundtable` (`@neomei/dsh-roundtable`). Execution awaits
* `run.result` and always disposes the run in a `finally`. Explicit-ask usage guidance is
* registered as the tool's own prompt section.
*
* The companion `roundtable_models` tool lists the providers and models the DSH runtime has
* registered (`ctx.llm.listProviders()` / `ctx.llm.listModels()`), so member model cards are built
* from the live runtime instead of the incomplete `settings.yaml`.
* @module @neomei/dsh-tool-roundtable
*/
const name = "tool-roundtable";
const inject = [
	"tools",
	"roundtable",
	"systemPrompt",
	"llm",
	"sessionTitle"
];
const Config = z.object({ toolName: z.string().default("roundtable") });
const MEMBER_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true,
			description: "唯一成员标识。"
		},
		label: {
			type: "string",
			required: true,
			description: "显示名，如「架构师」。"
		},
		persona: {
			type: "string",
			description: "角色遮蔽。"
		},
		provider: {
			type: "string",
			description: "该成员的模型 provider。"
		},
		model: {
			type: "string",
			description: "该成员的模型。"
		}
	}
};
/** Map a model-supplied member literal into the seam's roster shape. */
function toMember(m) {
	return {
		id: String(m.id),
		label: String(m.label),
		...m.persona !== void 0 ? { persona: String(m.persona) } : {},
		...m.provider !== void 0 || m.model !== void 0 ? { agentOptions: {
			...m.provider !== void 0 ? { provider: String(m.provider) } : {},
			...m.model !== void 0 ? { model: String(m.model) } : {}
		} } : {}
	};
}
/** Extract plain text from a member's output blocks. */
function textOf(blocks) {
	return blocks.map((b) => b.type === "text" ? b.text ?? "" : `[${b.type}]`).join("");
}
const MODELS_DEFAULT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		provider: {
			type: "string",
			required: true
		},
		model: {
			type: "string",
			required: true
		}
	}
};
const MODELS_PROVIDER_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		provider: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		models: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					}
				}
			}
		}
	}
};
function apply(ctx, config) {
	const { toolName } = config;
	ctx.systemPrompt.section({
		name: `tool:${toolName}`,
		order: 116,
		text: `Use the ${toolName} tool to gather multiple perspectives on a topic: several agents each speak once in fixed order, then a summary is produced.`
	});
	ctx.tools.register(defineTool({
		name: toolName,
		description: "Run a single-round multi-agent roundtable discussion and return the minutes.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "讨论话题。"
			},
			members: {
				type: "array",
				required: true,
				description: "圆桌成员，数组顺序即发言顺序。",
				items: MEMBER_SCHEMA
			},
			synthesize: {
				type: "boolean",
				description: "是否产出综合方案，默认 true。"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					stopReason: {
						type: "string",
						required: true
					},
					markdown: {
						type: "string",
						required: true
					},
					utterances: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								memberId: {
									type: "string",
									required: true
								},
								label: {
									type: "string",
									required: true
								},
								text: {
									type: "string",
									required: true
								}
							}
						}
					}
				}
			},
			render: (args, value) => {
				const raw = (value.utterances ?? []).map((u) => `【${u.label}】\n${u.text}`).join("\n\n");
				return [{
					type: "text",
					text: args.synthesize === false ? raw === "" ? "（无成员发言）" : raw : String(value.markdown)
				}];
			}
		},
		async execute(args, exec) {
			const parent = exec.agent;
			if (!parent) throw new Error("roundtable tool requires a calling agent");
			const members = args.members.map((m) => toMember(m));
			const synthesize = args.synthesize !== false;
			const run = ctx.roundtable.start({
				topic: args.topic,
				members,
				...args.synthesize !== void 0 ? { synthesize } : {},
				parent,
				signal: exec.signal
			});
			try {
				const result = await run.result;
				if (result.stopReason !== "completed") throw new Error(`roundtable ${result.stopReason}`);
				const markdown = serializeRoundtableMarkdown({
					id: run.id,
					roster: members,
					rounds: result.rounds,
					status: result.stopReason
				}, { synthesize });
				const utterances = result.rounds.flatMap((r) => r.utterances.map((u) => ({
					memberId: u.memberId,
					label: u.label,
					text: textOf(u.output)
				})));
				return {
					stopReason: result.stopReason,
					markdown,
					utterances
				};
			} finally {
				await run.dispose();
			}
		}
	}));
	ctx.tools.register(defineTool({
		name: "roundtable_models",
		description: "List the LLM providers and their models currently registered in the DSH runtime, plus the calling agent's default provider/model. Returns `default` (`{ provider, model }`, omitted when unavailable) and `providers` (`[{ provider, name, models: [{ id, name }] }]`). Use this to build provider→model selection cards (e.g. a roundtable member's model) instead of reading settings.yaml.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					default: MODELS_DEFAULT_SCHEMA,
					providers: {
						type: "array",
						required: true,
						items: MODELS_PROVIDER_SCHEMA
					}
				}
			},
			render: (_args, value) => {
				const result = value;
				const lines = [];
				if (result.default !== void 0) lines.push(`默认: ${result.default.provider}/${result.default.model}`);
				for (const provider of result.providers) lines.push(`${provider.provider} (${provider.name}): ${provider.models.map((model) => model.id).join(", ") || "(none)"}`);
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		async execute(_args, exec) {
			const providers = ctx.llm.listProviders();
			const entries = (await Promise.allSettled(providers.map(async (info) => {
				const models = await ctx.llm.listModels(info.id);
				return {
					provider: info.id,
					name: info.name,
					models: models.map((model) => ({
						id: model.id,
						name: model.name
					}))
				};
			}))).flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
			const options = exec.agent?.options;
			const def = options?.provider !== void 0 && options?.model !== void 0 ? {
				provider: options.provider,
				model: options.model
			} : void 0;
			return {
				...def === void 0 ? {} : { default: def },
				providers: entries
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "roundtable_title",
		description: "Set the current session title (e.g. to the roundtable topic). Call once after the topic is known, so the discussion group is named after its topic instead of a generic name.",
		parameters: { title: {
			type: "string",
			required: true,
			description: "会话标题，通常是讨论话题。"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { title: {
					type: "string",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: String(value.title)
			}]
		},
		async execute(args, exec) {
			if (!exec.agent) throw new Error("roundtable_title requires a calling agent");
			ctx.sessionTitle.rename(exec.agent.session, String(args.title));
			return { title: String(args.title) };
		}
	}));
}
//#endregion
export { Config, apply, inject, name };
