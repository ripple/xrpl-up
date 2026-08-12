/**
 * Sandbox — amendment enable ACTIVATION test (--local-network mode).
 *
 * amendment.enable.test.ts (the shared-sandbox suite) only checks that the
 * `enable` command exits 0 and queues the amendment — it deliberately skips
 * the reset so it doesn't disrupt other tests sharing that sandbox. That
 * left a real bug uncaught: enabling an amendment in --local-network mode
 * silently failed to ever activate it, because `seedConsensusVolumes()`
 * always re-seeded fresh volumes from a pre-built ledger snapshot that
 * predates the newly-queued amendment, so rippled booted via --load instead
 * of a real --start and the genesis-forcing config was never applied.
 *
 * This test runs in isolation (own globalSetup, wipes the stack) and drives
 * the full cycle: enable → reset → restart --local-network → verify the
 * amendment actually shows Enabled: yes afterward.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runXrplUp } from "../../helpers/sandbox-cli";

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

describe("sandbox amendment enable --local-network (real activation)", () => {
  let targetAmendment: string | null = null;

  beforeAll(() => {
    const result = runXrplUp(
      ["amendment", "list", "--local", "--disabled"],
      {},
      30_000,
    );
    if (result.status !== 0) {
      throw new Error(
        `amendment list --local --disabled failed (exit ${result.status}):\n` +
        (result.stderr || result.stdout),
      );
    }

    const lines = stripAnsi(result.stdout).split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith("Name") ||
        trimmed.startsWith("─") ||
        trimmed.includes("total known")
      ) {
        continue;
      }
      const parts = trimmed.split(/\s{2,}/);
      if (parts.length >= 4 && parts[parts.length - 1].includes("✔")) {
        targetAmendment = parts[0].trim();
        break;
      }
    }
  });

  it("finds a supported-but-disabled amendment to use as the test target", () => {
    if (!targetAmendment) {
      console.log("  ℹ  All supported amendments are already genesis-enabled — skipping activation test.");
      return;
    }
    expect(targetAmendment).not.toBeNull();
  });

  it("enable --auto-reset queues the amendment and resets the sandbox", () => {
    if (!targetAmendment) return;
    const result = runXrplUp(
      ["amendment", "enable", targetAmendment, "--local", "--auto-reset"],
      {},
      60_000,
    );
    expect(result.status).toBe(0);
  }, 90_000);

  it("restarting --local-network actually activates the amendment", () => {
    if (!targetAmendment) return;

    const startResult = runXrplUp(
      ["start", "--local", "--local-network", "--detach"],
      {},
      180_000,
    );
    expect(startResult.status).toBe(0);

    const infoResult = runXrplUp(
      ["amendment", "info", targetAmendment, "--local"],
      {},
      30_000,
    );
    expect(infoResult.status).toBe(0);
    expect(stripAnsi(infoResult.stdout)).toContain("Enabled:     ✔ yes");
  }, 200_000);
});
