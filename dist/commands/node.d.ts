export interface NodeOptions {
    network?: string;
    accountCount?: number;
    local?: boolean;
    localNetwork?: boolean;
    image?: string;
    ledgerInterval?: number;
    noAutoAdvance?: boolean;
    noSecrets?: boolean;
    debug?: boolean;
    detach?: boolean;
    noRestart?: boolean;
    config?: string;
    bindAddress?: string;
}
/**
 * `--config` (writeComposeFile in compose.ts) always forces standalone mode —
 * a custom rippled.cfg replaces the generated 2-node consensus setup entirely.
 * Reject the combination up front instead of silently downgrading a mode the
 * user explicitly asked for.
 */
export declare function assertConfigCompatibleWithMode(options: NodeOptions): void;
export declare function nodeCommand(options?: NodeOptions): Promise<void>;
//# sourceMappingURL=node.d.ts.map