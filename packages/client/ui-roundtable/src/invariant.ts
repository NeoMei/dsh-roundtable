/** Package-owned invariant companion for the roundtable UI plugin. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-roundtable'

/** Cordis companion plugin name. */
export const name = 'client-ui-roundtable-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser plugin contributes one effect-owned
 * Conversation Definition, keyed renderer, and dictionary; tests prove their
 * disposal and the Host roundtable package owns the durable event invariant.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
