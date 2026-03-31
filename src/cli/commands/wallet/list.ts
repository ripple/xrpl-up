import { Command } from "commander";
import { readdirSync, existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import { getKeystoreDir, KeystoreFile } from "../../utils/keystore";

interface ListOptions {
  keystore?: string;
  json: boolean;
}

interface WalletEntry {
  address: string;
  alias?: string;
}

export const listCommand = new Command("list")
  .alias("ls")
  .description("List keystored accounts")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--json", "Output as JSON array", false)
  .action((options: ListOptions) => {
    const keystoreDir = getKeystoreDir(options);

    if (!existsSync(keystoreDir)) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log("(empty)");
      }
      return;
    }

    const files = readdirSync(keystoreDir).filter((f) => f.endsWith(".json"));
    const entries: WalletEntry[] = files.map((f) => {
      const address = basename(f, ".json");
      try {
        const data = JSON.parse(readFileSync(join(keystoreDir, f), "utf-8")) as Partial<KeystoreFile>;
        const entry: WalletEntry = { address };
        if (data.label) {
          entry.alias = data.label;
        }
        return entry;
      } catch {
        return { address };
      }
    });

    if (options.json) {
      console.log(JSON.stringify(entries));
    } else if (entries.length === 0) {
      console.log("(empty)");
    } else {
      entries.forEach(({ address, alias }) => {
        if (alias) {
          console.log(`${address}  ${alias}`);
        } else {
          console.log(address);
        }
      });
    }
  });
