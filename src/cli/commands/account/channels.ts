import { Command } from "commander";
import { dropsToXrp } from "xrpl";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

interface PaymentChannel {
  channel_id: string;
  destination_account: string;
  amount: string;
  balance: string;
  settle_delay?: number;
  expiration?: number;
  cancel_after?: number;
  source_tag?: number;
  destination_tag?: number;
}

export const channelsCommand = new Command("channels")
  .alias("chan")
  .description("List payment channels for an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--destination-account <address>", "Filter by destination account")
  .option("--limit <n>", "Number of channels to return")
  .option("--marker <json-string>", "Pagination marker from a previous --json response")
  .option("--json", "Output raw JSON channels array")
  .action(async (
    addressOrAlias: string,
    options: { destinationAccount?: string; limit?: string; marker?: string; json?: boolean },
    cmd: Command
  ) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    await withClient(url, async (client) => {
      const reqParams: Record<string, unknown> = {
        command: "account_channels",
        account: address,
      };

      if (options.destinationAccount) {
        reqParams.destination_account = options.destinationAccount;
      }

      if (options.limit) {
        reqParams.limit = Number(options.limit);
      }

      if (options.marker) {
        reqParams.marker = JSON.parse(options.marker) as unknown;
      }

      const resp = await client.request(reqParams as Parameters<typeof client.request>[0]);
      const result = resp.result as {
        channels: PaymentChannel[];
        marker?: unknown;
      };

      const channels = result.channels ?? [];

      if (options.json) {
        console.log(JSON.stringify(channels));
        return;
      }

      if (channels.length === 0) {
        console.log("(no payment channels)");
        return;
      }

      for (const ch of channels) {
        const amountXrp = dropsToXrp(ch.amount);
        const balanceXrp = dropsToXrp(ch.balance);
        console.log(
          `${ch.channel_id}  dest: ${ch.destination_account}  amount: ${amountXrp} XRP  balance: ${balanceXrp} XRP`
        );
      }
    });
  });
