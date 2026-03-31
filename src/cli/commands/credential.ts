import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isCreatedNode, isDeletedNode, convertStringToHex, isoTimeToRippleTime } from "xrpl";
import type { CredentialCreate, CredentialAccept, CredentialDelete, TransactionMetadataBase } from "xrpl";
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

interface CredentialCreateOptions {
  subject: string;
  credentialType?: string;
  credentialTypeHex?: string;
  uri?: string;
  uriHex?: string;
  expiration?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const credentialCreateCommand = new Command("create")
  .description("Create an on-chain credential for a subject account")
  .requiredOption("--subject <address>", "Subject account address")
  .option("--credential-type <string>", "Credential type as plain string (auto hex-encoded, max 64 bytes)")
  .option("--credential-type-hex <hex>", "Credential type as raw hex (2-128 hex chars)")
  .option("--uri <string>", "URI as plain string (auto hex-encoded, max 256 bytes)")
  .option("--uri-hex <hex>", "URI as raw hex (max 512 hex chars)")
  .option("--expiration <ISO8601>", "Expiration date/time in ISO 8601 format")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: CredentialCreateOptions, cmd: Command) => {
    // Validate mutually exclusive credential-type flags
    if (options.credentialType !== undefined && options.credentialTypeHex !== undefined) {
      process.stderr.write("Error: --credential-type and --credential-type-hex are mutually exclusive\n");
      process.exit(1);
    }
    if (options.credentialType === undefined && options.credentialTypeHex === undefined) {
      process.stderr.write("Error: provide --credential-type or --credential-type-hex\n");
      process.exit(1);
    }

    // Validate mutually exclusive uri flags
    if (options.uri !== undefined && options.uriHex !== undefined) {
      process.stderr.write("Error: --uri and --uri-hex are mutually exclusive\n");
      process.exit(1);
    }

    // Resolve credential type hex
    let credentialTypeHex: string;
    if (options.credentialType !== undefined) {
      const encoded = convertStringToHex(options.credentialType);
      const byteLen = encoded.length / 2;
      if (byteLen > 64) {
        process.stderr.write(`Error: --credential-type encodes to ${byteLen} bytes, max is 64\n`);
        process.exit(1);
      }
      if (byteLen < 1) {
        process.stderr.write("Error: --credential-type must not be empty\n");
        process.exit(1);
      }
      credentialTypeHex = encoded;
    } else {
      const hex = options.credentialTypeHex!;
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length < 2 || hex.length > 128) {
        process.stderr.write("Error: --credential-type-hex must be 2-128 hex characters\n");
        process.exit(1);
      }
      credentialTypeHex = hex.toUpperCase();
    }

    // Resolve URI hex (optional)
    let uriHex: string | undefined;
    if (options.uri !== undefined) {
      const encoded = convertStringToHex(options.uri);
      const byteLen = encoded.length / 2;
      if (byteLen > 256) {
        process.stderr.write(`Error: --uri encodes to ${byteLen} bytes, max is 256\n`);
        process.exit(1);
      }
      if (byteLen < 1) {
        process.stderr.write("Error: --uri must not be empty\n");
        process.exit(1);
      }
      uriHex = encoded;
    } else if (options.uriHex !== undefined) {
      const hex = options.uriHex;
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length < 2 || hex.length > 512) {
        process.stderr.write("Error: --uri-hex must be 2-512 hex characters\n");
        process.exit(1);
      }
      uriHex = hex.toUpperCase();
    }

    // Validate expiration
    let expiration: number | undefined;
    if (options.expiration !== undefined) {
      const rippleTime = isoTimeToRippleTime(options.expiration);
      if (isNaN(rippleTime)) {
        process.stderr.write("Error: --expiration must be a valid ISO 8601 date/time\n");
        process.exit(1);
      }
      expiration = rippleTime;
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

    // Resolve subject address
    const keystoreDir = getKeystoreDir(options);
    const subject = resolveAccount(options.subject, keystoreDir);

    // Build CredentialCreate transaction
    const tx: CredentialCreate = {
      TransactionType: "CredentialCreate",
      Account: signerWallet.address,
      Subject: subject,
      CredentialType: credentialTypeHex,
    };

    if (uriHex !== undefined) tx.URI = uriHex;
    if (expiration !== undefined) tx.Expiration = expiration;

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
        meta?: TransactionMetadataBase & { TransactionResult?: string };
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

      // Extract Credential ledger entry ID from AffectedNodes
      let credentialId: string | null = null;
      const meta = txResult.meta;
      if (meta && typeof meta !== "string") {
        const credNode = meta.AffectedNodes?.find(
          (n) => isCreatedNode(n) && n.CreatedNode.LedgerEntryType === "Credential"
        );
        if (credNode && isCreatedNode(credNode)) {
          credentialId = credNode.CreatedNode.LedgerIndex;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, credentialId }));
      } else {
        console.log(`Transaction:   ${hash}`);
        console.log(`Result:        ${resultCode}`);
        console.log(`Fee:           ${feeXrp} XRP`);
        console.log(`Ledger:        ${ledger}`);
        if (credentialId) {
          console.log(`Credential ID: ${credentialId}`);
        }
      }
    });
  });

