import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — no network required for sign/verify (offline operations)
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const DUMMY_PUBLIC_KEY = "0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020";
const DUMMY_CHANNEL = "A".repeat(64);
const DUMMY_AMOUNT = "5";

describe("channel sign / channel verify (offline)", () => {
  it.concurrent("signs a claim and the resulting signature passes channel verify", () => {
    const signResult = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
    ]);
    expect(signResult.status).toBe(0);
    const signature = signResult.stdout.trim();
    expect(signature).toMatch(/^[0-9A-F]+$/);

    const verifyResult = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--signature", signature,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout.trim()).toBe("valid");
  });

  it.concurrent("channel sign --json outputs { signature } object", () => {
    const result = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
      "--json",
    ]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { signature: string };
    expect(typeof parsed.signature).toBe("string");
    expect(parsed.signature).toMatch(/^[0-9A-F]+$/);
  });

  it.concurrent("channel verify --json outputs { valid: true } for a valid signature", () => {
    const signResult = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
    ]);
    const signature = signResult.stdout.trim();

    const result = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--signature", signature,
      "--public-key", DUMMY_PUBLIC_KEY,
      "--json",
    ]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { valid: boolean };
    expect(parsed.valid).toBe(true);
  });

  it.concurrent("verify a tampered signature outputs 'invalid'", () => {
    const signResult = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
    ]);
    const signature = signResult.stdout.trim();

    // Tamper the last byte of the signature
    const tampered = signature.slice(0, -2) + (signature.endsWith("FF") ? "00" : "FF");

    const verifyResult = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--signature", tampered,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout.trim()).toBe("invalid");
  });

  it.concurrent("verify with wrong amount outputs 'invalid'", () => {
    const signResult = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
    ]);
    const signature = signResult.stdout.trim();

    // Different amount
    const verifyResult = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", "99",
      "--signature", signature,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout.trim()).toBe("invalid");
  });

  it.concurrent("channel verify --json outputs { valid: false } for invalid signature", () => {
    const result = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--signature", "DEADBEEF",
      "--public-key", DUMMY_PUBLIC_KEY,
      "--json",
    ]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { valid: boolean };
    expect(parsed.valid).toBe(false);
  });
});

describe("channel sign validation", () => {
  it.concurrent("missing --channel exits 1 with error", () => {
    const result = runCLI([
      "channel", "sign",
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--channel");
  });

  it.concurrent("missing --amount exits 1 with error", () => {
    const result = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--amount");
  });

  it.concurrent("missing key material exits 1 with error", () => {
    const result = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key material exits 1 with error", () => {
    const result = runCLI([
      "channel", "sign",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("invalid --channel (not 64 hex chars) exits 1", () => {
    const result = runCLI([
      "channel", "sign",
      "--channel", "notahex",
      "--amount", DUMMY_AMOUNT,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("channel verify validation", () => {
  const DUMMY_SIG = "3045022100E5FE1AE4D29F013C4AE5EA8AA48AFA91A797195F985F66ABAF5963ECAABE58E502205F66E5D63BB4225E41FEA886DE3E138E96E327F73653DC7F708E8D5F34406E0F";

  it.concurrent("missing --channel exits 1 with error", () => {
    const result = runCLI([
      "channel", "verify",
      "--amount", DUMMY_AMOUNT,
      "--signature", DUMMY_SIG,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--channel");
  });

  it.concurrent("missing --amount exits 1 with error", () => {
    const result = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--signature", DUMMY_SIG,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--amount");
  });

  it.concurrent("missing --signature exits 1 with error", () => {
    const result = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--signature");
  });

  it.concurrent("missing --public-key exits 1 with error", () => {
    const result = runCLI([
      "channel", "verify",
      "--channel", DUMMY_CHANNEL,
      "--amount", DUMMY_AMOUNT,
      "--signature", DUMMY_SIG,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--public-key");
  });

  it.concurrent("invalid --channel (not 64 hex chars) exits 1", () => {
    const result = runCLI([
      "channel", "verify",
      "--channel", "notahex",
      "--amount", DUMMY_AMOUNT,
      "--signature", DUMMY_SIG,
      "--public-key", DUMMY_PUBLIC_KEY,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
