import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("credential accept validation (no network)", () => {
  it.concurrent("missing --issuer exits 1 with error", () => {
    const result = runCLI([
      "credential", "accept",
      "--credential-type", "KYC",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("required option");
  });

  it.concurrent("missing credential-type exits 1 with error", () => {
    const result = runCLI([
      "credential", "accept",
      "--issuer", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("both --credential-type and --credential-type-hex exits 1", () => {
    const result = runCLI([
      "credential", "accept",
      "--issuer", DUMMY_ADDRESS,
      "--credential-type", "KYC",
      "--credential-type-hex", "4B5943",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "credential", "accept",
      "--issuer", DUMMY_ADDRESS,
      "--credential-type", "KYC",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("credential delete validation (no network)", () => {
  it.concurrent("missing credential-type exits 1 with error", () => {
    const result = runCLI([
      "credential", "delete",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("both --credential-type and --credential-type-hex exits 1", () => {
    const result = runCLI([
      "credential", "delete",
      "--credential-type", "KYC",
      "--credential-type-hex", "4B5943",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "credential", "delete",
      "--credential-type", "KYC",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("credential create validation (no network)", () => {
  it.concurrent("missing --subject exits 1 with error", () => {
    const result = runCLI([
      "credential", "create",
      "--credential-type", "KYC",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("required option");
  });

  it.concurrent("missing credential-type exits 1 with error", () => {
    const result = runCLI([
      "credential", "create",
      "--subject", DUMMY_ADDRESS,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("both --credential-type and --credential-type-hex exits 1", () => {
    const result = runCLI([
      "credential", "create",
      "--subject", DUMMY_ADDRESS,
      "--credential-type", "KYC",
      "--credential-type-hex", "4B5943",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("both --uri and --uri-hex exits 1", () => {
    const result = runCLI([
      "credential", "create",
      "--subject", DUMMY_ADDRESS,
      "--credential-type", "KYC",
      "--uri", "https://example.com",
      "--uri-hex", "68747470733A2F2F6578616D706C652E636F6D",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it.concurrent("missing key material exits 1", () => {
    const result = runCLI([
      "credential", "create",
      "--subject", DUMMY_ADDRESS,
      "--credential-type", "KYC",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
