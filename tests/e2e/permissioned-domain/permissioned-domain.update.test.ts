import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import type { AccountObjectsRequest } from "xrpl";
import { mkdtempSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
  resilientRequest,
} from "../helpers/fund";

// NOTE: PermissionedDomains amendment is enabled on testnet.

// 7 tests, each needs 1 owner + 1 credIssuer = 2 wallets per test
// Total wallets: 14; +6 buffer = 20 tickets
// Budget: 20 × 0.2 + 14 × 3 = 4 + 42 = 46 ≤ 99 ✓
const TICKET_COUNT = 20;

let client: Client;
let master: Wallet;

/**
 * Helper: create a domain via CLI and return its domain ID.
 */
function createDomain(ownerSeed: string, credentialArg: string): string {
  const result = runCLI([
    "--node", "testnet",
    "permissioned-domain", "create",
    "--credential", credentialArg,
    "--seed", ownerSeed,
  ]);
  if (result.status !== 0) {
    throw new Error(`Domain creation failed: ${result.stderr}`);
  }
  const match = result.stdout.match(/Domain ID:\s*([0-9A-Fa-f]{64})/);
  if (!match) {
    throw new Error(`Could not extract domain ID from: ${result.stdout}`);
  }
  return match[1];
}

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

describe("permissioned-domain update", () => {
  it.concurrent("updates domain credentials via --credential", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    const result = runCLI([
      "--node", "testnet",
      "permissioned-domain", "update",
      "--domain-id", domainId,
      "--credential", `${credIssuer.address}:AML`,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Domain ID: ${domainId}`);
    expect(result.stdout).toContain("Tx:");
  }, 120_000);

  it.concurrent("updates domain credentials via --credentials-json", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);
    const credsJson = JSON.stringify([
      { issuer: credIssuer.address, credential_type: "414D4C" }, // "AML" in hex
    ]);

    const result = runCLI([
      "--node", "testnet",
      "permissioned-domain", "update",
      "--domain-id", domainId,
      "--credentials-json", credsJson,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Domain ID: ${domainId}`);
    expect(result.stdout).toContain("Tx:");
  }, 120_000);

  it.concurrent("verifies updated credentials via account_objects", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    // Update with a different credential type
    const updateResult = runCLI([
      "--node", "testnet",
      "permissioned-domain", "update",
      "--domain-id", domainId,
      "--credential", `${credIssuer.address}:ACCREDITED`,
      "--seed", owner.seed!,
    ]);
    expect(updateResult.status, `stdout: ${updateResult.stdout}\nstderr: ${updateResult.stderr}`).toBe(0);

    // Verify on-chain state
    const res = await resilientRequest(client, {
      command: "account_objects",
      account: owner.address,
      type: "permissioned_domain",
      ledger_index: "validated",
    } as AccountObjectsRequest);

    const domainObj = res.result.account_objects.find(
      (o) => (o as { index?: string }).index === domainId
    );
    expect(domainObj).toBeDefined();
  }, 120_000);

  it.concurrent("--json outputs {result, domainId, tx}", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    const result = runCLI([
      "--node", "testnet",
      "permissioned-domain", "update",
      "--domain-id", domainId,
      "--credential", `${credIssuer.address}:JSON_UPDATE`,
      "--seed", owner.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      result: string;
      domainId: string;
      tx: string;
    };
    expect(out.result).toBe("success");
    expect(out.domainId.toUpperCase()).toBe(domainId.toUpperCase());
    expect(out.tx).toMatch(/^[0-9A-Fa-f]{64}$/);
  }, 120_000);

  it.concurrent("--dry-run prints signed tx JSON without submitting", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    const result = runCLI([
      "--node", "testnet",
      "permissioned-domain", "update",
      "--domain-id", domainId,
      "--credential", `${credIssuer.address}:DRY_UPDATE`,
      "--seed", owner.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; DomainID: string };
    };
    expect(out.tx.TransactionType).toBe("PermissionedDomainSet");
    expect(out.tx.DomainID.toUpperCase()).toBe(domainId.toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    const result = runCLI([
      "--node", "testnet",
      "permissioned-domain", "update",
      "--domain-id", domainId,
      "--credential", `${credIssuer.address}:NOWAIT_UPDATE`,
      "--seed", owner.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 90_000);

  it.concurrent("--account/--keystore/--password key material updates domain successfully", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        owner.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", "testnet",
        "permissioned-domain", "update",
        "--domain-id", domainId,
        "--credential", `${credIssuer.address}:ACCT_UPDATE`,
        "--account", owner.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`Domain ID: ${domainId}`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
