"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offersCommand = void 0;
const commander_1 = require("commander");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
const xrpl_1 = require("xrpl");
function formatAmount(amount) {
    if (typeof amount === "string") {
        return `${(0, xrpl_1.dropsToXrp)(amount)} XRP`;
    }
    return `${amount.value} ${amount.currency}/${amount.issuer}`;
}
exports.offersCommand = new commander_1.Command("offers")
    .alias("of")
    .description("List open DEX offers for an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--limit <n>", "Number of offers to return")
    .option("--marker <json-string>", "Pagination marker from a previous --json response")
    .option("--json", "Output raw JSON offers array")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
        const reqParams = {
            command: "account_offers",
            account: address,
        };
        if (options.limit) {
            reqParams.limit = Number(options.limit);
        }
        if (options.marker) {
            reqParams.marker = JSON.parse(options.marker);
        }
        const resp = await client.request(reqParams);
        const result = resp.result;
        const offers = result.offers ?? [];
        if (options.json) {
            console.log(JSON.stringify(offers));
            return;
        }
        if (offers.length === 0) {
            console.log("(no open offers)");
            return;
        }
        for (const offer of offers) {
            const pays = formatAmount(offer.taker_pays);
            const gets = formatAmount(offer.taker_gets);
            const quality = offer.quality ?? "-";
            console.log(`#${offer.seq}  ${pays} → ${gets}  quality: ${quality}`);
        }
    });
});
