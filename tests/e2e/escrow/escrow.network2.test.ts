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

// Fulfillment: preimage is 32 zero bytes
const TEST_FULFILLMENT =
  "A02280200000000000000000000000000000000000000000000000000000000000000000";

// 12 tests × 2 wallets = 24 wallets; +2 buffer = 26 tickets
// Budget: 26 × 0.2 + 24 × 3 XRP = 5.2 + 72 = 77.2 ≤ 99 ✓
const TICKET_COUNT = 26;
const FUND_AMOUNT = 3;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

// ---------------------------------------------------------------------------
// escrow finish
// ---------------------------------------------------------------------------
describe("escrow finish", () => {
  it.concurrent("finishes a time-based escrow and prints tesSUCCESS", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 16_000));

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "finish",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--seed", sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("finishes a crypto-condition escrow with --condition and --fulfillment", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--condition", TEST_CONDITION,
      "--cancel-after", new Date(Date.now() + 600_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "finish",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--condition", TEST_CONDITION,
      "--fulfillment", TEST_FULFILLMENT,
      "--seed", sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("--json output includes hash, result, fee, ledger", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 16_000));

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "finish",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 120_000);

  it.concurrent("--no-wait exits 0 and output contains 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 16_000));

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "finish",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--seed", sender.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 120_000);

  it.concurrent("--dry-run outputs JSON with TransactionType EscrowFinish and does not submit", async () => {
    const [sender] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "finish",
      "--owner", sender.address,
      "--sequence", "1",
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; OfferSequence: number } };
    expect(out.tx.TransactionType).toBe("EscrowFinish");
    expect(typeof out.tx_blob).toBe("string");
    expect(out.tx.OfferSequence).toBe(1);
  }, 120_000);

  it.concurrent("--dry-run with --condition and --fulfillment sets fields in tx", async () => {
    const [sender] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "finish",
      "--owner", sender.address,
      "--sequence", "1",
      "--condition", TEST_CONDITION,
      "--fulfillment", TEST_FULFILLMENT,
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Condition?: string; Fulfillment?: string } };
    expect(out.tx.Condition).toBe(TEST_CONDITION);
    expect(out.tx.Fulfillment).toBe(TEST_FULFILLMENT);
  }, 120_000);

  it.concurrent("--account/--keystore/--password key material finishes successfully", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 15_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 16_000));

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
        "--node", XRPL_WS,
        "escrow", "finish",
        "--owner", sender.address,
        "--sequence", String(sequence),
        "--account", sender.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// escrow cancel
// ---------------------------------------------------------------------------
describe("escrow cancel", () => {
  it.concurrent("cancels an expired escrow and prints tesSUCCESS", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 30_000).toISOString(),
      "--cancel-after", new Date(Date.now() + 45_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 50_000));

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "cancel",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--seed", sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("--json output includes hash, result, fee, ledger", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 30_000).toISOString(),
      "--cancel-after", new Date(Date.now() + 45_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 50_000));

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "cancel",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 120_000);

  it.concurrent("--dry-run outputs JSON with TransactionType EscrowCancel and does not submit", async () => {
    const [sender] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "cancel",
      "--owner", sender.address,
      "--sequence", "1",
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; OfferSequence: number } };
    expect(out.tx.TransactionType).toBe("EscrowCancel");
    expect(typeof out.tx_blob).toBe("string");
    expect(out.tx.OfferSequence).toBe(1);
  }, 120_000);

  it.concurrent("--no-wait exits 0 and output contains 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 30_000).toISOString(),
      "--cancel-after", new Date(Date.now() + 45_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 50_000));

    const result = runCLI([
      "--node", XRPL_WS,
      "escrow", "cancel",
      "--owner", sender.address,
      "--sequence", String(sequence),
      "--seed", sender.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 120_000);

  it.concurrent("--account/--keystore/--password key material cancels successfully", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "escrow", "create",
      "--to", receiver.address,
      "--amount", "1",
      "--finish-after", new Date(Date.now() + 30_000).toISOString(),
      "--cancel-after", new Date(Date.now() + 45_000).toISOString(),
      "--seed", sender.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequence } = JSON.parse(createResult.stdout) as { sequence: number };

    await new Promise((r) => setTimeout(r, 50_000));

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
        "--node", XRPL_WS,
        "escrow", "cancel",
        "--owner", sender.address,
        "--sequence", String(sequence),
        "--account", sender.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
