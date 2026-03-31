import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// Budget: 35 tickets × 0.2 = 7 XRP; 31 wallets × 2 XRP = 62 XRP; total 69 ≤ 99 ✓
// create: 9 wallets, cancel: 5, accept: 13, list: 4 = 31 wallets
const TICKET_COUNT = 35;
const FUND_AMOUNT = 2;

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

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Mint a transferable NFT and return its NFTokenID */
function mintNFT(wallet: Wallet): string {
  const result = runCLI([
    "--node", "testnet",
    "nft", "mint",
    "--taxon", "0",
    "--transferable",
    "--seed", wallet.seed!,
    "--json",
  ]);
  expect(result.status, `mint stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { result: string; nftokenId: string };
  expect(out.result).toBe("tesSUCCESS");
  return out.nftokenId;
}

/** Create a sell offer and return the offer ID */
function createSellOffer(wallet: Wallet, nftokenId: string, amountXrp: string): string {
  const result = runCLI([
    "--node", "testnet",
    "nft", "offer", "create",
    "--nft", nftokenId,
    "--amount", amountXrp,
    "--sell",
    "--seed", wallet.seed!,
    "--json",
  ]);
  expect(result.status, `sell offer stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { result: string; offerId: string };
  expect(out.result).toBe("tesSUCCESS");
  return out.offerId;
}

/** Create a buy offer and return the offer ID */
function createBuyOffer(wallet: Wallet, nftokenId: string, amountXrp: string, ownerAddress: string): string {
  const result = runCLI([
    "--node", "testnet",
    "nft", "offer", "create",
    "--nft", nftokenId,
    "--amount", amountXrp,
    "--owner", ownerAddress,
    "--seed", wallet.seed!,
    "--json",
  ]);
  expect(result.status, `buy offer stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { result: string; offerId: string };
  expect(out.result).toBe("tesSUCCESS");
  return out.offerId;
}

// ─── nft offer create ────────────────────────────────────────────────────────

describe("nft offer create", () => {
  it.concurrent("creates a sell offer and prints OfferID", async () => {
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "10",
      "--sell",
      "--seed", seller.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toMatch(/OfferID:\s+[0-9A-Fa-f]{64}/i);
  }, 90_000);

  it.concurrent("creates a buy offer and prints OfferID", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "0.1",
      "--owner", seller.address,
      "--seed", buyer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toMatch(/OfferID:\s+[0-9A-Fa-f]{64}/i);
  }, 90_000);

  it.concurrent("--expiration sets future expiration and succeeds", async () => {
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);

    const expiration = new Date(Date.now() + 3600 * 1000).toISOString();

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "1",
      "--sell",
      "--expiration", expiration,
      "--seed", seller.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { result: string; offerId: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.offerId).toMatch(/^[0-9A-Fa-f]{64}$/i);
  }, 90_000);

  it.concurrent("--json outputs structured JSON with offerId", async () => {
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "10",
      "--sell",
      "--seed", seller.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number; offerId: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
    expect(out.offerId).toMatch(/^[0-9A-Fa-f]{64}$/i);
  }, 90_000);

  it.concurrent("--dry-run outputs tx_blob and tx without submitting", async () => {
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = "0".repeat(64);
    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "10",
      "--sell",
      "--seed", seller.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; NFTokenID: string; Amount: string; Flags: number };
    };
    expect(out.tx.TransactionType).toBe("NFTokenCreateOffer");
    expect(out.tx.NFTokenID).toBe("0".repeat(64).toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
    // tfSellNFToken = 1
    expect(out.tx.Flags & 0x00000001).not.toBe(0);
  }, 90_000);

  it.concurrent("--no-wait submits and outputs hash", async () => {
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "10",
      "--sell",
      "--seed", seller.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--destination restricts the offer acceptor", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "create",
      "--nft", nftokenId,
      "--amount", "5",
      "--sell",
      "--destination", buyer.address,
      "--seed", seller.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { result: string; offerId: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.offerId).toMatch(/^[0-9A-Fa-f]{64}$/i);
  }, 90_000);
});

// ─── nft offer cancel ────────────────────────────────────────────────────────

describe("nft offer cancel", () => {
  it.concurrent("cancels a single offer", async () => {
    const [account] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(account);
    const offerId = createSellOffer(account, nftokenId, "5");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "cancel",
      "--offer", offerId,
      "--seed", account.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("cancels multiple offers in one tx", async () => {
    const [account] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId1 = mintNFT(account);
    const nftokenId2 = mintNFT(account);
    const offerId1 = createSellOffer(account, nftokenId1, "1");
    const offerId2 = createSellOffer(account, nftokenId2, "2");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "cancel",
      "--offer", offerId1,
      "--offer", offerId2,
      "--seed", account.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json outputs structured JSON", async () => {
    const [account] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(account);
    const offerId = createSellOffer(account, nftokenId, "3");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "cancel",
      "--offer", offerId,
      "--seed", account.seed!,
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
    const [account] = await createFunded(client, master, 1, FUND_AMOUNT);
    const dummyOfferId = "B".repeat(64);
    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "cancel",
      "--offer", dummyOfferId,
      "--seed", account.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; NFTokenOffers: string[] };
    };
    expect(out.tx.TransactionType).toBe("NFTokenCancelOffer");
    expect(out.tx.NFTokenOffers).toEqual(["B".repeat(64).toUpperCase()]);
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits and outputs hash", async () => {
    const [account] = await createFunded(client, master, 1, FUND_AMOUNT);
    const nftokenId = mintNFT(account);
    const offerId = createSellOffer(account, nftokenId, "1");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "cancel",
      "--offer", offerId,
      "--seed", account.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});

// ─── nft offer accept ────────────────────────────────────────────────────────

describe("nft offer accept", () => {
  it.concurrent("accepts a sell offer (direct) — buyer accepts seller's sell offer", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);
    const sellOfferId = createSellOffer(seller, nftokenId, "0.01");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--sell-offer", sellOfferId,
      "--seed", buyer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("accepts a buy offer (direct) — seller accepts buyer's buy offer", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);
    const buyOfferId = createBuyOffer(buyer, nftokenId, "0.01", seller.address);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--buy-offer", buyOfferId,
      "--seed", seller.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("brokered mode — broker accepts both sell and buy offers (no fee)", async () => {
    // minter creates sell offer; buyer creates buy offer; broker executes the accept
    const [minter, buyer, broker] = await createFunded(client, master, 3, FUND_AMOUNT);
    const nftokenId = mintNFT(minter);
    const sellOfferId = createSellOffer(minter, nftokenId, "0.01");
    const buyOfferId = createBuyOffer(buyer, nftokenId, "0.02", minter.address);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--sell-offer", sellOfferId,
      "--buy-offer", buyOfferId,
      "--seed", broker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--broker-fee option is accepted and appears in dry-run tx", async () => {
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const dummySellOfferId = "A".repeat(64);
    const dummyBuyOfferId = "B".repeat(64);
    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--sell-offer", dummySellOfferId,
      "--buy-offer", dummyBuyOfferId,
      "--broker-fee", "1",
      "--seed", seller.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; NFTokenBrokerFee: string };
    };
    expect(out.tx.TransactionType).toBe("NFTokenAcceptOffer");
    expect(out.tx.NFTokenBrokerFee).toBe("1000000"); // 1 XRP = 1000000 drops
  }, 90_000);

  it.concurrent("--json outputs structured JSON", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);
    const sellOfferId = createSellOffer(seller, nftokenId, "0.01");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--sell-offer", sellOfferId,
      "--seed", buyer.seed!,
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
    const [seller] = await createFunded(client, master, 1, FUND_AMOUNT);
    const dummyOfferId = "A".repeat(64);
    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--sell-offer", dummyOfferId,
      "--seed", seller.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; NFTokenSellOffer: string };
    };
    expect(out.tx.TransactionType).toBe("NFTokenAcceptOffer");
    expect(out.tx.NFTokenSellOffer).toBe("A".repeat(64).toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits and outputs hash", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);
    const sellOfferId = createSellOffer(seller, nftokenId, "0.01");

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "accept",
      "--sell-offer", sellOfferId,
      "--seed", buyer.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});

// ─── nft offer list ──────────────────────────────────────────────────────────

describe("nft offer list", () => {
  it.concurrent("lists both sell and buy offers in human-readable output", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);
    const sellOfferId = createSellOffer(seller, nftokenId, "10");
    const buyOfferId = createBuyOffer(buyer, nftokenId, "0.1", seller.address);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "list",
      nftokenId,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Sell Offers");
    expect(result.stdout).toContain("Buy Offers");
    expect(result.stdout).toContain(sellOfferId);
    expect(result.stdout).toContain(buyOfferId);
    expect(result.stdout).toContain("Amount:");
    expect(result.stdout).toContain("Owner:");
    expect(result.stdout).toContain("Expiration:");
    expect(result.stdout).toContain("Destination:");
  }, 90_000);

  it.concurrent("--json outputs { sellOffers, buyOffers } with correct offer IDs", async () => {
    const [seller, buyer] = await createFunded(client, master, 2, FUND_AMOUNT);
    const nftokenId = mintNFT(seller);
    const sellOfferId = createSellOffer(seller, nftokenId, "10");
    const buyOfferId = createBuyOffer(buyer, nftokenId, "0.1", seller.address);

    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "list",
      nftokenId,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      sellOffers: Array<{ nft_offer_index: string; amount: string; owner: string }>;
      buyOffers: Array<{ nft_offer_index: string; amount: string; owner: string }>;
    };
    expect(Array.isArray(out.sellOffers)).toBe(true);
    expect(Array.isArray(out.buyOffers)).toBe(true);

    const foundSell = out.sellOffers.find((o) => o.nft_offer_index === sellOfferId);
    expect(foundSell, `sell offer ${sellOfferId} not in sellOffers`).toBeDefined();

    const foundBuy = out.buyOffers.find((o) => o.nft_offer_index === buyOfferId);
    expect(foundBuy, `buy offer ${buyOfferId} not in buyOffers`).toBeDefined();
  }, 90_000);

  it.concurrent("exits with error for invalid NFTokenID", () => {
    const result = runCLI([
      "--node", "testnet",
      "nft", "offer", "list",
      "notvalid",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});
