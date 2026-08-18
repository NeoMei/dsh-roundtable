//#region lib/types/invariant.js
/** Package-owned invariant companion for the roundtable UI plugin. */
const PACKAGE_NAME = "@neomei/dsh-client-ui-roundtable";
/** Cordis companion plugin name. */
const name = "client-ui-roundtable-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the browser plugin contributes one effect-owned
* Conversation Definition, keyed renderer, and dictionary; tests prove their
* disposal and the Host roundtable package owns the durable event invariant.
*/
const install = () => {};
/** Register this package's invariant companion. */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
