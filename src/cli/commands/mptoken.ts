import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isCreatedNode, convertStringToHex, MPTokenIssuanceCreateFlags, MPTokenIssuanceSetFlags, MPTokenAuthorizeFlags, decodeAccountID } from "xrpl";
import type { MPTokenIssuanceCreate, MPTokenIssuanceDestroy, MPTokenIssuanceSet, MPTokenAuthorize, TransactionMetadataBase } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";

// ---------- shared wallet resolution ----------

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

// ---------- shared submit helper ----------

type SubmitOptions = { wait: boolean; json: boolean; dryRun: boolean };
type AnyMPTx = MPTokenIssuanceCreate | MPTokenIssuanceDestroy | MPTokenIssuanceSet | MPTokenAuthorize;

type SubmitResult = {
  hash?: string;
  ledger_index?: number;
  meta?: TransactionMetadataBase & { TransactionResult?: string; mpt_issuance_id?: string };
  tx_json?: { Fee?: string };
};

async function submitTx(
  client: import("xrpl").Client,
  wallet: Wallet,
  tx: AnyMPTx,
  options: SubmitOptions,
  printExtra?: (result: SubmitResult) => void
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

  const txResult = response.result as SubmitResult;
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
    const extra: Record<string, unknown> = {};
    if (printExtra) {
      // For JSON mode, we still call printExtra but capture output via a temp object
      // Instead, let callers handle JSON output if they need extra fields
    }
    console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, ...extra }));
  } else {
    console.log(`Transaction: ${hash}`);
    console.log(`Result:      ${resultCode}`);
    console.log(`Fee:         ${feeXrp} XRP`);
    console.log(`Ledger:      ${ledger}`);
  }

  if (printExtra) {
    printExtra(txResult);
  }
}

// ---------- flag helpers ----------

const VALID_CREATE_FLAGS: Record<string, number> = {
  "can-lock": MPTokenIssuanceCreateFlags.tfMPTCanLock,
  "require-auth": MPTokenIssuanceCreateFlags.tfMPTRequireAuth,
  "can-escrow": MPTokenIssuanceCreateFlags.tfMPTCanEscrow,
  "can-trade": MPTokenIssuanceCreateFlags.tfMPTCanTrade,
  "can-transfer": MPTokenIssuanceCreateFlags.tfMPTCanTransfer,
  "can-clawback": MPTokenIssuanceCreateFlags.tfMPTCanClawback,
};

const LSF_NAMES: Array<[number, string]> = [
  [0x00000001, "locked"],
  [MPTokenIssuanceCreateFlags.tfMPTCanLock, "can-lock"],
  [MPTokenIssuanceCreateFlags.tfMPTRequireAuth, "require-auth"],
  [MPTokenIssuanceCreateFlags.tfMPTCanEscrow, "can-escrow"],
  [MPTokenIssuanceCreateFlags.tfMPTCanTrade, "can-trade"],
  [MPTokenIssuanceCreateFlags.tfMPTCanTransfer, "can-transfer"],
  [MPTokenIssuanceCreateFlags.tfMPTCanClawback, "can-clawback"],
];

function decodeIssuanceFlags(flags: number): string {
  const active = LSF_NAMES.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
  return active.length > 0 ? active.join(", ") : "none";
}

/** Decode hex to UTF-8 if valid; return raw hex if it contains replacement characters. */
function tryDecodeHex(hex: string): string {
  const decoded = Buffer.from(hex, "hex").toString("utf-8");
  if (decoded.includes("\uFFFD")) return hex;
  return decoded;
}

// ---------- key material options (standard) ----------

const KEY_MATERIAL_OPTIONS = [
  ["--seed <seed>", "Family seed for signing"],
  ["--mnemonic <phrase>", "BIP39 mnemonic for signing"],
  ["--account <address-or-alias>", "Account address or alias to load from keystore"],
  ["--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)"],
  ["--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"],
] as const;

function validateKeyMaterial(options: { seed?: string; mnemonic?: string; account?: string }): void {
  const count = [options.seed, options.mnemonic, options.account].filter(Boolean).length;
  if (count === 0) {
    process.stderr.write("Error: provide key material via --seed, --mnemonic, or --account\n");
    process.exit(1);
  }
  if (count > 1) {
    process.stderr.write("Error: provide only one of --seed, --mnemonic, or --account\n");
    process.exit(1);
  }
}

// ---------- issuance create ----------

