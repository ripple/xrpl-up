"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.balanceCommand = void 0;
const commander_1 = require("commander");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.balanceCommand = new commander_1.Command("balance")
    .alias("bal")
    .description("Get the XRP balance of an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--drops", "Output raw drops as a plain integer string")
    .option("--json", "Output JSON with address and balance fields")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
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
