import { Command } from "commander";
import { Wallet } from "xrpl";
import type { ECDSA } from "xrpl";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { encryptKeystore, getKeystoreDir, type KeystoreFile } from "../../utils/keystore";
import { promptPasswordWithConfirmation } from "../../utils/prompt";

type KeyType = "ed25519" | "secp256k1";

interface NewWalletOptions {
  keyType: KeyType;
  json: boolean;
  save: boolean;
  showSecret: boolean;
  password?: string;
  alias?: string;
  keystore?: string;
}

function toAlgorithm(keyType: KeyType): ECDSA {
  const value = keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519";
  return value as unknown as ECDSA;
}

function checkAliasUniqueness(name: string, excludeAddress: string, keystoreDir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(keystoreDir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(keystoreDir, file), "utf-8")) as Partial<KeystoreFile>;
      if (data.label === name && data.address && data.address !== excludeAddress) {
        return data.address;
      }
    } catch {
      // skip unreadable files
    }
  }
  return null;
}

async function saveToKeystore(
  address: string,
  secret: string,
  keyType: KeyType,
  options: { password?: string; alias?: string; keystore?: string }
): Promise<string> {
  let password: string;
  if (options.password !== undefined) {
    process.stderr.write("Warning: passing passwords via flag is insecure\n");
    password = options.password;
  } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Error: --password is required when --save is used in non-interactive mode\n");
    process.exit(1);
  } else {
    password = await promptPasswordWithConfirmation();
  }

  const keystoreDir = getKeystoreDir(options);
  mkdirSync(keystoreDir, { recursive: true });

  if (options.alias !== undefined) {
    const conflictAddress = checkAliasUniqueness(options.alias, address, keystoreDir);
    if (conflictAddress !== null) {
      process.stderr.write(
        `Error: alias '${options.alias}' is already used by ${conflictAddress}.\n`
      );
      process.exit(1);
    }
  }

  const filePath = join(keystoreDir, `${address}.json`);
  const keystoreData = encryptKeystore(secret, password, keyType, address, options.alias);
  writeFileSync(filePath, JSON.stringify(keystoreData, null, 2), "utf-8");

  return filePath;
}

export const newWalletCommand = new Command("new")
  .alias("n")
  .description("Generate a new random XRPL wallet")
  .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519", "ed25519")
  .option("--json", "Output as JSON", false)
  .option("--save", "Encrypt and save the wallet to the keystore", false)
  .option("--show-secret", "Show the seed and private key (hidden by default)", false)
  .option("--password <password>", "Encryption password for --save (insecure, prefer interactive prompt)")
  .option("--alias <name>", "Set a human-readable alias when saving to keystore")
  .option(
    "--keystore <dir>",
    "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"
  )
  .action(async (options: NewWalletOptions) => {
    const wallet = Wallet.generate(toAlgorithm(options.keyType));

    if (options.json) {
      const output: Record<string, unknown> = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        keyType: options.keyType,
      };
      if (options.showSecret) {
        output.privateKey = wallet.privateKey;
        output.seed = wallet.seed;
      }
      if (options.save) {
        const filePath = await saveToKeystore(wallet.address, wallet.seed!, options.keyType, options);
        output["keystorePath"] = filePath;
      }
      console.log(JSON.stringify(output));
    } else {
      console.log(`Address:     ${wallet.address}`);
      console.log(`Public Key:  ${wallet.publicKey}`);
      if (options.showSecret) {
        console.log(`Private Key: ${wallet.privateKey}`);
        console.log(`Seed:        ${wallet.seed}`);
      } else {
        console.log(`Private Key: [hidden] (use --show-secret to see it)`);
        console.log(`Seed:        [hidden] (use --show-secret to see it)`);
      }
      if (options.save) {
        const filePath = await saveToKeystore(wallet.address, wallet.seed!, options.keyType, options);
        console.log(`Saved to ${filePath}`);
      }
    }
  });
