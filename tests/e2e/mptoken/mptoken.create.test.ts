import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 6 tests × 1 wallet each = 6 wallets; +4 buffer = 10 tickets
// Budget: 10 × 0.2 + 6 × 3 = 2 + 18 = 20 ≤ 99 ✓
const TICKET_COUNT = 10;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 300_000);

afterAll(async () => {
  await client.disconnect();
});

describe("mptoken issuance create", () => {
  it.concurrent("creates a basic issuance and prints MPTokenIssuanceID", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toContain("MPTokenIssuanceID:");
  }, 90_000);

  it.concurrent("creates an issuance with flags and transfer fee", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--flags", "can-transfer,can-clawback",
      "--transfer-fee", "500",
      "--max-amount", "1000000000",
      "--asset-scale", "6",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toContain("MPTokenIssuanceID:");

    // Extract issuance ID and verify with get
    const idMatch = result.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch).toBeTruthy();
    const issuanceId = idMatch![1];

    const getResult = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "get",
      issuanceId,
      "--json",
    ]);
    expect(getResult.status, `stdout: ${getResult.stdout} stderr: ${getResult.stderr}`).toBe(0);
    const entry = JSON.parse(getResult.stdout) as {
      node: {
        TransferFee: number;
        AssetScale: number;
        MaximumAmount: string;
      };
    };
    expect(entry.node.TransferFee).toBe(500);
    expect(entry.node.AssetScale).toBe(6);
    expect(entry.node.MaximumAmount).toBe("1000000000");
  }, 90_000);

  it.concurrent("creates an issuance with --metadata and verifies via get", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--metadata", "test-token-metadata",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toContain("MPTokenIssuanceID:");

    // Extract issuance ID and verify metadata via get
    const idMatch = result.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch).toBeTruthy();
    const issuanceId = idMatch![1];

    const getResult = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "get",
      issuanceId,
    ]);
    expect(getResult.status, `stdout: ${getResult.stdout} stderr: ${getResult.stderr}`).toBe(0);
    expect(getResult.stdout).toContain("test-token-metadata");
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger, issuanceId", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hash: string;
      result: string;
      fee: string;
      ledger: number;
      issuanceId: string;
    };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
    expect(typeof out.issuanceId).toBe("string");
    expect(out.issuanceId).toMatch(/^[0-9A-Fa-f]+$/i);
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType MPTokenIssuanceCreate", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("MPTokenIssuanceCreate");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting and outputs transaction hash", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 90_000);
});
