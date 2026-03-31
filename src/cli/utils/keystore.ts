import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";

export interface KeystoreFile {
  version: 1;
  address: string;
  label?: string;
  keyType: "ed25519" | "secp256k1";
  kdf: "pbkdf2";
  kdfparams: {
    iterations: 600000;
    keylen: 32;
    digest: "sha256";
    salt: string; // hex
  };
  cipher: "aes-256-gcm";
  cipherparams: {
    iv: string; // hex
    tag: string; // hex
  };
  ciphertext: string; // hex
}

export function getKeystoreDir(options: { keystore?: string }): string {
  if (options.keystore) {
    return resolve(options.keystore);
  }
  const envDir = process.env["XRPL_KEYSTORE"];
  if (envDir) {
    return resolve(envDir);
  }
  return join(homedir(), ".xrpl", "keystore");
}

export function encryptKeystore(
  seed: string,
  password: string,
  keyType: "ed25519" | "secp256k1",
  address: string,
  label?: string
): KeystoreFile {
  const salt = randomBytes(32);
  const iv = randomBytes(12);

  const key = pbkdf2Sync(password, salt, 600000, 32, "sha256");

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintextBuf = Buffer.from(seed, "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  const result: KeystoreFile = {
    version: 1,
    address,
    keyType,
    kdf: "pbkdf2",
    kdfparams: {
      iterations: 600000,
      keylen: 32,
      digest: "sha256",
      salt: salt.toString("hex"),
    },
    cipher: "aes-256-gcm",
    cipherparams: {
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
    },
    ciphertext: ciphertext.toString("hex"),
  };

  if (label !== undefined) {
    result.label = label;
  }

  return result;
}

export function decryptKeystore(file: KeystoreFile, password: string): string {
  const salt = Buffer.from(file.kdfparams.salt, "hex");
  const iv = Buffer.from(file.cipherparams.iv, "hex");
  const tag = Buffer.from(file.cipherparams.tag, "hex");
  const ciphertext = Buffer.from(file.ciphertext, "hex");

  const key = pbkdf2Sync(
    password,
    salt,
    file.kdfparams.iterations,
    file.kdfparams.keylen,
    file.kdfparams.digest
  );

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("wrong password or corrupt keystore");
  }
}

/**
 * Resolves an address-or-alias to an XRPL address.
 * - If the input looks like an XRPL address (starts with 'r', length 25-34), returns it unchanged.
 * - Otherwise scans keystoreDir for a *.json file with a matching label field.
 * - Throws if no matching alias is found.
 */
export function resolveAccount(addressOrAlias: string, keystoreDir: string): string {
  if (/^r[a-zA-Z0-9]{24,33}$/.test(addressOrAlias)) {
    return addressOrAlias;
  }

  let files: string[];
  try {
    files = readdirSync(keystoreDir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(keystoreDir, file), "utf-8")) as Partial<KeystoreFile>;
      if (data.label === addressOrAlias && data.address) {
        return data.address;
      }
    } catch {
      // skip unreadable files
    }
  }

  // Also check by address from filename (basename without .json)
  const byFilename = files.map((f) => basename(f, ".json"));
  if (byFilename.includes(addressOrAlias)) {
    return addressOrAlias;
  }

  throw new Error(`no wallet with alias ${addressOrAlias} found in keystore`);
}
