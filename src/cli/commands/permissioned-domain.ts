import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isCreatedNode, isDeletedNode, convertStringToHex, isValidClassicAddress } from "xrpl";
import type { PermissionedDomainSet, PermissionedDomainDelete, AuthorizeCredential, TransactionMetadataBase } from "xrpl";
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

interface CredentialInput {
  issuer: string;
  credential_type: string; // hex
}

/**
 * Parse --credential <issuer>:<type> options into AcceptedCredentials array.
 * <type> is treated as UTF-8 and auto-encoded to hex.
 */
function parseCredentialArgs(
  credentials: string[],
  credentialsJson: string | undefined
): AuthorizeCredential[] {
  if (credentialsJson !== undefined) {
    let parsed: CredentialInput[];
    try {
      parsed = JSON.parse(credentialsJson) as CredentialInput[];
    } catch {
      process.stderr.write("Error: --credentials-json must be valid JSON\n");
      process.exit(1);
    }
    if (!Array.isArray(parsed)) {
      process.stderr.write("Error: --credentials-json must be a JSON array\n");
      process.exit(1);
    }
    return parsed.map((item, idx) => {
      if (typeof item.issuer !== "string" || typeof item.credential_type !== "string") {
        process.stderr.write(`Error: --credentials-json item ${idx} must have string "issuer" and "credential_type"\n`);
        process.exit(1);
      }
      if (!isValidClassicAddress(item.issuer)) {
        process.stderr.write(`Error: --credentials-json item ${idx} has invalid issuer address: ${item.issuer}\n`);
        process.exit(1);
      }
      if (!/^[0-9A-Fa-f]+$/.test(item.credential_type) || item.credential_type.length < 2 || item.credential_type.length > 128) {
        process.stderr.write(`Error: --credentials-json item ${idx} credential_type must be 2-128 hex characters\n`);
        process.exit(1);
      }
      return {
        Credential: {
          Issuer: item.issuer,
          CredentialType: item.credential_type.toUpperCase(),
        },
      };
    });
  }

  return credentials.map((cred, idx) => {
    const firstColon = cred.indexOf(":");
    if (firstColon < 0) {
      process.stderr.write(`Error: --credential "${cred}" must be in format <issuer>:<type>\n`);
      process.exit(1);
    }
    const issuer = cred.substring(0, firstColon);
    const typeStr = cred.substring(firstColon + 1);
    if (!isValidClassicAddress(issuer)) {
      process.stderr.write(`Error: --credential ${idx + 1} has invalid issuer address: ${issuer}\n`);
      process.exit(1);
    }
    if (typeStr.length === 0) {
      process.stderr.write(`Error: --credential ${idx + 1} has empty credential type\n`);
      process.exit(1);
    }
    const credentialTypeHex = convertStringToHex(typeStr);
    const byteLen = credentialTypeHex.length / 2;
    if (byteLen > 64) {
      process.stderr.write(`Error: --credential ${idx + 1} type encodes to ${byteLen} bytes, max is 64\n`);
      process.exit(1);
    }
    return {
      Credential: {
        Issuer: issuer,
        CredentialType: credentialTypeHex,
      },
    };
  });
}

interface PermissionedDomainCreateOptions {
  credential: string[];
  credentialsJson?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const permissionedDomainCreateCommand = new Command("create")
  .description("Create a new permissioned domain with a set of accepted credentials")
  .option(
    "--credential <issuer:type>",
    "Accepted credential in <issuer>:<type> format (type is UTF-8, auto hex-encoded); repeatable, 1-10 total",
    (val: string, prev: string[]) => prev.concat([val]),
    [] as string[]
  )
  .option("--credentials-json <json>", 'JSON array of {issuer, credential_type} objects (credential_type must be hex)')
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: PermissionedDomainCreateOptions, cmd: Command) => {
    // Validate mutually exclusive credential input flags
    if (options.credential.length > 0 && options.credentialsJson !== undefined) {
      process.stderr.write("Error: --credential and --credentials-json are mutually exclusive\n");
      process.exit(1);
    }

    // Validate credential count before parsing
    if (options.credential.length === 0 && options.credentialsJson === undefined) {
      process.stderr.write("Error: provide at least one credential via --credential or --credentials-json\n");
      process.exit(1);
    }
    if (options.credential.length > 10) {
      process.stderr.write("Error: maximum 10 credentials allowed\n");
      process.exit(1);
    }

    const acceptedCredentials = parseCredentialArgs(options.credential, options.credentialsJson);

    if (acceptedCredentials.length === 0) {
      process.stderr.write("Error: provide at least one credential via --credential or --credentials-json\n");
      process.exit(1);
    }
    if (acceptedCredentials.length > 10) {
      process.stderr.write("Error: maximum 10 credentials allowed\n");
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

    // Build PermissionedDomainSet transaction (no DomainID = create new domain)
    const tx: PermissionedDomainSet = {
      TransactionType: "PermissionedDomainSet",
      Account: signerWallet.address,
      AcceptedCredentials: acceptedCredentials,
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
      const txHash = txResult.hash ?? signed.hash;
      const feeDrops = txResult.tx_json?.Fee ?? "0";
      const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
      const ledger = txResult.ledger_index;

      if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ result: resultCode, tx: txHash }));
        }
        process.exit(1);
      }

      // Extract the PermissionedDomain LedgerIndex from AffectedNodes
      let domainId: string | null = null;
      const meta = txResult.meta;
      if (meta && typeof meta !== "string") {
        const domainNode = meta.AffectedNodes?.find(
          (n) => isCreatedNode(n) && n.CreatedNode.LedgerEntryType === "PermissionedDomain"
        );
        if (domainNode && isCreatedNode(domainNode)) {
          domainId = domainNode.CreatedNode.LedgerIndex;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ result: "success", domainId, tx: txHash }));
      } else {
        if (domainId) {
          console.log(`Domain ID: ${domainId}`);
        }
        console.log(`Tx: ${txHash}`);
      }
    });
  });

