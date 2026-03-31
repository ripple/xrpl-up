import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { sign as rippleSign, deriveKeypair } from "ripple-keypairs";
import { Wallet } from "xrpl";
import type { ECDSA } from "xrpl";
import { decryptKeystore, type KeystoreFile } from "../../utils/keystore";
import { promptPassword } from "../../utils/prompt";

type KeyType = "ed25519" | "secp256k1";

const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";

function toAlgorithm(keyType: KeyType): ECDSA {
  return (keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519") as unknown as ECDSA;
}

function getKeystoreDir(options: { keystore?: string }): string {
  if (options.keystore) {
    return resolve(options.keystore);
  }
  const envDir = process.env["XRPL_KEYSTORE"];
  if (envDir) {
    return resolve(envDir);
  }
  return join(homedir(), ".xrpl", "keystore");
}

function detectMaterialType(material: string): "seed" | "mnemonic" | "privateKey" {
  if (material.trim().split(/\s+/).length > 1) return "mnemonic";
  if (/^s[a-zA-Z0-9]{20,}$/.test(material)) return "seed";
  return "privateKey";
}

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

function walletFromMnemonic(mnemonic: string, keyType: KeyType, derivationPath?: string): Wallet {
  return Wallet.fromMnemonic(mnemonic, {
    mnemonicEncoding: "bip39",
    derivationPath: derivationPath ?? DEFAULT_DERIVATION_PATH,
    algorithm: toAlgorithm(keyType),
  });
}

function walletFromPrivateKey(privateKey: string, keyType: KeyType): Wallet {
  // Derive public key from private key using xrpl's Wallet approach
  // We use deriveKeypair trick via a seed - but for raw private keys we need @noble/curves
  // Import dynamically to avoid circular issues; these are transitive deps
  // We reconstruct the wallet by signing a dummy and checking — but the cleaner way is:
  // xrpl.Wallet can be constructed with (publicKey, privateKey)
  // We must derive the public key first
  let publicKey: string;
  if (keyType === "ed25519") {
    // Use @noble/curves/ed25519 to derive public key
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ed25519: noble } = require("@noble/curves/ed25519") as {
      ed25519: { getPublicKey: (privKey: Uint8Array) => Uint8Array };
    };
    const rawPriv = Buffer.from(
      privateKey.toUpperCase().startsWith("ED") ? privateKey.slice(2) : privateKey,
      "hex"
    );
    const pubBytes = noble.getPublicKey(rawPriv);
    publicKey = "ED" + Buffer.from(pubBytes).toString("hex").toUpperCase();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { secp256k1: noble } = require("@noble/curves/secp256k1") as {
      secp256k1: { getPublicKey: (privKey: Uint8Array, compressed: boolean) => Uint8Array };
    };
    const rawPriv = Buffer.from(
      privateKey.toUpperCase().startsWith("00") ? privateKey.slice(2) : privateKey,
      "hex"
    );
    const pubBytes = noble.getPublicKey(rawPriv, true);
    publicKey = Buffer.from(pubBytes).toString("hex").toUpperCase();
  }
  return new Wallet(publicKey, privateKey);
}

interface SignOptions {
  message?: string;
  fromHex: boolean;
  tx?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  keyType?: string;
  password?: string;
  keystore?: string;
  json: boolean;
}

export const signCommand = new Command("sign")
  .alias("s")
  .description("Sign a message or XRPL transaction")
  .option("--message <string>", "UTF-8 message to sign (use --from-hex for hex-encoded)")
  .option("--from-hex", "Treat --message value as already hex-encoded", false)
  .option("--tx <json-or-path>", "Transaction JSON (inline or file path) to sign")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address>", "Account address to load from keystore (requires --password)")
  .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519 (used with --seed or --mnemonic)")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .option("--json", "Output as JSON", false)
  .action(async (options: SignOptions) => {
    if (!options.message && !options.tx) {
      process.stderr.write("Error: provide either --message or --tx\n");
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

    let signerWallet: Wallet;

    if (options.seed) {
      signerWallet = walletFromSeed(options.seed);
    } else if (options.mnemonic) {
      const keyType: KeyType = (options.keyType as KeyType) ?? "ed25519";
      signerWallet = walletFromMnemonic(options.mnemonic, keyType);
    } else {
      // --account: load from keystore
      const keystoreDir = getKeystoreDir(options);
      const filePath = join(keystoreDir, `${options.account!}.json`);

      if (!existsSync(filePath)) {
        process.stderr.write(`Error: keystore file not found for account ${options.account!}\n`);
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

      const materialType = detectMaterialType(material!);
      const storedKeyType: KeyType = keystoreData!.keyType;

      if (materialType === "seed") {
        signerWallet = walletFromSeed(material!);
      } else if (materialType === "mnemonic") {
        signerWallet = walletFromMnemonic(material!, storedKeyType);
      } else {
        signerWallet = walletFromPrivateKey(material!, storedKeyType);
      }
    }

    if (options.message !== undefined) {
      const messageHex = options.fromHex
        ? options.message
        : Buffer.from(options.message, "utf-8").toString("hex").toUpperCase();

      const signature = rippleSign(messageHex, signerWallet!.privateKey);

      if (options.json) {
        console.log(JSON.stringify({ signature }));
      } else {
        console.log(signature);
      }
    } else {
      // --tx mode
      let txJson: Record<string, unknown>;

      try {
        txJson = JSON.parse(options.tx!) as Record<string, unknown>;
      } catch {
        // Try as file path
        const filePath = resolve(options.tx!);
        if (!existsSync(filePath)) {
          process.stderr.write(
            `Error: could not parse as JSON and file not found: ${options.tx!}\n`
          );
          process.exit(1);
        }
        try {
          txJson = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
        } catch {
          process.stderr.write(`Error: failed to parse transaction JSON from file: ${options.tx!}\n`);
          process.exit(1);
        }
      }

      const signed = signerWallet!.sign(txJson as Parameters<Wallet["sign"]>[0]);

      if (options.json) {
        console.log(JSON.stringify({ tx_blob: signed.tx_blob, hash: signed.hash }));
      } else {
        console.log(`tx_blob: ${signed.tx_blob}`);
        console.log(`hash: ${signed.hash}`);
      }
    }
  });