interface CredentialAcceptOptions {
  issuer: string;
  credentialType?: string;
  credentialTypeHex?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const credentialAcceptCommand = new Command("accept")
  .description("Accept an on-chain credential issued to you")
  .requiredOption("--issuer <address>", "Address of the credential issuer")
  .option("--credential-type <string>", "Credential type as plain string (auto hex-encoded, max 64 bytes)")
  .option("--credential-type-hex <hex>", "Credential type as raw hex (2-128 hex chars)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: CredentialAcceptOptions, cmd: Command) => {
    // Validate mutually exclusive credential-type flags
    if (options.credentialType !== undefined && options.credentialTypeHex !== undefined) {
      process.stderr.write("Error: --credential-type and --credential-type-hex are mutually exclusive\n");
      process.exit(1);
    }
    if (options.credentialType === undefined && options.credentialTypeHex === undefined) {
      process.stderr.write("Error: provide --credential-type or --credential-type-hex\n");
      process.exit(1);
    }

    // Resolve credential type hex
    let credentialTypeHex: string;
    if (options.credentialType !== undefined) {
      const encoded = convertStringToHex(options.credentialType);
      const byteLen = encoded.length / 2;
      if (byteLen > 64) {
        process.stderr.write(`Error: --credential-type encodes to ${byteLen} bytes, max is 64\n`);
        process.exit(1);
      }
      if (byteLen < 1) {
        process.stderr.write("Error: --credential-type must not be empty\n");
        process.exit(1);
      }
      credentialTypeHex = encoded;
    } else {
      const hex = options.credentialTypeHex!;
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length < 2 || hex.length > 128) {
        process.stderr.write("Error: --credential-type-hex must be 2-128 hex characters\n");
        process.exit(1);
      }
      credentialTypeHex = hex.toUpperCase();
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

    // Resolve issuer address
    const keystoreDir = getKeystoreDir(options);
    const issuer = resolveAccount(options.issuer, keystoreDir);

    // Build CredentialAccept transaction
    const tx: CredentialAccept = {
      TransactionType: "CredentialAccept",
      Account: signerWallet.address,
      Issuer: issuer,
      CredentialType: credentialTypeHex,
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
        meta?: TransactionMetadataBase & { TransactionResult?: string };
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

interface CredentialDeleteOptions {
  credentialType?: string;
  credentialTypeHex?: string;
  subject?: string;
  issuer?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const credentialDeleteCommand = new Command("delete")
  .description("Delete an on-chain credential (revoke or clean up)")
  .option("--credential-type <string>", "Credential type as plain string (auto hex-encoded, max 64 bytes)")
  .option("--credential-type-hex <hex>", "Credential type as raw hex (2-128 hex chars)")
  .option("--subject <address>", "Subject account address (defaults to sender if omitted)")
  .option("--issuer <address>", "Issuer account address (defaults to sender if omitted)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: CredentialDeleteOptions, cmd: Command) => {
    // Validate mutually exclusive credential-type flags
    if (options.credentialType !== undefined && options.credentialTypeHex !== undefined) {
      process.stderr.write("Error: --credential-type and --credential-type-hex are mutually exclusive\n");
      process.exit(1);
    }
    if (options.credentialType === undefined && options.credentialTypeHex === undefined) {
      process.stderr.write("Error: provide --credential-type or --credential-type-hex\n");
      process.exit(1);
    }

    // Resolve credential type hex
    let credentialTypeHex: string;
    if (options.credentialType !== undefined) {
      const encoded = convertStringToHex(options.credentialType);
      const byteLen = encoded.length / 2;
      if (byteLen > 64) {
        process.stderr.write(`Error: --credential-type encodes to ${byteLen} bytes, max is 64\n`);
        process.exit(1);
      }
      if (byteLen < 1) {
        process.stderr.write("Error: --credential-type must not be empty\n");
        process.exit(1);
      }
      credentialTypeHex = encoded;
    } else {
      const hex = options.credentialTypeHex!;
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length < 2 || hex.length > 128) {
        process.stderr.write("Error: --credential-type-hex must be 2-128 hex characters\n");
        process.exit(1);
      }
      credentialTypeHex = hex.toUpperCase();
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
    const keystoreDir = getKeystoreDir(options);

    // Resolve subject and issuer (default to sender)
    const subject = options.subject !== undefined
      ? resolveAccount(options.subject, keystoreDir)
      : signerWallet.address;
    const issuer = options.issuer !== undefined
      ? resolveAccount(options.issuer, keystoreDir)
      : signerWallet.address;

    // Build CredentialDelete transaction
    const tx: CredentialDelete = {
      TransactionType: "CredentialDelete",
      Account: signerWallet.address,
      CredentialType: credentialTypeHex,
      Subject: subject,
      Issuer: issuer,
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
        meta?: TransactionMetadataBase & { TransactionResult?: string };
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

      // Extract deleted Credential ledger entry ID from AffectedNodes
      let credentialId: string | null = null;
      const meta = txResult.meta;
      if (meta && typeof meta !== "string") {
        const credNode = meta.AffectedNodes?.find(
          (n) => isDeletedNode(n) && n.DeletedNode.LedgerEntryType === "Credential"
        );
        if (credNode && isDeletedNode(credNode)) {
          credentialId = credNode.DeletedNode.LedgerIndex;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, credentialId }));
      } else {
        console.log(`Transaction:   ${hash}`);
        console.log(`Result:        ${resultCode}`);
        console.log(`Fee:           ${feeXrp} XRP`);
        console.log(`Ledger:        ${ledger}`);
        if (credentialId) {
          console.log(`Credential ID: ${credentialId}`);
        }
      }
    });
  });

