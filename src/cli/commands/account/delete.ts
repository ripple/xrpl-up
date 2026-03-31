import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isValidClassicAddress } from "xrpl";
import type { AccountDelete } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../../utils/client";
import { getNodeUrl } from "../../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../../utils/keystore";
import { promptPassword } from "../../utils/prompt";

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

interface DeleteOptions {
  destination: string;
  destinationTag?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  confirm: boolean;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

export const deleteCommand = new Command("delete")
  .description(
    "Delete an account with an AccountDelete transaction (irreversible). Fee: ~2 XRP (owner reserve, non-refundable)"
  )
  .requiredOption("--destination <address-or-alias>", "Destination address or alias to receive remaining XRP")
  .option("--destination-tag <n>", "Destination tag for the destination account")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--confirm", "Acknowledge that this permanently deletes your account (required unless --dry-run)", false)
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print unsigned tx JSON without submitting", false)
  .action(async (options: DeleteOptions, cmd: Command) => {
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

    // Resolve destination (alias → address, or pass through if it looks like an address)
    const keystoreDir = getKeystoreDir(options);
    let destinationAddress: string;
    try {
      destinationAddress = resolveAccount(options.destination, keystoreDir);
    } catch {
      // resolveAccount throws when input doesn't match XRPL address format and isn't a known alias
      process.stderr.write(`Error: invalid destination address: ${options.destination}\n`);
      process.exit(1);
    }

    // Extra validation: resolveAccount's regex is looser than actual address validation
    if (!isValidClassicAddress(destinationAddress)) {
      process.stderr.write(`Error: invalid destination address: ${destinationAddress}\n`);
      process.exit(1);
    }

    // --confirm required unless --dry-run
    if (!options.dryRun && !options.confirm) {
      process.stderr.write(
        "Error: This permanently deletes your account. Pass --confirm to proceed.\n"
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

    // Build the AccountDelete transaction
    const tx: AccountDelete = {
      TransactionType: "AccountDelete",
      Account: signerWallet!.address,
      Destination: destinationAddress,
    };

    if (options.destinationTag !== undefined) {
      tx.DestinationTag = parseInt(options.destinationTag, 10);
    }

    if (options.dryRun) {
      console.log(JSON.stringify(tx, null, 2));
      return;
    }

    const url = getNodeUrl(cmd);
    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);
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
