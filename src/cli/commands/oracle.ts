import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, convertStringToHex } from "xrpl";
import type { OracleSet, OracleDelete, PriceData } from "xrpl";
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

// ---------- shared submit helpers ----------

type SubmitResult = {
  hash?: string;
  ledger_index?: number;
  meta?: { TransactionResult?: string };
  tx_json?: { Fee?: string };
};

async function submitTx(
  client: import("xrpl").Client,
  wallet: Wallet,
  tx: OracleSet | OracleDelete,
  options: { wait: boolean; json: boolean; dryRun: boolean }
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
    console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
  } else {
    console.log(`Transaction: ${hash}`);
    console.log(`Result:      ${resultCode}`);
    console.log(`Fee:         ${feeXrp} XRP`);
    console.log(`Ledger:      ${ledger}`);
  }
}

// ---------- price parsing ----------

interface ParsedPriceEntry {
  BaseAsset: string;
  QuoteAsset: string;
  AssetPrice?: number;
  Scale?: number;
}

function parsePricePair(raw: string): ParsedPriceEntry {
  // Format: BASE/QUOTE[:PRICE[:SCALE]]
  // omit price (or use empty) to delete that pair on update
  const slashIdx = raw.indexOf("/");
  if (slashIdx < 1) {
    throw new Error(`Invalid --price format: "${raw}". Expected BASE/QUOTE[:PRICE[:SCALE]]`);
  }

  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    // No colon — just a pair, no price
    const baseAsset = raw.substring(0, slashIdx);
    const quoteAsset = raw.substring(slashIdx + 1);
    if (!baseAsset || !quoteAsset) {
      throw new Error(`Invalid --price format: "${raw}". Expected BASE/QUOTE[:PRICE[:SCALE]]`);
    }
    return { BaseAsset: baseAsset, QuoteAsset: quoteAsset };
  }

  const pair = raw.substring(0, colonIdx);
  const slashInPair = pair.indexOf("/");
  if (slashInPair < 1) {
    throw new Error(`Invalid --price format: "${raw}". Expected BASE/QUOTE[:PRICE[:SCALE]]`);
  }
  const baseAsset = pair.substring(0, slashInPair);
  const quoteAsset = pair.substring(slashInPair + 1);
  if (!baseAsset || !quoteAsset) {
    throw new Error(`Invalid --price format: "${raw}". Expected BASE/QUOTE[:PRICE[:SCALE]]`);
  }

  const rest = raw.substring(colonIdx + 1);
  if (!rest) {
    // "BTC/USD:" — empty price = delete pair
    return { BaseAsset: baseAsset, QuoteAsset: quoteAsset };
  }

  const restParts = rest.split(":");
  const priceRaw = restParts[0];
  const scaleRaw = restParts[1];

  if (!priceRaw) {
    return { BaseAsset: baseAsset, QuoteAsset: quoteAsset };
  }

  if (!/^\d+$/.test(priceRaw)) {
    throw new Error(`Invalid price in --price "${raw}": must be a non-negative integer`);
  }

  let scale = 0;
  if (scaleRaw !== undefined && scaleRaw !== "") {
    if (!/^\d+$/.test(scaleRaw)) {
      throw new Error(`Invalid scale in --price "${raw}": must be an integer 0-10`);
    }
    scale = parseInt(scaleRaw, 10);
    if (scale < 0 || scale > 10) {
      throw new Error(`Invalid scale in --price "${raw}": must be between 0 and 10`);
    }
  }

  const assetPrice = parseInt(priceRaw, 10);
  return { BaseAsset: baseAsset, QuoteAsset: quoteAsset, AssetPrice: assetPrice, Scale: scale };
}

function buildPriceDataSeries(entries: ParsedPriceEntry[]): PriceData[] {
  return entries.map((e) => {
    if (e.AssetPrice !== undefined && e.Scale !== undefined) {
      return {
        PriceData: {
          BaseAsset: e.BaseAsset,
          QuoteAsset: e.QuoteAsset,
          AssetPrice: e.AssetPrice,
          Scale: e.Scale,
        },
      };
    }
    return {
      PriceData: {
        BaseAsset: e.BaseAsset,
        QuoteAsset: e.QuoteAsset,
      },
    };
  });
}

// ---------- oracle set ----------

