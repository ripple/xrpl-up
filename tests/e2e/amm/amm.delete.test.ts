import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import { fundMaster, initTicketPool, createFunded, resilientSubmitAndWait, XRPL_WS } from "../helpers/fund";

// Budget: 10 tickets × 0.2 + 8 wallets × 5 XRP = 2 + 40 = 42 XRP ≤ 99 ✓
// 4 tests × 2 wallets (issuer + lp) = 8 wallets total
// Tests run sequentially (plain `it`) because runCLI uses spawnSync which blocks
// the Node.js event loop, making concurrent WebSocket operations hang.

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, 10);
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
  // Enable DefaultRipple on issuer so AMM transactions don't fail with terNO_RIPPLE
  const acctSetFilled = await client.autofill({
    TransactionType: "AccountSet",
    Account: issuer.address,
    SetFlag: 8, // asfDefaultRipple
  });
  acctSetFilled.LastLedgerSequence = (acctSetFilled.LastLedgerSequence ?? 0) + 200;
  const acctSetResult = await resilientSubmitAndWait(client, issuer.sign(acctSetFilled).tx_blob);
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

/**
 * Create an AMM pool via xrpl.js directly (bypassing the CLI).
 * Delete tests test the delete command, not create.
 */
async function createPoolViaXrpl(lp: Wallet, issuer: Wallet, currency = "USD"): Promise<void> {
  const createFilled = await client.autofill({
    TransactionType: "AMMCreate",
    Account: lp.address,
    Amount: "100000",
    Amount2: { currency, issuer: issuer.address, value: "10" },
    TradingFee: 300,
  });
  createFilled.LastLedgerSequence = (createFilled.LastLedgerSequence ?? 0) + 200;
  const result = await resilientSubmitAndWait(client, lp.sign(createFilled).tx_blob);
  expect((result.result.meta as { TransactionResult: string }).TransactionResult).toBe("tesSUCCESS");
}

/**
 * Withdraw all LP tokens from the pool via xrpl.js (tfWithdrawAll).
 */
async function withdrawAllViaXrpl(lp: Wallet, issuer: Wallet, currency = "USD"): Promise<void> {
  const withdrawFilled = await client.autofill({
    TransactionType: "AMMWithdraw",
    Account: lp.address,
    Asset: { currency: "XRP" },
    Asset2: { currency, issuer: issuer.address },
    Flags: 0x00020000, // tfWithdrawAll
  });
  withdrawFilled.LastLedgerSequence = (withdrawFilled.LastLedgerSequence ?? 0) + 200;
  const result = await resilientSubmitAndWait(client, lp.sign(withdrawFilled).tx_blob);
  expect((result.result.meta as { TransactionResult: string }).TransactionResult).toBe("tesSUCCESS");
}

// AMMDelete can only be triggered when AMMWithdraw(tfWithdrawAll) returns
// tecINCOMPLETE, which requires >512 simultaneous LP token holders on the AMM
// account. With 1–2 funded test wallets, tfWithdrawAll auto-deletes the AMM
// entirely, so AMMDelete would return terNO_AMM. Creating 513+ funded testnet
// accounts via the faucet is impractical, so the submit+wait tests below are
// skipped until a feasible setup strategy is found.
//
// References:
//   https://xrpl.org/docs/references/protocol/transactions/types/ammdelete
//   https://xrpl.org/docs/references/protocol/transactions/transaction-results/ter-codes.md

describe("amm delete", () => {
  it.skip(
    "delete pool after withdrawing all LP tokens: exits 0 with tesSUCCESS",
    async () => {
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);
      await createPoolViaXrpl(lp, issuer);
      await withdrawAllViaXrpl(lp, issuer);
      // Allow 2 ledger closes for the validated ledger to propagate to all
      // testnet nodes. A CLI subprocess connecting immediately after may land
      // on a node that hasn't yet applied the latest validated ledger, causing
      // autofill to return a stale sequence (tefPAST_SEQ → txnNotFound forever).
      await new Promise(r => setTimeout(r, 10_000));

      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "delete",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--seed", lp.seed!,
      ], {}, 180_000);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    },
    300_000
  );

  it.skip(
    "--json output includes hash and result",
    async () => {
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);
      await createPoolViaXrpl(lp, issuer);
      await withdrawAllViaXrpl(lp, issuer);
      await new Promise(r => setTimeout(r, 10_000));

      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "delete",
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

  it(
    "--dry-run: prints AMMDelete tx JSON without submitting",
    async () => {
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);
      await createPoolViaXrpl(lp, issuer);

      // dry-run doesn't require pool to be empty
      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "delete",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--dry-run",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as {
        tx_blob: string;
        tx: { TransactionType: string };
      };
      expect(out.tx.TransactionType).toBe("AMMDelete");
      expect(typeof out.tx_blob).toBe("string");
    },
    300_000
  );

  it.skip(
    "--no-wait: exits 0 and output is a 64-char hex hash",
    async () => {
      const [issuer, lp] = await createFunded(client, master, 2, 5);
      const iouSpec = await setupPool(issuer, lp);
      await createPoolViaXrpl(lp, issuer);
      await withdrawAllViaXrpl(lp, issuer);
      await new Promise(r => setTimeout(r, 10_000));

      const result = runCLI([
        "--node", XRPL_WS,
        "amm", "delete",
        "--asset", "XRP",
        "--asset2", iouSpec,
        "--no-wait",
        "--seed", lp.seed!,
      ]);

      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim()).toMatch(/^[0-9A-Fa-f]{64}$/);
    },
    300_000
  );
});
