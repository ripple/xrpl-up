import { Client } from "xrpl";
/**
 * Registered in the RippleX SourceTag Registry for xrpl-up. Permanent, opaque —
 * do not make this configurable (see registry: "treat as a permanent, opaque identifier").
 * Applied by default to transactions on non-local, non-mainnet networks so Ripple's
 * data team can attribute testnet/devnet activity to this CLI. Never overrides a
 * SourceTag a command has already set explicitly (e.g. escrow.ts's --source-tag flag).
 */
export declare const XRPL_UP_SOURCE_TAG = 548372691;
export declare const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
export declare const TESTNET_FALLBACK_URL = "wss://testnet.xrpl-labs.com/";
export declare const DEVNET_URL = "wss://s.devnet.rippletest.net:51233";
export type Network = "testnet" | "devnet" | "local";
/** Resolves a network alias ("testnet" | "devnet" | "local") or passes through a raw WebSocket URL unchanged. */
export declare function resolveNodeUrl(nodeOrNetwork: string): string;
export declare class MainnetBlockedError extends Error {
    constructor(nodeUrl: string);
}
/**
 * 0 is mainnet by xrpl.js's own convention (see Wallet/defaultFaucets.ts).
 * networkID is populated by xrpl.js from the connected server's own
 * server_info, so this works for any mainnet-connected node regardless of
 * hostname — unlike the URL-string heuristic in core/config.ts's
 * isMainnet(), which only catches three known Ripple-operated hostnames.
 * Blocks unconditionally, with no override — matches `start`/`faucet`'s
 * existing mainnet block, since this tool is not designed or supported for
 * Mainnet use at all. Exported as a pure function so the decision can be
 * unit tested without a live connection.
 */
export declare function shouldBlockMainnet(networkID: number | undefined, isLocal: boolean): boolean;
/** Connects to an XRPL node, runs `fn`, then disconnects — even on error.
 *  For testnet nodes, retries up to 5 times alternating between primary and
 *  fallback, sleeping 2 s between each attempt.
 *  For local nodes, retries up to 3 times on transient connection errors
 *  (WebSocket busy under concurrent load). */
export declare function withClient<T>(nodeUrl: string, fn: (client: Client) => Promise<T>): Promise<T>;
//# sourceMappingURL=client.d.ts.map