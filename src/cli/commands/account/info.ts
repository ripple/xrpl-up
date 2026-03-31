import { Command } from "commander";
import { parseAccountRootFlags } from "xrpl";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { getKeystoreDir, resolveAccount } from "../../utils/keystore";

export const infoCommand = new Command("info")
  .alias("i")
  .description("Get full on-ledger account information")
  .argument("<address-or-alias>", "Account address or alias")
  .option("--json", "Output raw JSON")
  .action(async (addressOrAlias: string, options: { json?: boolean }, cmd: Command) => {
    const url = getNodeUrl(cmd);
    const keystoreDir = getKeystoreDir({ keystore: undefined });
    const address = resolveAccount(addressOrAlias, keystoreDir);

    await withClient(url, async (client) => {
      const [infoResp, stateResp] = await Promise.all([
        client.request({
          command: "account_info",
          account: address,
          ledger_index: "validated",
        }),
        client.request({ command: "server_state" }),
      ]);

      const data = infoResp.result.account_data;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const balanceXrp = Number(data.Balance) / 1_000_000;
      const ownerCount = data.OwnerCount;

      const reserveBase = stateResp.result.state.validated_ledger?.reserve_base ?? 10_000_000;
      const reserveInc = stateResp.result.state.validated_ledger?.reserve_inc ?? 2_000_000;
      const reserveDrops = reserveBase + ownerCount * reserveInc;
      const reserveXrp = reserveDrops / 1_000_000;

      const flags = data.Flags ?? 0;
      const parsedFlags = parseAccountRootFlags(flags);
      const flagNames = Object.entries(parsedFlags)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const flagsStr =
        `0x${flags.toString(16).toUpperCase()}` +
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
    });
  });
