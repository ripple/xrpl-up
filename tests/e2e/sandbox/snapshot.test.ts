/**
 * Snapshot integration tests.
 *
 * These tests are intentionally sequential (no it.concurrent) because
 * snapshot save/restore stops and restarts the local rippled + faucet
 * services. Concurrent operations would race against the restart window.
 *
 * Run in isolation with:
 *   npm run test:e2e:snapshot
 *
 * Do NOT include in the main test:e2e:local run — service restarts
 * would disrupt other tests running concurrently on the same node.
 *
 * Requires the node to be running with --local-network (consensus mode,
 * handled by snapshot-setup.ts globalSetup).
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { runXrplUp } from "../../helpers/sandbox-cli";

const SNAPSHOTS_DIR = path.join(os.homedir(), ".xrpl-up", "snapshots");
const SNAP_NAME = "e2e-test-snapshot";
const SNAP_OVERWRITE = "e2e-test-snapshot-overwrite";

function snapshotPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}.tar.gz`);
}

function sidecarPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}-accounts.json`);
}

function metaPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}-meta.json`);
}

function cliOutput(result: { stdout?: string | null; stderr?: string | null }): string {
  return result.stderr || result.stdout || "xrpl-up command failed without output";
}

afterAll(() => {
  // Clean up all test snapshots created during this run
  for (const name of [SNAP_NAME, SNAP_OVERWRITE]) {
    for (const file of [snapshotPath(name), sidecarPath(name), metaPath(name)]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // ok if already missing
      }
    }
  }
});

// ─── save ─────────────────────────────────────────────────────────────────────

describe("snapshot save", () => {
  it("exits 0", () => {
    // snapshot save verifies accounts on-chain, stops services, tars the
    // volume, then resumes the sandbox. The next test checks the resume worked.
    const result = runXrplUp(["snapshot", "save", SNAP_NAME], {}, 120_000);
    expect(result.status, cliOutput(result)).toBe(0);
  });

  it("creates a .tar.gz file in ~/.xrpl-up/snapshots/", () => {
    expect(fs.existsSync(snapshotPath(SNAP_NAME))).toBe(true);
  });

  it("snapshot file is non-empty", () => {
    const stats = fs.statSync(snapshotPath(SNAP_NAME));
    expect(stats.size).toBeGreaterThan(0);
  });

  it("creates a -accounts.json sidecar", () => {
    expect(fs.existsSync(sidecarPath(SNAP_NAME))).toBe(true);
  });

  it("node WebSocket is healthy after save (verifies save resumed the sandbox)", async () => {
    // Do NOT start the sandbox here — snapshot save is supposed to resume
    // it automatically. An extra start would mask a broken resume flow.
    const result = runXrplUp(["status", "--local"], {}, 15_000);
    expect(result.status, cliOutput(result)).toBe(0);
    expect(result.stdout).toContain("healthy");
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("snapshot list", () => {
  it("exits 0", () => {
    const result = runXrplUp(["snapshot", "list"], {}, 10_000);
    expect(result.status, cliOutput(result)).toBe(0);
  });

  it("stdout contains the saved snapshot name", () => {
    const result = runXrplUp(["snapshot", "list"], {}, 10_000);
    expect(result.stdout).toContain(SNAP_NAME);
  });

  it("stdout contains file size in MB", () => {
    const result = runXrplUp(["snapshot", "list"], {}, 10_000);
    expect(result.stdout).toMatch(/\d+\.\d+ MB/);
  });

  it("stdout marks snapshot as having an accounts sidecar", () => {
    const result = runXrplUp(["snapshot", "list"], {}, 10_000);
    expect(result.stdout).toContain("+accounts");
  });
});

// ─── restore ──────────────────────────────────────────────────────────────────

describe("snapshot restore", () => {
  it("exits 1 for a non-existent snapshot", () => {
    const result = runXrplUp(
      ["snapshot", "restore", "nonexistent-e2e-snap-99"],
      {},
      15_000,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("exits 0 for an existing snapshot", () => {
    const result = runXrplUp(["snapshot", "restore", SNAP_NAME], {}, 120_000);
    expect(result.status, cliOutput(result)).toBe(0);
  });

  it("node WebSocket is healthy after restore", async () => {
    const result = runXrplUp(["status", "--local"], {}, 15_000);
    expect(result.status, cliOutput(result)).toBe(0);
    expect(result.stdout).toContain("healthy");
  });

  it("faucet HTTP endpoint is healthy after restore", () => {
    const result = runXrplUp(["status", "--local"], {}, 15_000);
    expect(result.status, cliOutput(result)).toBe(0);
    expect(result.stdout).toContain("Faucet:");
    expect(result.stdout).toContain("healthy");
  });
});

// ─── overwrite ────────────────────────────────────────────────────────────────

describe("snapshot save (overwrite existing)", () => {
  it("exits 0 when a snapshot with the same name already exists", () => {
    // First save
    const first = runXrplUp(["snapshot", "save", SNAP_OVERWRITE], {}, 120_000);
    expect(first.status, cliOutput(first)).toBe(0);
    // Second save — should overwrite, not fail
    const result = runXrplUp(["snapshot", "save", SNAP_OVERWRITE], {}, 120_000);
    expect(result.status, cliOutput(result)).toBe(0);
  });

  it("the overwritten snapshot is still listed", () => {
    const result = runXrplUp(["snapshot", "list"], {}, 10_000);
    expect(result.stdout).toContain(SNAP_OVERWRITE);
  });
});
