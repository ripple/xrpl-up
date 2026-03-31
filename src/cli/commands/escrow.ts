import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isoTimeToRippleTime } from "xrpl";
import type { EscrowCreate, EscrowFinish, EscrowCancel, LedgerEntry } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";

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

interface EscrowCreateOptions {
  to: string;
  amount: string;
  finishAfter?: string;
  cancelAfter?: string;
  condition?: string;
  destinationTag?: string;
  sourceTag?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const escrowCreateCommand = new Command("create")
  .alias("c")
  .description("Create an escrow on the XRP Ledger")
  .requiredOption("--to <address>", "Destination address for escrowed funds")
  .requiredOption("--amount <xrp>", "Amount to escrow in XRP (e.g. 10 or 1.5)")
  .option("--finish-after <iso>", "Time after which funds can be released (ISO 8601)")
  .option("--cancel-after <iso>", "Expiration time; escrow can be cancelled after this (ISO 8601)")
  .option("--condition <hex>", "PREIMAGE-SHA-256 crypto-condition hex blob")
  .option("--destination-tag <n>", "Destination tag (unsigned 32-bit integer)")
  .option("--source-tag <n>", "Source tag (unsigned 32-bit integer)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: EscrowCreateOptions, cmd: Command) => {
    // Require at least one time constraint or condition
    // (xrpl.js requires FinishAfter or CancelAfter; --condition alone is not a valid escrow)
    if (!options.finishAfter && !options.cancelAfter && !options.condition) {
      process.stderr.write("Error: provide at least --finish-after, --cancel-after, or --condition\n");
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

    // Parse amount (XRP decimal → drops string)
    const xrpFloat = parseFloat(options.amount);
    if (isNaN(xrpFloat) || xrpFloat <= 0) {
      process.stderr.write("Error: --amount must be a positive XRP decimal (e.g. 10 or 1.5)\n");
      process.exit(1);
    }
    const drops = String(Math.floor(xrpFloat * 1_000_000));

    // Parse --finish-after
    let finishAfter: number | undefined;
    if (options.finishAfter !== undefined) {
      try {
        finishAfter = isoTimeToRippleTime(options.finishAfter);
      } catch (e: unknown) {
        process.stderr.write(`Error: --finish-after: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Parse --cancel-after
    let cancelAfter: number | undefined;
    if (options.cancelAfter !== undefined) {
      try {
        cancelAfter = isoTimeToRippleTime(options.cancelAfter);
      } catch (e: unknown) {
        process.stderr.write(`Error: --cancel-after: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Parse destination tag
    let destTag: number | undefined;
    if (options.destinationTag !== undefined) {
      const tagNum = Number(options.destinationTag);
      if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
        process.stderr.write("Error: --destination-tag must be an integer between 0 and 4294967295\n");
        process.exit(1);
      }
      destTag = tagNum;
    }

    // Parse source tag
    let srcTag: number | undefined;
    if (options.sourceTag !== undefined) {
      const tagNum = Number(options.sourceTag);
      if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
        process.stderr.write("Error: --source-tag must be an integer between 0 and 4294967295\n");
        process.exit(1);
      }
      srcTag = tagNum;
    }

    const signerWallet = await resolveWallet(options);
    const keystoreDir = getKeystoreDir(options);
    const destination = resolveAccount(options.to, keystoreDir);

    const tx: EscrowCreate = {
      TransactionType: "EscrowCreate",
      Account: signerWallet.address,
      Amount: drops,
      Destination: destination,
      ...(finishAfter !== undefined ? { FinishAfter: finishAfter } : {}),
      ...(cancelAfter !== undefined ? { CancelAfter: cancelAfter } : {}),
      ...(options.condition !== undefined ? { Condition: options.condition } : {}),
      ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
      ...(srcTag !== undefined ? { SourceTag: srcTag } : {}),
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
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

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
      const feeDrops = txResult.tx_json?.Fee ?? "0";
      const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
      const ledger = txResult.ledger_index;
      const sequence = txResult.tx_json?.Sequence;

      if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, sequence }));
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
        console.log(`Sequence:    ${sequence}`);
      }
    });
  });