interface CredentialEntry {
  LedgerIndex: string;
  Issuer: string;
  Subject: string;
  CredentialType: string;
  URI?: string;
  Expiration?: number;
  Flags?: number;
}

/** Decode a hex string to UTF-8; return raw hex if it contains replacement characters. */
function tryDecodeHex(hex: string): string {
  const decoded = Buffer.from(hex, "hex").toString("utf-8");
  if (decoded.includes("\uFFFD")) return hex;
  return decoded;
}

/** Convert XRPL epoch to ISO8601 string. */
function xrplEpochToISO(epoch: number): string {
  return new Date((epoch + 946684800) * 1000).toISOString();
}

const LSF_ACCEPTED = 0x00010000;

interface CredentialListOptions {
  json: boolean;
  node?: string;
}

const credentialListCommand = new Command("list")
  .description("List credentials for an account")
  .argument("<address>", "Account address to query credentials for")
  .option("--json", "Output as JSON array", false)
  .action(async (address: string, options: CredentialListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const res = await client.request({
        command: "account_objects",
        account: address,
        type: "credential",
        ledger_index: "validated",
      });

      const credentials = res.result.account_objects as unknown as CredentialEntry[];

      if (options.json) {
        console.log(JSON.stringify(credentials));
        return;
      }

      if (credentials.length === 0) {
        console.log("No credentials found.");
        return;
      }

      for (const cred of credentials) {
        const credType = tryDecodeHex(cred.CredentialType);
        const uri = cred.URI ? tryDecodeHex(cred.URI) : "none";
        const expiration = cred.Expiration !== undefined ? xrplEpochToISO(cred.Expiration) : "none";
        const accepted = (cred.Flags ?? 0) & LSF_ACCEPTED ? "yes" : "no";
        console.log(`Credential ID: ${cred.LedgerIndex}`);
        console.log(`  Issuer:          ${cred.Issuer}`);
        console.log(`  Subject:         ${cred.Subject}`);
        console.log(`  Credential Type: ${credType}`);
        console.log(`  URI:             ${uri}`);
        console.log(`  Expiration:      ${expiration}`);
        console.log(`  Accepted:        ${accepted}`);
      }
    });
  });

export const credentialCommand = new Command("credential")
  .description("Manage XRPL on-chain credentials")
  .addCommand(credentialCreateCommand)
  .addCommand(credentialAcceptCommand)
  .addCommand(credentialDeleteCommand)
  .addCommand(credentialListCommand);
