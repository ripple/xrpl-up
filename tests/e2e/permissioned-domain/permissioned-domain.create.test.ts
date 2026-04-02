import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import { mkdtempSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// NOTE: PermissionedDomains amendment is enabled on testnet.

// 7 tests, each needs 1 owner + 1 credIssuer = 2 wallets per test
// Total wallets: 14; +6 buffer = 20 tickets
// Budget: 20 × 0.2 + 14 × 3 = 4 + 42 = 46 ≤ 99 ✓
const TICKET_COUNT = 20;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

describe("permissioned-domain create", () => {
  it.concurrent("creates a domain with 1 credential via --credential", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "create",
      "--credential", `${credIssuer.address}:KYC`,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Domain ID:");
    expect(result.stdout).toContain("Tx:");
  }, 90_000);

  it.concurrent("creates a domain with 3 credentials via --credential", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "create",
      "--credential", `${credIssuer.address}:KYC`,
      "--credential", `${credIssuer.address}:AML`,
      "--credential", `${credIssuer.address}:ACCREDITED`,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Domain ID:");
  }, 90_000);

  it.concurrent("creates a domain via --credentials-json", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const credsJson = JSON.stringify([
      { issuer: credIssuer.address, credential_type: "4B5943" }, // "KYC" in hex
    ]);
    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "create",
      "--credentials-json", credsJson,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Domain ID:");
  }, 90_000);

  it.concurrent("--json outputs {result, domainId, tx}", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "create",
      "--credential", `${credIssuer.address}:JSON_TEST`,
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
    expect(out.domainId).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.tx).toBe("string");
    expect(out.tx).toMatch(/^[0-9A-Fa-f]{64}$/);
  }, 90_000);

  it.concurrent("--dry-run prints unsigned tx JSON without submitting", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "create",
      "--credential", `${credIssuer.address}:KYC_DRY`,
      "--seed", owner.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("PermissionedDomainSet");
    expect(typeof out.tx_blob).toBe("string");
  }, 60_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "permissioned-domain", "create",
      "--credential", `${credIssuer.address}:KYC_NOWAIT`,
      "--seed", owner.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 60_000);

  it.concurrent("--account/--keystore/--password key material creates domain successfully", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, 3);
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
        "permissioned-domain", "create",
        "--credential", `${credIssuer.address}:KYC_ACCT`,
        "--account", owner.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("Domain ID:");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});
