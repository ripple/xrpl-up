"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mptokensCommand = void 0;
const commander_1 = require("commander");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.mptokensCommand = new commander_1.Command("mptokens")
    .alias("mpt")
    .description("List Multi-Purpose Tokens (MPT) held by an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--limit <n>", "Number of tokens to return", "20")
    .option("--marker <json-string>", "Pagination marker from a previous --json response")
    .option("--json", "Output raw JSON tokens array", false)
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
        const res = await client.request({
            command: "account_objects",
            account: address,
            type: "mptoken",
            limit: parseInt(options.limit, 10),
            marker: options.marker ? JSON.parse(options.marker) : undefined,
            ledger_index: "validated",
        });
        const tokens = res.result.account_objects;
        if (options.json) {
            console.log(JSON.stringify({
                tokens,
                marker: res.result.marker
            }, null, 2));
            return;
        }
        if (tokens.length === 0) {
            console.log("No MPTs held.");
            return;
        }
        console.log(`${"MPTokenIssuanceID".padEnd(48)}  ${"Balance".padStart(20)}  Flags`);
        console.log("-".repeat(48) + "  " + "-".repeat(20) + "  " + "-----");
        // lsfMPTLocked = 0x00000001. MPToken objects can have other bits set at
        // the same time (e.g. lsfMPTAuthorized = 0x00000002 for require-auth
        // issuances), so this must be a bitwise check, not strict equality —
        // otherwise a locked-and-authorized holder (Flags === 3) would show "None".
        for (const token of tokens) {
            const flags = (token.Flags & 0x00000001) !== 0 ? "Locked" : "None";
            // rippled omits MPTAmount entirely when the balance is exactly 0
            const amount = token.MPTAmount ?? "0";
            console.log(`${token.MPTokenIssuanceID}  ${amount.padStart(20)}  ${flags}`);
        }
        if (res.result.marker) {
            console.log(`\n(More tokens available. Use --marker '${JSON.stringify(res.result.marker)}' to see them)`);
        }
    });
});
