/**
 * Resolve a sensitive value from (in priority order):
 *   1. The CLI flag value (if provided — warns user it's insecure)
 *   2. An environment variable (safe — doesn't appear in ps output)
 *   3. An interactive masked prompt (TTY only)
 *
 * @param flagValue  Value from the CLI flag (undefined if not passed)
 * @param envVar     Name of the environment variable to check (e.g. "WALLET_PASSWORD")
 * @param promptText Prompt text for interactive mode
 */
export declare function resolveSecret(flagValue: string | undefined, envVar: string, promptText: string): Promise<string>;
export declare function promptPassword(prompt?: string): Promise<string>;
export declare function promptPasswordWithConfirmation(prompt?: string, confirmPrompt?: string): Promise<string>;
//# sourceMappingURL=prompt.d.ts.map