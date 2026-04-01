import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("ticket create validation", () => {
  it.concurrent("missing --count exits 1", () => {
    const result = runCLI([
      "ticket", "create",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("--count=0 exits 1 with error message", () => {
    const result = runCLI([
      "ticket", "create",
      "--count", "0",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--count=251 exits 1 with error message", () => {
    const result = runCLI([
      "ticket", "create",
      "--count", "251",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--count=-1 exits 1 with error message", () => {
    const result = runCLI([
      "ticket", "create",
      "--count", "-1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("non-integer --count exits 1 with error message", () => {
    const result = runCLI([
      "ticket", "create",
      "--count", "1.5",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "ticket", "create",
      "--count", "1",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key material sources exits 1 with error message", () => {
    const result = runCLI([
      "ticket", "create",
      "--count", "1",
      "--seed", DUMMY_SEED,
      "--mnemonic", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