interface IssuanceCreateOptions {
  assetScale?: string;
  maxAmount?: string;
  transferFee?: string;
  flags?: string;
  metadata?: string;
  metadataHex?: string;
  metadataFile?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const issuanceCreateCommand = new Command("create")
  .description("Create a new MPT issuance (MPTokenIssuanceCreate)")
  .option("--asset-scale <n>", "Decimal precision for display (0–255, default 0)")
  .option("--max-amount <string>", "Maximum token supply as base-10 UInt64 string")
  .option("--transfer-fee <n>", "Transfer fee in basis points × 10 (0–50000). Requires can-transfer flag")
  .option("--flags <list>", "Comma-separated flags: can-lock,require-auth,can-escrow,can-trade,can-transfer,can-clawback")
  .option("--metadata <string>", "Metadata as plain string (auto hex-encoded, max 1024 bytes)")
  .option("--metadata-hex <hex>", "Metadata as raw hex")
  .option("--metadata-file <path>", "Path to file whose contents are hex-encoded as metadata")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: IssuanceCreateOptions, cmd: Command) => {
    // Validate metadata mutual exclusion
    const metaCount = [options.metadata, options.metadataHex, options.metadataFile].filter(
      (v) => v !== undefined
    ).length;
    if (metaCount > 1) {
      process.stderr.write("Error: --metadata, --metadata-hex, and --metadata-file are mutually exclusive\n");
      process.exit(1);
    }

    // Validate metadata file exists
    if (options.metadataFile !== undefined && !existsSync(options.metadataFile)) {
      process.stderr.write(`Error: --metadata-file path does not exist: ${options.metadataFile}\n`);
      process.exit(1);
    }

    // Parse flags
    let flagsBitmask = 0;
    const flagNames = new Set<string>();
    if (options.flags !== undefined) {
      const parts = options.flags.split(",").map((f) => f.trim()).filter((f) => f.length > 0);
      for (const part of parts) {
        if (!(part in VALID_CREATE_FLAGS)) {
          process.stderr.write(
            `Error: unknown flag "${part}". Valid flags: ${Object.keys(VALID_CREATE_FLAGS).join(", ")}\n`
          );
          process.exit(1);
        }
        flagsBitmask |= VALID_CREATE_FLAGS[part]!;
        flagNames.add(part);
      }
    }

    // Validate transfer-fee requires can-transfer
    if (options.transferFee !== undefined && !flagNames.has("can-transfer")) {
      process.stderr.write("Error: --transfer-fee requires can-transfer in --flags\n");
      process.exit(1);
    }

    // Validate asset-scale
    let assetScale: number | undefined;
    if (options.assetScale !== undefined) {
      assetScale = parseInt(options.assetScale, 10);
      if (!Number.isInteger(assetScale) || assetScale < 0 || assetScale > 255) {
        process.stderr.write("Error: --asset-scale must be an integer between 0 and 255\n");
        process.exit(1);
      }
    }

    // Validate transfer-fee
    let transferFee: number | undefined;
    if (options.transferFee !== undefined) {
      transferFee = parseInt(options.transferFee, 10);
      if (!Number.isInteger(transferFee) || transferFee < 0 || transferFee > 50000) {
        process.stderr.write("Error: --transfer-fee must be an integer between 0 and 50000\n");
        process.exit(1);
      }
    }

    // Validate max-amount
    if (options.maxAmount !== undefined && !/^\d+$/.test(options.maxAmount)) {
      process.stderr.write("Error: --max-amount must be a positive integer string\n");
      process.exit(1);
    }

    // Resolve metadata hex
    let metadataHex: string | undefined;
    if (options.metadata !== undefined) {
      const encoded = convertStringToHex(options.metadata);
      const byteLen = encoded.length / 2;
      if (byteLen > 1024) {
        process.stderr.write(`Error: --metadata encodes to ${byteLen} bytes, max is 1024\n`);
        process.exit(1);
      }
      metadataHex = encoded.toUpperCase();
    } else if (options.metadataHex !== undefined) {
      if (!/^[0-9A-Fa-f]+$/.test(options.metadataHex) || options.metadataHex.length % 2 !== 0) {
        process.stderr.write("Error: --metadata-hex must be a valid even-length hex string\n");
        process.exit(1);
      }
      const byteLen = options.metadataHex.length / 2;
      if (byteLen > 1024) {
        process.stderr.write(`Error: --metadata-hex encodes to ${byteLen} bytes, max is 1024\n`);
        process.exit(1);
      }
      metadataHex = options.metadataHex.toUpperCase();
    } else if (options.metadataFile !== undefined) {
      const contents = readFileSync(options.metadataFile);
      if (contents.length > 1024) {
        process.stderr.write(`Error: --metadata-file contents are ${contents.length} bytes, max is 1024\n`);
        process.exit(1);
      }
      metadataHex = contents.toString("hex").toUpperCase();
    }

    validateKeyMaterial(options);

    const wallet = await resolveWallet(options);

    const tx: MPTokenIssuanceCreate = {
      TransactionType: "MPTokenIssuanceCreate",
      Account: wallet.address,
      ...(flagsBitmask !== 0 ? { Flags: flagsBitmask } : {}),
      ...(assetScale !== undefined ? { AssetScale: assetScale } : {}),
      ...(options.maxAmount !== undefined ? { MaximumAmount: options.maxAmount } : {}),
      ...(transferFee !== undefined ? { TransferFee: transferFee } : {}),
      ...(metadataHex !== undefined ? { MPTokenMetadata: metadataHex } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
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

      const txResult = response.result as SubmitResult;
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

      // Extract MPTokenIssuanceID from metadata
      let issuanceId: string | null = txResult.meta?.mpt_issuance_id ?? null;

      // Fallback: extract from AffectedNodes
      if (issuanceId === null) {
        const meta = txResult.meta;
        if (meta && typeof meta !== "string") {
          const node = meta.AffectedNodes?.find(
            (n) => isCreatedNode(n) && n.CreatedNode.LedgerEntryType === "MPTokenIssuance"
          );
          if (node && isCreatedNode(node)) {
            issuanceId = node.CreatedNode.LedgerIndex;
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, issuanceId }));
      } else {
        console.log(`Transaction:       ${hash}`);
        console.log(`Result:            ${resultCode}`);
        console.log(`Fee:               ${feeXrp} XRP`);
        console.log(`Ledger:            ${ledger}`);
        if (issuanceId) {
          console.log(`MPTokenIssuanceID: ${issuanceId}`);
        }
      }
    });
  });