interface PermissionedDomainUpdateOptions {
  domainId: string;
  credential: string[];
  credentialsJson?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const permissionedDomainUpdateCommand = new Command("update")
  .description(
    "Update the accepted credentials of an existing permissioned domain (replaces the entire credentials list)"
  )
  .requiredOption("--domain-id <hash>", "64-hex-char domain ID of the permissioned domain to update")
  .option(
    "--credential <issuer:type>",
    "Accepted credential in <issuer>:<type> format (type is UTF-8, auto hex-encoded); repeatable, 1-10 total",
    (val: string, prev: string[]) => prev.concat([val]),
    [] as string[]
  )
  .option("--credentials-json <json>", "JSON array of {issuer, credential_type} objects (credential_type must be hex)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: PermissionedDomainUpdateOptions, cmd: Command) => {
    // Validate domain-id format
    if (!/^[0-9A-Fa-f]{64}$/.test(options.domainId)) {
      process.stderr.write("Error: --domain-id must be a 64-character hex string\n");
      process.exit(1);
    }

    // Validate mutually exclusive credential input flags
    if (options.credential.length > 0 && options.credentialsJson !== undefined) {
      process.stderr.write("Error: --credential and --credentials-json are mutually exclusive\n");
      process.exit(1);
    }

    if (options.credential.length === 0 && options.credentialsJson === undefined) {
      process.stderr.write("Error: provide at least one credential via --credential or --credentials-json\n");
      process.exit(1);
    }
    if (options.credential.length > 10) {
      process.stderr.write("Error: maximum 10 credentials allowed\n");
      process.exit(1);
    }

    const acceptedCredentials = parseCredentialArgs(options.credential, options.credentialsJson);

    if (acceptedCredentials.length === 0) {
      process.stderr.write("Error: provide at least one credential via --credential or --credentials-json\n");
      process.exit(1);
    }
    if (acceptedCredentials.length > 10) {
      process.stderr.write("Error: maximum 10 credentials allowed\n");
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

    const tx: PermissionedDomainSet = {
      TransactionType: "PermissionedDomainSet",
      Account: signerWallet.address,
      // DomainID signals update (vs create which omits it)
      DomainID: options.domainId.toUpperCase(),
      AcceptedCredentials: acceptedCredentials,
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
          console.log(JSON.stringify({ result: "success", domainId: options.domainId.toUpperCase(), hash: signed.hash }));
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
      const txHash = txResult.hash ?? signed.hash;

      if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ result: resultCode, tx: txHash }));
        }
        process.exit(1);
      }

      const domainId = options.domainId.toUpperCase();

      if (options.json) {
        console.log(JSON.stringify({ result: "success", domainId, tx: txHash }));
      } else {
        console.log(`Domain ID: ${domainId}`);
        console.log(`Tx: ${txHash}`);
      }
    });
  });

interface PermissionedDomainDeleteOptions {
  domainId: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const permissionedDomainDeleteCommand = new Command("delete")
  .description("Delete a permissioned domain you own, removing it from the ledger and reclaiming the reserve")
  .requiredOption("--domain-id <hash>", "64-hex-char domain ID of the permissioned domain to delete")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: PermissionedDomainDeleteOptions, cmd: Command) => {
    // Validate domain-id format
    if (!/^[0-9A-Fa-f]{64}$/.test(options.domainId)) {
      process.stderr.write("Error: --domain-id must be a 64-character hex string\n");
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

    const tx: PermissionedDomainDelete = {
      TransactionType: "PermissionedDomainDelete",
      Account: signerWallet.address,
      DomainID: options.domainId.toUpperCase(),
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
      const txHash = txResult.hash ?? signed.hash;

      if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
          console.log(JSON.stringify({ result: resultCode, tx: txHash }));
        }
        process.exit(1);
      }

      const domainId = options.domainId.toUpperCase();

      if (options.json) {
        console.log(JSON.stringify({ result: "success", domainId, tx: txHash }));
      } else {
        console.log(`Deleted domain: ${domainId}`);
        console.log(`Tx: ${txHash}`);
      }
    });
  });

export const permissionedDomainCommand = new Command("permissioned-domain")
  .description("Manage XRPL permissioned domains")
  .addCommand(permissionedDomainCreateCommand)
  .addCommand(permissionedDomainUpdateCommand)
  .addCommand(permissionedDomainDeleteCommand);
