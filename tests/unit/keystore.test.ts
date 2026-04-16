import { describe, it, expect } from "vitest";
import { encryptKeystore, decryptKeystore, type KeystoreFile } from "../../src/utils/keystore";

describe("keystore encrypt/decrypt", () => {
  const seed = "sEdTnmue6JkroDsJRjHJbA29ytue5Yo";
  const password = "test-password-123";
  const address = "rTestAddress123456789012345";

  it("round-trips correctly", () => {
    const encrypted = encryptKeystore(seed, password, "ed25519", address);
    const decrypted = decryptKeystore(encrypted, password);
    expect(decrypted).toBe(seed);
  });

  it("fails with wrong password", () => {
    const encrypted = encryptKeystore(seed, password, "ed25519", address);
    expect(() => decryptKeystore(encrypted, "wrong-password")).toThrow("wrong password or corrupt keystore");
  });

  it("rejects truncated auth tag (IS-22127)", () => {
    const encrypted = encryptKeystore(seed, password, "ed25519", address);
    // Truncate the 32-char hex tag (16 bytes) to 16-char hex (8 bytes)
    const tampered: KeystoreFile = {
      ...encrypted,
      cipherparams: {
        ...encrypted.cipherparams,
        tag: encrypted.cipherparams.tag.slice(0, 16),
      },
    };
    expect(() => decryptKeystore(tampered, password)).toThrow("Invalid authentication tag length");
  });

  it("rejects empty auth tag", () => {
    const encrypted = encryptKeystore(seed, password, "ed25519", address);
    const tampered: KeystoreFile = {
      ...encrypted,
      cipherparams: {
        ...encrypted.cipherparams,
        tag: "",
      },
    };
    expect(() => decryptKeystore(tampered, password)).toThrow("Invalid authentication tag length");
  });

  it("preserves label when provided", () => {
    const encrypted = encryptKeystore(seed, password, "ed25519", address, "my-wallet");
    expect(encrypted.label).toBe("my-wallet");
    const decrypted = decryptKeystore(encrypted, password);
    expect(decrypted).toBe(seed);
  });
});
