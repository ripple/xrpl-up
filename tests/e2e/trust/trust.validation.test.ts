import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";


// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";


describe("trust set validation (no network)", () => {
  it.concurrent("invalid currency exits 1 with descriptive error", () => {
    const result = runCLI([
      "trust", "set",
      "--currency", "TOOLONG",
      "--issuer", DUMMY_ADDRESS,
      "--limit", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid currency");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "trust", "set",
      "--currency", "USD",
      "--issuer", DUMMY_ADDRESS,
      "--limit", "100",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key material options exits 1", () => {
    const result = runCLI([
      "trust", "set",
      "--currency", "USD",
      "--issuer", DUMMY_ADDRESS,
      "--limit", "100",
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--no-ripple and --clear-no-ripple together exits 1", () => {
    const result = runCLI([
      "trust", "set",
      "--currency", "USD",
      "--issuer", DUMMY_ADDRESS,
      "--limit", "100",
      "--seed", DUMMY_SEED,
      "--no-ripple",
      "--clear-no-ripple",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("--freeze and --unfreeze together exits 1", () => {
    const result = runCLI([
      "trust", "set",
      "--currency", "USD",
      "--issuer", DUMMY_ADDRESS,
      "--limit", "100",
      "--seed", DUMMY_SEED,
      "--freeze",
      "--unfreeze",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });
});
