import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { deriveKeypair } from "ripple-keypairs";
import { Wallet } from "xrpl";
import type { ECDSA } from "xrpl";
import { decryptKeystore, getKeystoreDir, type KeystoreFile } from "../../utils/keystore";
import { promptPassword } from "../../utils/prompt";

type KeyType = "ed25519" | "secp256k1";

const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";

function toAlgorithm(keyType: KeyType): ECDSA {
  return (keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519") as unknown as ECDSA;
}

function detectStoredMaterialType(material: string): "seed" | "mnemonic" | "privateKey" {
  if (material.trim().split(/\s+/).length > 1) {
    return "mnemonic";
  }
  if (/^s[a-zA-Z0-9]{20,}$/.test(material)) {
    return "seed";
  }
  return "privateKey";
}

function derivePrivateKeyFromMaterial(
  material: string,
  keyType: KeyType
): string {
  const materialType = detectStoredMaterialType(material);
  if (materialType === "seed") {
    return deriveKeypair(material).privateKey;
  } else if (materialType === "mnemonic") {
    const wallet = Wallet.fromMnemonic(material, {
      mnemonicEncoding: "bip39",
      derivationPath: DEFAULT_DERIVATION_PATH,
      algorithm: toAlgorithm(keyType),
    });
    return wallet.privateKey;
  } else {
    // raw private key stored directly
    return material;
  }
}

interface DecryptKeystoreOptions {
  file?: string;
  password?: string;
  showPrivateKey: boolean;
  json: boolean;
  keystore?: string;
}

export const decryptKeystoreCommand = new Command("decrypt-keystore")
  .alias("dk")
  .description("Decrypt a keystore file to retrieve the seed or private key")
  .argument("[address]", "XRPL address to look up in keystore (required unless --file is used)")
  .option("--file <path>", "Explicit keystore file path (overrides address lookup)")
  .option("--password <password>", "Decryption password (insecure, prefer interactive prompt)")
  .option("--show-private-key", "Also print the private key hex", false)
  .option("--json", "Output as JSON {address, seed, privateKey, keyType}", false)
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .action(async (address: string | undefined, options: DecryptKeystoreOptions) => {
    let filePath: string;

    if (options.file) {
      filePath = resolve(options.file);
    } else if (address) {
      const keystoreDir = getKeystoreDir(options);
      filePath = join(keystoreDir, `${address}.json`);
    } else {
      process.stderr.write("Error: provide an address or --file <path>\n");
      process.exit(1);
    }

    if (!existsSync(filePath)) {
      process.stderr.write(
        `Error: keystore file not found: ${filePath}\n`
      );
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

    let seed: string;
    try {
      seed = decryptKeystore(keystoreData, password);
    } catch {
      process.stderr.write("Error: wrong password or corrupt keystore\n");
      process.exit(1);
    }

    const keyType = keystoreData.keyType;
    const resolvedAddress = keystoreData.address;

    if (options.json) {
      const privateKey = derivePrivateKeyFromMaterial(seed, keyType);
      console.log(JSON.stringify({ address: resolvedAddress, seed, privateKey, keyType }));
    } else {
      console.log(`Seed: ${seed}`);
      if (options.showPrivateKey) {
        const privateKey = derivePrivateKeyFromMaterial(seed, keyType);
        console.log(`Private Key: ${privateKey}`);
      }
    }
  });
