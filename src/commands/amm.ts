import chalk from 'chalk';
import ora from 'ora';
import { Wallet, xrpToDrops, AccountSetAsfFlags } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';

import { logger } from '../utils/logger';

export interface AmmInfoOptions {
  asset1?: string;    // positional, e.g. "XRP" or "USD.rIssuerAddress"
  asset2?: string;    // positional
  account?: string;   // --account rAMMAccount (alternative to asset pair)
  local?: boolean;
  network?: string;
}

type XrplAmount = string | { currency: string; issuer: string; value: string };

/** Parse "XRP" → { currency: 'XRP' } or "USD.rIssuer" → { currency, issuer } */
function parseAsset(raw: string): { currency: string; issuer?: string } {
  if (raw.toUpperCase() === 'XRP') return { currency: 'XRP' };
  const dotIndex = raw.indexOf('.');
  if (dotIndex === -1) {
    throw new Error(
      `IOU assets must include an issuer: "${raw}" — use format CURRENCY.rIssuerAddress (e.g. USD.rHb9...)`
    );
  }
  const currency = raw.slice(0, dotIndex);
  const issuer = raw.slice(dotIndex + 1);
  if (!issuer) {
    throw new Error(
      `Missing issuer in "${raw}" — use format CURRENCY.rIssuerAddress (e.g. USD.rHb9...)`
    );
  }
  return { currency, issuer };
}

/** Format an XRPL amount for display. XRP amounts are strings (drops). */
function formatAmount(amount: XrplAmount): { value: string; label: string } {
  if (typeof amount === 'string') {
    const xrp = (Number(amount) / 1_000_000).toFixed(6);
    return { value: xrp + ' XRP', label: 'XRP' };
  }
  return {
    value: Number(amount.value).toFixed(6),
    label: `${amount.currency}  ${chalk.dim('(issuer: ' + amount.issuer + ')')}`,
  };
}

/** Shorten a hex currency code for display: "03930D...197B1" */
function shortCurrency(currency: string): string {
  if (currency.length <= 8) return currency;
  return currency.slice(0, 6) + '…' + currency.slice(-5);
}

