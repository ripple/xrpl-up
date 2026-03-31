import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 5 tests and their wallet needs:
//   1. list shows issuance ID for issuer           → 1 issuer
//   2. list --json outputs JSON array              → 1 issuer
//   3. list shows 'No MPT issuances.' empty acct   → 1 empty account (no issuances)
//   4. get shows correct properties               → 1 issuer
//   5. get --json outputs raw JSON                → 1 issuer
// Total wallets: 5; +4 buffer = 9 tickets
// Budget: 9 × 0.2 + 5 × 3 = 1.8 + 15 = 16.8 ≤ 99 ✓
const TICKET_COUNT = 9;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 300_000);

afterAll(async () => {
  await client.disconnect();
});

describe("mptoken issuance list and get", () => {
  it.concurrent("list shows the issuance ID for the issuer account", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    // Create issuance via CLI
    const createResult = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "create",
      "--metadata", "query-list-token",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const idMatch = createResult.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID").toBeTruthy();
    const issuanceId = idMatch![1]!;

    const result = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "list",
      issuer.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(issuanceId);
  }, 90_000);

  it.concurrent("list --json outputs a JSON array containing the issuance", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    // Create issuance with known AssetScale
    const createResult = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "create",
      "--asset-scale", "2",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "list",
      issuer.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const arr = JSON.parse(result.stdout) as Array<{ Issuer: string; AssetScale?: number }>;
    expect(Array.isArray(arr)).toBe(true);
    const found = arr.find((iss) => iss.Issuer === issuer.address && iss.AssetScale === 2);
    expect(found, `Issuance for ${issuer.address} with AssetScale=2 not found in list`).toBeTruthy();
  }, 90_000);

  it.concurrent("list shows 'No MPT issuances.' for an account with no issuances", async () => {
    const [emptyAccount] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "list",
      emptyAccount.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("No MPT issuances.");
  }, 60_000);

  it.concurrent("get shows correct properties (Issuer, AssetScale, MaximumAmount, TransferFee, Metadata)", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    // Create issuance with known properties
    const createResult = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "create",
      "--metadata", "query-test-token",
      "--max-amount", "999999",
      "--asset-scale", "2",
      "--flags", "can-transfer",
      "--transfer-fee", "100",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const idMatch = createResult.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID").toBeTruthy();
    const issuanceId = idMatch![1]!;

    const result = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "get",
      issuanceId,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`MPTokenIssuanceID: ${issuanceId}`);
    expect(result.stdout).toContain("Issuer:");
    expect(result.stdout).toContain(issuer.address);
    expect(result.stdout).toContain("AssetScale:");
    expect(result.stdout).toContain("2");
    expect(result.stdout).toContain("MaximumAmount:");
    expect(result.stdout).toContain("999999");
    expect(result.stdout).toContain("TransferFee:");
    expect(result.stdout).toContain("100");
    expect(result.stdout).toContain("Metadata:");
    expect(result.stdout).toContain("query-test-token");
  }, 90_000);

  it.concurrent("get --json outputs raw JSON with node.Issuer and correct fields", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    // Create issuance with known properties
    const createResult = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "create",
      "--max-amount", "999999",
      "--asset-scale", "2",
      "--flags", "can-transfer",
      "--transfer-fee", "100",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const idMatch = createResult.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID").toBeTruthy();
    const issuanceId = idMatch![1]!;

    const result = runCLI([
      "--node", "testnet",
      "mptoken", "issuance", "get",
      issuanceId,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      node: {
        Issuer: string;
        AssetScale: number;
        MaximumAmount: string;
        TransferFee: number;
      };
    };
    expect(out.node.Issuer).toBe(issuer.address);
    expect(out.node.AssetScale).toBe(2);
    expect(out.node.MaximumAmount).toBe("999999");
    expect(out.node.TransferFee).toBe(100);
  }, 90_000);
});
