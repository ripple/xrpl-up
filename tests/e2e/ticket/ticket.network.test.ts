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

// 10 tests concurrent × 1 wallet each = 10 wallets; +2 buffer = 12
// Budget: 12 × 0.2 + 10 × 5 XRP = 2.4 + 50 = 52.4 ≤ 99 ✓
const TICKET_COUNT = 12;
const FUND_AMOUNT = 5;

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

// ─── ticket create ────────────────────────────────────────────────────────────

describe("ticket create", () => {
  it.concurrent("creates 1 ticket and verifies via ticket list", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "1",
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toContain("Tickets:");

    const listResult = runCLI([
      "--node", XRPL_WS,
      "ticket", "list",
      wallet.address,
    ]);
    expect(listResult.status, `stdout: ${listResult.stdout}\nstderr: ${listResult.stderr}`).toBe(0);
    expect(listResult.stdout).toContain("Ticket sequence:");
  }, 90_000);

  it.concurrent("creates multiple tickets and count matches --count", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "3",
      "--seed", wallet.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { result: string; sequences: number[] };
    expect(out.result).toBe("tesSUCCESS");
    expect(Array.isArray(out.sequences)).toBe(true);
    expect(out.sequences).toHaveLength(3);
  }, 90_000);

  it.concurrent("--json outputs hash, result, sequences fields", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "2",
      "--seed", wallet.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; sequences: number[] };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
    expect(Array.isArray(out.sequences)).toBe(true);
    expect(out.sequences).toHaveLength(2);
    for (const seq of out.sequences) {
      expect(typeof seq).toBe("number");
    }
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType TicketCreate and does not submit", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "1",
      "--seed", wallet.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; TicketCount: number } };
    expect(out.tx.TransactionType).toBe("TicketCreate");
    expect(out.tx.TicketCount).toBe(1);
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait exits 0 and output contains 64-char hex hash", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "1",
      "--seed", wallet.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--account + --keystore + --password key material creates successfully", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        wallet.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", XRPL_WS,
        "ticket", "create",
        "--count", "1",
        "--account", wallet.address,
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

// ─── ticket list ──────────────────────────────────────────────────────────────

describe("ticket list", () => {
  it.concurrent("lists tickets for an account with correct format", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    // Create 3 tickets so we have something to list
    const createResult = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "3",
      "--seed", wallet.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequences } = JSON.parse(createResult.stdout) as { sequences: number[] };

    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "list",
      wallet.address,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Ticket sequence:");
    for (const seq of sequences) {
      expect(result.stdout).toContain(`Ticket sequence: ${seq}`);
    }
  }, 90_000);

  it.concurrent("--json outputs JSON array with sequence field", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "3",
      "--seed", wallet.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequences } = JSON.parse(createResult.stdout) as { sequences: number[] };

    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "list",
      wallet.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const tickets = JSON.parse(result.stdout) as Array<{ sequence: number }>;
    expect(Array.isArray(tickets)).toBe(true);
    expect(tickets.length).toBeGreaterThanOrEqual(3);
    for (const seq of sequences) {
      expect(tickets.some((t) => t.sequence === seq)).toBe(true);
    }
    for (const t of tickets) {
      expect(typeof t.sequence).toBe("number");
    }
  }, 90_000);

  it.concurrent("shows 'No tickets.' for an account with none", async () => {
    // Fresh funded wallet — has no tickets yet
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "ticket", "list",
      wallet.address,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim()).toBe("No tickets.");
  }, 90_000);

  it.concurrent("count of listed tickets matches --count used to create", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "ticket", "create",
      "--count", "3",
      "--seed", wallet.seed!,
      "--json",
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    const { sequences } = JSON.parse(createResult.stdout) as { sequences: number[] };

    const listResult = runCLI([
      "--node", XRPL_WS,
      "ticket", "list",
      wallet.address,
      "--json",
    ]);
    expect(listResult.status, `list: ${listResult.stderr}`).toBe(0);
    const tickets = JSON.parse(listResult.stdout) as Array<{ sequence: number }>;
    expect(tickets.length).toBeGreaterThanOrEqual(3);
    for (const seq of sequences) {
      expect(tickets.some((t) => t.sequence === seq)).toBe(true);
    }
  }, 90_000);
});
