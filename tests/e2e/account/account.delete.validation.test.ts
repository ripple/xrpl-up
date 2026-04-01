import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("account delete validation", () => {
  it.concurrent("missing --destination exits 1", () => {
    const result = runCLI([
      "account", "delete",
      "--seed", DUMMY_SEED,
      "--confirm",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("required option");
  });

  it.concurrent("invalid destination address exits 1 with descriptive error", () => {
    const result = runCLI([
      "account", "delete",
      "--destination", "not-a-valid-address",
      "--seed", DUMMY_SEED,
      "--confirm",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid destination address");
  });

  it.concurrent("missing --confirm without --dry-run exits 1 with correct message", () => {
    const result = runCLI([
      "account", "delete",
      "--destination", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("This permanently deletes your account. Pass --confirm to proceed.");
  });

  it.concurrent("--dry-run bypasses --confirm requirement and exits 0", () => {
    const result = runCLI([
      "account", "delete",
      "--destination", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as { TransactionType: string };
    expect(tx.TransactionType).toBe("AccountDelete");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "account", "delete",
      "--destination", DUMMY_ADDRESS,
      "--confirm",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide key material");
  });

  it.concurrent("multiple key materials exits 1", () => {
    const result = runCLI([
      "account", "delete",
      "--destination", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
      "--confirm",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide only one of");
  });
});
