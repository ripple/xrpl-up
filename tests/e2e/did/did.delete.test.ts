import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 4 tests × 1 wallet each = 4 wallets; +3 buffer = 7 tickets
// Budget: 7 × 0.2 + 4 × 3 = 1.4 + 12 = 13.4 ≤ 99 ✓
const TICKET_COUNT = 7;

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

describe("did delete", () => {
  it.concurrent("creates DID then deletes it; did get returns not-found", async () => {
    const [owner] = await createFunded(client, master, 1, 3);

    // Create DID
    const createResult = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/delete-test",
      "--seed", owner.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    expect(createResult.stdout).toContain("tesSUCCESS");

    // Delete DID
    const deleteResult = runCLI([
      "--node", "testnet",
      "did", "delete",
      "--seed", owner.seed!,
    ]);
    expect(deleteResult.status, `delete stdout: ${deleteResult.stdout} stderr: ${deleteResult.stderr}`).toBe(0);
    expect(deleteResult.stdout).toContain("tesSUCCESS");

    // Verify DID is gone
    const getResult = runCLI([
      "--node", "testnet",
      "did", "get",
      owner.address,
    ]);
    expect(getResult.status).toBe(0);
    expect(getResult.stdout).toContain(`No DID found for ${owner.address}`);
  }, 90_000);

  it.concurrent("--json outputs structured result on delete", async () => {
    const [owner] = await createFunded(client, master, 1, 3);

    // Create DID first
    const createResult = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/json-delete",
      "--seed", owner.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);

    const deleteResult = runCLI([
      "--node", "testnet",
      "did", "delete",
      "--json",
      "--seed", owner.seed!,
    ]);
    expect(deleteResult.status, `delete stdout: ${deleteResult.stdout} stderr: ${deleteResult.stderr}`).toBe(0);
    const out = JSON.parse(deleteResult.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 90_000);

  it.concurrent("--dry-run prints tx_blob without submitting", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "did", "delete",
      "--dry-run",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("DIDDelete");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait exits 0 with a hash", async () => {
    const [owner] = await createFunded(client, master, 1, 3);

    // Create DID first to have something to delete
    runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/nowait-delete",
      "--seed", owner.seed!,
    ]);

    const result = runCLI([
      "--node", "testnet",
      "did", "delete",
      "--no-wait",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});
