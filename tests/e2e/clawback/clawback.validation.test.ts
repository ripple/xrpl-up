import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Dummy values — no network needed
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const DUMMY_HOLDER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_ISSUER = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const DUMMY_MPT_ID = "000000000000000000000000000000000000000000000000"; // 48-char hex

describe("clawback validation (no network)", () => {
  it.concurrent("exits 1 with error when amount value is zero (IOU)", () => {
    const result = runCLI([
      "clawback",
      "--amount", `0/USD/${DUMMY_HOLDER}`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/amount value must not be zero/);
  });

  it.concurrent("exits 1 with error when amount value is zero (MPT)", () => {
    const result = runCLI([
      "clawback",
      "--amount", `0/${DUMMY_MPT_ID}`,
      "--holder", DUMMY_HOLDER,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/amount value must not be zero/);
  });

  it.concurrent("exits 1 when --holder is provided with IOU (3-part) amount", () => {
    const result = runCLI([
      "clawback",
      "--amount", `10/USD/${DUMMY_HOLDER}`,
      "--holder", DUMMY_HOLDER,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--holder is only valid for MPT mode/);
  });

  it.concurrent("exits 1 when MPT-format amount is provided without --holder", () => {
    const result = runCLI([
      "clawback",
      "--amount", `10/${DUMMY_MPT_ID}`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MPT clawback requires --holder/);
  });

  it.concurrent("exits 1 when no key material is provided", () => {
    const result = runCLI([
      "clawback",
      "--amount", `10/USD/${DUMMY_HOLDER}`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/provide key material via --seed, --mnemonic, or --account/);
  });

  it.concurrent("exits 1 when XRP amount is provided", () => {
    const result = runCLI([
      "clawback",
      "--amount", "1.5",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/clawback requires an IOU or MPT amount/);
  });

  it.concurrent("exits 1 when multiple key materials are provided", () => {
    const result = runCLI([
      "clawback",
      "--amount", `10/USD/${DUMMY_HOLDER}`,
      "--seed", DUMMY_SEED,
      "--account", DUMMY_ISSUER,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/provide only one of --seed, --mnemonic, or --account/);
  });
});
