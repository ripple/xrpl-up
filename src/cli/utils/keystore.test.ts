import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { decryptKeystore, encryptKeystore, resolveAccount } from "./keystore";

describe("keystore", () => {
  const seed = "sEdTVVsaK4ZHJf3fkzecMbhFDivmpeG";
  const password = "correct-horse-battery-staple";
  const keyType = "ed25519" as const;
  const address = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

  it("round-trips: decrypt(encrypt(seed)) === seed", () => {
    const keystore = encryptKeystore(seed, password, keyType, address);
    const decrypted = decryptKeystore(keystore, password);
    expect(decrypted).toBe(seed);
  });

  it("throws on wrong password", () => {
    const keystore = encryptKeystore(seed, password, keyType, address);
    expect(() => decryptKeystore(keystore, "wrong-password")).toThrow();
  });

  it("produces different ciphertext on each call (random salt/iv)", () => {
    const ks1 = encryptKeystore(seed, password, keyType, address);
    const ks2 = encryptKeystore(seed, password, keyType, address);
    expect(ks1.ciphertext).not.toBe(ks2.ciphertext);
    expect(ks1.kdfparams.salt).not.toBe(ks2.kdfparams.salt);
  });

  it("encryptKeystore stores label when provided", () => {
    const ks = encryptKeystore(seed, password, keyType, address, "alice");
    expect(ks.label).toBe("alice");
  });

  it("encryptKeystore omits label when not provided", () => {
    const ks = encryptKeystore(seed, password, keyType, address);
    expect(ks.label).toBeUndefined();
  });
});

describe("resolveAccount", () => {
  const testAddress = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

  it("returns address as-is when it looks like an XRPL address", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-keystore-test-"));
    try {
      const result = resolveAccount(testAddress, tmpDir);
      expect(result).toBe(testAddress);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("resolves a known alias to its address", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-keystore-test-"));
    try {
      const keystoreEntry = {
        version: 1,
        address: testAddress,
        label: "alice",
        keyType: "ed25519",
        kdf: "pbkdf2",
        kdfparams: { iterations: 600000, keylen: 32, digest: "sha256", salt: "aabbcc" },
        cipher: "aes-256-gcm",
        cipherparams: { iv: "ddeeff", tag: "112233" },
        ciphertext: "445566",
      };
      writeFileSync(join(tmpDir, `${testAddress}.json`), JSON.stringify(keystoreEntry), "utf-8");

      const result = resolveAccount("alice", tmpDir);
      expect(result).toBe(testAddress);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("throws on unknown alias", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-keystore-test-"));
    try {
      expect(() => resolveAccount("unknownalias", tmpDir)).toThrow(
        "no wallet with alias unknownalias found in keystore"
      );
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
