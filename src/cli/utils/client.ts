import { Client } from "xrpl";

export const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
export const TESTNET_FALLBACK_URL = "wss://testnet.xrpl-labs.com/";
export const MAINNET_URL = "wss://xrplcluster.com";
export const DEVNET_URL = "wss://s.devnet.rippletest.net:51233";

export type Network = "mainnet" | "testnet" | "devnet" | "local";

const NETWORK_URLS: Record<Network, string> = {
  mainnet: MAINNET_URL,
  testnet: TESTNET_URL,
  devnet: DEVNET_URL,
  local: "ws://localhost:6006",
};

/** Resolves a network alias ("mainnet" | "testnet" | "devnet" | "local") or passes through a raw WebSocket URL unchanged. */
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

async function withClientOnce<T>(nodeUrl: string, fn: (client: Client) => Promise<T>): Promise<T> {
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
    return withClientOnce(nodeUrl, fn);
  }

  if (isFallbackable) {
    const alt = nodeUrl === TESTNET_URL ? TESTNET_FALLBACK_URL : TESTNET_URL;
    const urls = [nodeUrl, alt];
    let lastErr: unknown;

    for (let i = 0; i < RETRY_MAX; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
      try {
        return await withClientOnce(urls[i % 2], fn);
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
      return await withClientOnce(nodeUrl, fn);
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) throw err;
    }
  }

  throw lastErr;
}
