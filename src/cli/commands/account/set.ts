import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet } from "xrpl";
import type { AccountSet } from "xrpl";
import { AccountSetAsfFlags } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../../utils/keystore";
import { promptPassword } from "../../utils/prompt";

// Map user-friendly flag names to AccountSetAsfFlags numeric values
const ASF_FLAG_MAP: Record<string, AccountSetAsfFlags> = {
  requireDestTag: 1 as AccountSetAsfFlags,
  requireAuth: 2 as AccountSetAsfFlags,
  disallowXRP: 3 as AccountSetAsfFlags,
  disableMaster: 4 as AccountSetAsfFlags,
  noFreeze: 6 as AccountSetAsfFlags,
  globalFreeze: 7 as AccountSetAsfFlags,
  defaultRipple: 8 as AccountSetAsfFlags,
  depositAuth: 9 as AccountSetAsfFlags,
};

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

interface SetOptions {
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  domain?: string;
  emailHash?: string;
  transferRate?: string;
  tickSize?: string;
  setFlag?: string;
  clearFlag?: string;
  allowClawback: boolean;
  confirm: boolean;
  json: boolean;
  dryRun: boolean;
}

export const setCommand = new Command("set")
  .description("Update account settings with an AccountSet transaction")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--domain <utf8-string>", "Domain to set (auto hex-encoded)")
  .option("--email-hash <32-byte-hex>", "Email hash (32-byte hex)")
  .option("--transfer-rate <integer>", "Transfer rate (0 or 1000000000-2000000000)")
  .option("--tick-size <n>", "Tick size (0 or 3-15)")
  .option(
    "--set-flag <name>",
    "Account flag to set (requireDestTag|requireAuth|disallowXRP|disableMaster|noFreeze|globalFreeze|defaultRipple|depositAuth)"
  )
  .option(
    "--clear-flag <name>",
    "Account flag to clear (requireDestTag|requireAuth|disallowXRP|disableMaster|noFreeze|globalFreeze|defaultRipple|depositAuth)"
  )
  .option("--allow-clawback", "Enable clawback on this account (irreversible — requires --confirm)", false)
  .option("--confirm", "Acknowledge irreversible operations (required with --allow-clawback)", false)
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print unsigned tx JSON without submitting", false)
  .action(async (options: SetOptions, cmd: Command) => {
    // Validate key material
    const keyMaterialCount = [options.seed, options.mnemonic, options.account].filter(Boolean).length;
    if (keyMaterialCount === 0) {
      process.stderr.write("Error: provide key material via --seed, --mnemonic, or --account\n");
      process.exit(1);
    }
    if (keyMaterialCount > 1) {
      process.stderr.write("Error: provide only one of --seed, --mnemonic, or --account\n");
      process.exit(1);
    }

    // Validate --allow-clawback requires --confirm
    if (options.allowClawback && !options.confirm) {
      process.stderr.write(
        "Error: --allow-clawback is irreversible. Once enabled it cannot be disabled. To proceed, add --confirm to your command.\n"
      );
      process.exit(1);
    }

    // Validate at least one setting is provided
    const hasSettable =
      options.domain !== undefined ||
      options.emailHash !== undefined ||
      options.transferRate !== undefined ||
      options.tickSize !== undefined ||
      options.setFlag !== undefined ||
      options.clearFlag !== undefined ||
      options.allowClawback;
    if (!hasSettable) {
      process.stderr.write(
        "Error: provide at least one setting to change (--domain, --email-hash, --transfer-rate, --tick-size, --set-flag, --clear-flag, --allow-clawback)\n"
      );
      process.exit(1);
    }

    // Validate flag names
    if (options.setFlag !== undefined && !(options.setFlag in ASF_FLAG_MAP)) {
      process.stderr.write(
        `Error: unknown flag name '${options.setFlag}'. Use one of: ${Object.keys(ASF_FLAG_MAP).join(", ")}\n`
      );
      process.exit(1);
    }
    if (options.clearFlag !== undefined && !(options.clearFlag in ASF_FLAG_MAP)) {
      process.stderr.write(
        `Error: unknown flag name '${options.clearFlag}'. Use one of: ${Object.keys(ASF_FLAG_MAP).join(", ")}\n`
      );
      process.exit(1);
    }

    // Resolve wallet
    let signerWallet: Wallet;

    if (options.seed) {
      signerWallet = walletFromSeed(options.seed);
    } else if (options.mnemonic) {
      signerWallet = Wallet.fromMnemonic(options.mnemonic, {
        mnemonicEncoding: "bip39",
        derivationPath: "m/44'/144'/0'/0/0",
      });
    } else {
      // --account: load from keystore
      const keystoreDir = getKeystoreDir(options);
      const address = resolveAccount(options.account!, keystoreDir);
      const filePath = join(keystoreDir, `${address}.json`);

      if (!existsSync(filePath)) {
        process.stderr.write(`Error: keystore file not found for account ${address}\n`);
        process.exit(1);
      }

      let keystoreData: KeystoreFile;
      try {
        keystoreData = JSON.parse(readFileSync(filePath, "utf-8")) as KeystoreFile;
      } catch {
        process.stderr.write("Error: failed to read or parse keystore file\n");
        process.exit(1);
      }

      let password: string;
      if (options.password !== undefined) {
        process.stderr.write("Warning: passing passwords via flag is insecure\n");
        password = options.password;
      } else {
        password = await promptPassword();
      }

      let material: string;
      try {
        material = decryptKeystore(keystoreData!, password);
      } catch {
        process.stderr.write("Error: wrong password or corrupt keystore\n");
        process.exit(1);
      }

      if (material!.trim().split(/\s+/).length > 1) {
        signerWallet = Wallet.fromMnemonic(material!, {
          mnemonicEncoding: "bip39",
          derivationPath: "m/44'/144'/0'/0/0",
        });
      } else {
        signerWallet = walletFromSeed(material!);
      }
    }

    // Build the AccountSet transaction
    const tx: AccountSet = {
      TransactionType: "AccountSet",
      Account: signerWallet!.address,
    };

    if (options.domain !== undefined) {
      tx.Domain = Buffer.from(options.domain, "utf8").toString("hex").toUpperCase();
    }
    if (options.emailHash !== undefined) {
      tx.EmailHash = options.emailHash;
    }
    if (options.transferRate !== undefined) {
      tx.TransferRate = parseInt(options.transferRate, 10);
    }
    if (options.tickSize !== undefined) {
      tx.TickSize = parseInt(options.tickSize, 10);
    }
    if (options.setFlag !== undefined) {
      tx.SetFlag = ASF_FLAG_MAP[options.setFlag];
    }
    if (options.clearFlag !== undefined) {
      tx.ClearFlag = ASF_FLAG_MAP[options.clearFlag];
    }
    if (options.allowClawback) {
      tx.SetFlag = AccountSetAsfFlags.asfAllowTrustLineClawback;
    }

    if (options.dryRun) {
      console.log(JSON.stringify(tx, null, 2));
      return;
    }

    const url = getNodeUrl(cmd);
    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);
      const signed = signerWallet!.sign(filled);
      await client.submit(signed.tx_blob);

      if (options.json) {
        console.log(
          JSON.stringify({
            hash: signed.hash,
            result: "tesSUCCESS",
            tx_blob: signed.tx_blob,
          })
        );
      } else {
        console.log(`Transaction submitted: ${signed.hash}`);
      }
    });
  });
