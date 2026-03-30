import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("oracle set validation (no network)", () => {
  it.concurrent("missing --document-id exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--price", "BTC/USD:155000:6",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/required option|missing|document-id/i);
  });

  it.concurrent("missing price data exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("both --price and --price-data exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--price-data", '[{"BaseAsset":"BTC","QuoteAsset":"USD","AssetPrice":155000,"Scale":6}]',
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("invalid --price format exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "INVALIDFORMAT",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--price with non-integer price value exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:notanumber:6",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("--price with scale > 10 exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:11",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("more than 10 price pairs exits 1 with error", () => {
    const prices = Array.from({ length: 11 }, (_, i) => `PAIR${i}/USD:${i}:0`);
    const args = ["oracle", "set", "--document-id", "1"];
    for (const p of prices) {
      args.push("--price", p);
    }
    args.push("--seed", DUMMY_SEED);
    const result = runCLI(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("both --provider and --provider-hex exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "myProvider",
      "--provider-hex", "6d7950726f7669646572",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("both --asset-class and --asset-class-hex exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--asset-class", "currency",
      "--asset-class-hex", "63757272656e6379",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("missing key material exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("multiple key material options exits 1 with error", () => {
    const result = runCLI([
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("oracle delete validation (no network)", () => {
  it.concurrent("missing --document-id exits 1 with error", () => {
    const result = runCLI([
      "oracle", "delete",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/required option|missing|document-id/i);
  });

  it.concurrent("missing key material exits 1 with error", () => {
    const result = runCLI([
      "oracle", "delete",
      "--document-id", "1",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
