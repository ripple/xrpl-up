import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet } from "xrpl";
import type { Clawback } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";
import { parseAmount } from "../utils/amount";

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

interface ClawbackOptions {
  amount: string;
  holder?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  // Commander strips 'no-' prefix: --no-wait → options.wait = false
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

export const clawbackCommand = new Command("clawback")
  .description("Claw back issued tokens (IOU or MPT) from a holder account")
  .requiredOption(
    "--amount <amount>",
    "For IOU tokens: value/CURRENCY/holder-address (holder-address is the account to claw back from, not the token issuer). For MPT tokens: value/MPT_ISSUANCE_ID"
  )
  .option("--holder <address>", "Holder address to claw back from (required for MPT mode only)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: ClawbackOptions, cmd: Command) => {
    // Parse amount
    let parsed: ReturnType<typeof parseAmount>;
    try {
      parsed = parseAmount(options.amount);
    } catch (e: unknown) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Reject XRP amounts
    if (parsed.type === "xrp") {
      process.stderr.write("Error: clawback requires an IOU or MPT amount, not XRP\n");
      process.exit(1);
    }

    // Reject zero amounts
    if (Number(parsed.value) === 0) {
      process.stderr.write("Error: amount value must not be zero\n");
      process.exit(1);
    }

    // Mode detection: --holder present = MPT mode; absent = IOU mode
    if (options.holder !== undefined) {
      // MPT mode: amount must be MPT format (2-part)
      if (parsed.type === "iou") {
        process.stderr.write(
          "Error: --holder is only valid for MPT mode. For IOU clawback, use value/CURRENCY/holder-address format without --holder\n"
        );
        process.exit(1);
      }
    } else {
      // IOU mode: amount must be IOU format (3-part)
      if (parsed.type === "mpt") {
        process.stderr.write(
          "Error: MPT clawback requires --holder <address> to specify the token holder\n"
        );
        process.exit(1);
      }
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

    // Build the Clawback transaction
    let tx: Clawback;

    if (parsed.type === "iou") {
      // IOU wire format: issuer sub-field holds the HOLDER address
      tx = {
        TransactionType: "Clawback",
        Account: signerWallet!.address,
        Amount: {
          value: parsed.value,
          currency: parsed.currency,
          issuer: parsed.issuer, // parsed.issuer = holder address from CLI input
        },
      };
    } else {
      // MPT wire format: Amount has mpt_issuance_id; Holder field has the holder address
      tx = {
        TransactionType: "Clawback",
        Account: signerWallet!.address,
        Amount: {
          value: parsed.value,
          mpt_issuance_id: parsed.mpt_issuance_id,
        },
        Holder: options.holder!,
      };
    }

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);

      if (options.dryRun) {
        const signed = signerWallet!.sign(filled);
        console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
        return;
      }

      const signed = signerWallet!.sign(filled);

      if (!options.wait) {
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
