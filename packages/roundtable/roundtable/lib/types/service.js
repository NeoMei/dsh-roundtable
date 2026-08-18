/**
 * Roundtable capability seam: the `roundtable` Service contract, its error
 * type, and the `roundtable/*` event vocabulary. Kept separate from the barrel
 * so the concrete provider (`engine.ts`) and the drivers can import the seam
 * without a module cycle through `index.ts`.
 * @module @neomei/dsh-roundtable/service
 */
import { Service } from '@deepseek-ai/cordis';
import { HarnessError } from '@deepseek-ai/dsh-llm';
export class RoundtableError extends HarnessError {
    constructor(message, code, options) {
        super(message, code, options);
        this.name = 'RoundtableError';
    }
}
/** Abstract roundtable service seam: starts a multi-round discussion and
 * returns its live run handle. The concrete provider (`engine.ts`) and the
 * host-loop driver implement it. */
export class RoundtableEngine extends Service {
    constructor(ctx) { super(ctx, 'roundtable'); }
    emitRoundtableEvent(name, ...args) {
        for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
            try {
                void Promise.resolve(callback(...args)).catch(e => this.ctx.logger.warn(`roundtable: ${name} listener rejected: ${String(e)}`));
            }
            catch (e) {
                this.ctx.logger.warn(`roundtable: ${name} listener threw: ${String(e)}`);
            }
        }
    }
}
//# sourceMappingURL=service.js.map