export async function ammInfoCommand(options: AmmInfoOptions): Promise<void> {
  // ── Validate inputs ────────────────────────────────────────────────────────
  const byAccount = Boolean(options.account);
  const byPair = Boolean(options.asset1 || options.asset2);

  if (!byAccount && !byPair) {
    logger.error(
      'Specify an asset pair or an AMM account.\n' +
      '  Usage: xrpl-up amm info XRP USD.rIssuerAddress [--local]\n' +
      '         xrpl-up amm info --account rAMMAccount [--local]'
    );
    process.exit(1);
  }

  if (!byAccount) {
    if (!options.asset1) {
      logger.error('Missing asset1 — e.g. xrpl-up amm info XRP USD.rIssuer --local');
      process.exit(1);
    }
    if (!options.asset2) {
      logger.error(
        `Missing asset2 — e.g. xrpl-up amm info ${options.asset1} USD.rIssuer --local`
      );
      process.exit(1);
    }
  }

  // ── Resolve network ────────────────────────────────────────────────────────
  let networkName: string;
  let networkConfig: { url: string; name?: string };

  if (options.local) {
    networkName = 'local';
    networkConfig = { url: LOCAL_WS_URL, name: 'Local rippled (Docker)' };
  } else {
    const config = loadConfig();
    const resolved = resolveNetwork(config, options.network);
    networkName = resolved.name;
    networkConfig = resolved.config;
  }

  const manager = new NetworkManager(networkName, networkConfig);

  // ── Build display label for spinner ───────────────────────────────────────
  const pairLabel = byAccount
    ? options.account!
    : `${options.asset1} / ${options.asset2}`;

  const spinner = ora({
    text: `Querying AMM pool ${chalk.cyan(pairLabel)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    // ── amm_info RPC ─────────────────────────────────────────────────────────
    let asset1Parsed: { currency: string; issuer?: string } | undefined;
    let asset2Parsed: { currency: string; issuer?: string } | undefined;

    if (!byAccount) {
      try {
        asset1Parsed = parseAsset(options.asset1!);
      } catch (e) {
        spinner.fail('Invalid asset1');
        logger.error((e as Error).message);
        process.exit(1);
      }
      try {
        asset2Parsed = parseAsset(options.asset2!);
      } catch (e) {
        spinner.fail('Invalid asset2');
        logger.error((e as Error).message);
        process.exit(1);
      }
    }

    const req: Record<string, unknown> = {
      command: 'amm_info',
      ledger_index: 'validated',
    };

    if (byAccount) {
      req['amm_account'] = options.account;
    } else {
      req['asset'] = asset1Parsed;
      req['asset2'] = asset2Parsed;
    }

    const res = await manager.client.request(req as any);
    await manager.disconnect();

    const amm = (res.result as any).amm as {
      account: string;
      amount: XrplAmount;
      amount2: XrplAmount;
      lp_token: { currency: string; issuer: string; value: string };
      trading_fee: number;
    };
    const ledgerIndex: number = (res.result as any).ledger_index;
    const validated: boolean  = (res.result as any).validated ?? false;

    // ── Format output ─────────────────────────────────────────────────────────
    const amt1 = formatAmount(amm.amount);
    const amt2 = formatAmount(amm.amount2);
    const feeRaw = amm.trading_fee;
    const feePct = (feeRaw / 1000).toFixed(3) + '%';
    const lpCurrency = shortCurrency(amm.lp_token.currency);
    const lpValue = Number(amm.lp_token.value).toFixed(6);

    // Derive pool pair label from actual response data
    const a1Label = typeof amm.amount === 'string' ? 'XRP' : (amm.amount as any).currency;
    const a2Label = typeof amm.amount2 === 'string' ? 'XRP' : (amm.amount2 as any).currency;

    spinner.stop();
    logger.blank();
    logger.section(`AMM Pool: ${chalk.cyan(a1Label + ' / ' + a2Label)}`);

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 16;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Asset 1',      chalk.green(amt1.value) + '  ' + chalk.dim(typeof amm.amount === 'string' ? '' : `(issuer: ${(amm.amount as any).issuer})`));
    row('Asset 2',      chalk.green(amt2.value) + '  ' + chalk.dim(typeof amm.amount2 === 'string' ? '' : `(issuer: ${(amm.amount2 as any).issuer})`));
    row('LP tokens',    chalk.white(lpValue) + `  ${chalk.dim('(currency: ' + lpCurrency + ')')}`);
    row('LP issuer',    chalk.dim(amm.lp_token.issuer));
    row('Trading fee',  chalk.white(String(feeRaw)) + chalk.dim(`  (${feePct})`));
    row('AMM account',  chalk.dim(amm.account));
    row('Ledger',       chalk.dim(`#${ledgerIndex}`) + (validated ? chalk.dim('  (validated)') : chalk.yellow('  (not validated)')));

    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('actNotFound') || msg.includes('Account not found') || msg.includes('asfAMM')) {
      const pair = byAccount ? options.account! : `${options.asset1} / ${options.asset2}`;
      spinner.fail(`No AMM pool found for ${pair} on ${networkName}`);
    } else {
      spinner.fail('Failed to query AMM pool');
      logger.error(msg);
    }
    process.exit(1);
  }
}

// ── amm create ───────────────────────────────────────────────────────────────

export interface AmmCreateOptions {
  asset1: string;    // currency code, e.g. "XRP" or "USD"
  asset2: string;    // currency code, e.g. "USD" or "EUR"
  amount1?: number;  // amount of asset1 to deposit (default 100)
  amount2?: number;  // amount of asset2 to deposit (default 100)
  fee?: number;      // trading fee in % e.g. 0.5 → 0.5% (default 0.5)
  local?: boolean;
  network?: string;
}

