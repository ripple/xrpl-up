import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, convertStringToHex, convertHexToString } from "xrpl";
import type { DepositPreauth, TransactionMetadataBase } from "xrpl";
import type { AuthorizeCredential } from "xrpl";
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

interface DepositPreauthSetOptions {
  authorize?: string;
  unauthorize?: string;
  authorizeCredential?: string;
  unauthorizeCredential?: string;
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

const depositPreauthSetCommand = new Command("set")
  .description("Grant or revoke deposit preauthorization for an account or credential")
  .option("--authorize <address>", "Preauthorize an account to send payments")
  .option("--unauthorize <address>", "Revoke preauthorization from an account")
  .option("--authorize-credential <issuer>", "Preauthorize a credential (by issuer address)")
  .option("--unauthorize-credential <issuer>", "Revoke credential-based preauthorization (by issuer address)")
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
  .action(async (options: DepositPreauthSetOptions, cmd: Command) => {
    // Count how many main action flags are provided
    const mainFlags = [
      options.authorize,
      options.unauthorize,
      options.authorizeCredential,
      options.unauthorizeCredential,
    ];
    const mainCount = mainFlags.filter((f) => f !== undefined).length;

    if (mainCount === 0) {
      process.stderr.write(
        "Error: provide exactly one of --authorize, --unauthorize, --authorize-credential, or --unauthorize-credential\n"
      );
      process.exit(1);
    }
    if (mainCount > 1) {
      process.stderr.write(
        "Error: --authorize, --unauthorize, --authorize-credential, and --unauthorize-credential are mutually exclusive\n"
      );
      process.exit(1);
    }

    // Validate credential-type flags
    if (options.credentialType !== undefined && options.credentialTypeHex !== undefined) {
      process.stderr.write("Error: --credential-type and --credential-type-hex are mutually exclusive\n");
      process.exit(1);
    }

    const isCredentialAction =
      options.authorizeCredential !== undefined || options.unauthorizeCredential !== undefined;
    const hasCredentialType =
      options.credentialType !== undefined || options.credentialTypeHex !== undefined;

    if (isCredentialAction && !hasCredentialType) {
      process.stderr.write(
        "Error: --authorize-credential and --unauthorize-credential require --credential-type or --credential-type-hex\n"
      );
      process.exit(1);
    }

    if (!isCredentialAction && hasCredentialType) {
      process.stderr.write(
        "Error: --credential-type and --credential-type-hex can only be used with --authorize-credential or --unauthorize-credential\n"
      );
      process.exit(1);
    }

    // Resolve credential type hex if needed
    let credentialTypeHex: string | undefined;
    if (isCredentialAction) {
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

    // Build the DepositPreauth transaction
    const tx: DepositPreauth = {
      TransactionType: "DepositPreauth",
      Account: signerWallet.address,
    };

    if (options.authorize !== undefined) {
      tx.Authorize = resolveAccount(options.authorize, keystoreDir);
    } else if (options.unauthorize !== undefined) {
      tx.Unauthorize = resolveAccount(options.unauthorize, keystoreDir);
    } else if (options.authorizeCredential !== undefined) {
      const issuer = resolveAccount(options.authorizeCredential, keystoreDir);
      const credential: AuthorizeCredential = {
        Credential: {
          Issuer: issuer,
          CredentialType: credentialTypeHex!,
        },
      };
      tx.AuthorizeCredentials = [credential];
    } else if (options.unauthorizeCredential !== undefined) {
      const issuer = resolveAccount(options.unauthorizeCredential, keystoreDir);
      const credential: AuthorizeCredential = {
        Credential: {
          Issuer: issuer,
          CredentialType: credentialTypeHex!,
        },
      };
      tx.UnauthorizeCredentials = [credential];
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

// ---------- deposit-preauth list ----------

interface DepositPreauthEntry {
  LedgerEntryType: string;
  Authorize?: string;
  AuthorizeCredentials?: Array<{ Credential: { Issuer: string; CredentialType: string } }>;
}

interface DepositPreauthListOptions {
  json: boolean;
}

const depositPreauthListCommand = new Command("list")
  .description("List deposit preauthorizations for an account")
  .argument("<address>", "Account address to query")
  .option("--json", "Output as JSON", false)
  .action(async (address: string, options: DepositPreauthListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      // Paginate through all deposit_preauth objects
      const entries: DepositPreauthEntry[] = [];
      let marker: unknown = undefined;

      do {
        const res = await client.request({
          command: "account_objects",
          account: address,
          type: "deposit_preauth",
          limit: 400,
          ...(marker !== undefined ? { marker } : {}),
        } as Parameters<typeof client.request>[0]);

        const result = res.result as {
          account_objects: DepositPreauthEntry[];
          marker?: unknown;
        };

        entries.push(...result.account_objects);
        marker = result.marker;
      } while (marker !== undefined);

      if (options.json) {
        console.log(JSON.stringify(entries));
        return;
      }

      if (entries.length === 0) {
        console.log("No deposit preauthorizations.");
        return;
      }

      for (const entry of entries) {
        if (entry.Authorize !== undefined) {
          console.log(`Account: ${entry.Authorize}`);
        } else if (entry.AuthorizeCredentials !== undefined && entry.AuthorizeCredentials.length > 0) {
          const cred = entry.AuthorizeCredentials[0]!.Credential;
          let credTypeStr: string;
          try {
            credTypeStr = convertHexToString(cred.CredentialType);
          } catch {
            credTypeStr = cred.CredentialType;
          }
          console.log(`Credential: ${cred.Issuer} / ${credTypeStr}`);
        }
      }
    });
  });

export const depositPreauthCommand = new Command("deposit-preauth")
  .description("Manage deposit preauthorizations on XRPL accounts")
  .addCommand(depositPreauthSetCommand)
  .addCommand(depositPreauthListCommand);
