import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet decrypt-keystore", () => {
  it.concurrent("decrypts an imported wallet and returns the original seed", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "testpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(seed);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 with error message on wrong password", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "wrongpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("wrong password or corrupt keystore");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--json outputs address, seed, privateKey, and keyType", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const {
        seed,
        address,
        privateKey: expectedPrivateKey,
        keyType,
      } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
        privateKey: string;
        keyType: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "testpassword",
        "--keystore",
        tmpDir,
        "--json",
      ]);

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        address: string;
        seed: string;
        privateKey: string;
        keyType: string;
      };
      expect(parsed.address).toBe(address);
      expect(parsed.seed).toBe(seed);
      expect(parsed.privateKey).toBe(expectedPrivateKey);
      expect(parsed.keyType).toBe(keyType);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--show-private-key prints private key line", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address, privateKey } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
        privateKey: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "testpassword",
        "--keystore",
        tmpDir,
        "--show-private-key",
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Seed:");
      expect(result.stdout).toContain("Private Key:");
      expect(result.stdout).toContain(privateKey);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias 'dk' works", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "dk",
        address,
        "--password",
        "testpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(seed);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--file flag accepts explicit file path", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const filePath = join(tmpDir, `${address}.json`);

      const result = runCLI([
        "wallet",
        "decrypt-keystore",
        "--file",
        filePath,
        "--password",
        "testpassword",
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(seed);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 when keystore file not found", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI([
        "wallet",
        "decrypt-keystore",
        "rNonExistentAddress123",
        "--password",
        "testpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
