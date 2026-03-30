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

export {
  loadConfig,
  resolveNetwork,
  isMainnet,
  DEFAULT_CONFIG,
} from './core/config';
export type { XrplUpConfig, NetworkConfig, AccountsConfig } from './core/config';

export { NetworkManager } from './core/network';
export type { ServerInfo } from './core/network';

export { WalletStore } from './core/wallet-store';
export type { StoredAccount } from './core/wallet-store';

// ── Ledger wrapper (merged from xrpl-cli) ────────────────────────────────────
export {
  withClient,
  resolveNodeUrl,
  TESTNET_URL,
  TESTNET_FALLBACK_URL,
  MAINNET_URL,
  DEVNET_URL,
} from './cli/utils/client';
export type { Network } from './cli/utils/client';

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
 * // Access accounts created by `xrpl-up node`
 * const store = new WalletStore(networkKey);
 * const accounts = store.all();
 * ```
 */
export function getRunContext(): {
  networkKey: string;
  networkUrl: string;
  networkName: string;
} {
  const networkKey = process.env.XRPL_NETWORK ?? 'testnet';
  const networkUrl =
    process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const networkName = process.env.XRPL_NETWORK_NAME ?? 'XRPL Testnet';

  return { networkKey, networkUrl, networkName };
}
