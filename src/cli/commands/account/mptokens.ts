import { Command } from "commander";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

interface MPTokenEntry {
  MPTokenIssuanceID: string;
  MPTAmount?: string;
  Flags: number;
}

export const mptokensCommand = new Command("mptokens")
  .alias("mpt")
  .description("List Multi-Purpose Tokens (MPT) held by an account")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--limit <n>", "Number of tokens to return", "20")
  .option("--marker <json-string>", "Pagination marker from a previous --json response")
  .option("--json", "Output raw JSON tokens array", false)
  .action(async (addressOrAlias: string, options: { limit: string; marker?: string; json: boolean }, cmd: Command) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    await withClient(url, async (client) => {
      const res = await client.request({
        command: "account_objects",
        account: address,
        type: "mptoken",
        limit: parseInt(options.limit, 10),
        marker: options.marker ? JSON.parse(options.marker) : undefined,
        ledger_index: "validated",
      });

      const tokens = res.result.account_objects as unknown as MPTokenEntry[];

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
