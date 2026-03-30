import { Command } from "commander";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { getKeystoreDir } from "../../utils/keystore";

interface RemoveOptions {
  keystore?: string;
}

export const removeCommand = new Command("remove")
  .alias("rm")
  .description("Remove a wallet from the keystore")
  .argument("<address>", "XRPL address to remove from keystore")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .action((address: string, options: RemoveOptions) => {
    const keystoreDir = getKeystoreDir(options);
    const filePath = join(keystoreDir, `${address}.json`);

    if (!existsSync(filePath)) {
      process.stderr.write(`Error: no keystore entry found for ${address}\n`);
      process.exit(1);
    }

    rmSync(filePath);
    console.log(`Removed ${address}`);
  });
