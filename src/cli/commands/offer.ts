import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, OfferCreateFlags, isoTimeToRippleTime } from "xrpl";
import type { OfferCreate, OfferCancel } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";
import { parseAmount, toXrplAmount } from "../utils/amount";

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

async function resolveWallet(options: {
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
}): Promise<Wallet> {
  if (options.seed) {
    return walletFromSeed(options.seed);
  }

  if (options.mnemonic) {
    return Wallet.fromMnemonic(options.mnemonic, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
  }

  // --account path
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
    return Wallet.fromMnemonic(material!, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
  }
  return walletFromSeed(material!);
}

interface OfferCreateOptions {
  takerPays: string;
  takerGets: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  sell: boolean;
  passive: boolean;
  immediateOrCancel: boolean;
  fillOrKill: boolean;
  expiration?: string;
  replace?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

interface OfferCancelOptions {
  sequence: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const offerCreateCommand = new Command("create")
  .alias("c")
  .description("Create a DEX offer on the XRP Ledger")
  .requiredOption("--taker-pays <amount>", "Amount the taker pays (e.g. 1.5 for XRP, 10/USD/rIssuer for IOU)")
  .requiredOption("--taker-gets <amount>", "Amount the taker gets (e.g. 1.5 for XRP, 10/USD/rIssuer for IOU)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--sell", "Set tfSell flag — offer consumes funds in order of taker_pays", false)
  .option("--passive", "Set tfPassive flag — offer does not consume matching offers", false)
  .option("--immediate-or-cancel", "Set tfImmediateOrCancel — fill as much as possible, cancel remainder", false)
  .option("--fill-or-kill", "Set tfFillOrKill — fill completely or cancel entire offer", false)
  .option("--expiration <iso>", "Offer expiration as ISO 8601 string (e.g. 2030-01-01T00:00:00Z)")
  .option("--replace <sequence>", "Cancel offer with this sequence and replace it atomically (OfferSequence field)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: OfferCreateOptions, cmd: Command) => {
    // Validate mutually exclusive flags
    if (options.immediateOrCancel && options.fillOrKill) {
      process.stderr.write("Error: --immediate-or-cancel and --fill-or-kill are mutually exclusive\n");
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

    const signerWallet = await resolveWallet(options);

    // Parse taker-pays
    let xrplTakerPays: ReturnType<typeof toXrplAmount>;
    try {
      xrplTakerPays = toXrplAmount(parseAmount(options.takerPays));
    } catch (e: unknown) {
      process.stderr.write(`Error: --taker-pays: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Parse taker-gets
    let xrplTakerGets: ReturnType<typeof toXrplAmount>;
    try {
      xrplTakerGets = toXrplAmount(parseAmount(options.takerGets));
    } catch (e: unknown) {
      process.stderr.write(`Error: --taker-gets: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Build flags
    let flags = 0;
    if (options.sell) flags |= OfferCreateFlags.tfSell;
    if (options.passive) flags |= OfferCreateFlags.tfPassive;
    if (options.immediateOrCancel) flags |= OfferCreateFlags.tfImmediateOrCancel;
    if (options.fillOrKill) flags |= OfferCreateFlags.tfFillOrKill;

    // Build transaction
    const tx: OfferCreate = {
      TransactionType: "OfferCreate",
      Account: signerWallet.address,
      TakerPays: xrplTakerPays as OfferCreate["TakerPays"],
      TakerGets: xrplTakerGets as OfferCreate["TakerGets"],
      ...(flags !== 0 ? { Flags: flags } : {}),
    };

    // Apply --expiration
    if (options.expiration !== undefined) {
      try {
        tx.Expiration = isoTimeToRippleTime(options.expiration);
      } catch (e: unknown) {
        process.stderr.write(`Error: --expiration: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Apply --replace (OfferSequence)
    if (options.replace !== undefined) {
      const seq = parseInt(options.replace, 10);
      if (!Number.isInteger(seq) || seq < 0) {
        process.stderr.write("Error: --replace must be a non-negative integer\n");
        process.exit(1);
      }
      tx.OfferSequence = seq;
    }

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);

      if (options.dryRun) {
        const signed = signerWallet.sign(filled);
        console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
        return;
      }

      const signed = signerWallet.sign(filled);

      if (!options.wait) {
        await client.submit(signed.tx_blob);
        if (options.json) {
          console.log(JSON.stringify({ hash: signed.hash }));
        } else {
          console.log(signed.hash);
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
        tx_json?: { Fee?: string; Sequence?: number };
      };

      const resultCode = txResult.meta?.TransactionResult ?? "unknown";
      const hash = txResult.hash ?? signed.hash;
      const offerSequence = txResult.tx_json?.Sequence ?? (filled as { Sequence?: number }).Sequence ?? 0;

      // tecKILLED is expected for IOC/FOK offers that cannot be filled — treat as success
      const isKilled = resultCode === "tecKILLED";
      if (/^te[cfm]/i.test(resultCode) && !isKilled) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ hash, result: resultCode, offerSequence }));
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, offerSequence }));
      } else if (isKilled) {
        console.log(`Offer killed (IOC/FOK condition not met). Sequence: ${offerSequence}`);
      } else {
        console.log(`Offer created. Sequence: ${offerSequence}`);
      }
    });
  });

const offerCancelCommand = new Command("cancel")
  .alias("x")
  .description("Cancel an existing DEX offer on the XRP Ledger")
  .requiredOption("--sequence <n>", "Sequence number of the offer to cancel")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: OfferCancelOptions, cmd: Command) => {
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

    const seq = parseInt(options.sequence, 10);
    if (!Number.isInteger(seq) || seq < 0) {
      process.stderr.write("Error: --sequence must be a non-negative integer\n");
      process.exit(1);
    }

    const signerWallet = await resolveWallet(options);

    const tx: OfferCancel = {
      TransactionType: "OfferCancel",
      Account: signerWallet.address,
      OfferSequence: seq,
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);

      if (options.dryRun) {
        const signed = signerWallet.sign(filled);
        console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
        return;
      }

      const signed = signerWallet.sign(filled);

      if (!options.wait) {
        await client.submit(signed.tx_blob);
        if (options.json) {
          console.log(JSON.stringify({ hash: signed.hash }));
        } else {
          console.log(signed.hash);
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

      if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ hash, result: resultCode }));
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode }));
      } else {
        console.log(`Offer cancelled. Hash: ${hash}`);
      }
    });
  });

export const offerCommand = new Command("offer")
  .description("Manage DEX offers on the XRP Ledger")
  .addCommand(offerCreateCommand)
  .addCommand(offerCancelCommand);
