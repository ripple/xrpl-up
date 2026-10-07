import { Client } from "xrpl";
export declare const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
export declare const TESTNET_FALLBACK_URL = "wss://testnet.xrpl-labs.com/";
export declare const DEVNET_URL = "wss://s.devnet.rippletest.net:51233";
export type Network = "testnet" | "devnet";
/** Resolves a network alias ("testnet" | "devnet") or passes through a raw WebSocket URL unchanged. */
export declare function resolveNodeUrl(nodeOrNetwork: string): string;
/** Connects to an XRPL node, runs `fn`, then disconnects — even on error.
 *  For testnet nodes, retries up to 5 times alternating between primary and
 *  fallback, sleeping 2 s between each attempt. */
export declare function withClient<T>(nodeUrl: string, fn: (client: Client) => Promise<T>): Promise<T>;
//# sourceMappingURL=client.d.ts.map