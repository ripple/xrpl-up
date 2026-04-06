import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 18 tests concurrent × 1 wallet each = 18 wallets; +2 buffer = 20
// Budget: 20 × 0.2 + 18 × 4 XRP = 4 + 72 = 76 ≤ 99 ✓
const TICKET_COUNT = 20;
const FUND_AMOUNT = 4;

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

// ─── oracle set ───────────────────────────────────────────────────────────────

describe("oracle set", () => {
  it.concurrent("creates an oracle with --price and prints tesSUCCESS", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("creates an oracle with --price-data JSON", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const priceData = JSON.stringify([
      { BaseAsset: "ETH", QuoteAsset: "USD", AssetPrice: 3000000, Scale: 6 },
      { BaseAsset: "BTC", QuoteAsset: "USD", AssetPrice: 60000000, Scale: 6 },
    ]);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price-data", priceData,
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("updates an oracle price (uses same document-id)", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "XRP/USD:5000:6",
      "--provider", "chainlink",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);

    const updateResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "XRP/USD:5500:6",
      "--seed", oracle.seed!,
    ]);
    expect(updateResult.status, `update: ${updateResult.stderr}`).toBe(0);
    expect(updateResult.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("--last-update-time override is accepted", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const ts = Math.floor(Date.now() / 1000);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "SOL/USD:200000:6",
      "--provider", "test",
      "--asset-class", "currency",
      "--last-update-time", String(ts),
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("--json outputs structured JSON", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--json",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 120_000);

  it.concurrent("--dry-run prints tx_blob and tx without submitting", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--dry-run",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; OracleDocumentID: number } };
    expect(out.tx.TransactionType).toBe("OracleSet");
    expect(out.tx.OracleDocumentID).toBe(1);
    expect(typeof out.tx_blob).toBe("string");
  }, 120_000);

  it.concurrent("--no-wait exits 0 and outputs a hash", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--no-wait",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 120_000);

  it.concurrent("--provider-hex sets provider without encoding", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const pythHex = Buffer.from("pyth").toString("hex");
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider-hex", pythHex,
      "--asset-class", "currency",
      "--dry-run",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Provider?: string } };
    expect(out.tx.Provider?.toUpperCase()).toBe(pythHex.toUpperCase());
  }, 120_000);

  it.concurrent("--asset-class-hex sets asset class without encoding", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const currencyHex = Buffer.from("currency").toString("hex");
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class-hex", currencyHex,
      "--dry-run",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { AssetClass?: string } };
    expect(out.tx.AssetClass?.toUpperCase()).toBe(currencyHex.toUpperCase());
  }, 120_000);

  it.concurrent("price pair without scale defaults to Scale 0 in dry-run", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--dry-run",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx: { PriceDataSeries: Array<{ PriceData: { Scale?: number } }> };
    };
    expect(out.tx.PriceDataSeries[0].PriceData.Scale).toBe(0);
  }, 120_000);
});

// ─── oracle get ───────────────────────────────────────────────────────────────

describe("oracle get", () => {
  it.concurrent("returns human-readable price pairs with decoded provider and asset class", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const setupResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--price", "ETH/USD:3000000:9",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(setupResult.status, `setup: ${setupResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "get",
      oracle.address,
      "1",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("pyth");
    expect(result.stdout).toContain("currency");
    expect(result.stdout).toMatch(/BTC\/USD/);
    expect(result.stdout).toMatch(/ETH\/USD/);
    expect(result.stdout).toContain("1");
  }, 120_000);

  it.concurrent("--json outputs raw ledger entry as JSON", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const setupResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(setupResult.status, `setup: ${setupResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "get",
      oracle.address,
      "1",
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      node: {
        LedgerEntryType: string;
        OracleDocumentID: number;
        PriceDataSeries: unknown[];
      };
    };
    expect(out.node.LedgerEntryType).toBe("Oracle");
    expect(out.node.OracleDocumentID).toBe(1);
    expect(Array.isArray(out.node.PriceDataSeries)).toBe(true);
  }, 120_000);

  it.concurrent("returns error for non-existent oracle", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "get",
      oracle.address,
      "9999",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/error/i);
  }, 120_000);

  it.concurrent("--node option is accepted on oracle get", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const setupResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(setupResult.status, `setup: ${setupResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "wss://s.altnet.rippletest.net:51233",
      "oracle", "get",
      oracle.address,
      "1",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("pyth");
  }, 120_000);
});

// ─── oracle delete ────────────────────────────────────────────────────────────

describe("oracle delete", () => {
  it.concurrent("creates then deletes an oracle; get returns not-found", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "BTC/USD:155000:6",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);
    expect(createResult.stdout).toContain("tesSUCCESS");

    const deleteResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "delete",
      "--document-id", "1",
      "--seed", oracle.seed!,
    ]);
    expect(deleteResult.status, `delete: ${deleteResult.stderr}`).toBe(0);
    expect(deleteResult.stdout).toContain("tesSUCCESS");

    const getResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "get",
      oracle.address,
      "1",
    ]);
    expect(getResult.status).toBe(1);
    expect(getResult.stderr).toMatch(/error|not found|entryNotFound/i);
  }, 120_000);

  it.concurrent("--json outputs structured JSON on delete", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "ETH/USD:3000:3",
      "--provider", "pyth",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);

    const deleteResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "delete",
      "--document-id", "1",
      "--json",
      "--seed", oracle.seed!,
    ]);
    expect(deleteResult.status, `delete: ${deleteResult.stderr}`).toBe(0);
    const out = JSON.parse(deleteResult.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 120_000);

  it.concurrent("--dry-run on delete prints tx_blob without submitting", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "oracle", "delete",
      "--document-id", "99",
      "--dry-run",
      "--seed", oracle.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; OracleDocumentID: number } };
    expect(out.tx.TransactionType).toBe("OracleDelete");
    expect(out.tx.OracleDocumentID).toBe(99);
    expect(typeof out.tx_blob).toBe("string");
  }, 120_000);

  it.concurrent("--no-wait on delete exits 0 and outputs hash", async () => {
    const [oracle] = await createFunded(client, master, 1, FUND_AMOUNT);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "set",
      "--document-id", "1",
      "--price", "XRP/USD:5000:6",
      "--provider", "test",
      "--asset-class", "currency",
      "--seed", oracle.seed!,
    ]);
    expect(createResult.status, `create: ${createResult.stderr}`).toBe(0);

    const deleteResult = runCLI([
      "--node", XRPL_WS,
      "oracle", "delete",
      "--document-id", "1",
      "--no-wait",
      "--seed", oracle.seed!,
    ]);
    expect(deleteResult.status, `delete: ${deleteResult.stderr}`).toBe(0);
    expect(deleteResult.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 120_000);
});
