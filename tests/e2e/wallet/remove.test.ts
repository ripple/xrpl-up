import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet remove", () => {
  it.concurrent("removes an imported wallet and file no longer exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const filePath = join(tmpDir, `${address}.json`);
      expect(existsSync(filePath)).toBe(true);

      const result = runCLI(["wallet", "remove", address, "--keystore", tmpDir]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(`Removed ${address}`);
      expect(existsSync(filePath)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("removed wallet no longer appears in wallet list", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "remove", address, "--keystore", tmpDir]);

      const listResult = runCLI(["wallet", "list", "--keystore", tmpDir]);
      expect(listResult.status).toBe(0);
      expect(listResult.stdout).not.toContain(address);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 with error message when address not found", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI(["wallet", "remove", "rNonExistentAddress123", "--keystore", tmpDir]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias 'rm' works", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI(["wallet", "rm", address, "--keystore", tmpDir]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Removed ${address}`);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("respects XRPL_KEYSTORE env var", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword"], { XRPL_KEYSTORE: tmpDir });

      const result = runCLI(["wallet", "remove", address], { XRPL_KEYSTORE: tmpDir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Removed ${address}`);

      const filePath = join(tmpDir, `${address}.json`);
      expect(existsSync(filePath)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
