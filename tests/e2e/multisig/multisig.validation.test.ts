import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — no network calls; exits before connecting
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const ADDR_1 = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const ADDR_2 = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const ADDR_3 = "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59";

describe("multisig set validation", () => {
  it.concurrent("missing --signer exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("quorum = 0 exits 1 with suggestion to use delete", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "0",
      "--signer", `${ADDR_1}:1`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("multisig delete");
  });

  it.concurrent("quorum > sum of weights exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "10",
      "--signer", `${ADDR_1}:3`,
      "--signer", `${ADDR_2}:2`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/quorum.*exceed|exceed.*quorum/i);
  });

  it.concurrent("more than 32 signers exits 1 with error", () => {
    // Count check fires before per-signer validation, so repeating one address 33 times
    // triggers the "at most 32" error (not a duplicate error).
    const signers: string[] = [];
    for (let i = 0; i < 33; i++) {
      signers.push("--signer", `${ADDR_2}:1`);
    }
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      ...signers,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("at most 32");
  });

  it.concurrent("duplicate signer address exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", `${ADDR_1}:1`,
      "--signer", `${ADDR_1}:2`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("duplicate");
  });

  it.concurrent("invalid format (missing colon) exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", ADDR_1, // no :weight
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid --signer format");
  });

  it.concurrent("non-integer weight exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", `${ADDR_1}:abc`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid weight");
  });

  it.concurrent("weight <= 0 exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", `${ADDR_1}:0`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid weight");
  });

  it.concurrent("missing key material exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", `${ADDR_1}:1`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("missing --quorum exits 1 with required option error", () => {
    const result = runCLI([
      "multisig", "set",
      "--signer", `${ADDR_1}:1`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("required option");
  });

  it.concurrent("multiple key material sources exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", `${ADDR_1}:1`,
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only one");
  });

  it.concurrent("invalid signer address exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", "notanaddress:1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid address");
  });

  it.concurrent("float weight exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "1",
      "--signer", `${ADDR_1}:1.5`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid weight");
  });

  it.concurrent("negative quorum exits 1 with error", () => {
    const result = runCLI([
      "multisig", "set",
      "--quorum", "-1",
      "--signer", `${ADDR_1}:1`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multisig delete missing key material exits 1 with error", () => {
    const result = runCLI(["multisig", "delete"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multisig list missing address argument exits 1", () => {
    const result = runCLI(["multisig", "list"]);
    expect(result.status).toBe(1);
  });
});
