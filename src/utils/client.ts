import { Client } from "xrpl";

export const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
export const TESTNET_FALLBACK_URL = "wss://testnet.xrpl-labs.com/";
export const DEVNET_URL = "wss://s.devnet.rippletest.net:51233";

export type Network = "testnet" | "devnet";

const NETWORK_URLS: Record<Network, string> = {
  testnet: TESTNET_URL,
  devnet: DEVNET_URL,
};

/** Resolves a network alias ("testnet" | "devnet") or passes through a raw WebSocket URL unchanged. */
export function resolveNodeUrl(nodeOrNetwork: string): string {
  if (nodeOrNetwork in NETWORK_URLS) {
    return NETWORK_URLS[nodeOrNetwork as Network];
  }
  return nodeOrNetwork;
}

const RETRY_SLEEP_MS = 2_000;
const RETRY_MAX = 5;

async function withClientOnce<T>(nodeUrl: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(nodeUrl, { timeout: 60_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

/** Connects to an XRPL node, runs `fn`, then disconnects — even on error.
 *  For testnet nodes, retries up to 5 times alternating between primary and
 *  fallback, sleeping 2 s between each attempt. */
export async function withClient<T>(
  nodeUrl: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const isFallbackable = nodeUrl === TESTNET_URL || nodeUrl === TESTNET_FALLBACK_URL;
  if (!isFallbackable) {
    return withClientOnce(nodeUrl, fn);
  }

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
