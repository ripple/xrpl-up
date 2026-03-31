import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";
import { dropsToXrp } from "xrpl";

interface IssuedCurrencyAmount {
  currency: string;
  issuer: string;
  value: string;
}

type Amount = string | IssuedCurrencyAmount;

interface Offer {
  seq: number;
  taker_pays: Amount;
  taker_gets: Amount;
  quality?: string;
}

function formatAmount(amount: Amount): string {
  if (typeof amount === "string") {
    return `${dropsToXrp(amount)} XRP`;
  }
  return `${amount.value} ${amount.currency}/${amount.issuer}`;
}

export const offersCommand = new Command("offers")
  .alias("of")
  .description("List open DEX offers for an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--limit <n>", "Number of offers to return")
  .option("--marker <json-string>", "Pagination marker from a previous --json response")
  .option("--json", "Output raw JSON offers array")
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
        command: "account_offers",
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
        offers: Offer[];
        marker?: unknown;
      };

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
