import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — no network calls in this file
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("did set validation", () => {
  it("no fields provided exits 1 with error", () => {
    const result = runCLI(["did", "set", "--seed", DUMMY_SEED]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("missing key material exits 1 with error", () => {
    const result = runCLI(["did", "set", "--uri", "https://example.com/did"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("multiple key material options exits 1 with error", () => {
    const result = runCLI([
      "did", "set",
      "--uri", "https://example.com/did",
      "--seed", DUMMY_SEED,
      "--mnemonic", "test test test test test test test test test test test junk",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("--uri and --uri-hex are mutually exclusive", () => {
    const result = runCLI([
      "did", "set",
      "--uri", "https://example.com/did",
      "--uri-hex", "68747470733a2f2f",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--data and --data-hex are mutually exclusive", () => {
    const result = runCLI([
      "did", "set",
      "--data", "attestation",
      "--data-hex", "61747465737461",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--did-document and --did-document-hex are mutually exclusive", () => {
    const result = runCLI([
      "did", "set",
      "--did-document", '{"@context":"https://www.w3.org/ns/did/v1"}',
      "--did-document-hex", "7b7d",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--uri and --clear-uri are mutually exclusive", () => {
    const result = runCLI([
      "did", "set",
      "--uri", "https://example.com/did",
      "--clear-uri",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--data and --clear-data are mutually exclusive", () => {
    const result = runCLI([
      "did", "set",
      "--data", "attestation",
      "--clear-data",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--did-document and --clear-did-document are mutually exclusive", () => {
    const result = runCLI([
      "did", "set",
      "--did-document", '{"@context":"https://www.w3.org/ns/did/v1"}',
      "--clear-did-document",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });
});
