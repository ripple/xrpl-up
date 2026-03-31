import { Command } from "commander";
import { Wallet } from "xrpl";
import type { ECDSA } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";

type KeyType = "ed25519" | "secp256k1";

const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";

interface PrivateKeyOptions {
  seed?: string;
  mnemonic?: string;
  keyType?: KeyType;
  derivationPath: string;
  json: boolean;
}

function toAlgorithm(keyType: KeyType): ECDSA {
  const value = keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519";
  return value as unknown as ECDSA;
}

export const privateKeyCommand = new Command("private-key")
  .alias("pk")
  .description("Derive private key from seed or mnemonic")
  .option("--seed <seed>", "Family seed (sXXX...)")
  .option("--mnemonic <phrase>", "BIP39 mnemonic phrase")
  .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519")
  .option(
    "--derivation-path <path>",
    "BIP44 derivation path (used with --mnemonic)",
    DEFAULT_DERIVATION_PATH
  )
  .option("--json", "Output as JSON", false)
  .action((options: PrivateKeyOptions) => {
    const provided = [options.seed, options.mnemonic].filter(
      (v) => v !== undefined
    );

    if (provided.length === 0) {
      process.stderr.write(
        "Error: one of --seed or --mnemonic is required\n"
      );
      process.exit(1);
    }

    if (provided.length > 1) {
      process.stderr.write(
        "Error: only one of --seed or --mnemonic may be provided\n"
      );
      process.exit(1);
    }

    let privateKey: string;
    let keyType: KeyType;

    if (options.seed !== undefined) {
      // Use ripple-keypairs directly so algorithm is inferred from seed encoding
      const keypair = deriveKeypair(options.seed);
      privateKey = keypair.privateKey;
      keyType =
        options.keyType ??
        (privateKey.toUpperCase().startsWith("ED") ? "ed25519" : "secp256k1");
    } else {
      // mnemonic path
      keyType = options.keyType ?? "ed25519";
      const wallet = Wallet.fromMnemonic(options.mnemonic!, {
        mnemonicEncoding: "bip39",
        derivationPath: options.derivationPath,
        algorithm: toAlgorithm(keyType),
      });
      privateKey = wallet.privateKey;
    }

    if (options.json) {
      console.log(JSON.stringify({ privateKey, keyType }));
    } else {
      console.log(`Private Key: ${privateKey}`);
      console.log(`Key Type:    ${keyType}`);
    }
  });
