import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

const TESTNET_FAUCET = "https://faucet.altnet.rippletest.net/accounts";
const DEVNET_FAUCET = "https://faucet.devnet.rippletest.net/accounts";

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 2000;
const FAUCET_MAX_RETRIES = 6;
const FAUCET_RETRY_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const fundCommand = new Command("fund")
  .alias("f")
  .description("Fund an address from the testnet or devnet faucet")
  .argument("<address-or-alias>", "Account address or alias to fund")
  .option("--json", "Output as JSON", false)
  .action(async (addressOrAlias: string, options: { json: boolean }, cmd: Command) => {
    const nodeUrl = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    let faucetUrl: string;
    if (nodeUrl.includes("altnet")) {
      faucetUrl = TESTNET_FAUCET;
    } else if (nodeUrl.includes("devnet")) {
      faucetUrl = DEVNET_FAUCET;
    } else {
      process.stderr.write("Error: wallet fund is only available on testnet and devnet\n");
      process.exit(1);
    }

    let response: Response | undefined;
    for (let attempt = 0; attempt < FAUCET_MAX_RETRIES; attempt++) {
      response = await fetch(faucetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: address }),
      });
      if (response.ok) break;
      // Retry on 429 (rate limit) or 5xx server errors
      if ((response.status === 429 || response.status >= 500) && attempt < FAUCET_MAX_RETRIES - 1) {
        await sleep(FAUCET_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      break;
    }

    if (!response!.ok) {
      const text = await response!.text();
      process.stderr.write(`Error: ${text}\n`);
      process.exit(1);
    }

    // Poll until account appears on ledger
    let balanceDrops: string | undefined;
    await withClient(nodeUrl, async (client) => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const resp = await client.request({
            command: "account_info",
            account: address,
            ledger_index: "validated",
          });
          balanceDrops = resp.result.account_data.Balance;
          return;
        } catch {
          if (attempt < MAX_RETRIES - 1) {
            await sleep(RETRY_DELAY_MS);
          }
        }
      }
      process.stderr.write("Error: account did not appear on ledger after 10 retries\n");
      process.exit(1);
    });

    if (balanceDrops === undefined) {
      process.stderr.write("Error: account did not appear on ledger after 10 retries\n");
      process.exit(1);
    }

    const balanceXrp = Number(balanceDrops) / 1_000_000;

    if (options.json) {
      console.log(JSON.stringify({ address, balanceXrp, balanceDrops }));
    } else {
      console.log(`Funded ${address}`);
      console.log(`Balance: ${balanceXrp} XRP`);
    }
  });
