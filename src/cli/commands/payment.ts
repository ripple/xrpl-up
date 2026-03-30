import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, PaymentFlags } from "xrpl";
import type { Payment, Memo } from "xrpl";
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

interface PaymentOptions {
  to: string;
  amount: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  destinationTag?: string;
  memo?: string[];
  memoType?: string;
  memoFormat?: string;
  sendMax?: string;
  deliverMin?: string;
  paths?: string;
  partial: boolean;
  rippleDirect: boolean;
  limitQuality: boolean;
  noWait: boolean;
  json: boolean;
  dryRun: boolean;
}

export const paymentCommand = new Command("payment")
  .alias("send")
  .description("Send a Payment transaction on the XRP Ledger")
  .requiredOption("--to <address-or-alias>", "Destination address or alias")
  .requiredOption("--amount <amount>", "Amount to send (e.g. 1.5 for XRP, 10/USD/rIssuer for IOU, 100/<48-hex> for MPT)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--destination-tag <n>", "Destination tag (unsigned 32-bit integer)")
  .option("--memo <text>", "Memo text to attach (repeatable)", (val: string, prev: string[]) => [...(prev ?? []), val], [] as string[])
  .option("--memo-type <hex>", "MemoType hex for the last memo")
  .option("--memo-format <hex>", "MemoFormat hex for the last memo")
  .option("--send-max <amount>", "SendMax field; supports XRP, IOU, and MPT amounts")
  .option("--deliver-min <amount>", "DeliverMin field; automatically adds tfPartialPayment flag")
  .option("--paths <json-or-file>", "Payment paths as JSON array or path to a .json file")
  .option("--partial", "Set tfPartialPayment flag", false)
  .option("--no-ripple-direct", "Set tfNoRippleDirect flag (value 0x00010000)")
  .option("--limit-quality", "Set tfLimitQuality flag (value 0x00080000)", false)
  .option("--no-wait", "Submit without waiting for validation", false)
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: PaymentOptions, cmd: Command) => {
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

    // Parse amount
    let xrplAmount: string | { value: string; currency: string; issuer: string } | { value: string; mpt_issuance_id: string };
    try {
      xrplAmount = toXrplAmount(parseAmount(options.amount));
    } catch (e: unknown) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Parse --send-max
    let xrplSendMax: string | { value: string; currency: string; issuer: string } | { value: string; mpt_issuance_id: string } | undefined;
    if (options.sendMax !== undefined) {
      try {
        xrplSendMax = toXrplAmount(parseAmount(options.sendMax));
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Parse --deliver-min
    let xrplDeliverMin: string | { value: string; currency: string; issuer: string } | { value: string; mpt_issuance_id: string } | undefined;
    if (options.deliverMin !== undefined) {
      try {
        xrplDeliverMin = toXrplAmount(parseAmount(options.deliverMin));
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Parse --paths
    let xrplPaths: unknown[] | undefined;
    if (options.paths !== undefined) {
      try {
        const raw = options.paths.endsWith(".json")
          ? readFileSync(options.paths, "utf-8")
          : options.paths;
        xrplPaths = JSON.parse(raw) as unknown[];
      } catch (e: unknown) {
        process.stderr.write(`Error: failed to parse --paths: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Resolve destination
    const keystoreDir = getKeystoreDir(options);
    const destination = resolveAccount(options.to, keystoreDir);

    // Validate destination tag
    let destTag: number | undefined;
    if (options.destinationTag !== undefined) {
      const tagNum = Number(options.destinationTag);
      if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
        process.stderr.write(`Error: --destination-tag must be an integer between 0 and 4294967295\n`);
        process.exit(1);
      }
      destTag = tagNum;
    }

    // Build memos
    let memos: Memo[] | undefined;
    if (options.memo && options.memo.length > 0) {
      memos = options.memo.map((text, idx) => {
        const memoData = Buffer.from(text, "utf8").toString("hex").toUpperCase();
        const memo: Memo["Memo"] = { MemoData: memoData };
        if (idx === options.memo!.length - 1) {
          if (options.memoType) memo.MemoType = options.memoType;
          if (options.memoFormat) memo.MemoFormat = options.memoFormat;
        }
        return { Memo: memo };
      });
    }

    // Compute combined payment flags
    let combinedFlags = 0;
    if (options.partial || xrplDeliverMin !== undefined) combinedFlags |= PaymentFlags.tfPartialPayment;
    if (!options.rippleDirect) combinedFlags |= PaymentFlags.tfNoRippleDirect;
    if (options.limitQuality) combinedFlags |= PaymentFlags.tfLimitQuality;

    // Build the Payment transaction
    const tx: Payment = {
      TransactionType: "Payment",
      Account: signerWallet!.address,
      Destination: destination,
      Amount: xrplAmount as Payment["Amount"],
      ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
      ...(memos ? { Memos: memos } : {}),
      ...(xrplSendMax !== undefined ? { SendMax: xrplSendMax as Payment["Amount"] } : {}),
      ...(xrplDeliverMin !== undefined ? { DeliverMin: xrplDeliverMin as Payment["Amount"] } : {}),
      ...(combinedFlags !== 0 ? { Flags: combinedFlags } : {}),
      ...(xrplPaths !== undefined && xrplPaths.length > 0 ? { Paths: xrplPaths as Payment["Paths"] } : {}),
    };

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
        meta?: {
          TransactionResult?: string;
          delivered_amount?: string | { value: string; currency: string; issuer: string };
        };
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
          const failOut: Record<string, unknown> = { hash, result: resultCode, fee: feeXrp, ledger };
          if (destTag !== undefined) failOut.destinationTag = destTag;
          if (memos) failOut.memos = memos;
          console.log(JSON.stringify(failOut));
        }
        process.exit(1);
      }

      if (options.json) {
        const out: Record<string, unknown> = { hash, result: resultCode, fee: feeXrp, ledger };
        if (destTag !== undefined) out.destinationTag = destTag;
        if (memos) out.memos = memos;
        if (options.partial && txResult.meta?.delivered_amount !== undefined) {
          out.deliveredAmount = txResult.meta.delivered_amount;
        }
        console.log(JSON.stringify(out));
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
        if (destTag !== undefined) console.log(`Destination Tag: ${destTag}`);
      }
    });
  });
