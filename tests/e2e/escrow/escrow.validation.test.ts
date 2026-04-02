import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("escrow create validation", () => {
  it.concurrent("missing --to exits 1", () => {
    const result = runCLI([
      "escrow", "create",
      "--amount", "10",
      "--finish-after", "2030-01-01T00:00:00Z",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing --amount exits 1", () => {
    const result = runCLI([
      "escrow", "create",
      "--to", DUMMY_ADDRESS,
      "--finish-after", "2030-01-01T00:00:00Z",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing both --finish-after and --condition exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("invalid ISO date in --finish-after exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--finish-after", "not-a-date",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--finish-after", "2030-01-01T00:00:00Z",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("escrow finish validation", () => {
  it.concurrent("missing --owner exits 1", () => {
    const result = runCLI([
      "escrow", "finish",
      "--sequence", "1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing --sequence exits 1", () => {
    const result = runCLI([
      "escrow", "finish",
      "--owner", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "finish",
      "--owner", DUMMY_ADDRESS,
      "--sequence", "1",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--condition without --fulfillment exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "finish",
      "--owner", DUMMY_ADDRESS,
      "--sequence", "1",
      "--condition", "A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--fulfillment without --condition exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "finish",
      "--owner", DUMMY_ADDRESS,
      "--sequence", "1",
      "--fulfillment", "A02280200000000000000000000000000000000000000000000000000000000000000000",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("escrow cancel validation", () => {
  it.concurrent("missing --owner exits 1", () => {
    const result = runCLI([
      "escrow", "cancel",
      "--sequence", "1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing --sequence exits 1", () => {
    const result = runCLI([
      "escrow", "cancel",
      "--owner", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "escrow", "cancel",
      "--owner", DUMMY_ADDRESS,
      "--sequence", "1",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
