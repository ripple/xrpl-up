import { Client } from "xrpl";

/**
 * Registered in the RippleX SourceTag Registry for xrpl-up. Permanent, opaque —
 * do not make this configurable (see registry: "treat as a permanent, opaque identifier").
 * Applied by default to transactions on non-local, non-mainnet networks so Ripple's
 * data team can attribute testnet/devnet activity to this CLI. Never overrides a
 * SourceTag a command has already set explicitly (e.g. escrow.ts's --source-tag flag).
 */
export const XRPL_UP_SOURCE_TAG = 548372691;

export const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
export const TESTNET_FALLBACK_URL = "wss://testnet.xrpl-labs.com/";
export const DEVNET_URL = "wss://s.devnet.rippletest.net:51233";

export type Network = "testnet" | "devnet" | "local";

const NETWORK_URLS: Record<Network, string> = {
  testnet: TESTNET_URL,
  devnet: DEVNET_URL,
  local: "ws://localhost:6006",
};

/** Resolves a network alias ("testnet" | "devnet" | "local") or passes through a raw WebSocket URL unchanged. */
export function resolveNodeUrl(nodeOrNetwork: string): string {
  if (nodeOrNetwork in NETWORK_URLS) {
    return NETWORK_URLS[nodeOrNetwork as Network];
  }
  return nodeOrNetwork;
}

const RETRY_SLEEP_MS = 2_000;
const RETRY_MAX = 5;
const LOCAL_RETRY_MAX = 3;
const LOCAL_RETRY_SLEEP_MS = 1_000;

/** Set XRPL_UP_ALLOW_MAINNET=1 to override the mainnet block below. */
export const ALLOW_MAINNET_ENV_VAR = 'XRPL_UP_ALLOW_MAINNET';

export class MainnetBlockedError extends Error {
  constructor(nodeUrl: string) {
    super(
      `Refusing to connect to XRPL Mainnet (${nodeUrl}). xrpl-up is not designed or ` +
      'supported for Mainnet — it has no production key management (seeds are stored ' +
      'unencrypted and can be passed on the command line) and several commands are ' +
      `irreversible. Set ${ALLOW_MAINNET_ENV_VAR}=1 to override at your own risk.`
    );
    this.name = 'MainnetBlockedError';
  }
}

/**
 * 0 is mainnet by xrpl.js's own convention (see Wallet/defaultFaucets.ts).
 * networkID is populated by xrpl.js from the connected server's own
 * server_info, so this works for any mainnet-connected node regardless of
 * hostname — unlike the URL-string heuristic in core/config.ts's
 * isMainnet(), which only catches three known Ripple-operated hostnames.
 * Blocks unconditionally (matches `start`/`faucet`'s existing mainnet
 * block) rather than just warning, since this tool is not designed or
 * supported for Mainnet use at all. Exported as a pure function so the
 * decision can be unit tested without a live connection.
 */
export function shouldBlockMainnet(networkID: number | undefined, isLocal: boolean): boolean {
  if (isLocal) return false;
  if (networkID !== 0) return false;
  return process.env[ALLOW_MAINNET_ENV_VAR] !== '1';
}

async function withClientOnce<T>(nodeUrl: string, isLocal: boolean, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(nodeUrl, { timeout: 60_000 });
  await client.connect();

  // Guard against xrpl.js race: connect() can resolve before the
  // underlying WebSocket is fully open (observed on Node 20 under load).
  if (!client.isConnected()) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket did not open within 10s after connect()')), 10_000);
      client.on('connected', () => { clearTimeout(timeout); resolve(); });
      client.on('disconnected', () => { clearTimeout(timeout); reject(new Error('WebSocket disconnected during connect')); });
    });
  }

  if (shouldBlockMainnet(client.networkID, isLocal)) {
    await client.disconnect();
    throw new MainnetBlockedError(nodeUrl);
  }

  // Tag transactions from this CLI for Ripple's testnet/devnet attribution dashboard.
  // networkID is populated by xrpl.js from the connected server's own server_info —
  // 0 is mainnet by xrpl.js's own convention (see Wallet/defaultFaucets.ts). Skips
  // tagging if the value is missing/unknown, rather than guessing.
  if (!isLocal && client.networkID !== 0 && client.networkID !== undefined) {
    const originalAutofill = client.autofill.bind(client);
    client.autofill = (async (tx: Parameters<typeof originalAutofill>[0], signersCount?: number) => {
      if (tx.SourceTag === undefined) tx.SourceTag = XRPL_UP_SOURCE_TAG;
      return originalAutofill(tx, signersCount);
    }) as typeof client.autofill;
  }

  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

/** Returns true for transient connection errors that are worth retrying. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Timeout|ECONNREFUSED|ECONNRESET|WebSocket is not open|readyState/i.test(err.message);
}

/** Connects to an XRPL node, runs `fn`, then disconnects — even on error.
 *  For testnet nodes, retries up to 5 times alternating between primary and
 *  fallback, sleeping 2 s between each attempt.
 *  For local nodes, retries up to 3 times on transient connection errors
 *  (WebSocket busy under concurrent load). */
export async function withClient<T>(
  nodeUrl: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const isFallbackable = nodeUrl === TESTNET_URL || nodeUrl === TESTNET_FALLBACK_URL;
  const isLocal = /localhost|127\.0\.0\.1/i.test(nodeUrl);

  if (!isFallbackable && !isLocal) {
    return withClientOnce(nodeUrl, isLocal, fn);
  }

  if (isFallbackable) {
    const alt = nodeUrl === TESTNET_URL ? TESTNET_FALLBACK_URL : TESTNET_URL;
    const urls = [nodeUrl, alt];
    let lastErr: unknown;

    for (let i = 0; i < RETRY_MAX; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
      try {
        return await withClientOnce(urls[i % 2], isLocal, fn);
      } catch (err) {
        lastErr = err;
        const isTimeout = err instanceof Error && err.message.includes("Timeout");
        if (!isTimeout) throw err;
      }
    }

    throw lastErr;
  }

  // Local node: retry on transient errors (busy WebSocket under concurrent load)
  let lastErr: unknown;
  for (let i = 0; i < LOCAL_RETRY_MAX; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, LOCAL_RETRY_SLEEP_MS));
    try {
      return await withClientOnce(nodeUrl, isLocal, fn);
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) throw err;
    }
  }

  throw lastErr;
}
