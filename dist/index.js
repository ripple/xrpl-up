"use strict";
/**
 * xrpl-up public API
 *
 * Utilities for scripts run via `xrpl-up run`:
 *   - loadConfig / resolveNetwork
 *   - NetworkManager
 *   - WalletStore
 *   - withClient (ledger wrapper from xrpl-cli)
 *
 * Environment variables injected by the `run` command:
 *   XRPL_NETWORK        – network key (e.g. "testnet")
 *   XRPL_NETWORK_URL    – WebSocket URL
 *   XRPL_NETWORK_NAME   – display name
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVNET_URL = exports.TESTNET_FALLBACK_URL = exports.TESTNET_URL = exports.resolveNodeUrl = exports.withClient = exports.WalletStore = exports.NetworkManager = exports.DEFAULT_CONFIG = exports.isMainnet = exports.resolveNetwork = exports.loadConfig = void 0;
exports.getRunContext = getRunContext;
var config_1 = require("./core/config");
Object.defineProperty(exports, "loadConfig", { enumerable: true, get: function () { return config_1.loadConfig; } });
Object.defineProperty(exports, "resolveNetwork", { enumerable: true, get: function () { return config_1.resolveNetwork; } });
Object.defineProperty(exports, "isMainnet", { enumerable: true, get: function () { return config_1.isMainnet; } });
Object.defineProperty(exports, "DEFAULT_CONFIG", { enumerable: true, get: function () { return config_1.DEFAULT_CONFIG; } });
var network_1 = require("./core/network");
Object.defineProperty(exports, "NetworkManager", { enumerable: true, get: function () { return network_1.NetworkManager; } });
var wallet_store_1 = require("./core/wallet-store");
Object.defineProperty(exports, "WalletStore", { enumerable: true, get: function () { return wallet_store_1.WalletStore; } });
// ── Ledger wrapper (merged from xrpl-cli) ────────────────────────────────────
var client_1 = require("./cli/utils/client");
Object.defineProperty(exports, "withClient", { enumerable: true, get: function () { return client_1.withClient; } });
Object.defineProperty(exports, "resolveNodeUrl", { enumerable: true, get: function () { return client_1.resolveNodeUrl; } });
Object.defineProperty(exports, "TESTNET_URL", { enumerable: true, get: function () { return client_1.TESTNET_URL; } });
Object.defineProperty(exports, "TESTNET_FALLBACK_URL", { enumerable: true, get: function () { return client_1.TESTNET_FALLBACK_URL; } });
Object.defineProperty(exports, "DEVNET_URL", { enumerable: true, get: function () { return client_1.DEVNET_URL; } });
/**
 * Convenience helper for use inside `xrpl-up run` scripts.
 *
 * Returns the XRPL network info available from the run context.
 * The caller is responsible for creating and connecting a Client.
 *
 * @example
 * ```ts
 * import { Client } from 'xrpl';
 * import { getRunContext, WalletStore } from 'xrpl-up';
 *
 * const { networkUrl, networkName, networkKey } = getRunContext();
 * const client = new Client(networkUrl);
 * await client.connect();
 *
 * // Access accounts created by `xrpl-up start`
 * const store = new WalletStore(networkKey);
 * const accounts = store.all();
 * ```
 */
function getRunContext() {
    const networkKey = process.env.XRPL_NETWORK ?? 'testnet';
    const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
    const networkName = process.env.XRPL_NETWORK_NAME ?? 'XRPL Testnet';
    return { networkKey, networkUrl, networkName };
}
