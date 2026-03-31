import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, convertStringToHex } from "xrpl";
import type { DIDSet, DIDDelete } from "xrpl";
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

async function submitTx(
  client: import("xrpl").Client,
  wallet: Wallet,
  tx: DIDSet | DIDDelete,
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
}

// ---------- did set ----------

interface DIDSetOptions {
  uri?: string;
  uriHex?: string;
  data?: string;
  dataHex?: string;
  didDocument?: string;
  didDocumentHex?: string;
  clearUri: boolean;
  clearData: boolean;
  clearDidDocument: boolean;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const didSetCommand = new Command("set")
  .description("Publish or update a Decentralized Identifier (DID) on-chain (DIDSet)")
  .option("--uri <string>", "URI for the DID (auto hex-encoded; pass empty string to clear)")
  .option("--uri-hex <hex>", "URI as raw hex (mutually exclusive with --uri)")
  .option("--data <string>", "Public attestation data (auto hex-encoded; pass empty string to clear)")
  .option("--data-hex <hex>", "Data as raw hex (mutually exclusive with --data)")
  .option("--did-document <string>", "DID document (auto hex-encoded; pass empty string to clear)")
  .option("--did-document-hex <hex>", "DID document as raw hex (mutually exclusive with --did-document)")
  .option("--clear-uri", "Clear the URI field (sends URI as empty string)", false)
  .option("--clear-data", "Clear the Data field (sends Data as empty string)", false)
  .option("--clear-did-document", "Clear the DIDDocument field (sends DIDDocument as empty string)", false)
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: DIDSetOptions, cmd: Command) => {
    // Validate mutually exclusive plain/hex flag pairs
    if (options.uri !== undefined && options.uriHex !== undefined) {
      process.stderr.write("Error: --uri and --uri-hex are mutually exclusive\n");
      process.exit(1);
    }
    if (options.data !== undefined && options.dataHex !== undefined) {
      process.stderr.write("Error: --data and --data-hex are mutually exclusive\n");
      process.exit(1);
    }
    if (options.didDocument !== undefined && options.didDocumentHex !== undefined) {
      process.stderr.write("Error: --did-document and --did-document-hex are mutually exclusive\n");
      process.exit(1);
    }

    // Validate that a value flag and its clear flag are not both provided
    if (options.uri !== undefined && options.clearUri) {
      process.stderr.write("Error: --uri and --clear-uri are mutually exclusive\n");
      process.exit(1);
    }
    if (options.data !== undefined && options.clearData) {
      process.stderr.write("Error: --data and --clear-data are mutually exclusive\n");
      process.exit(1);
    }
    if (options.didDocument !== undefined && options.clearDidDocument) {
      process.stderr.write("Error: --did-document and --clear-did-document are mutually exclusive\n");
      process.exit(1);
    }

    // At least one field must be provided
    const hasAnyField =
      options.uri !== undefined ||
      options.uriHex !== undefined ||
      options.data !== undefined ||
      options.dataHex !== undefined ||
      options.didDocument !== undefined ||
      options.didDocumentHex !== undefined ||
      options.clearUri ||
      options.clearData ||
      options.clearDidDocument;

    if (!hasAnyField) {
      process.stderr.write(
        "Error: provide at least one of --uri, --uri-hex, --data, --data-hex, --did-document, --did-document-hex, --clear-uri, --clear-data, or --clear-did-document\n"
      );
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

    // Build URI hex value
    let uriValue: string | undefined;
    if (options.clearUri) {
      uriValue = "";
    } else if (options.uri !== undefined) {
      // empty string --uri '' means clear
      uriValue = options.uri === "" ? "" : convertStringToHex(options.uri);
    } else if (options.uriHex !== undefined) {
      uriValue = options.uriHex;
    }

    // Build Data hex value
    let dataValue: string | undefined;
    if (options.clearData) {
      dataValue = "";
    } else if (options.data !== undefined) {
      dataValue = options.data === "" ? "" : convertStringToHex(options.data);
    } else if (options.dataHex !== undefined) {
      dataValue = options.dataHex;
    }

    // Build DIDDocument hex value
    let didDocumentValue: string | undefined;
    if (options.clearDidDocument) {
      didDocumentValue = "";
    } else if (options.didDocument !== undefined) {
      didDocumentValue = options.didDocument === "" ? "" : convertStringToHex(options.didDocument);
    } else if (options.didDocumentHex !== undefined) {
      didDocumentValue = options.didDocumentHex;
    }

    const tx: DIDSet = {
      TransactionType: "DIDSet",
      Account: signerWallet.address,
      ...(uriValue !== undefined ? { URI: uriValue } : {}),
      ...(dataValue !== undefined ? { Data: dataValue } : {}),
      ...(didDocumentValue !== undefined ? { DIDDocument: didDocumentValue } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitTx(client, signerWallet, tx, options);
    });
  });

// ---------- did delete ----------

interface DIDDeleteOptions {
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const didDeleteCommand = new Command("delete")
  .description("Delete the sender's on-chain Decentralized Identifier (DIDDelete)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: DIDDeleteOptions, cmd: Command) => {
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

    const tx: DIDDelete = {
      TransactionType: "DIDDelete",
      Account: signerWallet.address,
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      await submitTx(client, signerWallet, tx, options);
    });
  });

// ---------- did get ----------

interface DIDGetOptions {
  json: boolean;
}

interface DIDLedgerEntry {
  LedgerEntryType?: string;
  Account?: string;
  URI?: string;
  Data?: string;
  DIDDocument?: string;
}

function hexToUtf8(hex: string): string {
  try {
    return Buffer.from(hex, "hex").toString("utf-8");
  } catch {
    return hex;
  }
}

const didGetCommand = new Command("get")
  .description("Query the on-chain DID for an account")
  .argument("<address>", "Account address to query")
  .option("--json", "Output raw JSON ledger entry", false)
  .action(async (address: string, options: DIDGetOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      let result: unknown;
      try {
        result = await client.request({
          command: "account_objects",
          account: address,
          type: "did",
        } as Parameters<typeof client.request>[0]);
      } catch (e: unknown) {
        const err = e as Error;
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }

      const accountObjects = (result as { result?: { account_objects?: DIDLedgerEntry[] } }).result?.account_objects ?? [];
      const didEntry = accountObjects[0];

      if (!didEntry) {
        console.log(`No DID found for ${address}.`);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(didEntry));
        return;
      }

      const uri = didEntry.URI ? hexToUtf8(didEntry.URI) : "(none)";
      const data = didEntry.Data ?? "(none)";
      const didDocument = didEntry.DIDDocument ? hexToUtf8(didEntry.DIDDocument) : "(none)";

      console.log(`URI:         ${uri}`);
      console.log(`Data:        ${data}`);
      console.log(`DIDDocument: ${didDocument}`);
    });
  });

export const didCommand = new Command("did")
  .description("Manage Decentralized Identifiers (DIDs) on the XRP Ledger")
  .addCommand(didSetCommand)
  .addCommand(didDeleteCommand)
  .addCommand(didGetCommand);
