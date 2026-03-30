import { Command } from "commander";
import { Wallet } from "xrpl";
import type { ECDSA } from "xrpl";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { deriveKeypair } from "ripple-keypairs";

type KeyType = "ed25519" | "secp256k1";

const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";

interface PublicKeyOptions {
  seed?: string;
  mnemonic?: string;
  privateKey?: string;
  keyType?: KeyType;
  derivationPath: string;
  json: boolean;
}

function toAlgorithm(keyType: KeyType): ECDSA {
  const value = keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519";
  return value as unknown as ECDSA;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function hexToBytes(hex: string): Uint8Array {
  return Buffer.from(hex, "hex");
}

function derivePublicKeyFromPrivate(privateKeyHex: string): { publicKey: string; keyType: KeyType } {
  if (privateKeyHex.startsWith("ED") || privateKeyHex.startsWith("ed")) {
    const rawPrivKey = hexToBytes(privateKeyHex.slice(2));
    const pubKeyBytes = ed25519.getPublicKey(rawPrivKey);
    return { publicKey: "ED" + bytesToHex(pubKeyBytes), keyType: "ed25519" };
  } else if (privateKeyHex.startsWith("00")) {
    const rawPrivKey = hexToBytes(privateKeyHex.slice(2));
    const pubKeyBytes = secp256k1.getPublicKey(rawPrivKey, true);
    return { publicKey: bytesToHex(pubKeyBytes), keyType: "secp256k1" };
  } else {
    process.stderr.write(
      "Error: cannot infer key type from private key — use --key-type secp256k1 or --key-type ed25519\n"
    );
    process.exit(1);
  }
}

export const publicKeyCommand = new Command("public-key")
  .alias("pubkey")
  .description("Derive public key from key material")
  .option("--seed <seed>", "Family seed (sXXX...)")
  .option("--mnemonic <phrase>", "BIP39 mnemonic phrase")
  .option("--private-key <hex>", "Raw private key as hex (ED-prefixed for ed25519, 00-prefixed for secp256k1)")
  .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519")
  .option(
    "--derivation-path <path>",
    "BIP44 derivation path (used with --mnemonic)",
    DEFAULT_DERIVATION_PATH
  )
  .option("--json", "Output as JSON", false)
  .action((options: PublicKeyOptions) => {
    const provided = [options.seed, options.mnemonic, options.privateKey].filter(
      (v) => v !== undefined
    );

    if (provided.length === 0) {
      process.stderr.write(
        "Error: one of --seed, --mnemonic, or --private-key is required\n"
      );
      process.exit(1);
    }

    if (provided.length > 1) {
      process.stderr.write(
        "Error: only one of --seed, --mnemonic, or --private-key may be provided\n"
      );
      process.exit(1);
    }

    let publicKey: string;
    let keyType: KeyType;

    if (options.seed !== undefined) {
      const keypair = deriveKeypair(options.seed);
      publicKey = keypair.publicKey;
      keyType =
        options.keyType ??
        (keypair.privateKey.toUpperCase().startsWith("ED") ? "ed25519" : "secp256k1");
    } else if (options.mnemonic !== undefined) {
      keyType = options.keyType ?? "ed25519";
      const wallet = Wallet.fromMnemonic(options.mnemonic, {
        mnemonicEncoding: "bip39",
        derivationPath: options.derivationPath,
        algorithm: toAlgorithm(keyType),
      });
      publicKey = wallet.publicKey;
    } else {
      // --private-key path
      const derived = derivePublicKeyFromPrivate(options.privateKey!);
      publicKey = derived.publicKey;
      keyType = options.keyType ?? derived.keyType;
    }

    if (options.json) {
      console.log(JSON.stringify({ publicKey, keyType }));
    } else {
      console.log(`Public Key: ${publicKey}`);
      console.log(`Key Type:   ${keyType}`);
    }
  });
