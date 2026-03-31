import { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { getKeystoreDir, type KeystoreFile } from "../../utils/keystore";

function checkAliasUniqueness(
  name: string,
  excludeAddress: string,
  keystoreDir: string
): string | null {
  let files: string[];
  try {
    files = readdirSync(keystoreDir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(keystoreDir, file), "utf-8")) as Partial<KeystoreFile>;
      if (data.label === name && data.address && data.address !== excludeAddress) {
        return data.address;
      }
    } catch {
      // skip unreadable files
    }
  }
  return null;
}

export const aliasCommand = new Command("alias").description("Manage wallet aliases");

aliasCommand
  .command("set")
  .description("Set a human-readable alias on a keystore entry")
  .argument("<address>", "XRPL address of the wallet")
  .argument("<name>", "Alias name to set")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .option("--force", "Overwrite existing alias even if used by another address", false)
  .action((address: string, name: string, options: { keystore?: string; force: boolean }) => {
    const keystoreDir = getKeystoreDir(options);
    mkdirSync(keystoreDir, { recursive: true });

    const filePath = join(keystoreDir, `${address}.json`);
    if (!existsSync(filePath)) {
      process.stderr.write(`Error: keystore file for ${address} not found\n`);
      process.exit(1);
    }

    const conflictAddress = checkAliasUniqueness(name, address, keystoreDir);
    if (conflictAddress !== null && !options.force) {
      process.stderr.write(
        `Error: alias '${name}' is already used by ${conflictAddress}. Use --force to overwrite.\n`
      );
      process.exit(1);
    }

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as KeystoreFile;
    data.label = name;

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, filePath);

    console.log(`Alias '${name}' set for ${address}`);
  });

aliasCommand
  .command("list")
  .description("List all wallets with aliases")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .option("--json", "Output as JSON array", false)
  .action((options: { keystore?: string; json: boolean }) => {
    const keystoreDir = getKeystoreDir(options);

    let files: string[] = [];
    try {
      files = readdirSync(keystoreDir).filter((f) => f.endsWith(".json"));
    } catch {
      // directory doesn't exist — no aliases
    }

    const aliases: { alias: string; address: string }[] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(keystoreDir, file), "utf-8")) as Partial<KeystoreFile>;
        if (data.label && data.address) {
          aliases.push({ alias: data.label, address: data.address });
        }
      } catch {
        // skip unreadable files
      }
    }

    if (options.json) {
      console.log(JSON.stringify(aliases));
      return;
    }

    if (aliases.length === 0) {
      console.log("(no aliases set)");
      return;
    }

    for (const { alias, address } of aliases) {
      console.log(`${alias}  →  ${address}`);
    }
  });

aliasCommand
  .command("remove")
  .description("Remove alias from a keystore entry")
  .argument("<address>", "XRPL address of the wallet")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .action((address: string, options: { keystore?: string }) => {
    const keystoreDir = getKeystoreDir(options);

    const filePath = join(keystoreDir, `${address}.json`);
    if (!existsSync(filePath)) {
      process.stderr.write(`Error: keystore file for ${address} not found\n`);
      process.exit(1);
    }

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as KeystoreFile;
    delete data.label;

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, filePath);

    console.log(`Alias removed from ${address}`);
  });
