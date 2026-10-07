/**
 * Human-readable descriptions for XRPL transaction result codes.
 * Covers the most common tec, ter, and tef codes a developer will encounter.
 */
export declare const TEC_MESSAGES: Record<string, string>;
/**
 * Returns a human-readable description for a transaction result code.
 * Falls back to the raw code if not found.
 */
export declare function tecMessage(code: string): string;
//# sourceMappingURL=tec-codes.d.ts.map