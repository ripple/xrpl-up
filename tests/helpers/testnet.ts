import { Client, Wallet } from "xrpl";
import { TESTNET_URL } from "../../src/utils/client";

const FAUCET_URL = "https://faucet.altnet.rippletest.net/accounts";

/**
 * Fund a fresh wallet from the testnet faucet.
 * Returns the funded wallet.
 */
const FAUCET_MAX_RETRIES = 30;
const FAUCET_RETRY_BASE_MS = 5000;

export async function fundFromFaucet(client: Client): Promise<Wallet> {
  const wallet = Wallet.generate();
  let lastStatus = 0;
  for (let attempt = 0; attempt < FAUCET_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = FAUCET_RETRY_BASE_MS * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
    const response = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: wallet.address }),
    });
    if (response.ok) {
      await waitForAccount(client, wallet.address);
      return wallet;
    }
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(`Faucet request failed after ${FAUCET_MAX_RETRIES} attempts: ${lastStatus}`);
}

/**
 * Fund multiple wallets from a single funded source wallet.
 * Used to parallelize E2E tests without hammering the faucet.
 */
export async function distributeToWallets(
  client: Client,
  source: Wallet,
  count: number,
  amountXrp: number = 25
): Promise<Wallet[]> {
  const wallets = Array.from({ length: count }, () => Wallet.generate());
  const { xrpToDrops, autofill, sign, submitAndWait } = await import("xrpl");

  for (const wallet of wallets) {
    const tx = await autofill(client, {
      TransactionType: "Payment",
      Account: source.address,
      Amount: xrpToDrops(amountXrp),
      Destination: wallet.address,
    });
    const signed = sign(tx, source);
    await submitAndWait(signed.tx_blob, client);
  }

  return wallets;
}

async function waitForAccount(
  client: Client,
  address: string,
  retries = 10,
  delayMs = 2000
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
  throw new Error(`Account ${address} did not appear on ledger after ${retries} retries`);
}

export { TESTNET_URL };
