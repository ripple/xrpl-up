import { Client, Wallet } from "xrpl";

export const DEVNET_URL = "wss://s.devnet.rippletest.net:51233";
const DEVNET_FAUCET_URL = "https://faucet.devnet.rippletest.net/accounts";

const FAUCET_MAX_RETRIES = 30;
const FAUCET_RETRY_BASE_MS = 5000;

/**
 * Fund a fresh wallet from the devnet faucet.
 */
export async function fundFromDevnetFaucet(client: Client): Promise<Wallet> {
  const wallet = Wallet.generate();
  let lastStatus = 0;
  for (let attempt = 0; attempt < FAUCET_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = FAUCET_RETRY_BASE_MS * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
    const response = await fetch(DEVNET_FAUCET_URL, {
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
  throw new Error(`Devnet faucet request failed after ${FAUCET_MAX_RETRIES} attempts: ${lastStatus}`);
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
  throw new Error(`Account ${address} did not appear on devnet ledger after ${retries} retries`);
}
