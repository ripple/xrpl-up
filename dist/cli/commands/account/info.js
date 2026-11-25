"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.infoCommand = void 0;
const commander_1 = require("commander");
const xrpl_1 = require("xrpl");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.infoCommand = new commander_1.Command("info")
    .alias("i")
    .description("Get full on-ledger account information")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--json", "Output raw JSON")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
        const [infoResp, stateResp] = await Promise.all([
            client.request({
                command: "account_info",
                account: address,
                ledger_index: "validated",
                signer_lists: true,
            }),
            client.request({ command: "server_state" }),
        ]);
        const data = infoResp.result.account_data;
        const signerLists = infoResp.result.signer_lists;
        if (options.json) {
            console.log(JSON.stringify(signerLists && signerLists.length > 0 ? { ...data, signer_lists: signerLists } : data, null, 2));
            return;
        }
        const balanceXrp = Number(data.Balance) / 1_000_000;
        const ownerCount = data.OwnerCount;
        const reserveBase = stateResp.result.state.validated_ledger?.reserve_base ?? 10_000_000;
        const reserveInc = stateResp.result.state.validated_ledger?.reserve_inc ?? 2_000_000;
        const reserveDrops = reserveBase + ownerCount * reserveInc;
        const reserveXrp = reserveDrops / 1_000_000;
        const flags = data.Flags ?? 0;
        const parsedFlags = (0, xrpl_1.parseAccountRootFlags)(flags);
        const flagNames = Object.entries(parsedFlags)
            .filter(([, v]) => v)
            .map(([k]) => k);
        const flagsStr = `0x${flags.toString(16).toUpperCase()}` +
            (flagNames.length > 0 ? ` (${flagNames.join(", ")})` : "");
        console.log(`Address:      ${data.Account}`);
        console.log(`Balance:      ${balanceXrp} XRP`);
        console.log(`Sequence:     ${data.Sequence}`);
        console.log(`Owner Count:  ${ownerCount}`);
        console.log(`Reserve:      ${reserveXrp} XRP (base ${reserveBase / 1_000_000} + ${ownerCount} × ${reserveInc / 1_000_000})`);
        console.log(`Flags:        ${flagsStr}`);
        if (data.Domain) {
            const domain = Buffer.from(data.Domain, "hex").toString("utf8");
            console.log(`Domain:       ${domain}`);
        }
        if (data.EmailHash) {
            console.log(`Email Hash:   ${data.EmailHash}`);
        }
        if (data.TransferRate && data.TransferRate !== 0) {
            const feeFactor = data.TransferRate / 1_000_000_000;
            console.log(`Transfer Rate: ${data.TransferRate} (${feeFactor} fee factor)`);
        }
        if (data.TickSize && data.TickSize !== 0) {
            console.log(`Tick Size:    ${data.TickSize}`);
        }
        if (data.RegularKey) {
            console.log(`Regular Key:  ${data.RegularKey}`);
        }
        if (signerLists && signerLists.length > 0) {
            const signerList = signerLists[0];
            console.log(`Signer List:  quorum ${signerList.SignerQuorum}`);
            for (const entry of signerList.SignerEntries) {
                console.log(`  - ${entry.SignerEntry.Account} (weight ${entry.SignerEntry.SignerWeight})`);
            }
        }
    });
});
