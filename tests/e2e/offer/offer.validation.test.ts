import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";


// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";


describe("offer validation (no network)", () => {
  it.concurrent("missing --taker-pays exits 1", () => {
    const result = runCLI([
      "offer", "create",
      "--taker-gets", "10",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing --taker-gets exits 1", () => {
    const result = runCLI([
      "offer", "create",
      "--taker-pays", `1/USD/${DUMMY_ADDRESS}`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
  });

  it.concurrent("missing key material exits 1 with error message", () => {
    const result = runCLI([
      "offer", "create",
      "--taker-pays", `1/USD/${DUMMY_ADDRESS}`,
      "--taker-gets", "10",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--immediate-or-cancel and --fill-or-kill together exits 1 with mutual exclusion error", () => {
    const result = runCLI([
      "offer", "create",
      "--taker-pays", `1/USD/${DUMMY_ADDRESS}`,
      "--taker-gets", "10",
      "--seed", DUMMY_SEED,
      "--immediate-or-cancel",
      "--fill-or-kill",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--immediate-or-cancel and --fill-or-kill are mutually exclusive");
  });
});