export async function ammCreateCommand(options: AmmCreateOptions): Promise<void> {
  const amt1 = options.amount1 ?? 100;
  const amt2 = options.amount2 ?? 100;
  const feePercent = options.fee ?? 0.5;
  const tradingFee = Math.round(feePercent * 1000);   // 0.5% → 500

  if (tradingFee < 0 || tradingFee > 1000) {
    logger.error('Trading fee must be between 0% and 1% (max 1000 in rippled units).');
    process.exit(1);
  }

  const cur1 = options.asset1.toUpperCase();
  const cur2 = options.asset2.toUpperCase();

  if (cur1 === cur2) {
    logger.error(`Both assets are "${cur1}" — the pool needs two different assets.`);
    process.exit(1);
  }

  // ── Resolve network ──────────────────────────────────────────────────────
  let networkName: string;
  let networkConfig: { url: string; name?: string };

  if (options.local) {
    networkName = 'local';
    networkConfig = { url: LOCAL_WS_URL, name: 'Local rippled (Docker)' };
  } else {
    const config = loadConfig();
    const resolved = resolveNetwork(config, options.network);
    networkName = resolved.name;
    networkConfig = resolved.config;
  }

  const isLocal = networkName === 'local';
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Setting up AMM pool ${chalk.cyan(cur1 + ' / ' + cur2)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const client = manager.client;

    // ── Helper: advance ledger (local only) ──────────────────────────────
    const advance = async () => {
      if (isLocal) await (client as any).request({ command: 'ledger_accept' });
    };

    // ── Helper: submit and wait ──────────────────────────────────────────
    const submit = async (tx: Record<string, unknown>, wallet: Wallet) => {
      const filled = await client.autofill(tx as any);
      const { tx_blob } = wallet.sign(filled as any);
      await client.submit(tx_blob);
      await advance();
    };

    // ── Step 1: Fund accounts ────────────────────────────────────────────
    // Determine which sides need an issuer
    const need1Issuer = cur1 !== 'XRP';
    const need2Issuer = cur2 !== 'XRP';

    // LP needs enough XRP to cover the pool side (if XRP) + all reserves + fees
    // Base reserve=10, trust line=2 per IOU, LP token trust=2, buffer=50
    const lpXrpReserve = 10 + (need1Issuer ? 2 : 0) + (need2Issuer ? 2 : 0) + 2 + 50;
    const lpFundAmount = (cur1 === 'XRP' ? amt1 : 0) + (cur2 === 'XRP' ? amt2 : 0) + lpXrpReserve;

    let issuer1Wallet: Wallet | undefined;
    let issuer2Wallet: Wallet | undefined;
    let lpWallet: Wallet;

    if (isLocal) {
      if (need1Issuer) {
        spinner.text = `Funding ${cur1} issuer…`;
        const r = await fundWalletFromGenesis(client, 100);
        issuer1Wallet = r.wallet;
      }
      // Reuse issuer1 for cur2 if they are different currencies but both IOUs
      // (two separate issuers is cleaner)
      if (need2Issuer) {
        spinner.text = `Funding ${cur2} issuer…`;
        const r = await fundWalletFromGenesis(client, 100);
        issuer2Wallet = r.wallet;
      }
      spinner.text = `Funding LP account…`;
      const r = await fundWalletFromGenesis(client, lpFundAmount);
      lpWallet = r.wallet;
    } else {
      // Remote: use the public faucet via xrpl.js
      if (need1Issuer) {
        spinner.text = `Funding ${cur1} issuer via faucet…`;
        const r = await client.fundWallet();
        issuer1Wallet = r.wallet;
      }
      if (need2Issuer) {
        spinner.text = `Funding ${cur2} issuer via faucet…`;
        const r = await client.fundWallet();
        issuer2Wallet = r.wallet;
      }
      spinner.text = `Funding LP account via faucet…`;
      const r = await client.fundWallet();
      lpWallet = r.wallet;
    }

    // ── Step 2: AccountSet DefaultRipple on each issuer ──────────────────
    if (issuer1Wallet) {
      spinner.text = `Enabling DefaultRipple on ${cur1} issuer…`;
      await submit({
        TransactionType: 'AccountSet',
        Account: issuer1Wallet.address,
        SetFlag: AccountSetAsfFlags.asfDefaultRipple,
      }, issuer1Wallet);
    }
    if (issuer2Wallet) {
      spinner.text = `Enabling DefaultRipple on ${cur2} issuer…`;
      await submit({
        TransactionType: 'AccountSet',
        Account: issuer2Wallet.address,
        SetFlag: AccountSetAsfFlags.asfDefaultRipple,
      }, issuer2Wallet);
    }

    // ── Step 3: TrustSet + issue tokens to LP ────────────────────────────
    if (issuer1Wallet) {
      spinner.text = `Creating trust line: LP → ${cur1} issuer…`;
      await submit({
        TransactionType: 'TrustSet',
        Account: lpWallet!.address,
        LimitAmount: { currency: cur1, issuer: issuer1Wallet.address, value: String(amt1 * 10) },
      }, lpWallet!);

      spinner.text = `Issuing ${amt1} ${cur1} to LP…`;
      await submit({
        TransactionType: 'Payment',
        Account: issuer1Wallet.address,
        Destination: lpWallet!.address,
        Amount: { currency: cur1, issuer: issuer1Wallet.address, value: String(amt1) },
      }, issuer1Wallet);
    }

    if (issuer2Wallet) {
      spinner.text = `Creating trust line: LP → ${cur2} issuer…`;
      await submit({
        TransactionType: 'TrustSet',
        Account: lpWallet!.address,
        LimitAmount: { currency: cur2, issuer: issuer2Wallet.address, value: String(amt2 * 10) },
      }, lpWallet!);

      spinner.text = `Issuing ${amt2} ${cur2} to LP…`;
      await submit({
        TransactionType: 'Payment',
        Account: issuer2Wallet.address,
        Destination: lpWallet!.address,
        Amount: { currency: cur2, issuer: issuer2Wallet.address, value: String(amt2) },
      }, issuer2Wallet);
    }

    // ── Step 4: AMMCreate ────────────────────────────────────────────────
    spinner.text = `Creating AMM pool…`;

    const xrplAmount1 = cur1 === 'XRP'
      ? xrpToDrops(String(amt1))
      : { currency: cur1, issuer: issuer1Wallet!.address, value: String(amt1) };

    const xrplAmount2 = cur2 === 'XRP'
      ? xrpToDrops(String(amt2))
      : { currency: cur2, issuer: issuer2Wallet!.address, value: String(amt2) };

    await submit({
      TransactionType: 'AMMCreate',
      Account: lpWallet!.address,
      Amount: xrplAmount1,
      Amount2: xrplAmount2,
      TradingFee: tradingFee,
    }, lpWallet!);

    // ── Step 5: Query the created pool for confirmation ──────────────────
    spinner.text = 'Fetching pool info…';

    const req: Record<string, unknown> = {
      command: 'amm_info',
      ledger_index: 'validated',
      asset: cur1 === 'XRP' ? { currency: 'XRP' } : { currency: cur1, issuer: issuer1Wallet!.address },
      asset2: cur2 === 'XRP' ? { currency: 'XRP' } : { currency: cur2, issuer: issuer2Wallet!.address },
    };

    const res = await client.request(req as any);
    await manager.disconnect();

    const amm = (res.result as any).amm as {
      account: string;
      amount: XrplAmount;
      amount2: XrplAmount;
      lp_token: { currency: string; issuer: string; value: string };
      trading_fee: number;
    };

    spinner.succeed(chalk.green(`AMM pool created on ${chalk.cyan(manager.displayName)}`));
    logger.blank();
    logger.section(`AMM Pool: ${chalk.cyan(cur1 + ' / ' + cur2)}`);

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 16;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    const a1 = formatAmount(amm.amount);
    const a2 = formatAmount(amm.amount2);

    row('Asset 1',      chalk.green(a1.value) + (issuer1Wallet ? chalk.dim(`  (issuer: ${issuer1Wallet.address})`) : ''));
    row('Asset 2',      chalk.green(a2.value) + (issuer2Wallet ? chalk.dim(`  (issuer: ${issuer2Wallet.address})`) : ''));
    row('LP tokens',    chalk.white(Number(amm.lp_token.value).toFixed(6)) + chalk.dim(`  (currency: ${shortCurrency(amm.lp_token.currency)})`));
    row('LP account',   chalk.dim(lpWallet!.address));
    row('AMM account',  chalk.dim(amm.account));
    row('Trading fee',  chalk.white(String(amm.trading_fee)) + chalk.dim(`  (${feePercent.toFixed(3)}%)`));

    if (issuer1Wallet || issuer2Wallet) {
      logger.blank();
      logger.log(chalk.dim('  Query with:'));
      const infoAsset1 = cur1 === 'XRP' ? 'XRP' : `${cur1}.${issuer1Wallet!.address}`;
      const infoAsset2 = cur2 === 'XRP' ? 'XRP' : `${cur2}.${issuer2Wallet!.address}`;
      logger.log(`  ${chalk.cyan(`xrpl-up amm info ${infoAsset1} ${infoAsset2}${isLocal ? ' --local' : ''}`)}`);
    }

    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('AMM pool creation failed');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
