import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — no network calls in this file
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const DUMMY_ISSUER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

describe("amm validation (no network)", () => {
  it("missing --asset exits 1", () => {
    const result = runCLI([
      "amm", "create",
      "--asset2", "XRP",
      "--amount", "1000000",
      "--amount2", "1000000",
      "--trading-fee", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it("missing --asset2 exits 1", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--amount", "1000000",
      "--amount2", "1000000",
      "--trading-fee", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it("missing --amount exits 1", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount2", "100",
      "--trading-fee", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it("missing --trading-fee exits 1", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it("--trading-fee above 1000 exits 1 with error message", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--trading-fee", "1001",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--trading-fee");
  });

  it("--trading-fee negative exits 1 with error message", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--trading-fee", "-1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--trading-fee");
  });

  it("same asset for both slots exits 1 with error message", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", "XRP",
      "--amount", "1000000",
      "--amount2", "1000000",
      "--trading-fee", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("different assets");
  });

  it("same IOU asset for both slots exits 1 with error message", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", `USD/${DUMMY_ISSUER}`,
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "100",
      "--amount2", "100",
      "--trading-fee", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("different assets");
  });

  it("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--trading-fee", "100",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("multiple key materials exits 1 with error message", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--trading-fee", "100",
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("--trading-fee 0 is valid (passes validation, fails on network only)", () => {
    // 0 is a valid trading fee — validation should not reject it
    // (will fail at network level with missing funded account, but that's OK for validation tests)
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--trading-fee", "0",
      "--seed", DUMMY_SEED,
    ]);
    // Should NOT exit 1 due to trading-fee validation (may exit non-zero due to network)
    expect(result.stderr).not.toContain("--trading-fee must be");
  });

  it("--trading-fee 1000 is valid (passes validation, fails on network only)", () => {
    const result = runCLI([
      "amm", "create",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--amount", "1000000",
      "--amount2", "100",
      "--trading-fee", "1000",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.stderr).not.toContain("--trading-fee must be");
  });
});

describe("amm deposit validation (no network)", () => {
  it("no flags exits 1 with error message", () => {
    const result = runCLI([
      "amm", "deposit",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("--for-empty without --amount and --amount2 exits 1", () => {
    const result = runCLI([
      "amm", "deposit",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--for-empty",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("amm withdraw validation (no network)", () => {
  it("no flags exits 1 with error message", () => {
    const result = runCLI([
      "amm", "withdraw",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("--all with --lp-token-in exits 1 (ambiguous mode)", () => {
    const result = runCLI([
      "amm", "withdraw",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--all",
      "--lp-token-in", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("amm bid validation (no network)", () => {
  it("more than 4 --auth-account values exits 1", () => {
    const result = runCLI([
      "amm", "bid",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--auth-account", DUMMY_ISSUER,
      "--auth-account", DUMMY_ISSUER,
      "--auth-account", DUMMY_ISSUER,
      "--auth-account", DUMMY_ISSUER,
      "--auth-account", DUMMY_ISSUER,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--auth-account");
  });
});

describe("amm vote validation (no network)", () => {
  it("--trading-fee above 1000 exits 1", () => {
    const result = runCLI([
      "amm", "vote",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--trading-fee", "1001",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--trading-fee");
  });

  it("--trading-fee negative exits 1", () => {
    const result = runCLI([
      "amm", "vote",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--trading-fee", "-1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--trading-fee");
  });
});

describe("amm clawback validation (no network)", () => {
  it("--asset XRP exits 1 with error message", () => {
    const result = runCLI([
      "amm", "clawback",
      "--asset", "XRP",
      "--asset2", `USD/${DUMMY_ISSUER}`,
      "--holder", DUMMY_ISSUER,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IOU");
  });

  it("missing --holder exits 1", () => {
    const result = runCLI([
      "amm", "clawback",
      "--asset", `USD/${DUMMY_ISSUER}`,
      "--asset2", "XRP",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });
});
