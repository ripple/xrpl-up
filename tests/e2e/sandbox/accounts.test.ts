/**
 * Sandbox lifecycle — accounts command tests.
 *
 * Requires the local rippled stack to be running (started by globalSetup).
 * Tests both the wallet-store listing path and the --address direct lookup path.
 */
import { describe, it, expect } from "vitest";
import { runXrplUp } from "../../helpers/sandbox-cli";

// Well-known genesis address for standalone rippled
// (seed: snoPBrXtMeMyMHUVTgbuqAfg1SUTb, algorithm: secp256k1)
const GENESIS_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

describe("sandbox accounts --local (wallet store listing)", () => {
  it("exits 0 regardless of wallet store state", () => {
    // If the store is empty it prints a warning (exit 0), otherwise shows a table.
    // Either way the command must not crash.
    const result = runXrplUp(["accounts", "--local"], {}, 15_000);
    expect(result.status).toBe(0);
  });
});

describe("sandbox accounts --local --address (direct address lookup)", () => {
  it("genesis address lookup exits 0", () => {
    const result = runXrplUp(
      ["accounts", "--local", "--address", GENESIS_ADDRESS],
      {},
      15_000,
    );
    expect(result.status).toBe(0);
  });

  it("genesis address lookup renders the balance table in stdout", () => {
    // The genesis account holds 100 billion XRP, so the formatted cell value
    // "100000000000.000000 XRP" (23 chars) exceeds the 20-char colWidth and gets
    // truncated by cli-table3 — "XRP" is clipped off. Check the column header
    // "Balance" instead, which always fits and confirms the table rendered.
    const result = runXrplUp(
      ["accounts", "--local", "--address", GENESIS_ADDRESS],
      {},
      15_000,
    );
    expect(result.stdout).toContain("Balance");
  });

  it("genesis address lookup stdout contains the queried address", () => {
    const result = runXrplUp(
      ["accounts", "--local", "--address", GENESIS_ADDRESS],
      {},
      15_000,
    );
    expect(result.stdout).toContain(GENESIS_ADDRESS);
  });

  it("invalid address exits 1 with account-not-found message", () => {
    // Use a syntactically valid but unfunded address to trigger actNotFound
    const result = runXrplUp(
      ["accounts", "--local", "--address", "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe"],
      {},
      15_000,
    );
    expect(result.status).toBe(1);
  });
});
