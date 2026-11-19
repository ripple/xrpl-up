export interface NetworkConfig {
    url: string;
    name?: string;
}
export interface AccountsConfig {
    count?: number;
}
export interface XrplUpConfig {
    networks: Record<string, NetworkConfig>;
    defaultNetwork: string;
    accounts?: AccountsConfig;
}
export declare const DEFAULT_CONFIG: XrplUpConfig;
export declare function loadConfig(): XrplUpConfig;
export declare function resolveNetwork(config: XrplUpConfig, networkName?: string): {
    name: string;
    config: NetworkConfig;
};
/** Best-effort detection of mainnet URLs. Used to block/warn operations that
 *  should not target the production XRPL network. */
export declare function isMainnet(_networkName: string, networkConfig: NetworkConfig): boolean;
/** URL-only variant for use outside the config system (e.g. CLI wrapper commands). */
export declare function looksLikeMainnetUrl(url: string): boolean;
//# sourceMappingURL=config.d.ts.map