import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 9 mint tests concurrent × 1 wallet each = 9 wallets; +2 buffer = 11
// Budget: 11 × 0.2 + 9 × 3 XRP = 2.2 + 27 = 29.2 ≤ 99 ✓
const TICKET_COUNT = 11;
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

// ─── nft mint ────────────────────────────────────────────────────────────────

describe("nft mint", () => {
  it.concurrent("mints an NFT with --taxon only and prints NFTokenID", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "42",
      "--seed", minter.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toMatch(/NFTokenID:\s+[0-9A-F]{64}/i);
  }, 120_000);

  it.concurrent("mints an NFT with --uri and verifies it appears in account nfts", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "1",
      "--uri", "https://example.com/nft-metadata.json",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { result: string; nftokenId: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.nftokenId).toMatch(/^[0-9A-F]{64}$/i);

    const nftsResult = runCLI([
      "--node", XRPL_WS,
      "account", "nfts",
      "--json",
      minter.address,
    ]);
    expect(nftsResult.status).toBe(0);
    const nfts = JSON.parse(nftsResult.stdout) as Array<{ NFTokenID: string }>;
    expect(nfts.some((n) => n.NFTokenID === out.nftokenId)).toBe(true);
  }, 120_000);

  it.concurrent("mints an NFT with --transfer-fee and --transferable", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--transferable",
      "--transfer-fee", "1000",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { result: string; nftokenId: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.nftokenId).toMatch(/^[0-9A-F]{64}$/i);
  }, 120_000);

  it.concurrent("--json outputs structured JSON with nftokenId", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number; nftokenId: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(out.nftokenId).toMatch(/^[0-9A-F]{64}$/i);
  }, 120_000);

  it.concurrent("--dry-run outputs tx_blob and tx without submitting", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--seed", minter.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; NFTokenTaxon: number } };
    expect(out.tx.TransactionType).toBe("NFTokenMint");
    expect(out.tx.NFTokenTaxon).toBe(0);
    expect(typeof out.tx_blob).toBe("string");
  }, 120_000);

  it.concurrent("--burnable flag sets tfBurnable in dry-run tx Flags", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--burnable",
      "--seed", minter.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Flags?: number } };
    expect(out.tx.Flags).toBeDefined();
    // tfBurnable = 0x00000001 = 1
    expect(out.tx.Flags! & 0x00000001).not.toBe(0);
  }, 120_000);

  it.concurrent("--only-xrp flag sets tfOnlyXRP in dry-run tx Flags", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--only-xrp",
      "--seed", minter.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Flags?: number } };
    expect(out.tx.Flags).toBeDefined();
    // tfOnlyXRP = 0x00000002 = 2
    expect(out.tx.Flags! & 0x00000002).not.toBe(0);
  }, 120_000);

  it.concurrent("--mutable flag sets tfMutable in dry-run tx Flags", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--mutable",
      "--seed", minter.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Flags?: number } };
    expect(out.tx.Flags).toBeDefined();
    // tfMutable = 0x00000010 = 16
    expect(out.tx.Flags! & 0x00000010).not.toBe(0);
  }, 120_000);

  it.concurrent("--no-wait exits 0 and outputs a 64-char hex hash", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--seed", minter.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 120_000);
});
