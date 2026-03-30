import { Client, Wallet, xrpToDrops } from "xrpl";
import type { TicketCreate, Payment as XrplPayment } from "xrpl";

export const DEVNET_WS = "wss://s.devnet.rippletest.net:51233";

const DEVNET_FAUCET_URL = "https://faucet.devnet.rippletest.net/accounts";
const FAUCET_MAX_RETRIES = 30;
const FAUCET_RETRY_BASE_MS = 5000;
const RETRY_SLEEP_MS = 2_000;
const RETRY_MAX = 5;

/**
 * Wraps client.request with retry on TimeoutError (same node — devnet has no fallback).
 * Sleeps 2 s between each attempt; gives up after RETRY_MAX tries.
 */
export async function resilientRequestDevnet<TResponse = Record<string, unknown>>(
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

// Module-level ticket pool — shared across all test cases within a file.
// JS is single-threaded so nextTicketDevnet() is race-free.
const ticketPool: number[] = [];

/**
 * Fund a master wallet from the devnet faucet (1 faucet call).
 * Returns a wallet with ~100 XRP ready to distribute.
 */
export async function fundMasterDevnet(client: Client): Promise<Wallet> {
  const wallet = Wallet.generate();
  let lastStatus = 0;

  for (let attempt = 0; attempt < FAUCET_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, FAUCET_RETRY_BASE_MS * attempt));
    }
    const response = await fetch(DEVNET_FAUCET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: wallet.address, userAgent: "xrpl-cli-tests" }),
    });
    if (response.ok) {
      await waitForAccount(client, wallet.address);
      return wallet;
    }
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
  }

  throw new Error(
    `Devnet faucet request failed after ${FAUCET_MAX_RETRIES} attempts: status ${lastStatus}`,
  );
}

/**
 * Pre-create `count` tickets on the master account.
 * Extracts TicketSequence values from meta.AffectedNodes and stores them in
 * the module-level pool for use by nextTicketDevnet().
 */
export async function initTicketPoolDevnet(
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
  const result = await client.submitAndWait(signed.tx_blob);

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
export function nextTicketDevnet(): number {
  const ticket = ticketPool.shift();
  if (ticket === undefined) {
    throw new Error(
      "Ticket pool exhausted — increase count passed to initTicketPoolDevnet",
    );
  }
  return ticket;
}

/**
 * Generate `count` wallets and fund each with `amountXrp` from master.
 * All funding payments are submitted concurrently using Sequence:0 +
 * TicketSequence so they don't conflict with each other.
 */
export async function createFundedDevnet(
  client: Client,
  master: Wallet,
  count: number,
  amountXrp = 3,
): Promise<Wallet[]> {
  const wallets = Array.from({ length: count }, () => Wallet.generate());

  await Promise.all(
    wallets.map(async (wallet) => {
      const ticket = nextTicketDevnet();
      const tx = await client.autofill({
        TransactionType: "Payment",
        Account: master.address,
        Amount: xrpToDrops(amountXrp),
        Destination: wallet.address,
        Sequence: 0,
        TicketSequence: ticket,
      } as XrplPayment & { TicketSequence: number });

      tx.Sequence = 0;
      (tx as typeof tx & { TicketSequence: number }).TicketSequence = ticket;

      const signed = master.sign(tx);
      const res = await client.submitAndWait(signed.tx_blob);

      const txResult = (res.result.meta as { TransactionResult?: string })
        ?.TransactionResult;
      if (txResult !== "tesSUCCESS") {
        throw new Error(
          `Funding payment failed: ${txResult} (ticket ${ticket}, dest ${wallet.address})`,
        );
      }
      await waitForAccount(client, wallet.address);
    }),
  );

  return wallets;
}

/**
 * Fund a specific wallet address using a ticket from the pool.
 * Use this when you need to fund a known wallet (e.g. mnemonic-derived).
 */
export async function fundAddressDevnet(
  client: Client,
  master: Wallet,
  targetAddress: string,
  amountXrp = 3,
): Promise<void> {
  const ticket = nextTicketDevnet();
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
    `Account ${address} did not appear on devnet ledger after ${retries} retries`,
  );
}