interface OracleSetOptions {
  documentId: string;
  price?: string[];
  priceData?: string;
  provider?: string;
  providerHex?: string;
  assetClass?: string;
  assetClassHex?: string;
  lastUpdateTime?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const oracleSetCommand = new Command("set")
  .description("Publish or update an on-chain price oracle (OracleSet)")
  .requiredOption("--document-id <n>", "Oracle document ID (UInt32)")
  .option(
    "--price <BASE/QUOTE:PRICE:SCALE>",
    "Price pair (repeatable; omit price to delete pair on update; e.g. BTC/USD:155000:6)",
    (val: string, prev: string[]) => prev.concat([val]),
    [] as string[]
  )
  .option("--price-data <json>", "JSON array of price pairs (alternative to --price)")
  .option("--provider <string>", "Oracle provider string (auto hex-encoded)")
  .option("--provider-hex <hex>", "Oracle provider as raw hex (mutually exclusive with --provider)")
  .option("--asset-class <string>", "Asset class string (auto hex-encoded)")
  .option("--asset-class-hex <hex>", "Asset class as raw hex (mutually exclusive with --asset-class)")
  .option("--last-update-time <unix-ts>", "Unix timestamp for LastUpdateTime (defaults to now)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: OracleSetOptions, cmd: Command) => {
    // Validate document-id
    const documentId = parseInt(options.documentId, 10);
    if (!Number.isInteger(documentId) || documentId < 0 || documentId > 4294967295) {
      process.stderr.write("Error: --document-id must be an integer between 0 and 4294967295\n");
      process.exit(1);
    }

    // Validate mutually exclusive price flags
    const hasPriceFlag = options.price !== undefined && options.price.length > 0;
    const hasPriceData = options.priceData !== undefined;
    if (hasPriceFlag && hasPriceData) {
      process.stderr.write("Error: --price and --price-data are mutually exclusive\n");
      process.exit(1);
    }
    if (!hasPriceFlag && !hasPriceData) {
      process.stderr.write("Error: provide price data via --price or --price-data\n");
      process.exit(1);
    }

    // Validate mutually exclusive provider flags
    if (options.provider !== undefined && options.providerHex !== undefined) {
      process.stderr.write("Error: --provider and --provider-hex are mutually exclusive\n");
      process.exit(1);
    }

    // Validate mutually exclusive asset-class flags
    if (options.assetClass !== undefined && options.assetClassHex !== undefined) {
      process.stderr.write("Error: --asset-class and --asset-class-hex are mutually exclusive\n");
      process.exit(1);
    }

    // Parse price pairs
    let parsedEntries: ParsedPriceEntry[];

    if (hasPriceFlag) {
      if (options.price!.length > 10) {
        process.stderr.write("Error: at most 10 price pairs allowed\n");
        process.exit(1);
      }
      try {
        parsedEntries = options.price!.map(parsePricePair);
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    } else {
      // Parse --price-data JSON
      let rawArray: unknown;
      try {
        rawArray = JSON.parse(options.priceData!);
      } catch {
        process.stderr.write("Error: --price-data must be valid JSON\n");
        process.exit(1);
      }

      if (!Array.isArray(rawArray)) {
        process.stderr.write("Error: --price-data must be a JSON array\n");
        process.exit(1);
      }

      if (rawArray.length > 10) {
        process.stderr.write("Error: at most 10 price pairs allowed\n");
        process.exit(1);
      }

      parsedEntries = (rawArray as Array<Record<string, unknown>>).map((item) => {
        if (typeof item !== "object" || item === null) {
          process.stderr.write("Error: each item in --price-data must be an object\n");
          process.exit(1);
        }
        const entry: ParsedPriceEntry = {
          BaseAsset: String(item["BaseAsset"] ?? ""),
          QuoteAsset: String(item["QuoteAsset"] ?? ""),
        };
        if (item["AssetPrice"] !== undefined && item["AssetPrice"] !== null) {
          entry.AssetPrice = Number(item["AssetPrice"]);
          entry.Scale = item["Scale"] !== undefined ? Number(item["Scale"]) : 0;
        }
        return entry;
      });
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

    // Build provider and asset-class hex
    let providerHex: string | undefined;
    if (options.provider !== undefined) {
      providerHex = convertStringToHex(options.provider);
    } else if (options.providerHex !== undefined) {
      providerHex = options.providerHex;
    }

    let assetClassHex: string | undefined;
    if (options.assetClass !== undefined) {
      assetClassHex = convertStringToHex(options.assetClass);
    } else if (options.assetClassHex !== undefined) {
      assetClassHex = options.assetClassHex;
    }

    // Build LastUpdateTime
    const lastUpdateTime =
      options.lastUpdateTime !== undefined
        ? parseInt(options.lastUpdateTime, 10)
        : Math.floor(Date.now() / 1000);

    // Build PriceDataSeries
    const priceDataSeries = buildPriceDataSeries(parsedEntries);

    // Build OracleSet transaction
    const tx: OracleSet = {
      TransactionType: "OracleSet",
      Account: signerWallet.address,
      OracleDocumentID: documentId,
      LastUpdateTime: lastUpdateTime,
      PriceDataSeries: priceDataSeries,
      ...(providerHex !== undefined ? { Provider: providerHex } : {}),
      ...(assetClassHex !== undefined ? { AssetClass: assetClassHex } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitTx(client, signerWallet, tx, options);
    });
  });

// ---------- oracle delete ----------

interface OracleDeleteOptions {
  documentId: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const oracleDeleteCommand = new Command("delete")
  .description("Delete an on-chain price oracle (OracleDelete)")
  .requiredOption("--document-id <n>", "Oracle document ID (UInt32)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: OracleDeleteOptions, cmd: Command) => {
    const documentId = parseInt(options.documentId, 10);
    if (!Number.isInteger(documentId) || documentId < 0 || documentId > 4294967295) {
      process.stderr.write("Error: --document-id must be an integer between 0 and 4294967295\n");
      process.exit(1);
    }

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

    const tx: OracleDelete = {
      TransactionType: "OracleDelete",
      Account: signerWallet.address,
      OracleDocumentID: documentId,
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitTx(client, signerWallet, tx, options);
    });
  });

// ---------- oracle get ----------

interface OracleGetOptions {
  json: boolean;
}

interface OracleLedgerEntry {
  Owner?: string;
  OracleDocumentID?: number;
  Provider?: string;
  AssetClass?: string;
  LastUpdateTime?: number;
  PriceDataSeries?: Array<{
    PriceData: {
      BaseAsset: string;
      QuoteAsset: string;
      AssetPrice?: number | string;
      Scale?: number;
    };
  }>;
}

function hexToUtf8(hex: string): string {
  try {
    return Buffer.from(hex, "hex").toString("utf-8");
  } catch {
    return hex;
  }
}

function formatLastUpdateTime(unixTs: number): string {
  return new Date(unixTs * 1000).toISOString();
}

function computeActualPrice(assetPrice: number | string, scale: number): string {
  // actualPrice = AssetPrice * 10^(-Scale)
  const price = typeof assetPrice === "string" ? parseInt(assetPrice, 16) : assetPrice;
  if (scale === 0) return String(price);
  return (price * Math.pow(10, -scale)).toFixed(scale);
}

const oracleGetCommand = new Command("get")
  .description("Query an on-chain price oracle")
  .argument("<owner-address>", "Oracle owner account address")
  .argument("<document-id>", "Oracle document ID (UInt32)")
  .option("--json", "Output raw JSON ledger entry", false)
  .action(async (ownerAddress: string, documentIdStr: string, options: OracleGetOptions, cmd: Command) => {
    const documentId = parseInt(documentIdStr, 10);
    if (!Number.isInteger(documentId) || documentId < 0 || documentId > 4294967295) {
      process.stderr.write("Error: <document-id> must be an integer between 0 and 4294967295\n");
      process.exit(1);
    }

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      let result: unknown;
      try {
        const response = await client.request({
          command: "ledger_entry",
          oracle: {
            account: ownerAddress,
            oracle_document_id: documentId,
          },
        } as Parameters<typeof client.request>[0]);
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

      const entry = (result as { node?: OracleLedgerEntry }).node ?? (result as OracleLedgerEntry);

      const providerHex = entry.Provider ?? "";
      const assetClassHex = entry.AssetClass ?? "";
      const lastUpdateTime = entry.LastUpdateTime ?? 0;
      const priceDataSeries = entry.PriceDataSeries ?? [];

      console.log(`Document ID:   ${entry.OracleDocumentID ?? documentId}`);
      console.log(`Provider:      ${providerHex ? hexToUtf8(providerHex) : "(none)"}`);
      console.log(`Asset Class:   ${assetClassHex ? hexToUtf8(assetClassHex) : "(none)"}`);
      console.log(`Last Updated:  ${formatLastUpdateTime(lastUpdateTime)}`);
      console.log("Price Pairs:");
      for (const pd of priceDataSeries) {
        const p = pd.PriceData;
        const pairLabel = `${p.BaseAsset}/${p.QuoteAsset}`;
        if (p.AssetPrice !== undefined) {
          const scale = p.Scale ?? 0;
          const actual = computeActualPrice(p.AssetPrice, scale);
          console.log(`  ${pairLabel}: ${actual}`);
        } else {
          console.log(`  ${pairLabel}: (no price)`);
        }
      }
    });
  });

export const oracleCommand = new Command("oracle")
  .description("Manage on-chain price oracles")
  .addCommand(oracleSetCommand)
  .addCommand(oracleDeleteCommand)
  .addCommand(oracleGetCommand);
