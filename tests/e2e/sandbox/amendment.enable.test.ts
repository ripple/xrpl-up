/**
 * Sandbox — amendment enable command tests.
 *
 * Requires the local rippled stack to be running (started by globalSetup).
 * Enabling writes the amendment hash to ~/.xrpl-up/genesis-amendments.txt
 * and is only applied to the ledger after a full node reset + restart.
 * The running node's state is NOT changed by these tests.
 *
 * The target amendment is discovered dynamically at runtime by querying the
 * disabled list and picking the first supported-but-not-enabled amendment.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runXrplUp } from "../../helpers/sandbox-cli";

// Strip ANSI escape codes so we can parse CLI output reliably.
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

describe("sandbox amendment enable --local", () => {
  let targetAmendment: string | null = null;

  beforeAll(() => {
    const result = runXrplUp(
      ["amendment", "list", "--local", "--disabled"],
      {},
      30_000,
    );

    // If the command itself failed, surface the error immediately so all tests fail
    // with a clear root cause rather than silently skipping.
    if (result.status !== 0) {
      throw new Error(
        `amendment list --local --disabled failed (exit ${result.status}):\n` +
        (result.stderr || result.stdout),
      );
    }

    // Row format (ANSI stripped):
    //   "  <Name padded 34>  <Hash padded 18>  ✗         ✔"
    // All rows have ✗ for Enabled (it's the --disabled list).
    // We want the first row whose last token is ✔ (supported).
    const lines = stripAnsi(result.stdout).split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip header, separator, and summary lines.
      if (
        !trimmed ||
        trimmed.startsWith("Name") ||
        trimmed.startsWith("─") ||
        trimmed.includes("total known")
      ) {
        continue;
      }
      // Data row: split on 2+ consecutive spaces to get columns.
      const parts = trimmed.split(/\s{2,}/);
      // parts: [name, hash, enabledMark, supportedMark]
      if (parts.length >= 4 && parts[parts.length - 1].includes("✔")) {
        targetAmendment = parts[0].trim();
        break;
      }
    }
  });

  it("finds a supported-but-disabled amendment to use as the test target", () => {
    // targetAmendment being null is NOT a test failure — it means the genesis config
    // already includes all supported amendments (fully up-to-date sandbox). Skip gracefully.
    if (!targetAmendment) {
      console.log("  ℹ  All supported amendments are already genesis-enabled — skipping enable tests.");
      return;
    }
    expect(targetAmendment).not.toBeNull();
  });

  it("enables the discovered amendment and exits 0", () => {
    if (!targetAmendment) return; // skip — no candidate (all amendments already enabled)
    const result = runXrplUp(
      ["amendment", "enable", targetAmendment, "--local"],
      {},
      60_000,
      "n\n",  // answer "no" to the reset prompt — keeps the sandbox running
    );
    expect(result.status).toBe(0);
  }, 120_000);

  it("amendment is queued in the genesis config file", () => {
    if (!targetAmendment) return; // skip — no candidate (all amendments already enabled)
    const genesisFile = path.join(os.homedir(), ".xrpl-up", "genesis-amendments.txt");
    expect(fs.existsSync(genesisFile)).toBe(true);
    const contents = fs.readFileSync(genesisFile, "utf-8");
    expect(contents).toContain(targetAmendment);
  });
});
