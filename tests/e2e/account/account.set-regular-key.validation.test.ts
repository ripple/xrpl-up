import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("account set-regular-key validation (no network)", () => {
  it.concurrent("exits 1 when both --key and --remove are provided", () => {
    const result = runCLI([
      "account", "set-regular-key",
      "--key", DUMMY_ADDRESS,
      "--remove",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("exits 1 when neither --key nor --remove is provided", () => {
    const result = runCLI([
      "account", "set-regular-key",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide either --key");
  });

  it.concurrent("exits 1 when no key material is provided", () => {
    const result = runCLI([
      "account", "set-regular-key",
      "--key", DUMMY_ADDRESS,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide key material");
  });

  it.concurrent("exits 1 when multiple key materials are provided", () => {
    const result = runCLI([
      "account", "set-regular-key",
      "--key", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide only one of");
  });

  it.concurrent("--dry-run with --key outputs SetRegularKey JSON (no network)", () => {
    const result = runCLI([
      "account", "set-regular-key",
      "--key", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as { TransactionType: string; RegularKey: string };
    expect(tx.TransactionType).toBe("SetRegularKey");
    expect(tx.RegularKey).toBe(DUMMY_ADDRESS);
  });

  it.concurrent("--dry-run with --remove outputs SetRegularKey JSON without RegularKey field (no network)", () => {
    const result = runCLI([
      "account", "set-regular-key",
      "--remove",
      "--seed", DUMMY_SEED,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as { TransactionType: string; RegularKey?: string };
    expect(tx.TransactionType).toBe("SetRegularKey");
    expect(tx.RegularKey).toBeUndefined();
  });
});