interface EscrowFinishOptions {
  owner: string;
  sequence: string;
  condition?: string;
  fulfillment?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const escrowFinishCommand = new Command("finish")
  .alias("f")
  .description("Release funds from an escrow")
  .requiredOption("--owner <address>", "Address of the account that created the escrow")
  .requiredOption("--sequence <n>", "Sequence number of the EscrowCreate transaction")
  .option("--condition <hex>", "PREIMAGE-SHA-256 condition hex blob (must pair with --fulfillment)")
  .option("--fulfillment <hex>", "Matching crypto-condition fulfillment hex blob (must pair with --condition)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: EscrowFinishOptions, cmd: Command) => {
    // --condition and --fulfillment must be provided together
    const hasCondition = options.condition !== undefined;
    const hasFulfillment = options.fulfillment !== undefined;
    if (hasCondition !== hasFulfillment) {
      process.stderr.write("Error: --condition and --fulfillment must be provided together\n");
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

    // Parse sequence number
    const seqNum = Number(options.sequence);
    if (!Number.isInteger(seqNum) || seqNum < 0) {
      process.stderr.write("Error: --sequence must be a non-negative integer\n");
      process.exit(1);
    }

    const signerWallet = await resolveWallet(options);
    const keystoreDir = getKeystoreDir(options);
    const owner = resolveAccount(options.owner, keystoreDir);

    const tx: EscrowFinish = {
      TransactionType: "EscrowFinish",
      Account: signerWallet.address,
      Owner: owner,
      OfferSequence: seqNum,
      ...(options.condition !== undefined ? { Condition: options.condition } : {}),
      ...(options.fulfillment !== undefined ? { Fulfillment: options.fulfillment } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const filled = await client.autofill(tx);

      // When fulfillment is provided, compute the minimum fee and use it if it exceeds autofill's fee
      if (options.fulfillment !== undefined) {
        const fulfillmentBytes = options.fulfillment.length / 2;
        const calculatedFee = Math.ceil((fulfillmentBytes + 15) / 16) * 10 + 330;
        const autofillFee = Number(filled.Fee ?? "0");
        filled.Fee = String(Math.max(calculatedFee, autofillFee));
      }

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
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

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

interface EscrowCancelOptions {
  owner: string;
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

const escrowCancelCommand = new Command("cancel")
  .alias("x")
  .description("Cancel an expired escrow and return funds to the owner")
  .requiredOption("--owner <address>", "Address of the account that created the escrow")
  .requiredOption("--sequence <n>", "Sequence number of the EscrowCreate transaction")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: EscrowCancelOptions, cmd: Command) => {
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

    // Parse sequence number
    const seqNum = Number(options.sequence);
    if (!Number.isInteger(seqNum) || seqNum < 0) {
      process.stderr.write("Error: --sequence must be a non-negative integer\n");
      process.exit(1);
    }

    const signerWallet = await resolveWallet(options);
    const keystoreDir = getKeystoreDir(options);
    const owner = resolveAccount(options.owner, keystoreDir);

    const tx: EscrowCancel = {
      TransactionType: "EscrowCancel",
      Account: signerWallet.address,
      Owner: owner,
      OfferSequence: seqNum,
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
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

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

/** Convert XRPL ripple epoch to ISO 8601 string */
function rippleTimeToIso(epoch: number): string {
  return new Date((epoch + 946684800) * 1000).toISOString();
}

interface EscrowListOptions {
  json: boolean;
}

const escrowListCommand = new Command("list")
  .alias("ls")
  .description("List pending escrows for an account")
  .argument("<address>", "Account address to query")
  .option("--json", "Output as JSON array", false)
  .action(async (address: string, options: EscrowListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const response = await client.request({
        command: "account_objects",
        account: address,
        type: "escrow",
        limit: 400,
      });

      type EscrowEntry = LedgerEntry.Escrow & { index: string };
      const escrows = response.result.account_objects as EscrowEntry[];

      // Fetch each escrow's creating transaction to get the EscrowCreate sequence
      const results = await Promise.all(
        escrows.map(async (escrow) => {
          const txResponse = await client.request({
            command: "tx",
            transaction: escrow.PreviousTxnID,
          });
          const txResult = txResponse.result as { tx_json?: { Sequence?: number } };
          const sequence = txResult.tx_json?.Sequence ?? 0;

          return {
            sequence,
            amount: (Number(escrow.Amount) / 1_000_000).toFixed(6),
            destination: escrow.Destination,
            finishAfter: escrow.FinishAfter !== undefined ? rippleTimeToIso(escrow.FinishAfter) : "none",
            cancelAfter: escrow.CancelAfter !== undefined ? rippleTimeToIso(escrow.CancelAfter) : "none",
            condition: escrow.Condition ?? "none",
          };
        })
      );

      if (options.json) {
        console.log(JSON.stringify(results));
        return;
      }

      if (results.length === 0) {
        console.log("No pending escrows found.");
        return;
      }

      for (const e of results) {
        console.log(`Sequence:    ${e.sequence}`);
        console.log(`Amount:      ${e.amount} XRP`);
        console.log(`Destination: ${e.destination}`);
        console.log(`FinishAfter: ${e.finishAfter}`);
        console.log(`CancelAfter: ${e.cancelAfter}`);
        console.log(`Condition:   ${e.condition}`);
        console.log("---");
      }
    });
  });

export const escrowCommand = new Command("escrow")
  .description("Manage XRPL escrows")
  .addCommand(escrowCreateCommand)
  .addCommand(escrowFinishCommand)
  .addCommand(escrowCancelCommand)
  .addCommand(escrowListCommand);
