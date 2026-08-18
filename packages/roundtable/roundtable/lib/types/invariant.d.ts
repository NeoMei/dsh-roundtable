/**
 * Package-owned durable `roundtable/*` invariants: every record the recorder
 * projects into a parent Session must replay with a stable shape, so shape
 * checks here guard the cross-process recovery fold (`recovery.ts`) and the
 * client's structural casts.
 * @module @neomei/dsh-roundtable/invariant
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "roundtable-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register the roundtable invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map