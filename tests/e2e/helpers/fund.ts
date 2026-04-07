import { Client, Wallet, xrpToDrops } from "xrpl";
import type { TicketCreate, Payment as XrplPayment } from "xrpl";

export const XRPL_WS = "wss://s.altnet.rippletest.net:51233";
export const XRPL_WS_FALLBACK = "wss://testnet.xrpl-labs.com/";

/**
 * Connect a Client with retry. Exported for API compatibility with local.ts.
 * On testnet, connections are generally reliable so this rarely retries.
 */
export async function connectWithRetry(
  clientRef: { client: Client },
  maxAttempts = 3,
  perAttemptMs = 30_000,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await Promise.race([
        clientRef.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("connect timeout")), perAttemptMs),
        ),
      ]);
      return;
    } catch {
      try { await clientRef.client.disconnect(); } catch { /* ignore */ }
      if (i < maxAttempts - 1) {
        clientRef.client = new Client(XRPL_WS, { timeout: 60_000 });
      }
    }
  }
  throw new Error(`Failed to connect to ${XRPL_WS} after ${maxAttempts} attempts`);
}

const FAUCET_URL = "https://faucet.altnet.rippletest.net/accounts";
const FAUCET_URL_FALLBACK = "https://testnet.xrpl-labs.com/accounts";
const FAUCET_MAX_RETRIES = 30;
const FAUCET_RETRY_BASE_MS = 5000;
const RETRY_SLEEP_MS = 2_000;
const RETRY_MAX = 5;

// Module-level ticket pool — shared across all test cases within a file.
// JS is single-threaded so nextTicket() is race-free.
const ticketPool: number[] = [];

/**
 * Wraps client.request with alternating-node retry on TimeoutError.
 * Odd-numbered attempts use the fallback node; even attempts use the primary client.
 * Sleeps 2 s between each attempt; gives up after RETRY_MAX tries.
 */
export async function resilientRequest<TResponse = Record<string, unknown>>(
  client: Client,
  params: Parameters<Client["request"]>[0],
): Promise<TResponse> {
  let lastErr: unknown;
  for (let i = 0; i < RETRY_MAX; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
    const useFallback = i % 2 === 1;
    try {
      if (useFallback) {
        const fb = new Client(XRPL_WS_FALLBACK, { timeout: 60_000 });
        try {
          await fb.connect();
          return (await fb.request(params)) as TResponse;
        } finally {
          await fb.disconnect().catch(() => {});
        }
      }
      return (await client.request(params)) as TResponse;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Timeout")) throw err;
    }
  }
  throw lastErr;
}

/**
 * Wraps client.submitAndWait with alternating-node retry on TimeoutError.
 */
export async function resilientSubmitAndWait(
  client: Client,
  tx_blob: string,
): Promise<Awaited<ReturnType<typeof client.submitAndWait>>> {
  let lastErr: unknown;
  for (let i = 0; i < RETRY_MAX; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
    const useFallback = i % 2 === 1;
    try {
      if (useFallback) {
        const fb = new Client(XRPL_WS_FALLBACK, { timeout: 60_000 });
        try {
          await fb.connect();
          return await fb.submitAndWait(tx_blob);
        } finally {
          await fb.disconnect().catch(() => {});
        }
      }
      return await client.submitAndWait(tx_blob);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Timeout")) throw err;
    }
  }
  throw lastErr;
}

/**
 * Fund a master wallet from the testnet faucet (1 faucet call).
 * Returns a wallet with ~1000 XRP ready to distribute.
 * On TimeoutError, retries once using the fallback node and faucet.
 */
export async function fundMaster(client: Client): Promise<Wallet> {
  const wallet = Wallet.generate();
  let lastStatus = 0;
  let originalError: Error | undefined;

  const tryFund = async (faucetUrl: string, waitClient: Client): Promise<Wallet | null> => {
    for (let attempt = 0; attempt < FAUCET_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, FAUCET_RETRY_BASE_MS * attempt));
      }
      const response = await fetch(faucetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: wallet.address }),
      });
      if (response.ok) {
        await waitForAccount(waitClient, wallet.address);
        return wallet;
      }
      lastStatus = response.status;
      if (response.status !== 429 && response.status < 500) break;
    }
    return null;
  };

  try {
    const result = await tryFund(FAUCET_URL, client);
    if (result) return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Timeout")) {
      throw err;
    }
    originalError = err instanceof Error ? err : new Error(msg);
  }

  // Fallback: retry once using the fallback node
  const fallbackClient = new Client(XRPL_WS_FALLBACK, { timeout: 60_000 });
  try {
    await fallbackClient.connect();
    const result = await tryFund(FAUCET_URL_FALLBACK, fallbackClient);
    if (result) return result;
  } catch (fallbackErr) {
    if (originalError) throw originalError;
    throw fallbackErr;
  } finally {
    await fallbackClient.disconnect();
  }

  if (originalError) throw originalError;
  throw new Error(
    `Faucet request failed after ${FAUCET_MAX_RETRIES} attempts: status ${lastStatus}`,
  );
}

