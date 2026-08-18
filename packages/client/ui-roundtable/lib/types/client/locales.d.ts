/** `roundtable` namespace dictionaries. */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "roundtable";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    title: string;
    'footer.action': string;
    'roster.empty': string;
    'round.title': string;
    'round.topic': string;
    'round.steers': string;
    'round.summary': string;
    'round.empty': string;
    'live.title': string;
    export: string;
    continue: string;
    stop: string;
    'status.active': string;
    'status.completed': string;
    'status.cancelled': string;
    'status.error': string;
};
/** English dictionary (same key set). */
export declare const en: Record<RoundtableKey, string>;
/** Union of this namespace's dictionary keys. */
export type RoundtableKey = keyof typeof zh;
//# sourceMappingURL=locales.d.ts.map