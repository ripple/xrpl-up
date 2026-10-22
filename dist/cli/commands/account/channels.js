"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelsCommand = void 0;
const commander_1 = require("commander");
const xrpl_1 = require("xrpl");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.channelsCommand = new commander_1.Command("channels")
    .alias("chan")
    .description("List payment channels for an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--destination-account <address>", "Filter by destination account")
    .option("--limit <n>", "Number of channels to return")
    .option("--marker <json-string>", "Pagination marker from a previous --json response")
    .option("--json", "Output raw JSON channels array")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
        const reqParams = {
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
            reqParams.marker = JSON.parse(options.marker);
        }
        const resp = await client.request(reqParams);
        const result = resp.result;
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
            const amountXrp = (0, xrpl_1.dropsToXrp)(ch.amount);
            const balanceXrp = (0, xrpl_1.dropsToXrp)(ch.balance);
            console.log(`${ch.channel_id}  dest: ${ch.destination_account}  amount: ${amountXrp} XRP  balance: ${balanceXrp} XRP`);
        }
    });
});
