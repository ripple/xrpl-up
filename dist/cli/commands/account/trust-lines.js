"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trustLinesCommand = void 0;
const commander_1 = require("commander");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.trustLinesCommand = new commander_1.Command("trust-lines")
    .alias("lines")
    .description("List trust lines for an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--peer <address>", "Filter to trust lines with a specific peer")
    .option("--limit <n>", "Number of trust lines to return")
    .option("--marker <json-string>", "Pagination marker from a previous --json response")
    .option("--json", "Output raw JSON lines array")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
        const reqParams = {
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
            reqParams.marker = JSON.parse(options.marker);
        }
        const resp = await client.request(reqParams);
        const result = resp.result;
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
            // `account_lines` omits boolean fields entirely when they're false,
            // so a missing field here means false, not "unknown".
            const freeze = Boolean(line.freeze || line.freeze_peer);
            const noRipple = Boolean(line.no_ripple || line.no_ripple_peer);
            // `authorized` is whether the queried account itself is authorized on
            // this line; `peer_authorized` is whether the counterparty (typically
            // the issuer, under RequireAuth) has authorized it — the one most
            // examples care about.
            const authorized = Boolean(line.authorized || line.peer_authorized);
            console.log(`${line.currency}/${line.account}  balance: ${line.balance}  limit: ${line.limit}  ` +
                `noRipple: ${noRipple}  freeze: ${freeze}  authorized: ${authorized}`);
        }
    });
});
