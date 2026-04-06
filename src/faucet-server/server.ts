import http from 'node:http';
import { Client, Wallet, xrpToDrops } from 'xrpl';

const RIPPLED_WS_URL = process.env.RIPPLED_WS_URL ?? 'ws://rippled:80';
const PORT = parseInt(process.env.FAUCET_PORT ?? '3001', 10);
const FUND_AMOUNT_XRP = parseInt(process.env.FUND_AMOUNT_XRP ?? '1000', 10);
const LEDGER_INTERVAL_MS = parseInt(process.env.LEDGER_INTERVAL_MS ?? '0', 10);
const GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';

// Singleton client — reuse one WebSocket connection for all requests
let client: Client | null = null;

async function getClient(): Promise<Client> {
  if (client && client.isConnected()) return client;
  client = new Client(RIPPLED_WS_URL, { timeout: 60_000 });
  // Swallow connection-level errors (e.g. rippled restarting for a snapshot).
  // The HTTP server stays up; the next request will reconnect via this function.
  client.on('error', () => { client = null; });
  await client.connect();
  return client;
}

/** Read the full request body as a string. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

/**
 * Fund a wallet on the local sandbox.
 *
 * - If `destination` is provided: send FUND_AMOUNT_XRP to that address.
 *   Returns `{ address, balance }` — no seed (caller already has it).
 * - If `destination` is omitted: generate a fresh wallet, fund it, and
 *   return `{ address, seed, balance }`.
 */
async function fundWallet(destination?: string): Promise<{ address: string; seed?: string; balance: number }> {
  const c = await getClient();
  const genesis = Wallet.fromSeed(GENESIS_SEED);

  let targetAddress: string;
  let newWallet: Wallet | undefined;

  if (destination) {
    targetAddress = destination;
  } else {
    newWallet = Wallet.generate();
    targetAddress = newWallet.address;
  }

  const paymentTx = await c.autofill({
    TransactionType: 'Payment',
    Account: genesis.address,
    Amount: xrpToDrops(String(FUND_AMOUNT_XRP)),
    Destination: targetAddress,
  });

  const { tx_blob } = genesis.sign(paymentTx);
  await c.submit(tx_blob);

  // Advance the ledger to validate the funding transaction.
  // Wrap in try/catch — the CLI's auto-advance ticker may beat us to it; harmless.
  try {
    await (c as any).request({ command: 'ledger_accept' });
  } catch {
    // ledger already closed by someone else — that's fine
  }

  return {
    address: targetAddress,
    ...(newWallet ? { seed: newWallet.seed ?? '' } : {}),
    balance: FUND_AMOUNT_XRP,
  };
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Fund a wallet
  if (req.method === 'POST' && req.url === '/faucet') {
    try {
      // Read optional body — { destination?: string }
      let destination: string | undefined;
      const rawBody = await readBody(req);
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody) as { destination?: string };
          if (parsed.destination && typeof parsed.destination === 'string') {
            destination = parsed.destination;
          }
        } catch { /* ignore malformed JSON — treat as no destination */ }
      }

      const result = await fundWallet(destination);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[faucet] listening on port ${PORT}, rippled at ${RIPPLED_WS_URL}`);
});

// Auto-advance ledger (detach mode only — when CLI is not running)
if (LEDGER_INTERVAL_MS > 0) {
  const advance = async () => {
    try {
      const c = await getClient();
      await (c as any).request({ command: 'ledger_accept' });
    } catch { /* swallow — rippled may be restarting */ }
    setTimeout(advance, LEDGER_INTERVAL_MS);
  };
  setTimeout(advance, LEDGER_INTERVAL_MS);
  console.log(`[faucet] auto-advancing ledger every ${LEDGER_INTERVAL_MS}ms`);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (client?.isConnected()) await client.disconnect();
  server.close(() => process.exit(0));
});
