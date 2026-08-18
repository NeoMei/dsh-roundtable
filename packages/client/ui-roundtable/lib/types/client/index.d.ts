/** Browser plugin for the roundtable sidebar entry ("新讨论组"). */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type RoundtableKey } from './locales.ts';
export type { RoundtableFooterActionInjected } from './slots.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Roundtable sidebar-entry copy. */
        roundtable: RoundtableKey;
    }
}
/** Required services for the dictionary registration and the sidebar entry. */
export declare const inject: string[];
/**
 * Register the roundtable dictionary and the `sidebar.footer.action` entry —
 * the sidebar "新讨论组" button that starts a fresh session and hands off to
 * the `roundtable` skill. Member utterances render as NORMAL chat messages
 * (the host agent re-emits each member's reply), so there is no special panel.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map