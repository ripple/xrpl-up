import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet new", () => {
  it.concurrent("generates a valid wallet with --json flag (secrets hidden by default)", () => {
    const result = runCLI(["wallet", "new", "--json"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as {
      address: string;
      publicKey: string;
      privateKey?: string;
      seed?: string;
      keyType: string;
    };
    expect(wallet.address).toMatch(/^r/);
    expect(wallet.publicKey).toBeTruthy();
    expect(wallet.seed).toBeUndefined();
    expect(wallet.privateKey).toBeUndefined();
  });

  it.concurrent("shows secrets with --show-secret and --json", () => {
    const result = runCLI(["wallet", "new", "--json", "--show-secret"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as {
      address: string;
      publicKey: string;
      privateKey: string;
      seed: string;
      keyType: string;
    };
    expect(wallet.address).toMatch(/^r/);
    expect(wallet.seed).toMatch(/^s/);
    expect(wallet.publicKey).toBeTruthy();
    expect(wallet.privateKey).toBeTruthy();
  });

  it.concurrent("defaults to ed25519 key type", () => {
    const result = runCLI(["wallet", "new", "--json"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as { keyType: string };
    expect(wallet.keyType).toBe("ed25519");
  });

  it.concurrent("uses secp256k1 when --key-type secp256k1 is passed", () => {
    const result = runCLI(["wallet", "new", "--key-type", "secp256k1", "--json"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as {
      address: string;
      keyType: string;
    };
    expect(wallet.keyType).toBe("secp256k1");
    expect(wallet.address).toMatch(/^r/);
  });

  it.concurrent("hides secrets in labelled lines without --json by default", () => {
    const result = runCLI(["wallet", "new"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Address:/m);
    expect(result.stdout).toMatch(/^Public Key:/m);
    expect(result.stdout).toContain("Private Key: [hidden]");
    expect(result.stdout).toContain("Seed:        [hidden]");
  });

  it.concurrent("shows secrets in labelled lines with --show-secret", () => {
    const result = runCLI(["wallet", "new", "--show-secret"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Address:\s+r/m);
    expect(result.stdout).toMatch(/^Public Key:\s+[0-9A-F]+/im);
    expect(result.stdout).toMatch(/^Private Key:\s+[0-9A-F]+/im);
    expect(result.stdout).toMatch(/^Seed:\s+s/m);
  });

  it.concurrent("alias 'n' works", () => {
    const result = runCLI(["wallet", "n", "--json"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as { address: string };
    expect(wallet.address).toMatch(/^r/);
  });

  it.concurrent("--save writes keystore file and outputs keystorePath", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-new-"));
    try {
      const result = runCLI([
        "wallet", "new", "--save", "--password", "test123", "--keystore", tmpDir, "--json",
      ]);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Warning: passing passwords via flag is insecure");
      const output = JSON.parse(result.stdout) as { address: string; keystorePath: string };
      expect(output.address).toMatch(/^r/);
      expect(existsSync(output.keystorePath)).toBe(true);
      expect(output.keystorePath).toBe(join(tmpDir, `${output.address}.json`));

      const listResult = runCLI(["wallet", "list", "--keystore", tmpDir]);
      expect(listResult.status).toBe(0);
      expect(listResult.stdout).toContain(output.address);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--save --alias stores label in keystore JSON and appears in alias list", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-new-"));
    try {
      const result = runCLI([
        "wallet", "new", "--save", "--password", "test123", "--keystore", tmpDir,
        "--alias", "bob", "--json",
      ]);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as { address: string; keystorePath: string };
      const keystoreData = JSON.parse(readFileSync(output.keystorePath, "utf-8")) as { label: string };
      expect(keystoreData.label).toBe("bob");

      const aliasResult = runCLI(["wallet", "alias", "list", "--keystore", tmpDir]);
      expect(aliasResult.status).toBe(0);
      expect(aliasResult.stdout).toContain("bob");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--save without --password in non-TTY mode exits 1 with error message", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-new-"));
    try {
      const result = runCLI(["wallet", "new", "--save", "--keystore", tmpDir]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--password is required");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("wallet new-mnemonic", () => {
  it.concurrent("hides mnemonic and private key by default", () => {
    const result = runCLI(["wallet", "new-mnemonic", "--json"]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      mnemonic?: string;
      privateKey?: string;
      address: string;
    };
    expect(output.address).toMatch(/^r/);
    expect(output.mnemonic).toBeUndefined();
    expect(output.privateKey).toBeUndefined();
  });

  it.concurrent("shows mnemonic and private key with --show-secret", () => {
    const result = runCLI(["wallet", "new-mnemonic", "--json", "--show-secret"]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      mnemonic: string;
      privateKey: string;
      address: string;
    };
    expect(output.address).toMatch(/^r/);
    expect(output.mnemonic.split(/\s+/)).toHaveLength(12);
    expect(output.privateKey).toBeTruthy();
  });

  it.concurrent("--save writes keystore file containing the mnemonic (even if hidden in output)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-new-mnemonic-"));
    try {
      const result = runCLI([
        "wallet", "new-mnemonic", "--save", "--password", "test123", "--keystore", tmpDir, "--json",
      ]);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as {
        mnemonic?: string;
        address: string;
        keystorePath: string;
      };
      expect(output.mnemonic).toBeUndefined();
      expect(existsSync(output.keystorePath)).toBe(true);

      const decryptResult = runCLI([
        "wallet", "decrypt-keystore", output.address,
        "--password", "test123", "--keystore", tmpDir, "--json",
      ]);
      expect(decryptResult.status).toBe(0);
      const decrypted = JSON.parse(decryptResult.stdout) as { seed: string };
      // For mnemonic wallets, seed field in decrypt output contains the mnemonic
      expect(decrypted.seed.trim().split(/\s+/)).toHaveLength(12);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
