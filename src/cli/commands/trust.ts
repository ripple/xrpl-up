import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, TrustSetFlags } from "xrpl";
import type { TrustSet } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

function validateCurrency(currency: string): string {
  const upper = currency.toUpperCase();
  // 3-char ASCII (uppercase letters/digits)
  if (/^[A-Z0-9]{3}$/.test(upper)) {
    return upper;
  }
  // 40-char hex
  if (/^[0-9A-Fa-f]{40}$/.test(currency)) {
    return currency.toUpperCase();
  }
  throw new Error(
    `Invalid currency '${currency}': must be a 3-character ASCII code (e.g. USD) or 40-character hex string`
  );
}

interface TrustSetOptions {
  currency: string;
  issuer: string;
  limit: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  noWait: boolean;
  json: boolean;
  dryRun: boolean;
  // Commander converts --no-ripple to options.ripple = false (not noRipple)
  ripple: boolean;
  clearNoRipple: boolean;
  freeze: boolean;
  unfreeze: boolean;
  auth: boolean;
  qualityIn?: string;
  qualityOut?: string;
}

const trustSetCommand = new Command("set")
  .alias("s")
  .description("Create or update a trust line")
  .requiredOption("--currency <code>", "Currency code (3-char ASCII or 40-char hex)")
  .requiredOption("--issuer <address-or-alias>", "Issuer address or alias")
  .requiredOption("--limit <value>", "Trust line limit (0 removes the trust line)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation", false)
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .option("--no-ripple", "Set NoRipple flag on trust line")
  .option("--clear-no-ripple", "Clear NoRipple flag on trust line", false)
  .option("--freeze", "Freeze the trust line", false)
  .option("--unfreeze", "Unfreeze the trust line", false)
  .option("--auth", "Authorize the trust line", false)
  .option("--quality-in <n>", "Set QualityIn (unsigned integer)")
  .option("--quality-out <n>", "Set QualityOut (unsigned integer)")
  .action(async (options: TrustSetOptions, cmd: Command) => {
    // Validate currency
    let currency: string;
    try {
      currency = validateCurrency(options.currency);
    } catch (e: unknown) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Validate flag combinations
    // Commander converts --no-ripple to options.ripple = false
    const noRipple = options.ripple === false;
    if (noRipple && options.clearNoRipple) {
      process.stderr.write("Error: --no-ripple and --clear-no-ripple are mutually exclusive\n");
      process.exit(1);
    }
    if (options.freeze && options.unfreeze) {
      process.stderr.write("Error: --freeze and --unfreeze are mutually exclusive\n");
      process.exit(1);
    }

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

    // Resolve issuer
    const keystoreDir = getKeystoreDir(options);
    const issuer = resolveAccount(options.issuer, keystoreDir);

    // Build TrustSet transaction
    const tx: TrustSet = {
      TransactionType: "TrustSet",
      Account: signerWallet!.address,
      LimitAmount: {
        currency: currency!,
        issuer,
        value: options.limit,
      },
    };

    // Apply flags via bitwise OR
    let flags = 0;
    if (noRipple) flags |= TrustSetFlags.tfSetNoRipple;
    if (options.clearNoRipple) flags |= TrustSetFlags.tfClearNoRipple;
    if (options.freeze) flags |= TrustSetFlags.tfSetFreeze;
    if (options.unfreeze) flags |= TrustSetFlags.tfClearFreeze;
    if (options.auth) flags |= TrustSetFlags.tfSetfAuth;
    if (flags !== 0) tx.Flags = flags;

    // Apply quality fields
    if (options.qualityIn !== undefined) tx.QualityIn = parseInt(options.qualityIn, 10);
    if (options.qualityOut !== undefined) tx.QualityOut = parseInt(options.qualityOut, 10);

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);

      if (options.dryRun) {
        const signed = signerWallet!.sign(filled);
        console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
        return;
      }

      const signed = signerWallet!.sign(filled);

      if (options.noWait) {
        await client.submit(signed.tx_blob);
        if (options.json) {
          console.log(JSON.stringify({ hash: signed.hash }));
        } else {
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

      // submitAndWait
      let response;
      try {
        response = await client.submitAndWait(signed.tx_blob);
      } catch (e: unknown) {
        const err = e as Error;
        if (err.constructor.name === "TimeoutError" || err.message?.includes("LastLedgerSequence")) {
          process.stderr.write("Error: transaction expired (LastLedgerSequence exceeded)\n");
          process.exit(1);
        }
        throw e;
      }

      const txResult = response.result as {
        hash?: string;
        ledger_index?: number;
        meta?: { TransactionResult?: string };
        tx_json?: { Fee?: string };
      };

      const resultCode = txResult.meta?.TransactionResult ?? "unknown";
      const hash = txResult.hash ?? signed.hash;
      const feeDrops = txResult.tx_json?.Fee ?? "0";
      const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
      const ledger = txResult.ledger_index;

      // Exit 1 on tec/tef/tem codes
      if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
      }
    });
  });

export const trustCommand = new Command("trust")
  .description("Manage XRPL trust lines")
  .addCommand(trustSetCommand);

// Re-export flag constants for use in US-002
export { TrustSetFlags };
