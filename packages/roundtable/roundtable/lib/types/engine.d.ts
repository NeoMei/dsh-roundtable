import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { RoundtableEngine } from './service.ts';
import type { RoundtableStartRequest, RoundtableRun } from './runtime-types.ts';
/** Engine-provider config: the `ctx.subagents` provider members and the host summarizer run on. */
export interface Config {
    provider?: string;
    /** 成员上限，缺省 8（spec §6）。 */
    maxMembers?: number;
}
/**
 * The concrete roundtable engine provider: registers `ctx.roundtable` and runs
 * one single-round discussion per `start()` call. Mirrors `WorkerThreadWorkflowEngine`
 * (the concrete `WorkflowEngine` provider) — but the roundtable seam `RoundtableEngine`
 * and its provider share this package, so this class IS the seam's loadable entry.
 */
export declare class RoundtableEngineProvider extends RoundtableEngine {
    static inject: string[];
    static Config: z<Config>;
    private readonly provider;
    private readonly maxMembers;
    private readonly recorder;
    constructor(ctx: Context, config: Config);
    start(request: RoundtableStartRequest): RoundtableRun;
}
/** Back-compat factory: build the provider instance for direct/in-process use. */
export declare function createRoundtableEngine(ctx: Context, deps: {
    provider: string;
}): RoundtableEngine;
//# sourceMappingURL=engine.d.ts.map