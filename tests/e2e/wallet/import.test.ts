import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet import", () => {
  it.concurrent("imports a seed with --password and --keystore and creates the keystore file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      expect(newResult.status).toBe(0);
      const { seed, address } = JSON.parse(newResult.stdout) as {
        seed: string;
        address: string;
      };

      const importResult = runCLI([
        "wallet", "import", seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
      ]);
      expect(importResult.stderr).toContain("Warning: passing passwords via flag is insecure");
      expect(importResult.status).toBe(0);
      expect(importResult.stdout).toContain(`Imported account ${address}`);

      const keystoreFile = join(tmpDir, `${address}.json`);
      expect(existsSync(keystoreFile)).toBe(true);

      const keystoreData = JSON.parse(readFileSync(keystoreFile, "utf-8")) as {
        address: string;
        version: number;
      };
      expect(keystoreData.address).toBe(address);
      expect(keystoreData.version).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 if keystore file already exists without --force", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed } = JSON.parse(newResult.stdout) as { seed: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const secondImport = runCLI([
        "wallet", "import", seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
      ]);
      expect(secondImport.status).toBe(1);
      expect(secondImport.stderr).toMatch(/already exists/);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--force overwrites existing keystore file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(newResult.stdout) as {
        seed: string;
        address: string;
      };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const forceResult = runCLI([
        "wallet", "import", seed,
        "--password", "newpassword",
        "--keystore", tmpDir,
        "--force",
      ]);
      expect(forceResult.status).toBe(0);
      expect(forceResult.stdout).toContain(`Imported account ${address}`);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("alias 'i' works", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed } = JSON.parse(newResult.stdout) as { seed: string };

      const importResult = runCLI([
        "wallet", "i", seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("respects XRPL_KEYSTORE env var", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(newResult.stdout) as {
        seed: string;
        address: string;
      };

      const importResult = runCLI(["wallet", "import", seed, "--password", "testpassword"], {
        XRPL_KEYSTORE: tmpDir,
      });
      expect(importResult.status).toBe(0);
      expect(existsSync(join(tmpDir, `${address}.json`))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--alias stores label in keystore JSON and shows in alias list", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(newResult.stdout) as { seed: string; address: string };

      const importResult = runCLI([
        "wallet", "import", seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
        "--alias", "alice",
      ]);
      expect(importResult.status).toBe(0);
      expect(importResult.stdout).toContain(`Imported account ${address} (alias: alice)`);

      // verify label in keystore JSON
      const keystoreData = JSON.parse(
        readFileSync(join(tmpDir, `${address}.json`), "utf-8")
      ) as { label?: string };
      expect(keystoreData.label).toBe("alice");

      // verify alias list shows alice
      const listResult = runCLI(["wallet", "alias", "list", "--keystore", tmpDir]);
      expect(listResult.status).toBe(0);
      expect(listResult.stdout).toContain("alice");
      expect(listResult.stdout).toContain(address);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("--alias exits 1 if alias already taken; --force succeeds", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet1 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };
      const wallet2 = JSON.parse(runCLI(["wallet", "new", "--json", "--show-secret"]).stdout) as { seed: string; address: string };

      // import first wallet with alias
      runCLI(["wallet", "import", wallet1.seed, "--password", "testpassword", "--keystore", tmpDir, "--alias", "shared"]);

      // import second wallet with same alias — should fail
      const dupResult = runCLI([
        "wallet", "import", wallet2.seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
        "--alias", "shared",
      ]);
      expect(dupResult.status).toBe(1);
      expect(dupResult.stderr).toMatch(/already used/);

      // --force should succeed
      const forceResult = runCLI([
        "wallet", "import", wallet2.seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
        "--alias", "shared",
        "--force",
      ]);
      expect(forceResult.status).toBe(0);
      expect(forceResult.stdout).toContain(`Imported account ${wallet2.address} (alias: shared)`);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("imports a secp256k1 seed and creates correct keystore", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const newResult = runCLI(["wallet", "new", "--key-type", "secp256k1", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(newResult.stdout) as {
        seed: string;
        address: string;
      };

      const importResult = runCLI([
        "wallet", "import", seed,
        "--password", "testpassword",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status).toBe(0);

      const keystoreData = JSON.parse(
        readFileSync(join(tmpDir, `${address}.json`), "utf-8")
      ) as { address: string; keyType: string };
      expect(keystoreData.address).toBe(address);
      expect(keystoreData.keyType).toBe("secp256k1");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
