import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet alias set / remove", () => {
  it.concurrent("sets an alias on an imported wallet and removes it", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      expect(newResult.status).toBe(0);
      const { seed, address } = JSON.parse(newResult.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      // alias set
      const setResult = runCLI(["wallet", "alias", "set", address, "alice", "--keystore", tmpDir]);
      expect(setResult.status).toBe(0);
      expect(setResult.stdout).toContain(`Alias 'alice' set for ${address}`);

      // verify label in keystore JSON
      const keystoreData = JSON.parse(
        readFileSync(join(tmpDir, `${address}.json`), "utf-8")
      ) as { label?: string };
      expect(keystoreData.label).toBe("alice");

      // alias remove
      const removeResult = runCLI(["wallet", "alias", "remove", address, "--keystore", tmpDir]);
      expect(removeResult.status).toBe(0);
      expect(removeResult.stdout).toContain(`Alias removed from ${address}`);

      // verify label is absent
      const afterRemove = JSON.parse(
        readFileSync(join(tmpDir, `${address}.json`), "utf-8")
      ) as { label?: string };
      expect(afterRemove.label).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias set exits 1 if address not found in keystore", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI([
        "wallet", "alias", "set", "rFakeAddressNotInKeystore123456789", "bob",
        "--keystore", tmpDir,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/not found/);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias remove exits 1 if address not found in keystore", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const result = runCLI([
        "wallet", "alias", "remove", "rFakeAddressNotInKeystore123456789",
        "--keystore", tmpDir,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/not found/);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias set exits 1 if name already used by different address", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };
      const wallet2 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", wallet1.seed, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "import", wallet2.seed, "--password", "testpassword", "--keystore", tmpDir]);

      // set alias on wallet1
      runCLI(["wallet", "alias", "set", wallet1.address, "shared", "--keystore", tmpDir]);

      // try to set same alias on wallet2 — should fail
      const dupResult = runCLI(["wallet", "alias", "set", wallet2.address, "shared", "--keystore", tmpDir]);
      expect(dupResult.status).toBe(1);
      expect(dupResult.stderr).toMatch(/already used/);

      // --force should succeed
      const forceResult = runCLI([
        "wallet", "alias", "set", wallet2.address, "shared", "--keystore", tmpDir, "--force",
      ]);
      expect(forceResult.status).toBe(0);
      expect(forceResult.stdout).toContain(`Alias 'shared' set for ${wallet2.address}`);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias list shows labelled wallets and omits unlabelled ones", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };
      const wallet2 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };
      const wallet3 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", wallet1.seed, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "import", wallet2.seed, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "import", wallet3.seed, "--password", "testpassword", "--keystore", tmpDir]);

      runCLI(["wallet", "alias", "set", wallet1.address, "alice", "--keystore", tmpDir]);
      runCLI(["wallet", "alias", "set", wallet2.address, "bob", "--keystore", tmpDir]);
      // wallet3 has no alias

      const listResult = runCLI(["wallet", "alias", "list", "--keystore", tmpDir]);
      expect(listResult.status).toBe(0);
      expect(listResult.stdout).toContain("alice");
      expect(listResult.stdout).toContain(wallet1.address);
      expect(listResult.stdout).toContain("bob");
      expect(listResult.stdout).toContain(wallet2.address);
      // wallet3 address should not appear
      expect(listResult.stdout).not.toContain(wallet3.address);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias list --json outputs valid JSON array with alias and address fields", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", wallet1.seed, "--password", "testpassword", "--keystore", tmpDir]);
      runCLI(["wallet", "alias", "set", wallet1.address, "alice", "--keystore", tmpDir]);

      const listResult = runCLI(["wallet", "alias", "list", "--json", "--keystore", tmpDir]);
      expect(listResult.status).toBe(0);
      const parsed = JSON.parse(listResult.stdout) as { alias: string; address: string }[];
      expect(Array.isArray(parsed)).toBe(true);
      const entry = parsed.find((e) => e.address === wallet1.address);
      expect(entry).toBeDefined();
      expect(entry?.alias).toBe("alice");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias list prints (no aliases set) when no labelled wallets exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const listResult = runCLI(["wallet", "alias", "list", "--keystore", tmpDir]);
      expect(listResult.status).toBe(0);
      expect(listResult.stdout).toContain("(no aliases set)");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("respects XRPL_KEYSTORE env var", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const { seed, address } = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const setResult = runCLI(["wallet", "alias", "set", address, "envtest"], {
        XRPL_KEYSTORE: tmpDir,
      });
      expect(setResult.status).toBe(0);
      expect(setResult.stdout).toContain(`Alias 'envtest' set for ${address}`);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