// ---------- issuance destroy ----------

interface IssuanceDestroyOptions {
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const issuanceDestroyCommand = new Command("destroy")
  .description("Destroy an MPT issuance (MPTokenIssuanceDestroy)")
  .argument("<issuance-id>", "MPTokenIssuanceID to destroy")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (issuanceId: string, options: IssuanceDestroyOptions, cmd: Command) => {
    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);

    const tx: MPTokenIssuanceDestroy = {
      TransactionType: "MPTokenIssuanceDestroy",
      Account: wallet.address,
      MPTokenIssuanceID: issuanceId,
    };

    const url = getNodeUrl(cmd);
    await withClient(url, async (client) => {
      await submitTx(client, wallet, tx, options);
    });
  });

// ---------- issuance set ----------

interface IssuanceSetOptions {
  lock: boolean;
  unlock: boolean;
  holder?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const issuanceSetCommand = new Command("set")
  .description("Lock or unlock an MPT issuance (MPTokenIssuanceSet)")
  .argument("<issuance-id>", "MPTokenIssuanceID to modify")
  .option("--lock", "Lock the issuance (or a holder's balance)", false)
  .option("--unlock", "Unlock the issuance (or a holder's balance)", false)
  .option("--holder <address>", "Holder address for per-holder lock/unlock")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (issuanceId: string, options: IssuanceSetOptions, cmd: Command) => {
    if (!options.lock && !options.unlock) {
      process.stderr.write("Error: provide --lock or --unlock\n");
      process.exit(1);
    }
    if (options.lock && options.unlock) {
      process.stderr.write("Error: --lock and --unlock are mutually exclusive\n");
      process.exit(1);
    }

    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);

    const tx: MPTokenIssuanceSet = {
      TransactionType: "MPTokenIssuanceSet",
      Account: wallet.address,
      MPTokenIssuanceID: issuanceId,
      Flags: options.lock ? MPTokenIssuanceSetFlags.tfMPTLock : MPTokenIssuanceSetFlags.tfMPTUnlock,
      ...(options.holder !== undefined ? { Holder: options.holder } : {}),
    };

    const url = getNodeUrl(cmd);
    await withClient(url, async (client) => {
      await submitTx(client, wallet, tx, options);
    });
  });

// ---------- issuance list ----------

interface IssuanceListOptions {
  json: boolean;
}

interface MPTokenIssuanceEntry {
  index: string;
  Issuer: string;
  Sequence?: number;  // present in rippled response, used to compute 24-byte MPTokenIssuanceID
  AssetScale?: number;
  MaximumAmount?: string;
  OutstandingAmount?: string;
  TransferFee?: number;
  Flags?: number;
  MPTokenMetadata?: string;
  LedgerEntryType: string;
}

/** Compute the 24-byte MPTokenIssuanceID = Sequence (4 bytes BE) + AccountID (20 bytes). */
function computeIssuanceId(sequence: number, issuer: string): string {
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeUInt32BE(sequence, 0);
  return Buffer.concat([seqBuf, Buffer.from(decodeAccountID(issuer))]).toString("hex").toUpperCase();
}

