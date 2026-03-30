import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
const DUMMY_DOMAIN_ID = "A".repeat(64);

describe("permissioned-domain create validation (no network)", () => {
  it("missing credentials exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "create",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("more than 10 credentials exits 1 with error", () => {
    const creds = Array.from({ length: 11 }, (_, i) => `${DUMMY_ADDRESS}:type${i}`);
    const args: string[] = ["permissioned-domain", "create", "--seed", DUMMY_SEED];
    for (const c of creds) {
      args.push("--credential", c);
    }
    const result = runCLI(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("maximum 10");
  });

  it("both --credential and --credentials-json exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "create",
      "--credential", `${DUMMY_ADDRESS}:KYC`,
      "--credentials-json", JSON.stringify([{ issuer: DUMMY_ADDRESS, credential_type: "4B5943" }]),
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("invalid issuer address in --credential exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "create",
      "--credential", "notanaddress:KYC",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid issuer address");
  });

  it("missing key material exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "create",
      "--credential", `${DUMMY_ADDRESS}:KYC`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("invalid issuer address in --credentials-json exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "create",
      "--credentials-json", JSON.stringify([{ issuer: "notvalid", credential_type: "4B5943" }]),
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid issuer address");
  });
});

describe("permissioned-domain update validation (no network)", () => {
  it("missing --domain-id exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "update",
      "--credential", `${DUMMY_ADDRESS}:KYC`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("domain-id");
  });

  it("invalid --domain-id format (not 64 hex chars) exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "update",
      "--domain-id", "notahexhash",
      "--credential", `${DUMMY_ADDRESS}:KYC`,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("64-character hex");
  });

  it("missing credentials exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "update",
      "--domain-id", DUMMY_DOMAIN_ID,
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("both --credential and --credentials-json exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "update",
      "--domain-id", DUMMY_DOMAIN_ID,
      "--credential", `${DUMMY_ADDRESS}:KYC`,
      "--credentials-json", JSON.stringify([{ issuer: DUMMY_ADDRESS, credential_type: "4B5943" }]),
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("invalid issuer address in --credential exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "update",
      "--domain-id", DUMMY_DOMAIN_ID,
      "--credential", "notanaddress:KYC",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid issuer address");
  });

  it("missing key material exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "update",
      "--domain-id", DUMMY_DOMAIN_ID,
      "--credential", `${DUMMY_ADDRESS}:KYC`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("permissioned-domain delete validation (no network)", () => {
  it("missing --domain-id exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "delete",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("domain-id");
  });

  it("invalid --domain-id format (not 64 hex chars) exits 1", () => {
    const result = runCLI([
      "permissioned-domain", "delete",
      "--domain-id", "notahexhash",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("64-character hex");
  });

  it("missing key material exits 1 with error", () => {
    const result = runCLI([
      "permissioned-domain", "delete",
      "--domain-id", DUMMY_DOMAIN_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
