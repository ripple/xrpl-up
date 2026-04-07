/**
 * Sandbox lifecycle — validation tests (no network required).
 *
 * These tests exercise CLI-level argument validation: missing required
 * positional arguments (handled by Commander) and early-exit guards
 * inside command handlers (e.g. --local requirement checks).
 *
 * No running node is needed — all cases exit before any network call.
 */
import { describe, it, expect } from "vitest";
import { runXrplUp } from "../../helpers/sandbox-cli";

// ── snapshot ──────────────────────────────────────────────────────────────────

describe("sandbox snapshot validation", () => {
  it("snapshot save without <name> exits 1", () => {
    const result = runXrplUp(["snapshot", "save"]);
    expect(result.status).toBe(1);
  });

  it("snapshot restore without <name> exits 1", () => {
    const result = runXrplUp(["snapshot", "restore"]);
    expect(result.status).toBe(1);
  });
});

// ── config ────────────────────────────────────────────────────────────────────

describe("sandbox config validate validation", () => {
  it("config validate without <file> exits 1", () => {
    const result = runXrplUp(["config", "validate"]);
    expect(result.status).toBe(1);
  });

  it("config validate with nonexistent file exits 1 with file-not-found message", () => {
    const result = runXrplUp(["config", "validate", "/nonexistent/path/rippled.cfg"]);
    expect(result.status).toBe(1);
    // Error message comes through stdout (logger.log inside printValidationResult)
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("not found");
  });
});

// ── amendment ─────────────────────────────────────────────────────────────────

describe("sandbox amendment validation", () => {
  it("amendment info without <nameOrHash> exits 1", () => {
    const result = runXrplUp(["amendment", "info"]);
    expect(result.status).toBe(1);
  });

  it("amendment enable without --local exits 1 immediately", () => {
    // amendmentEnableCommand checks --local before any network call
    const result = runXrplUp(["amendment", "enable", "SomeAmendment"]);
    expect(result.status).toBe(1);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--local");
  });


});

// ── faucet ────────────────────────────────────────────────────────────────────

describe("sandbox faucet validation", () => {
  it("faucet --network mainnet exits 1 with unknown network message", () => {
    // "mainnet" is not a recognized network alias
    const result = runXrplUp(["faucet", "--network", "mainnet"]);
    expect(result.status).toBe(1);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("not found");
  });

  it("faucet --network invalid-net exits 1 with unknown network message", () => {
    // resolveNetwork throws for unknown network names
    const result = runXrplUp(["faucet", "--network", "invalid-net"]);
    expect(result.status).toBe(1);
  });
});
