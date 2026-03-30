import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

interface NFToken {
  NFTokenID: string;
  Flags: number;
  Issuer?: string;
  NFTokenTaxon: number;
  nft_serial: number;
  TransferFee?: number;
  URI?: string;
}

export const nftsCommand = new Command("nfts")
  .alias("nft")
  .description("List NFTs owned by an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--limit <n>", "Number of NFTs to return")
  .option("--marker <json-string>", "Pagination marker from a previous --json response")
  .option("--json", "Output raw JSON NFTs array")
  .action(async (
    addressOrAlias: string,
    options: { limit?: string; marker?: string; json?: boolean },
    cmd: Command
  ) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    await withClient(url, async (client) => {
      const reqParams: Record<string, unknown> = {
        command: "account_nfts",
        account: address,
      };

      if (options.limit) {
        reqParams.limit = Number(options.limit);
      }

      if (options.marker) {
        reqParams.marker = JSON.parse(options.marker) as unknown;
      }

      const resp = await client.request(reqParams as Parameters<typeof client.request>[0]);
      const result = resp.result as {
        account_nfts: NFToken[];
        marker?: unknown;
      };

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
        console.log(
          `${nft.NFTokenID}  taxon: ${nft.NFTokenTaxon}  serial: ${nft.nft_serial}  flags: ${nft.Flags}`
        );
      }
    });
  });
