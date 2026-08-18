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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "tool-roundtable";
export declare const inject: string[];
export interface Config {
    toolName?: string;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map