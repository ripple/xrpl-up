import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, convertStringToHex } from "xrpl";
import type { CheckCreate, CheckCash, CheckCancel, LedgerEntry } from "xrpl";
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

type AffectedNode =
  | { CreatedNode: { LedgerEntryType: string; LedgerIndex: string } }
  | { ModifiedNode: { LedgerEntryType: string; LedgerIndex: string } }
  | { DeletedNode: { LedgerEntryType: string; LedgerIndex: string } };

function extractCheckId(affectedNodes: AffectedNode[]): string | undefined {
  for (const node of affectedNodes) {
    if ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === "Check") {
      return node.CreatedNode.LedgerIndex;
    }
  }
  return undefined;
}

async function submitAndReport(
  client: import("xrpl").Client,
  wallet: Wallet,
  tx: CheckCreate | CheckCash | CheckCancel,
  options: { wait: boolean; json: boolean; dryRun: boolean },
  extras?: (txResult: {
    hash?: string;
    ledger_index?: number;
    meta?: { TransactionResult?: string; AffectedNodes?: AffectedNode[] };
    tx_json?: { Fee?: string; Sequence?: number };
  }) => Record<string, unknown>
): Promise<void> {
  const filled = await client.autofill(tx);

  if (options.dryRun) {
    const signed = wallet.sign(filled);
    console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
    return;
  }

  const signed = wallet.sign(filled);

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
    meta?: { TransactionResult?: string; AffectedNodes?: AffectedNode[] };
    tx_json?: { Fee?: string; Sequence?: number };
  };

  const resultCode = txResult.meta?.TransactionResult ?? "unknown";
  const hash = txResult.hash ?? signed.hash;
  const feeDrops = txResult.tx_json?.Fee ?? "0";
  const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
  const ledger = txResult.ledger_index;
  const sequence = txResult.tx_json?.Sequence;

  const extra = extras ? extras(txResult) : {};

  if (/^te[cfm]/i.test(resultCode)) {
    process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
    if (options.json) {
      console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, ...extra }));
    }
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, sequence, ...extra }));
  } else {
    console.log(`Transaction: ${hash}`);
    console.log(`Result:      ${resultCode}`);
    console.log(`Fee:         ${feeXrp} XRP`);
    console.log(`Ledger:      ${ledger}`);
    console.log(`Sequence:    ${sequence}`);
    for (const [k, v] of Object.entries(extra)) {
      const label = k.charAt(0).toUpperCase() + k.slice(1);
      console.log(`${(label + ":").padEnd(13)}${String(v)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// check create
// ---------------------------------------------------------------------------

interface CheckCreateOptions {
  to: string;
  sendMax: string;
  expiration?: string;
  destinationTag?: string;
  invoiceId?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const checkCreateCommand = new Command("create")
  .alias("c")
  .description("Create a Check on the XRP Ledger")
  .requiredOption("--to <address>", "Destination address that can cash the Check")
  .requiredOption(
    "--send-max <amount>",
    "Maximum amount the Check can debit (XRP decimal or value/CURRENCY/issuer)"
  )
  .option("--expiration <iso>", "Check expiration time (ISO 8601)")
  .option("--destination-tag <n>", "Destination tag (unsigned 32-bit integer)")
  .option(
    "--invoice-id <string>",
    "Invoice identifier (plain string ≤32 bytes, auto hex-encoded to UInt256)"
  )
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: CheckCreateOptions, cmd: Command) => {
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

    // Parse --send-max
    let parsedSendMax;
    try {
      parsedSendMax = parseAmount(options.sendMax);
    } catch (e: unknown) {
      process.stderr.write(`Error: --send-max: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Parse --expiration
    let expiration: number | undefined;
    if (options.expiration !== undefined) {
      const ts = new Date(options.expiration).getTime();
      if (isNaN(ts)) {
        process.stderr.write("Error: --expiration: invalid ISO 8601 date\n");
        process.exit(1);
      }
      expiration = Math.floor(ts / 1000) - 946684800;
    }

    // Parse --destination-tag
    let destTag: number | undefined;
    if (options.destinationTag !== undefined) {
      const tagNum = Number(options.destinationTag);
      if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
        process.stderr.write("Error: --destination-tag must be an integer between 0 and 4294967295\n");
        process.exit(1);
      }
      destTag = tagNum;
    }

    // Parse --invoice-id
    let invoiceId: string | undefined;
    if (options.invoiceId !== undefined) {
      const byteLen = Buffer.byteLength(options.invoiceId, "utf-8");
      if (byteLen > 32) {
        process.stderr.write("Error: --invoice-id must be at most 32 bytes\n");
        process.exit(1);
      }
      // Hex-encode and zero-pad to 64 hex chars (UInt256)
      const hex = convertStringToHex(options.invoiceId);
      invoiceId = hex.toUpperCase().padEnd(64, "0");
    }

    const signerWallet = await resolveWallet(options);
    const keystoreDir = getKeystoreDir(options);
    const destination = resolveAccount(options.to, keystoreDir);

    const tx: CheckCreate = {
      TransactionType: "CheckCreate",
      Account: signerWallet.address,
      Destination: destination,
      SendMax: toXrplAmount(parsedSendMax) as CheckCreate["SendMax"],
      ...(expiration !== undefined ? { Expiration: expiration } : {}),
      ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
      ...(invoiceId !== undefined ? { InvoiceID: invoiceId } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitAndReport(client, signerWallet, tx, options, (txResult) => {
        const affectedNodes = (txResult.meta?.AffectedNodes ?? []) as AffectedNode[];
        const checkId = extractCheckId(affectedNodes);
        return checkId !== undefined ? { checkId } : {};
      });
    });
  });

