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

// 6 tests, each needs 1 owner + 1 credIssuer = 2 wallets per test
// Total wallets: 12; +6 buffer = 18 tickets
// Budget: 18 × 0.2 + 12 × 3 = 3.6 + 36 = 39.6 ≤ 99 ✓
const TICKET_COUNT = 18;

let client: Client;
let master: Wallet;

/**
 * Helper: create a domain via CLI and return its domain ID.
 */
function createDomain(ownerSeed: string, credentialArg: string): string {
  const result = runCLI([
    "--node", XRPL_WS,
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
  client = new Client(XRPL_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

describe("permissioned-domain delete", () => {
  it.concurrent("deletes a domain and outputs Deleted domain + Tx", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "delete",
      "--domain-id", domainId,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Deleted domain: ${domainId.toUpperCase()}`);
    expect(result.stdout).toContain("Tx:");
  }, 120_000);

  it.concurrent("verifies domain is gone via account_objects after delete", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:KYC`);

    const deleteResult = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "delete",
      "--domain-id", domainId,
      "--seed", owner.seed!,
    ]);
    expect(deleteResult.status, `stdout: ${deleteResult.stdout}\nstderr: ${deleteResult.stderr}`).toBe(0);

    // Verify domain is gone on-chain
    const res = await resilientRequest(client, {
      command: "account_objects",
      account: owner.address,
      type: "permissioned_domain",
      ledger_index: "validated",
    } as AccountObjectsRequest);

    const domainObj = res.result.account_objects.find(
      (o) => (o as { index?: string }).index === domainId
    );
    expect(domainObj).toBeUndefined();
  }, 120_000);

  it.concurrent("--json outputs {result, domainId, tx}", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:JSON_DEL`);

    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "delete",
      "--domain-id", domainId,
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
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:DRY_DEL`);

    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "delete",
      "--domain-id", domainId,
      "--seed", owner.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; DomainID: string };
    };
    expect(out.tx.TransactionType).toBe("PermissionedDomainDelete");
    expect(out.tx.DomainID.toUpperCase()).toBe(domainId.toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
  }, 120_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:NOWAIT_DEL`);

    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "delete",
      "--domain-id", domainId,
      "--seed", owner.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 120_000);

  it.concurrent("--account/--keystore/--password key material deletes domain successfully", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const domainId = createDomain(owner.seed!, `${credIssuer.address}:ACCT_DEL`);
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
        "--node", XRPL_WS,
        "permissioned-domain", "delete",
        "--domain-id", domainId,
        "--account", owner.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("Deleted domain:");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
