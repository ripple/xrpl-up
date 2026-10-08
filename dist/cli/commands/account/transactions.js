"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionsCommand = void 0;
const commander_1 = require("commander");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.transactionsCommand = new commander_1.Command("transactions")
    .alias("txs")
    .description("List recent transactions for an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--limit <n>", "Number of transactions to return (max 400)", "20")
    .option("--marker <json-string>", "Pagination marker from a previous --json response")
    .option("--json", "Output raw JSON with transactions and optional marker")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    const limit = Math.min(Number(options.limit), 400);
    await (0, client_1.withClient)(url, async (client) => {
        const reqParams = {
            command: "account_tx",
            account: address,
            ledger_index_min: -1,
            limit,
        };
        if (options.marker) {
            reqParams.marker = JSON.parse(options.marker);
        }
        const resp = await client.request(reqParams);
        const result = resp.result;
        const transactions = (result.transactions ?? []).slice(0, limit);
        if (options.json) {
            const out = { transactions };
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
