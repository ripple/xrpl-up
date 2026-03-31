import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import { fundMaster, initTicketPool, createFunded, resilientSubmitAndWait, XRPL_WS } from "../helpers/fund";

// Budget: 12 tickets × 0.2 + 10 wallets × 5 XRP = 2.4 + 50 = 52.4 XRP ≤ 99 ✓
// 5 tests × 2 wallets (issuer + lp) = 10 wallets total

let client: Client;
let master: Wallet;

async function ensureConnected(): Promise<void> {
  if (!client.isConnected()) {
    await client.disconnect().catch(() => {});
    await client.connect();
  }
}

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, 12);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

/**
 * Set up trust line + IOU funding using the shared client.
 * Returns the IOU asset spec string: "CURRENCY/issuer".
 */
async function setupPool(
  issuer: Wallet,
  lp: Wallet,
  currency = "USD"
): Promise<string> {
  await ensureConnected();
  // Enable DefaultRipple on issuer so AMM transactions don't fail with terNO_RIPPLE
  const acctSetFilled = await client.autofill({
    TransactionType: "AccountSet",
    Account: issuer.address,
    SetFlag: 8, // asfDefaultRipple
  });
  acctSetFilled.LastLedgerSequence = (acctSetFilled.LastLedgerSequence ?? 0) + 200;
  const acctSetResult = await resilientSubmitAndWait(
    client, issuer.sign(acctSetFilled).tx_blob
  );
  expect((acctSetResult.result.meta as { TransactionResult: string }).TransactionResult).toBe("tesSUCCESS");

  const trustSetFilled = await client.autofill({
    TransactionType: "TrustSet",
    Account: lp.address,
    LimitAmount: { currency, issuer: issuer.address, value: "1000000" },
  });
  trustSetFilled.LastLedgerSequence = (trustSetFilled.LastLedgerSequence ?? 0) + 200;
  await resilientSubmitAndWait(client, lp.sign(trustSetFilled).tx_blob);

  const paymentFilled = await client.autofill({
    TransactionType: "Payment",
    Account: issuer.address,
    Destination: lp.address,
    Amount: { currency, issuer: issuer.address, value: "100000" },
  });
  paymentFilled.LastLedgerSequence = (paymentFilled.LastLedgerSequence ?? 0) + 200;
  await resilientSubmitAndWait(client, issuer.sign(paymentFilled).tx_blob);
  return `${currency}/${issuer.address}`;
}

describe("amm bid", () => {
  it.concurrent(
    "bid on auction slot: exits 0 and reports tesSUCCESS",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", "testnet",
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ], {}, 180_000);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // lp holds LP tokens from pool creation; bid on the auction slot
      const result = runCLI([
        "--node", "testnet",
        "amm", "bid",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--seed", lp.seed!,
      ], {}, 180_000);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    },
    300_000
  );

  it.concurrent(
    "--json output includes hash and result",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", "testnet",
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ], {}, 180_000);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", "testnet",
        "amm", "bid",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--json",
        "--seed", lp.seed!,
      ], {}, 180_000);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as { hash: string; result: string };
      expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
      expect(out.result).toBe("tesSUCCESS");
    },
    300_000
  );

  it.concurrent(
    "--dry-run: prints AMMBid tx JSON without submitting",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", "testnet",
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ], {}, 180_000);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", "testnet",
        "amm", "bid",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--dry-run",
        "--seed", lp.seed!,
      ], {}, 180_000);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as {
        tx_blob: string;
        tx: { TransactionType: string };
      };
      expect(out.tx.TransactionType).toBe("AMMBid");
      expect(typeof out.tx_blob).toBe("string");
    },
    300_000
  );
});

describe("amm vote", () => {
  it.concurrent(
    "vote on trading fee: new fee reflected in amm info",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", "testnet",
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ], {}, 180_000);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // lp votes for a new trading fee
      const voteResult = runCLI([
        "--node", "testnet",
        "amm", "vote",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--trading-fee", "500",
        "--seed", lp.seed!,
      ], {}, 180_000);
      expect(voteResult.status, `vote stderr: ${voteResult.stderr}`).toBe(0);
      expect(voteResult.stdout).toContain("tesSUCCESS");

      // Verify new fee via amm info (lp is sole LP holder so vote sets fee exactly)
      const infoResult = runCLI([
        "--node", "testnet",
        "amm", "info",
        "--asset", "XRP",
        "--asset2", iouSpec,
      ], {}, 180_000);
      expect(infoResult.status).toBe(0);
      expect(infoResult.stdout).toContain("500");
    },
    300_000
  );

  it.concurrent(
    "--dry-run: prints AMMVote tx JSON without submitting",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", "testnet",
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ], {}, 180_000);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", "testnet",
        "amm", "vote",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--trading-fee", "400",
        "--dry-run",
        "--seed", lp.seed!,
      ], {}, 180_000);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as {
        tx_blob: string;
        tx: { TransactionType: string; TradingFee: number };
      };
      expect(out.tx.TransactionType).toBe("AMMVote");
      expect(out.tx.TradingFee).toBe(400);
      expect(typeof out.tx_blob).toBe("string");
    },
    300_000
  );
});
