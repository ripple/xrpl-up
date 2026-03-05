/**
 * test-trade.ts — AMM trading test for xrpl-up local sandbox
 *
 * Prerequisites:
 *   1. xrpl-up node --local        (keep running in another terminal)
 *   2. xrpl-up amm create XRP USD --local   (note the ISSUER address printed)
 *
 * Usage:
 *   ISSUER=rXXXXXXXXXXXXXXXXXXXXXXXXXXXXX xrpl-up run examples/test-trade.ts
 */

import { Client, Wallet, xrpToDrops } from 'xrpl';

// ── Config ────────────────────────────────────────────────────────────────────

const ISSUER = process.env.ISSUER;
if (!ISSUER) {
  console.error('Error: set ISSUER env var to the USD issuer address');
  console.error('  e.g. ISSUER=rXXX... xrpl-up run examples/test-trade.ts');
  process.exit(1);
}

const CURRENCY    = 'USD';
const WS_URL      = 'ws://localhost:6006';
const GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client(WS_URL);
  await client.connect();
  console.log('✓ Connected to local rippled\n');

  const genesis = Wallet.fromSeed(GENESIS_SEED);
  const trader  = Wallet.generate();

  /** Advance the ledger (required in standalone mode) */
  const accept = () => (client as any).request({ command: 'ledger_accept' });

  /** Submit a transaction signed by trader, then advance the ledger */
  const submit = async (txData: Record<string, unknown>): Promise<string> => {
    const filled = await client.autofill(txData as any);
    const { tx_blob } = trader.sign(filled as any);
    const res = await client.submit(tx_blob);
    await accept();
    return (res.result as any).engine_result as string;
  };

  /** Get live XRP balance in XRP (not drops) */
  const xrpBal = async (addr: string): Promise<number> => {
    const r = await client.request({
      command: 'account_info', account: addr, ledger_index: 'validated',
    });
    return Number((r.result as any).account_data.Balance) / 1_000_000;
  };

  /** Get live IOU balance */
  const iouBal = async (addr: string): Promise<number> => {
    const r = await client.request({
      command: 'account_lines', account: addr, ledger_index: 'validated',
    });
    const line = ((r.result as any).lines as any[])
      .find(l => l.currency === CURRENCY && l.account === ISSUER);
    return line ? Number(line.balance) : 0;
  };

  /** Fetch current pool XRP and USD reserves */
  const pool = async (): Promise<{ xrp: number; usd: number; price: number }> => {
    const r = await client.request({
      command: 'amm_info',
      asset:  { currency: 'XRP' },
      asset2: { currency: CURRENCY, issuer: ISSUER },
      ledger_index: 'validated',
    } as any);
    const amm = (r.result as any).amm;
    const xrp = Number(amm.amount) / 1_000_000;
    const usd = Number(amm.amount2.value);
    return { xrp, usd, price: xrp / usd };  // XRP per USD
  };

  const printPool = (label: string, p: { xrp: number; usd: number; price: number }) =>
    console.log(`${label.padEnd(10)} ${p.xrp.toFixed(4)} XRP  │  ${p.usd.toFixed(4)} USD  │  1 USD = ${p.price.toFixed(6)} XRP`);

  const printTrader = (label: string, x: number, u: number) =>
    console.log(`${label.padEnd(10)} ${x.toFixed(4)} XRP  │  ${u.toFixed(4)} USD`);

  // ── Step 1: Fund trader ─────────────────────────────────────────────────
  console.log('── Step 1: Fund trader ──────────────────────────────────────');
  const fundTx = await client.autofill({
    TransactionType: 'Payment',
    Account: genesis.address,
    Destination: trader.address,
    Amount: xrpToDrops('300'),
  } as any);
  const { tx_blob: fundBlob } = genesis.sign(fundTx as any);
  await client.submit(fundBlob);
  await accept();
  console.log(`Trader address: ${trader.address}`);
  console.log(`Funded with:    300 XRP\n`);

  // ── Step 2: Trust line ──────────────────────────────────────────────────
  console.log('── Step 2: Set up trust line ────────────────────────────────');
  const r0 = await submit({
    TransactionType: 'TrustSet',
    Account: trader.address,
    LimitAmount: { currency: CURRENCY, issuer: ISSUER, value: '100000' },
  });
  console.log(`TrustSet: ${r0}  (trader trusts ${CURRENCY}.${ISSUER})\n`);

  // ── Initial state ───────────────────────────────────────────────────────
  console.log('── Initial state ────────────────────────────────────────────');
  const p0   = await pool();
  const xrp0 = await xrpBal(trader.address);
  const usd0 = await iouBal(trader.address);
  printPool('Pool:', p0);
  printTrader('Trader:', xrp0, usd0);
  console.log();

  // ── Trade 1: Buy USD with XRP ───────────────────────────────────────────
  // OfferCreate: maker sells XRP (TakerGets), buys USD (TakerPays).
  // The AMM acts as counterparty and fills at the spot price.
  console.log('── Trade 1: Buy ~9 USD with XRP ─────────────────────────────');
  const r1 = await submit({
    TransactionType: 'OfferCreate',
    Account: trader.address,
    TakerGets: xrpToDrops('15'),                                      // sell up to 15 XRP
    TakerPays: { currency: CURRENCY, issuer: ISSUER, value: '9' },    // buy 9 USD
  });
  const p1   = await pool();
  const xrp1 = await xrpBal(trader.address);
  const usd1 = await iouBal(trader.address);
  console.log(`Result: ${r1}`);
  printPool('Pool:', p1);
  printTrader('Trader:', xrp1, usd1);
  console.log(`  → spent  ${(xrp0 - xrp1).toFixed(6)} XRP`);
  console.log(`  → gained ${(usd1 - usd0).toFixed(6)} USD`);
  console.log(`  → slippage: pool price moved from ${p0.price.toFixed(6)} → ${p1.price.toFixed(6)} XRP/USD\n`);

  // ── Trade 2: Sell USD for XRP ───────────────────────────────────────────
  // OfferCreate: maker sells USD (TakerGets), buys XRP (TakerPays).
  console.log('── Trade 2: Sell ~5 USD for XRP ─────────────────────────────');
  const r2 = await submit({
    TransactionType: 'OfferCreate',
    Account: trader.address,
    TakerGets: { currency: CURRENCY, issuer: ISSUER, value: '5' },    // sell 5 USD
    TakerPays: xrpToDrops('4'),                                        // buy 4 XRP
  });
  const p2   = await pool();
  const xrp2 = await xrpBal(trader.address);
  const usd2 = await iouBal(trader.address);
  console.log(`Result: ${r2}`);
  printPool('Pool:', p2);
  printTrader('Trader:', xrp2, usd2);
  console.log(`  → spent  ${(usd1 - usd2).toFixed(6)} USD`);
  console.log(`  → gained ${(xrp2 - xrp1).toFixed(6)} XRP`);
  console.log(`  → slippage: pool price moved from ${p1.price.toFixed(6)} → ${p2.price.toFixed(6)} XRP/USD\n`);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('── Summary (net P&L) ─────────────────────────────────────────');
  console.log(`  XRP: ${xrp0.toFixed(4)} → ${xrp2.toFixed(4)}  (${(xrp2 - xrp0 >= 0 ? '+' : '')}${(xrp2 - xrp0).toFixed(4)})`);
  console.log(`  USD: ${usd0.toFixed(4)} → ${usd2.toFixed(4)}  (${(usd2 - usd0 >= 0 ? '+' : '')}${(usd2 - usd0).toFixed(4)})`);
  console.log('\n✓ AMM trading test complete!');

  await client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
