import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

interface TransactionMeta {
  TransactionResult?: string;
}

interface TxEntry {
  ledger_index?: number;
  hash?: string;
  tx_json?: {
    TransactionType?: string;
    hash?: string;
  };
  meta?: TransactionMeta;
}

export const transactionsCommand = new Command("transactions")
  .alias("txs")
  .description("List recent transactions for an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--limit <n>", "Number of transactions to return (max 400)", "20")
  .option("--marker <json-string>", "Pagination marker from a previous --json response")
  .option("--json", "Output raw JSON with transactions and optional marker")
  .action(async (
    addressOrAlias: string,
    options: { limit: string; marker?: string; json?: boolean },
    cmd: Command
  ) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);
    const limit = Math.min(Number(options.limit), 400);

    await withClient(url, async (client) => {
      const reqParams: Record<string, unknown> = {
        command: "account_tx",
        account: address,
        ledger_index_min: -1,
        limit,
      };

      if (options.marker) {
        reqParams.marker = JSON.parse(options.marker) as unknown;
      }

      const resp = await client.request(reqParams as Parameters<typeof client.request>[0]);
      const result = resp.result as {
        transactions: TxEntry[];
        marker?: unknown;
      };

      const transactions = result.transactions ?? [];

      if (options.json) {
        const out: { transactions: TxEntry[]; marker?: unknown } = { transactions };
        if (result.marker !== undefined) {
          out.marker = result.marker;
        }
        console.log(JSON.stringify(out));
        return;
      }

      if (transactions.length === 0) {
        console.log("(no transactions)");
        return;
      }

      for (const entry of transactions) {
        const ledger = entry.ledger_index ?? "-";
        const type = entry.tx_json?.TransactionType ?? "-";
        const result_code = entry.meta?.TransactionResult ?? "-";
        const hash = entry.hash ?? entry.tx_json?.hash ?? "-";
        console.log(`${ledger}  ${type}  ${result_code}  ${hash}`);
      }
    });
  });
