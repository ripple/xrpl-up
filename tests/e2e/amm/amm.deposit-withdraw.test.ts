import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import { fundMaster, initTicketPool, createFunded, resilientSubmitAndWait, XRPL_WS } from "../helpers/fund";

// Budget: 16 tickets × 0.2 + 12 wallets × 5 XRP = 3.2 + 60 = 63.2 XRP ≤ 99 ✓
// 6 tests × 2 wallets (issuer + lp) = 12 wallets total

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
  await initTicketPool(client, master, 16);
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

describe("amm deposit", () => {
  it.concurrent(
    "double-asset deposit (tfTwoAsset): deposits XRP and IOU into pool",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      // Create pool first
      const createResult = runCLI([
        "--node", XRPL_WS,
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ]);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // Deposit more assets (tfTwoAsset mode)
      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "deposit",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "50000",
        "--amount2", "5",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    },
    120_000
  );

  it.concurrent(
    "single-asset deposit (tfSingleAsset): deposits only XRP into pool",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", XRPL_WS,
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ]);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // Single-asset deposit: XRP only (tfSingleAsset mode)
      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "deposit",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "50000",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    },
    120_000
  );

  it.concurrent(
    "--dry-run: prints AMMDeposit tx JSON without submitting",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", XRPL_WS,
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ]);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "deposit",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "50000",
        "--amount2", "5",
        "--dry-run",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as {
        tx_blob: string;
        tx: { TransactionType: string };
      };
      expect(out.tx.TransactionType).toBe("AMMDeposit");
      expect(typeof out.tx_blob).toBe("string");
    },
    120_000
  );
});

describe("amm withdraw", () => {
  it.concurrent(
    "LP-token withdraw (tfLPToken): redeems LP tokens for both assets",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", XRPL_WS,
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ]);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // lp has LP tokens from pool creation; withdraw via CLI (tfLPToken mode)
      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "withdraw",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--lp-token-in", "1",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    },
    120_000
  );

  it.concurrent(
    "single-asset withdraw (tfSingleAsset): withdraws XRP from pool",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", XRPL_WS,
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ]);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // lp withdraws XRP from pool (tfSingleAsset mode, only --amount specified)
      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "withdraw",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "50000",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    },
    120_000
  );

  it.concurrent(
    "--json output includes hash and result",
    async () => {
      await ensureConnected();
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);

      const createResult = runCLI([
        "--node", XRPL_WS,
        "amm", "create",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--amount", "100000",
        "--amount2", "10",
        "--trading-fee", "300",
        "--seed", lp.seed!,
      ]);
      expect(createResult.status, `create stderr: ${createResult.stderr}`).toBe(0);

      // Deposit first via xrpl.js to ensure fresh LP tokens for this test
      await ensureConnected();
      const depositFilled = await client.autofill({
        TransactionType: "AMMDeposit",
        Account: lp.address,
        Asset: { currency: "XRP" },
        Asset2: { currency: "USD", issuer: issuer.address },
        Flags: 0x00080000, // tfSingleAsset
        Amount: "50000",
      });
      depositFilled.LastLedgerSequence = (depositFilled.LastLedgerSequence ?? 0) + 200;
      await resilientSubmitAndWait(client, lp.sign(depositFilled).tx_blob);

      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "withdraw",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--lp-token-in", "1",
        "--json",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as { hash: string; result: string };
      expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
      expect(out.result).toBe("tesSUCCESS");
    },
    120_000
  );
});
