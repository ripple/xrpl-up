import { Command } from "commander";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { decryptKeystore, encryptKeystore, getKeystoreDir, type KeystoreFile } from "../../utils/keystore";
import { promptPassword } from "../../utils/prompt";

interface ChangePasswordOptions {
  password?: string;
  newPassword?: string;
  keystore?: string;
}

export const changePasswordCommand = new Command("change-password")
  .alias("cp")
  .description("Re-encrypt a keystore file with a new password")
  .argument("<address>", "XRPL address of the keystore entry to update")
  .option("--password <current>", "Current password (insecure, prefer interactive prompt)")
  .option("--new-password <new>", "New password (insecure, prefer interactive prompt)")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .action(async (address: string, options: ChangePasswordOptions) => {
    const keystoreDir = getKeystoreDir(options);
    const filePath = join(keystoreDir, `${address}.json`);

    if (!existsSync(filePath)) {
      process.stderr.write(`Error: keystore file not found for address ${address}\n`);
      process.exit(1);
    }

    let keystoreData: KeystoreFile;
    try {
      keystoreData = JSON.parse(readFileSync(filePath, "utf-8")) as KeystoreFile;
    } catch {
      process.stderr.write("Error: failed to read or parse keystore file\n");
      process.exit(1);
    }

    let currentPassword: string;
    if (options.password !== undefined) {
      process.stderr.write("Warning: passing passwords via flag is insecure\n");
      currentPassword = options.password;
    } else {
      currentPassword = await promptPassword("Current password: ");
    }

    let seed: string;
    try {
      seed = decryptKeystore(keystoreData, currentPassword);
    } catch {
      process.stderr.write("Error: wrong password or corrupt keystore\n");
      process.exit(1);
    }

    let newPassword: string;
    if (options.newPassword !== undefined) {
      process.stderr.write("Warning: passing passwords via flag is insecure\n");
      newPassword = options.newPassword;
    } else {
      newPassword = await promptPassword("New password: ");
    }

    const newKeystoreData = encryptKeystore(seed, newPassword, keystoreData.keyType, keystoreData.address);

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(newKeystoreData, null, 2), "utf-8");
    renameSync(tmpPath, filePath);

    console.log(`Password changed for ${address}`);
  });
