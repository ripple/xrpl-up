import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// PREIMAGE-SHA-256 condition for a 32-byte zero preimage
// SHA-256(0x00 * 32) = 66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925
const TEST_CONDITION =
  "A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120";

// 11 tests × 2 wallets = 22 wallets; +2 buffer = 24 tickets
// Budget: 24 × 0.2 + 22 × 3 XRP = 4.8 + 66 = 70.8 ≤ 99 ✓
const TICKET_COUNT = 24;
const FUND_AMOUNT = 3;

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

// ---------------------------------------------------------------------------
// escrow create
// ---------------------------------------------------------------------------
describe("escrow create", () => {
  it.concurrent("creates a time-based escrow with near-future FinishAfter and prints tesSUCCESS + sequence", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toMatch(/Sequence:/);
  }, 90_000);

  it.concurrent("creates an escrow with --cancel-after and prints tesSUCCESS", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--cancel-after", new Date(Date.now() + 300_000).toISOString(),
      "--seed", sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json output includes hash, result, sequence fields", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; sequence: number; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
    expect(typeof out.sequence).toBe("number");
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType EscrowCreate and does not submit", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "2",
      "--finish-after", new Date(Date.now() + 600_000).toISOString(),
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; Amount: string; FinishAfter: number } };
    expect(out.tx.TransactionType).toBe("EscrowCreate");
    expect(typeof out.tx_blob).toBe("string");
    expect(out.tx.Amount).toBe("2000000");
    expect(typeof out.tx.FinishAfter).toBe("number");
  }, 90_000);

  it.concurrent("--no-wait exits 0 and output contains 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--destination-tag appears in dry-run tx", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 600_000).toISOString(),
      "--destination-tag", "42",
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { DestinationTag?: number } };
    expect(out.tx.DestinationTag).toBe(42);
  }, 90_000);

  it.concurrent("--source-tag appears in dry-run tx", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 600_000).toISOString(),
      "--source-tag", "99",
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { SourceTag?: number } };
    expect(out.tx.SourceTag).toBe(99);
  }, 90_000);

  it.concurrent("--condition + --cancel-after appears in dry-run tx", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--condition", TEST_CONDITION,
      "--cancel-after", new Date(Date.now() + 600_000).toISOString(),
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Condition?: string; CancelAfter?: number } };
    expect(out.tx.Condition).toBe(TEST_CONDITION);
    expect(typeof out.tx.CancelAfter).toBe("number");
  }, 90_000);

  it.concurrent("--account + --keystore + --password key material creates successfully", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        sender.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `stdout: ${importResult.stdout} stderr: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", "testnet",
        "escrow", "create",
        "--to", receiver.address,
        "--amount", "1",
        "--finish-after", new Date(Date.now() + 15_000).toISOString(),
        "--account", sender.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// escrow list
// ---------------------------------------------------------------------------
describe("escrow list", () => {
  it.concurrent("lists pending escrows and shows sequence + amount + destination", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 300_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    const result = runCLI([
      "--node", "testnet",
      "escrow", "list",
      sender.address,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Sequence:    ${sequence}`);
    expect(result.stdout).toContain("1.000000 XRP");
    expect(result.stdout).toContain(receiver.address);
  }, 90_000);

  it.concurrent("--json outputs an array with the expected escrow entry", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", "testnet",
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 300_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    const result = runCLI([
      "--node", "testnet",
      "escrow", "list",
      sender.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const arr = JSON.parse(result.stdout) as Array<{
      sequence: number;
      amount: string;
      destination: string;
      finishAfter: string;
      cancelAfter: string;
      condition: string;
    }>;
    expect(Array.isArray(arr)).toBe(true);
    const entry = arr.find((e) => e.sequence === sequence);
    expect(entry).toBeDefined();
    expect(entry!.amount).toBe("1.000000");
    expect(entry!.destination).toBe(receiver.address);
    expect(entry!.finishAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry!.cancelAfter).toBe("none");
    expect(entry!.condition).toBe("none");
  }, 90_000);
});