// ---------------------------------------------------------------------------
// check cash
// ---------------------------------------------------------------------------

interface CheckCashOptions {
  check: string;
  amount?: string;
  deliverMin?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const checkCashCommand = new Command("cash")
  .description("Cash a Check on the XRP Ledger")
  .requiredOption("--check <id>", "64-character Check ID (hex)")
  .option("--amount <amount>", "Exact amount to cash (XRP decimal or value/CURRENCY/issuer)")
  .option("--deliver-min <amount>", "Minimum amount to receive (XRP decimal or value/CURRENCY/issuer)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: CheckCashOptions, cmd: Command) => {
    // Exactly one of --amount or --deliver-min required
    const hasAmount = options.amount !== undefined;
    const hasDeliverMin = options.deliverMin !== undefined;
    if (!hasAmount && !hasDeliverMin) {
      process.stderr.write("Error: provide either --amount or --deliver-min\n");
      process.exit(1);
    }
    if (hasAmount && hasDeliverMin) {
      process.stderr.write("Error: --amount and --deliver-min are mutually exclusive\n");
      process.exit(1);
    }

    // Validate Check ID format
    if (!/^[0-9a-fA-F]{64}$/.test(options.check)) {
      process.stderr.write("Error: --check must be a 64-character hex string\n");
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

    // Parse amount fields
    let parsedAmount: ReturnType<typeof parseAmount> | undefined;
    if (hasAmount) {
      try {
        parsedAmount = parseAmount(options.amount!);
      } catch (e: unknown) {
        process.stderr.write(`Error: --amount: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    let parsedDeliverMin: ReturnType<typeof parseAmount> | undefined;
    if (hasDeliverMin) {
      try {
        parsedDeliverMin = parseAmount(options.deliverMin!);
      } catch (e: unknown) {
        process.stderr.write(`Error: --deliver-min: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    const signerWallet = await resolveWallet(options);

    const tx: CheckCash = {
      TransactionType: "CheckCash",
      Account: signerWallet.address,
      CheckID: options.check.toUpperCase(),
      ...(parsedAmount !== undefined
        ? { Amount: toXrplAmount(parsedAmount) as CheckCash["Amount"] }
        : {}),
      ...(parsedDeliverMin !== undefined
        ? { DeliverMin: toXrplAmount(parsedDeliverMin) as CheckCash["DeliverMin"] }
        : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitAndReport(client, signerWallet, tx, options);
    });
  });

// ---------------------------------------------------------------------------
// check cancel
// ---------------------------------------------------------------------------

interface CheckCancelOptions {
  check: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const checkCancelCommand = new Command("cancel")
  .alias("x")
  .description("Cancel a Check on the XRP Ledger")
  .requiredOption("--check <id>", "64-character Check ID (hex)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: CheckCancelOptions, cmd: Command) => {
    // Validate Check ID format
    if (!/^[0-9a-fA-F]{64}$/.test(options.check)) {
      process.stderr.write("Error: --check must be a 64-character hex string\n");
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

    const tx: CheckCancel = {
      TransactionType: "CheckCancel",
      Account: signerWallet.address,
      CheckID: options.check.toUpperCase(),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitAndReport(client, signerWallet, tx, options);
    });
  });

// ---------------------------------------------------------------------------
// check list
// ---------------------------------------------------------------------------

interface CheckListOptions {
  json: boolean;
}

/** Convert XRPL ripple epoch to ISO 8601 string */
function rippleTimeToIso(epoch: number): string {
  return new Date((epoch + 946684800) * 1000).toISOString();
}

function formatSendMax(
  sendMax: string | { value: string; currency: string; issuer: string }
): string {
  if (typeof sendMax === "string") {
    const xrp = (Number(sendMax) / 1_000_000).toFixed(6);
    return `${xrp} XRP`;
  }
  return `${sendMax.value}/${sendMax.currency}/${sendMax.issuer}`;
}

const checkListCommand = new Command("list")
  .alias("ls")
  .description("List pending checks for an account")
  .argument("<address>", "Account address to query")
  .option("--json", "Output as JSON array", false)
  .action(async (address: string, options: CheckListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const response = await client.request({
        command: "account_objects",
        account: address,
        type: "check",
        limit: 400,
      });

      type CheckEntry = LedgerEntry.Check & { index: string };
      const checks = response.result.account_objects as CheckEntry[];

      const results = checks.map((check) => ({
        checkId: check.index,
        sendMax: formatSendMax(check.SendMax as string | { value: string; currency: string; issuer: string }),
        destination: check.Destination,
        expiration: check.Expiration !== undefined ? rippleTimeToIso(check.Expiration) : "none",
        invoiceId: check.InvoiceID ?? "none",
      }));

      if (options.json) {
        console.log(JSON.stringify(results));
        return;
      }

      if (results.length === 0) {
        console.log("No pending checks found.");
        return;
      }

      for (const c of results) {
        console.log(`CheckID:     ${c.checkId}`);
        console.log(`SendMax:     ${c.sendMax}`);
        console.log(`Destination: ${c.destination}`);
        console.log(`Expiration:  ${c.expiration}`);
        console.log(`InvoiceID:   ${c.invoiceId}`);
        console.log("---");
      }
    });
  });

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export const checkCommand = new Command("check")
  .description("Manage XRPL Checks")
  .addCommand(checkCreateCommand)
  .addCommand(checkCashCommand)
  .addCommand(checkCancelCommand)
  .addCommand(checkListCommand);