/**
 * Pre-create `count` tickets on the master account.
 * Extracts TicketSequence values from meta.AffectedNodes and stores them in
 * the module-level pool for use by nextTicket().
 */
export async function initTicketPool(
  client: Client,
  master: Wallet,
  count: number,
): Promise<void> {
  const ticketTx: TicketCreate = await client.autofill({
    TransactionType: "TicketCreate",
    Account: master.address,
    TicketCount: count,
  });
  const signed = master.sign(ticketTx);

  const result = await resilientSubmitAndWait(client, signed.tx_blob);

  const meta = result.result.meta;
  if (!meta || typeof meta === "string") {
    throw new Error("No metadata returned from TicketCreate");
  }

  const affectedNodes = meta.AffectedNodes ?? [];
  for (const node of affectedNodes) {
    if ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === "Ticket") {
      const fields = node.CreatedNode.NewFields as { TicketSequence?: number };
      if (typeof fields.TicketSequence === "number") {
        ticketPool.push(fields.TicketSequence);
      }
    }
  }
}

/**
 * Synchronously pop the next ticket from the pool.
 * Safe to call from concurrent async paths because JS is single-threaded.
 */
export function nextTicket(): number {
  const ticket = ticketPool.shift();
  if (ticket === undefined) {
    throw new Error(
      "Ticket pool exhausted — increase count passed to initTicketPool",
    );
  }
  return ticket;
}

/**
 * Generate `count` unfunded wallets (no network calls).
 */
export function generateWallets(count: number): Wallet[] {
  return Array.from({ length: count }, () => Wallet.generate());
}

/**
 * Generate `count` wallets and fund each with `amountXrp` from master.
 * All funding payments are submitted concurrently using Sequence:0 +
 * TicketSequence so they don't conflict with each other.
 */
export async function createFunded(
  client: Client,
  master: Wallet,
  count: number,
  amountXrp = 3,
): Promise<Wallet[]> {
  const wallets = generateWallets(count);

  await Promise.all(
    wallets.map(async (wallet) => {
      const ticket = nextTicket();
      // Build the payment with Sequence:0 + TicketSequence so concurrent
      // payments from master don't step on each other's sequence numbers.
      const tx = await client.autofill({
        TransactionType: "Payment",
        Account: master.address,
        Amount: xrpToDrops(amountXrp),
        Destination: wallet.address,
        // Pre-set Sequence:0 so autofill doesn't overwrite it.
        Sequence: 0,
        TicketSequence: ticket,
      } as XrplPayment & { TicketSequence: number });

      // Ensure autofill did not clobber the ticket-based fields.
      tx.Sequence = 0;
      (tx as typeof tx & { TicketSequence: number }).TicketSequence = ticket;

      const signed = master.sign(tx);
      const res = await resilientSubmitAndWait(client, signed.tx_blob);
      const txResult = (res.result.meta as { TransactionResult?: string })
        ?.TransactionResult;
      if (txResult !== "tesSUCCESS") {
        throw new Error(
          `Funding payment failed: ${txResult} (ticket ${ticket}, dest ${wallet.address})`,
        );
      }
      // Verify the account is visible before returning (guards against
      // propagation delay between validated ledger and account_info visibility)
      await waitForAccount(client, wallet.address);
    }),
  );

  return wallets;
}

/**
 * Fund a specific wallet address using a ticket from the pool.
 * Use this when you need to fund a known wallet (e.g. mnemonic-derived).
 */
export async function fundAddress(
  client: Client,
  master: Wallet,
  targetAddress: string,
  amountXrp = 3,
): Promise<void> {
  const ticket = nextTicket();
  const tx = await client.autofill({
    TransactionType: "Payment",
    Account: master.address,
    Amount: xrpToDrops(amountXrp),
    Destination: targetAddress,
    Sequence: 0,
    TicketSequence: ticket,
  } as XrplPayment & { TicketSequence: number });
  tx.Sequence = 0;
  (tx as typeof tx & { TicketSequence: number }).TicketSequence = ticket;
  const signed = master.sign(tx);
  await client.submitAndWait(signed.tx_blob);
  await waitForAccount(client, targetAddress);
}

async function waitForAccount(
  client: Client,
  address: string,
  retries = 10,
  delayMs = 2000,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await client.request({
        command: "account_info",
        account: address,
        ledger_index: "validated",
      });
      return;
    } catch {
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw new Error(
    `Account ${address} did not appear on ledger after ${retries} retries`,
  );
}
