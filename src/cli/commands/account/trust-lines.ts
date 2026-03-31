import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

interface TrustLine {
  account: string;
  currency: string;
  balance: string;
  limit: string;
  limit_peer?: string;
  no_ripple?: boolean;
  no_ripple_peer?: boolean;
  quality_in?: number;
  quality_out?: number;
  freeze?: boolean;
  freeze_peer?: boolean;
}

export const trustLinesCommand = new Command("trust-lines")
  .alias("lines")
  .description("List trust lines for an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--peer <address>", "Filter to trust lines with a specific peer")
  .option("--limit <n>", "Number of trust lines to return")
  .option("--marker <json-string>", "Pagination marker from a previous --json response")
  .option("--json", "Output raw JSON lines array")
  .action(async (
    addressOrAlias: string,
    options: { peer?: string; limit?: string; marker?: string; json?: boolean },
    cmd: Command
  ) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    await withClient(url, async (client) => {
      const reqParams: Record<string, unknown> = {
        command: "account_lines",
        account: address,
      };

      if (options.peer) {
        reqParams.peer = options.peer;
      }

      if (options.limit) {
        reqParams.limit = Number(options.limit);
      }

      if (options.marker) {
        reqParams.marker = JSON.parse(options.marker) as unknown;
      }

      const resp = await client.request(reqParams as Parameters<typeof client.request>[0]);
      const result = resp.result as {
        lines: TrustLine[];
        marker?: unknown;
      };

      const lines = result.lines ?? [];

      if (options.json) {
        console.log(JSON.stringify(lines));
        return;
      }

      if (lines.length === 0) {
        console.log("(no trust lines)");
        return;
      }

      for (const line of lines) {
        console.log(`${line.currency}/${line.account}  balance: ${line.balance}  limit: ${line.limit}`);
      }
    });
  });
