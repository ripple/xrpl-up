import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet, convertHexToString } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 9 tests concurrent (4 burn + 5 modify) × 1 wallet each = 9 wallets; +2 buffer = 11
// Budget: 11 × 0.2 + 9 × 3 XRP = 2.2 + 27 = 29.2 ≤ 99 ✓
const TICKET_COUNT = 11;
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

// ─── nft burn ────────────────────────────────────────────────────────────────

describe("nft burn", () => {
  it.concurrent("mints then burns an NFT successfully", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--burnable",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    expect(mintOut.result).toBe("tesSUCCESS");
    const nftokenId = mintOut.nftokenId;
    expect(nftokenId).toMatch(/^[0-9A-F]{64}$/i);

    const burnResult = runCLI([
      "--node", XRPL_WS,
      "nft", "burn",
      "--nft", nftokenId,
      "--seed", minter.seed!,
    ]);
    expect(burnResult.status, `burn stdout: ${burnResult.stdout} stderr: ${burnResult.stderr}`).toBe(0);
    expect(burnResult.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json outputs structured JSON", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    const nftokenId = mintOut.nftokenId;

    const burnResult = runCLI([
      "--node", XRPL_WS,
      "nft", "burn",
      "--nft", nftokenId,
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(burnResult.status, `stdout: ${burnResult.stdout} stderr: ${burnResult.stderr}`).toBe(0);
    const out = JSON.parse(burnResult.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 90_000);

  it.concurrent("--dry-run outputs tx_blob and tx without submitting", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = "0".repeat(64);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "burn",
      "--nft", nftokenId,
      "--seed", minter.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; NFTokenID: string } };
    expect(out.tx.TransactionType).toBe("NFTokenBurn");
    expect(out.tx.NFTokenID).toBe("0".repeat(64).toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits and outputs hash", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    const nftokenId = mintOut.nftokenId;

    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "burn",
      "--nft", nftokenId,
      "--seed", minter.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});

// ─── nft modify ──────────────────────────────────────────────────────────────

describe("nft modify", () => {
  it.concurrent("mints with --mutable, modifies URI, verifies change via account nfts", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--mutable",
      "--uri", "https://example.com/original.json",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    expect(mintOut.result).toBe("tesSUCCESS");
    const nftokenId = mintOut.nftokenId;
    expect(nftokenId).toMatch(/^[0-9A-F]{64}$/i);

    const newUri = "https://example.com/updated.json";

    const modifyResult = runCLI([
      "--node", XRPL_WS,
      "nft", "modify",
      "--nft", nftokenId,
      "--uri", newUri,
      "--seed", minter.seed!,
    ]);
    expect(modifyResult.status, `modify stdout: ${modifyResult.stdout} stderr: ${modifyResult.stderr}`).toBe(0);
    expect(modifyResult.stdout).toContain("tesSUCCESS");

    const nftsResult = runCLI([
      "--node", XRPL_WS,
      "account", "nfts",
      "--json",
      minter.address,
    ]);
    expect(nftsResult.status).toBe(0);
    const nfts = JSON.parse(nftsResult.stdout) as Array<{ NFTokenID: string; URI?: string }>;
    const token = nfts.find((n) => n.NFTokenID === nftokenId);
    expect(token).toBeDefined();
    expect(convertHexToString(token!.URI!)).toBe(newUri);
  }, 90_000);

  it.concurrent("--json outputs structured JSON", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--mutable",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    const nftokenId = mintOut.nftokenId;

    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "modify",
      "--nft", nftokenId,
      "--uri", "https://example.com/json-test.json",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 90_000);

  it.concurrent("--dry-run outputs tx_blob and tx without submitting", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = "0".repeat(64);
    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "modify",
      "--nft", nftokenId,
      "--uri", "https://example.com/dry-run.json",
      "--seed", minter.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; NFTokenID: string; URI?: string } };
    expect(out.tx.TransactionType).toBe("NFTokenModify");
    expect(out.tx.NFTokenID).toBe("0".repeat(64).toUpperCase());
    expect(typeof out.tx.URI).toBe("string");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--clear-uri clears the URI of a mutable NFT", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--mutable",
      "--uri", "https://example.com/to-clear.json",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    const nftokenId = mintOut.nftokenId;

    const modifyResult = runCLI([
      "--node", XRPL_WS,
      "nft", "modify",
      "--nft", nftokenId,
      "--clear-uri",
      "--seed", minter.seed!,
    ]);
    expect(modifyResult.status, `modify stdout: ${modifyResult.stdout} stderr: ${modifyResult.stderr}`).toBe(0);
    expect(modifyResult.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--no-wait submits and outputs hash", async () => {
    const [minter] = await createFunded(client, master, 1, FUND_AMOUNT);

    const mintResult = runCLI([
      "--node", XRPL_WS,
      "nft", "mint",
      "--taxon", "0",
      "--mutable",
      "--seed", minter.seed!,
      "--json",
    ]);
    expect(mintResult.status, `mint stdout: ${mintResult.stdout} stderr: ${mintResult.stderr}`).toBe(0);
    const mintOut = JSON.parse(mintResult.stdout) as { result: string; nftokenId: string };
    const nftokenId = mintOut.nftokenId;

    const result = runCLI([
      "--node", XRPL_WS,
      "nft", "modify",
      "--nft", nftokenId,
      "--uri", "https://example.com/nowait.json",
      "--seed", minter.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});
