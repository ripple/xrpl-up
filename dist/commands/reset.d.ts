export interface ResetOptions {
    snapshots?: boolean;
    keepAmendments?: boolean;
}
/**
 * Wipe all local sandbox state:
 *  - Stop containers (docker compose down)
 *  - Remove the persist ledger volume
 *  - Clear the WalletStore (local-accounts.json)
 *  - Clear amendments added via `amendment enable` (unless --keep-amendments)
 *  - Optionally delete all snapshots (--snapshots)
 */
export declare function resetCommand(options?: ResetOptions): void;
//# sourceMappingURL=reset.d.ts.map