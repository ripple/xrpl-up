import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

// Dummy channel ID (64 hex chars)
const DUMMY_CHANNEL = "A" .repeat(64);

describe("channel create validation (no network)", () => {
  it.concurrent("missing --to exits 1 with error", () => {
    const result = runCLI([
      "channel", "create",
      "--amount", "10",
      "--settle-delay", "60",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--to");
  });

  it.concurrent("missing --amount exits 1 with error", () => {
    const result = runCLI([
      "channel", "create",
      "--to", DUMMY_ADDRESS,
      "--settle-delay", "60",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--amount");
  });

  it.concurrent("missing --settle-delay exits 1 with error", () => {
    const result = runCLI([
      "channel", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--settle-delay");
  });

  it.concurrent("invalid --cancel-after ISO date exits 1", () => {
    const result = runCLI([
      "channel", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--settle-delay", "60",
      "--cancel-after", "not-a-date",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "channel", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--settle-delay", "60",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key material options exits 1", () => {
    const result = runCLI([
      "channel", "create",
      "--to", DUMMY_ADDRESS,
      "--amount", "10",
      "--settle-delay", "60",
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("channel fund validation (no network)", () => {
  it.concurrent("missing --channel exits 1 with error", () => {
    const result = runCLI([
      "channel", "fund",
      "--amount", "5",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--channel");
  });

  it.concurrent("missing --amount exits 1 with error", () => {
    const result = runCLI([
      "channel", "fund",
      "--channel", DUMMY_CHANNEL,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--amount");
  });

  it.concurrent("invalid --channel (not 64 hex chars) exits 1", () => {
    const result = runCLI([
      "channel", "fund",
      "--channel", "notahex",
      "--amount", "5",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("invalid --expiration ISO date exits 1", () => {
    const result = runCLI([
      "channel", "fund",
      "--channel", DUMMY_CHANNEL,
      "--amount", "5",
      "--expiration", "not-a-date",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "channel", "fund",
      "--channel", DUMMY_CHANNEL,
      "--amount", "5",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key material options exits 1", () => {
    const result = runCLI([
      "channel", "fund",
      "--channel", DUMMY_CHANNEL,
      "--amount", "5",
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("channel claim validation (no network)", () => {
  it.concurrent("missing --channel exits 1 with error", () => {
    const result = runCLI([
      "channel", "claim",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--channel");
  });

  it.concurrent("missing key material exits 1 with error", () => {
    const result = runCLI([
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key materials exits 1 with error", () => {
    const result = runCLI([
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("invalid --channel (not 64 hex chars) exits 1", () => {
    const result = runCLI([
      "channel", "claim",
      "--channel", "notahex",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--signature without --public-key exits 1 with error", () => {
    const SIG = "DEADBEEF".repeat(16);
    const result = runCLI([
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
      "--amount", "5",
      "--balance", "5",
      "--signature", SIG,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--public-key");
  });

  it.concurrent("--signature without --amount exits 1 with error", () => {
    const SIG = "DEADBEEF".repeat(16);
    const PK = "0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020";
    const result = runCLI([
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
      "--balance", "5",
      "--signature", SIG,
      "--public-key", PK,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--amount");
  });

  it.concurrent("--signature without --balance exits 1 with error", () => {
    const SIG = "DEADBEEF".repeat(16);
    const PK = "0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020";
    const result = runCLI([
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
      "--amount", "5",
      "--signature", SIG,
      "--public-key", PK,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--balance");
  });
});
