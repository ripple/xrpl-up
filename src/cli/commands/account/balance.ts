import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

export const balanceCommand = new Command("balance")
  .alias("bal")
  .description("Get the XRP balance of an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--drops", "Output raw drops as a plain integer string")
  .option("--json", "Output JSON with address and balance fields")
  .action(async (addressOrAlias: string, options: { drops?: boolean; json?: boolean }, cmd: Command) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    await withClient(url, async (client) => {
      const resp = await client.request({
        command: "account_info",
        account: address,
        ledger_index: "validated",
      });

      const data = resp.result.account_data;
      const balanceDrops = data.Balance;
      const balanceXrp = Number(balanceDrops) / 1_000_000;

      if (options.json) {
        console.log(JSON.stringify({ address: data.Account, balanceXrp, balanceDrops }));
        return;
      }

      if (options.drops) {
        console.log(balanceDrops);
        return;
      }

      console.log(`${balanceXrp} XRP`);
    });
  });
