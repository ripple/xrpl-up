import { Client, Wallet, xrpToDrops } from "xrpl";

export const XRPL_WS = "ws://localhost:6006";
export const XRPL_WS_FALLBACK = "ws://localhost:6006";

// Amount to fund each test wallet. Well above the 10 XRP base reserve on standalone.
const FUND_AMOUNT_XRP = 100;

// Each worker fork gets its own pre-funded master account (seeded by globalSetup).
// VITEST_WORKER_ID starts at 1, seeds are stored 0-indexed.
const WORKER_ID = Math.max(0, parseInt(process.env.VITEST_WORKER_ID ?? "1") - 1);
const WORKER_SEED = process.env[`XRPL_WORKER_SEED_${WORKER_ID}`];

function getWorkerWallet(): Wallet {
  if (!WORKER_SEED) {
    throw new Error(
      `XRPL_WORKER_SEED_${WORKER_ID} is not set. ` +
        `Run tests via vitest.config.local.ts so globalSetup pre-funds worker masters.`,
    );
  }
  return Wallet.fromSeed(WORKER_SEED);
}

const LOCAL_FAUCET_URL = "http://localhost:3001/faucet";
const RETRY_SLEEP_MS = 500;
const RETRY_MAX = 5;

// ─── Serialization queue ──────────────────────────────────────────────────────
//
// All genesis account operations (whether via faucet or direct client calls)
// must be serialized so the autofill sequence numbers don't collide.
// The queue is module-level and shared across all test files in the same worker
// process (maxForks: 1).

let genesisQueue: Promise<void> = Promise.resolve();

/**
 * Acquire the genesis serialization lock, run `fn`, then release.
 */
async function withGenesisLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prev = genesisQueue;
  genesisQueue = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ─── Per-fork master payment (no ledger_accept) ───────────────────────────────
//
// Submits a Payment from this fork's pre-funded master → destination using
// client.submit() (fire-and-forget). Each fork has its own master account
// (seeded by globalSetup), so forks never share sequence numbers.
// Does NOT call ledger_accept — the 1-second periodic timer advances the ledger,
// keeping close_time tracking wall-clock time.

async function masterPayment(client: Client, destination: string): Promise<void> {
  await withGenesisLock(async () => {
    const master = getWorkerWallet();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1_000));
      try {
        // Re-autofill on every attempt: if the previous submit timed out but
        // the tx was actually accepted, the sequence will have advanced.
        const tx = await client.autofill({
          TransactionType: "Payment",
          Account: master.address,
          Amount: xrpToDrops(String(FUND_AMOUNT_XRP)),
          Destination: destination,
        });
        const { tx_blob } = master.sign(tx);
        await client.submit(tx_blob);
        return; // success
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Timeout")) throw err; // non-timeout errors re-thrown immediately
      }
    }
    throw lastErr;
  });
}

// ─── Faucet (kept for health-check compatibility; not used for wallet funding) ─

async function callFaucet(
  body: Record<string, unknown>,
): Promise<{ address: string; seed?: string; balance: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(LOCAL_FAUCET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Local faucet request failed: HTTP ${response.status}`);
      }
      return (await response.json()) as { address: string; seed?: string; balance: number };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        attempt < 2 &&
        (msg.includes("other side closed") ||
          msg.includes("UND_ERR_SOCKET") ||
          msg.includes("fetch failed"))
      ) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

// ─── Resilient wrappers ───────────────────────────────────────────────────────

/**
 * Wraps client.request with retry on TimeoutError.
 * Local node is reliable so no fallback node needed.
 */
export async function resilientRequest<TResponse = Record<string, unknown>>(
  client: Client,
  params: Parameters<Client["request"]>[0],
): Promise<TResponse> {
  let lastErr: unknown;
  for (let i = 0; i < RETRY_MAX; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
    try {
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
 * Wraps client.submitAndWait with retry on TimeoutError.
 */
export async function resilientSubmitAndWait(
  client: Client,
  tx_blob: string,
): Promise<Awaited<ReturnType<typeof client.submitAndWait>>> {
  let lastErr: unknown;
  for (let i = 0; i < RETRY_MAX; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
    try {
      return await client.submitAndWait(tx_blob);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Timeout")) throw err;
    }
  }
  throw lastErr;
}

// ─── Funding helpers ──────────────────────────────────────────────────────────

/**
 * Fund a master wallet by submitting a direct genesis payment.
 * Returns a wallet with FUND_AMOUNT_XRP XRP, ready to distribute.
 *
 * Uses genesisPayment (no ledger_accept) so that ledger close time
 * continues to track wall-clock time.
 */
export async function fundMaster(client: Client): Promise<Wallet> {
  const master = Wallet.generate();
  await masterPayment(client, master.address);
  await waitForAccount(client, master.address);
  return master;
}

/**
 * No-op in local mode — ticket pool not needed.
 * Kept for API compatibility.
 */
export async function initTicketPool(
  _client: Client,
  _master: Wallet,
  _count: number,
): Promise<void> {}

/**
 * Not used in local mode.
 * Exported for API compatibility only.
 */
export function nextTicket(): number {
  throw new Error("nextTicket() should not be called in local mode");
}

/**
 * Generate `count` unfunded wallets (no network calls).
 */
export function generateWallets(count: number): Wallet[] {
  return Array.from({ length: count }, () => Wallet.generate());
}

/**
 * Create `count` funded wallets via direct genesis payments.
 *
 * All payments are submitted first (serialized through genesisQueue so
 * sequence numbers don't collide), then waitForAccount runs concurrently
 * for all wallets. A single periodic ledger close (≤1 s) validates the
 * whole batch, so N wallets cost N×~50 ms (submit) + ≤1 s (validation).
 *
 * `master` and `amountXrp` are accepted for API compatibility but ignored.
 */
export async function createFunded(
  client: Client,
  _master: Wallet,
  count: number,
  _amountXrp = 3,
): Promise<Wallet[]> {
  const wallets = Array.from({ length: count }, () => Wallet.generate());
  // Submit all payments first (serialized — no concurrent sequence conflicts)
  for (const wallet of wallets) {
    await masterPayment(client, wallet.address);
  }
  // Wait for all accounts to appear in the validated ledger concurrently
  await Promise.all(wallets.map((w) => waitForAccount(client, w.address)));
  return wallets;
}

/**
 * Fund a specific address via a direct genesis payment.
 * `master` and `amountXrp` are accepted for API compatibility but ignored.
 */
export async function fundAddress(
  client: Client,
  _master: Wallet,
  targetAddress: string,
  _amountXrp = 3,
): Promise<void> {
  await masterPayment(client, targetAddress);
  await waitForAccount(client, targetAddress);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function waitForAccount(
  client: Client,
  address: string,
  retries = 20,
  delayMs = 500,
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