const issuanceListCommand = new Command("list")
  .description("List MPT issuances for an account")
  .argument("<address>", "Account address to query")
  .option("--json", "Output as JSON array", false)
  .action(async (address: string, options: IssuanceListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const res = await client.request({
        command: "account_objects",
        account: address,
        type: "mpt_issuance",
        ledger_index: "validated",
      });

      const issuances = res.result.account_objects as unknown as MPTokenIssuanceEntry[];

      if (options.json) {
        console.log(JSON.stringify(issuances));
        return;
      }

      if (issuances.length === 0) {
        console.log("No MPT issuances.");
        return;
      }

      for (const iss of issuances) {
        const flags = decodeIssuanceFlags(iss.Flags ?? 0);
        const displayId =
          iss.Sequence !== undefined
            ? computeIssuanceId(iss.Sequence, iss.Issuer)
            : iss.index;
        const parts = [
          `AssetScale=${iss.AssetScale ?? 0}`,
          `MaximumAmount=${iss.MaximumAmount ?? "(none)"}`,
          `OutstandingAmount=${iss.OutstandingAmount ?? "0"}`,
          `Flags=[${flags}]`,
        ];
        console.log(`${displayId}  ${parts.join("  ")}`);
      }
    });
  });

// ---------- issuance get ----------

interface IssuanceGetOptions {
  json: boolean;
}

const issuanceGetCommand = new Command("get")
  .description("Get MPT issuance details by ID")
  .argument("<issuance-id>", "MPTokenIssuanceID to query")
  .option("--json", "Output raw JSON", false)
  .action(async (issuanceId: string, options: IssuanceGetOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      let result: unknown;
      try {
        const response = await client.request({
          command: "ledger_entry",
          mpt_issuance: issuanceId,
          ledger_index: "validated",
        });
        result = response.result;
      } catch (e: unknown) {
        const err = e as Error;
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result));
        return;
      }

      const entry = ((result as { node?: MPTokenIssuanceEntry }).node ??
        (result as MPTokenIssuanceEntry));

      const flags = decodeIssuanceFlags(entry.Flags ?? 0);
      const metadata = entry.MPTokenMetadata ? tryDecodeHex(entry.MPTokenMetadata) : "(none)";

      console.log(`MPTokenIssuanceID: ${issuanceId}`);
      console.log(`Issuer:            ${entry.Issuer ?? "(unknown)"}`);
      console.log(`AssetScale:        ${entry.AssetScale ?? 0}`);
      console.log(`MaximumAmount:     ${entry.MaximumAmount ?? "(none)"}`);
      console.log(`OutstandingAmount: ${entry.OutstandingAmount ?? "0"}`);
      console.log(`TransferFee:       ${entry.TransferFee ?? 0}`);
      console.log(`Flags:             ${flags}`);
      console.log(`Metadata:          ${metadata}`);
    });
  });

// ---------- issuance sub-group ----------

const issuanceCommand = new Command("issuance")
  .description("Manage MPT issuances")
  .addCommand(issuanceCreateCommand)
  .addCommand(issuanceDestroyCommand)
  .addCommand(issuanceSetCommand)
  .addCommand(issuanceListCommand)
  .addCommand(issuanceGetCommand);

// ---------- authorize ----------

interface AuthorizeOptions {
  holder?: string;
  unauthorize: boolean;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const authorizeCommand = new Command("authorize")
  .description("Opt in to hold an MPT issuance, or grant/revoke holder authorization (MPTokenAuthorize)")
  .argument("<issuance-id>", "MPTokenIssuanceID")
  .option("--holder <address>", "Holder address (issuer-side: authorize/unauthorize a specific holder)")
  .option("--unauthorize", "Revoke authorization instead of granting", false)
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (issuanceId: string, options: AuthorizeOptions, cmd: Command) => {
    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);

    const tx: MPTokenAuthorize = {
      TransactionType: "MPTokenAuthorize",
      Account: wallet.address,
      MPTokenIssuanceID: issuanceId,
      ...(options.holder !== undefined ? { Holder: options.holder } : {}),
      ...(options.unauthorize ? { Flags: MPTokenAuthorizeFlags.tfMPTUnauthorize } : {}),
    };

    const url = getNodeUrl(cmd);
    await withClient(url, async (client) => {
      await submitTx(client, wallet, tx, options);
    });
  });

// ---------- export ----------

export const mptokenCommand = new Command("mptoken")
  .description("Manage Multi-Purpose Tokens (MPT) on the XRP Ledger")
  .addCommand(issuanceCommand)
  .addCommand(authorizeCommand);
