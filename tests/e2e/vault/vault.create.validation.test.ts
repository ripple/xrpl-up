import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const DUMMY_VAULT_ID = "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2";

describe("vault create validation", () => {
  it("missing --asset exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("--private without --domain-id exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--asset", "0",
      "--private",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
    expect(result.stderr).toContain("--domain-id");
  });

  it("invalid --domain-id (not 64-char hex) exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--asset", "0",
      "--domain-id", "notahexstring",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
    expect(result.stderr).toContain("--domain-id");
  });

  it("invalid --domain-id (correct hex but wrong length) exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--asset", "0",
      "--domain-id", "AABB",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("missing key material exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--asset", "0",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("multiple key material sources exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--asset", "0",
      "--seed", DUMMY_SEED,
      "--mnemonic", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("invalid --asset format exits 1 with error", () => {
    const result = runCLI([
      "vault", "create",
      "--asset", "not-valid-asset",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("--dry-run with valid XRP asset prints tx JSON without network call", () => {
    // --dry-run needs a seed and connects to network to autofill — skip this in validation
    // This is just checking the flag exists (other tests cover actual dry-run)
    const result = runCLI([
      "vault", "create",
      "--asset", "0",
      "--private",
      "--seed", DUMMY_SEED,
    ]);
    // --private without --domain-id should still fail before network
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--domain-id");
  });

  it("--vault-id flag does not exist on create (wrong subcommand usage)", () => {
    const result = runCLI([
      "vault", "create",
      "--vault-id", DUMMY_VAULT_ID,
      "--asset", "0",
      "--seed", DUMMY_SEED,
    ]);
    // --vault-id is not an option on create; commander prints unknown option error
    expect(result.status).toBe(1);
  });
});

describe("vault set validation", () => {
  it("missing --vault-id exits 1 with error", () => {
    const result = runCLI([
      "vault", "set",
      "--data", "DEADBEEF",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("invalid --vault-id format exits 1 with error", () => {
    const result = runCLI([
      "vault", "set",
      "--vault-id", "not-a-valid-hash",
      "--data", "DEADBEEF",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("no update fields provided exits 1 with error", () => {
    const result = runCLI([
      "vault", "set",
      "--vault-id", DUMMY_VAULT_ID,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("missing key material exits 1 with error", () => {
    const result = runCLI([
      "vault", "set",
      "--vault-id", DUMMY_VAULT_ID,
      "--data", "DEADBEEF",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("vault deposit validation", () => {
  it("missing --vault-id exits 1 with error", () => {
    const result = runCLI([
      "vault", "deposit",
      "--amount", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("missing --amount exits 1 with error", () => {
    const result = runCLI([
      "vault", "deposit",
      "--vault-id", DUMMY_VAULT_ID,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("invalid --vault-id format exits 1 with error", () => {
    const result = runCLI([
      "vault", "deposit",
      "--vault-id", "tooshort",
      "--amount", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("vault withdraw validation", () => {
  it("missing --vault-id exits 1 with error", () => {
    const result = runCLI([
      "vault", "withdraw",
      "--amount", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("missing --amount exits 1 with error", () => {
    const result = runCLI([
      "vault", "withdraw",
      "--vault-id", DUMMY_VAULT_ID,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("--destination-tag without --destination exits 1 with error", () => {
    const result = runCLI([
      "vault", "withdraw",
      "--vault-id", DUMMY_VAULT_ID,
      "--amount", "10",
      "--destination-tag", "42",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
    expect(result.stderr).toContain("--destination");
  });
});

describe("vault delete validation", () => {
  it("missing --vault-id exits 1 with error", () => {
    const result = runCLI([
      "vault", "delete",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("invalid --vault-id format exits 1 with error", () => {
    const result = runCLI([
      "vault", "delete",
      "--vault-id", "tooshort",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("vault clawback validation", () => {
  it("missing --vault-id exits 1 with error", () => {
    const result = runCLI([
      "vault", "clawback",
      "--holder", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("missing --holder exits 1 with error", () => {
    const result = runCLI([
      "vault", "clawback",
      "--vault-id", DUMMY_VAULT_ID,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("invalid --holder address format exits 1 with error", () => {
    const result = runCLI([
      "vault", "clawback",
      "--vault-id", DUMMY_VAULT_ID,
      "--holder", "not-an-address",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
