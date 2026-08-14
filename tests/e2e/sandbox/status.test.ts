/**
 * Sandbox lifecycle — status command tests.
 *
 * Requires the local rippled stack to be running (started by globalSetup).
 * All tests are read-only — no state is modified.
 */
import { describe, it, expect } from "vitest";
import { runXrplUp } from "../../helpers/sandbox-cli";

describe("sandbox status", () => {
  it("exits 0", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    expect(result.status).toBe(0);
  });

  it("stdout contains the Status section header", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    expect(result.stdout).toContain("Status");
  });

  it("stdout contains Version: field", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    expect(result.stdout).toContain("Version:");
  });

  it("stdout contains State: field", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    expect(result.stdout).toContain("State:");
  });

  it("stdout contains Ledger: field", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    expect(result.stdout).toContain("Ledger:");
  });

  it("stdout contains Faucet: field with health check (local only)", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    // Faucet health line is only shown in local mode
    expect(result.stdout).toContain("Faucet:");
  });

  it("stdout shows faucet as healthy", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    // globalSetup waited for faucet health before tests run, so it must be healthy
    expect(result.stdout).toContain("healthy");
  });

  it("stdout contains Endpoint: pointing at local WebSocket", () => {
    const result = runXrplUp(["status"], {}, 15_000);
    expect(result.stdout).toContain("ws://");
  });
});
