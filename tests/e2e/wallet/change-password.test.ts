import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet change-password", () => {
  it.concurrent("changes password and allows decrypt with new password", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "oldpassword", "--keystore", tmpDir]);

      const changeResult = runCLI([
        "wallet",
        "change-password",
        address,
        "--password",
        "oldpassword",
        "--new-password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(changeResult.status).toBe(0);
      expect(changeResult.stdout).toContain(`Password changed for ${address}`);

      const decryptResult = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(decryptResult.status).toBe(0);
      expect(decryptResult.stdout).toContain(seed);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 with error on wrong current password", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "correctpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "change-password",
        address,
        "--password",
        "wrongpassword",
        "--new-password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("wrong password or corrupt keystore");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("original password no longer works after change", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "oldpassword", "--keystore", tmpDir]);

      runCLI([
        "wallet",
        "change-password",
        address,
        "--password",
        "oldpassword",
        "--new-password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      const decryptOld = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "oldpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(decryptOld.status).toBe(1);
      expect(decryptOld.stderr).toContain("wrong password or corrupt keystore");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias 'cp' works", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "oldpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "cp",
        address,
        "--password",
        "oldpassword",
        "--new-password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Password changed for ${address}`);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 when keystore file not found", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI([
        "wallet",
        "change-password",
        "rNonExistentAddress123",
        "--password",
        "oldpassword",
        "--new-password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("seed remains unchanged after password change", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "oldpassword", "--keystore", tmpDir]);

      runCLI([
        "wallet",
        "change-password",
        address,
        "--password",
        "oldpassword",
        "--new-password",
        "newpassword",
        "--keystore",
        tmpDir,
      ]);

      const decryptResult = runCLI([
        "wallet",
        "decrypt-keystore",
        address,
        "--password",
        "newpassword",
        "--keystore",
        tmpDir,
        "--json",
      ]);

      expect(decryptResult.status).toBe(0);
      const parsed = JSON.parse(decryptResult.stdout) as { seed: string; address: string };
      expect(parsed.seed).toBe(seed);
      expect(parsed.address).toBe(address);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
