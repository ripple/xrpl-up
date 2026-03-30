import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet list", () => {
  it.concurrent("prints (empty) when keystore directory does not exist", () => {
    const nonExistentDir = join(tmpdir(), `xrpl-nonexistent-${Date.now()}`);
    const result = runCLI(["wallet", "list", "--keystore", nonExistentDir]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("(empty)");
  });

  it.concurrent("prints (empty) when keystore directory is empty", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI(["wallet", "list", "--keystore", tmpDir]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("(empty)");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("lists two imported wallets", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const wallet2 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed: seed1, address: address1 } = JSON.parse(wallet1.stdout) as { seed: string; address: string };
      const { seed: seed2, address: address2 } = JSON.parse(wallet2.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed1, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "import", seed2, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI(["wallet", "list", "--keystore", tmpDir]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(address1);
      expect(result.stdout).toContain(address2);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--json outputs a JSON array of wallet objects", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const wallet2 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed: seed1, address: address1 } = JSON.parse(wallet1.stdout) as { seed: string; address: string };
      const { seed: seed2, address: address2 } = JSON.parse(wallet2.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed1, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "import", seed2, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI(["wallet", "list", "--keystore", tmpDir, "--json"]);
      expect(result.status).toBe(0);
      const entries = JSON.parse(result.stdout) as { address: string; alias?: string }[];
      expect(Array.isArray(entries)).toBe(true);
      const addresses = entries.map((e) => e.address);
      expect(addresses).toContain(address1);
      expect(addresses).toContain(address2);
      // No alias key when not set
      for (const entry of entries) {
        expect(entry).not.toHaveProperty("alias");
      }
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--json outputs empty array when no keystores exist", () => {
    const nonExistentDir = join(tmpdir(), `xrpl-nonexistent-${Date.now()}`);
    const result = runCLI(["wallet", "list", "--keystore", nonExistentDir, "--json"]);
    expect(result.status).toBe(0);
    const entries = JSON.parse(result.stdout) as { address: string }[];
    expect(entries).toEqual([]);
  });

  it.concurrent("alias 'ls' works", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI(["wallet", "ls", "--keystore", tmpDir]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("(empty)");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("respects XRPL_KEYSTORE env var", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet1.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword"], { XRPL_KEYSTORE: tmpDir });

      const result = runCLI(["wallet", "list"], { XRPL_KEYSTORE: tmpDir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(address);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("shows alias column in human-readable output when alias is set", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet1.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--alias", "myalias", "--keystore", tmpDir]);

      const result = runCLI(["wallet", "list", "--keystore", tmpDir]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(address);
      expect(result.stdout).toContain("myalias");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--json output contains alias field when set, no alias field when unset", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const wallet2 = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed: seed1, address: address1 } = JSON.parse(wallet1.stdout) as { seed: string; address: string };
      const { seed: seed2, address: address2 } = JSON.parse(wallet2.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed1, "--password", "testpassword", "--alias", "walletalias", "--keystore", tmpDir]);
      runCLI(["wallet", "import", seed2, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI(["wallet", "list", "--keystore", tmpDir, "--json"]);
      expect(result.status).toBe(0);
      const entries = JSON.parse(result.stdout) as { address: string; alias?: string }[];

      const entry1 = entries.find((e) => e.address === address1);
      const entry2 = entries.find((e) => e.address === address2);

      expect(entry1).toBeDefined();
      expect(entry1?.alias).toBe("walletalias");

      expect(entry2).toBeDefined();
      expect(entry2).not.toHaveProperty("alias");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
