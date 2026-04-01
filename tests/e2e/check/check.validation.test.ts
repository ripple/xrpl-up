import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const DUMMY_CHECK_ID = "49647F0D748DC3FE26BDACBC57F251AADEFFF391403EC9BF87C97F67E9977FB0";

describe("check create validation", () => {
  it.concurrent("missing --to exits 1", () => {
    const result = runCLI([
      "check", "create",
      "--send-max", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing --send-max exits 1", () => {
    const result = runCLI([
      "check", "create",
      "--to", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "check", "create",
      "--to", DUMMY_ADDRESS,
      "--send-max", "10",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("invalid ISO date in --expiration exits 1 with error message", () => {
    const result = runCLI([
      "check", "create",
      "--to", DUMMY_ADDRESS,
      "--send-max", "10",
      "--expiration", "not-a-date",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--invoice-id > 32 bytes exits 1 with error message", () => {
    const result = runCLI([
      "check", "create",
      "--to", DUMMY_ADDRESS,
      "--send-max", "10",
      "--invoice-id", "this-string-is-definitely-longer-than-32-bytes-in-utf8",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("check cash validation", () => {
  it.concurrent("missing --check exits 1", () => {
    const result = runCLI([
      "check", "cash",
      "--amount", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing both --amount and --deliver-min exits 1 with error message", () => {
    const result = runCLI([
      "check", "cash",
      "--check", DUMMY_CHECK_ID,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("providing both --amount and --deliver-min exits 1 with error message", () => {
    const result = runCLI([
      "check", "cash",
      "--check", DUMMY_CHECK_ID,
      "--amount", "10",
      "--deliver-min", "5",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "check", "cash",
      "--check", DUMMY_CHECK_ID,
      "--amount", "10",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("check cancel validation", () => {
  it.concurrent("missing --check exits 1", () => {
    const result = runCLI([
      "check", "cancel",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "check", "cancel",
      "--check", DUMMY_CHECK_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
