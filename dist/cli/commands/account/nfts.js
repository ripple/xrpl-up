"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nftsCommand = void 0;
const commander_1 = require("commander");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
exports.nftsCommand = new commander_1.Command("nfts")
    .alias("nft")
    .description("List NFTs owned by an account")
    .argument("<address-or-alias>", "Account address or alias")
    .option("--limit <n>", "Number of NFTs to return")
    .option("--marker <json-string>", "Pagination marker from a previous --json response")
    .option("--json", "Output raw JSON NFTs array")
    .action(async (addressOrAlias, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    const keystoreDir = (0, keystore_1.getKeystoreDir)({ keystore: undefined });
    const address = (0, keystore_1.resolveAccount)(addressOrAlias, keystoreDir);
    await (0, client_1.withClient)(url, async (client) => {
        const reqParams = {
            command: "account_nfts",
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
        const nfts = result.account_nfts ?? [];
        if (options.json) {
            console.log(JSON.stringify(nfts));
            return;
        }
        if (nfts.length === 0) {
            console.log("(no NFTs)");
            return;
        }
        for (const nft of nfts) {
            console.log(`${nft.NFTokenID}  taxon: ${nft.NFTokenTaxon}  serial: ${nft.nft_serial}  flags: ${nft.Flags}`);
        }
    });
});
