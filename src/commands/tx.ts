import chalk from 'chalk';
import ora from 'ora';
import { dropsToXrp } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── Shared helpers ────────────────────────────────────────────────────────────

interface NetworkInfo {
  networkName: string;
  networkConfig: { url: string; name?: string };
  isLocal: boolean;
}

function resolveNetworkInfo(options: { local?: boolean; network?: string }): NetworkInfo {
  if (options.local) {
    return {
      networkName: 'local',
      networkConfig: { url: LOCAL_WS_URL, name: 'Local rippled (Docker)' },
      isLocal: true,
    };
  }
  const config = loadConfig();
  const resolved = resolveNetwork(config, options.network);
  return {
    networkName: resolved.name,
    networkConfig: resolved.config,
    isLocal: resolved.name === 'local',
  };
}

const RIPPLE_EPOCH = 946684800;

function formatDate(rippleDate: number): string {
  return new Date((rippleDate + RIPPLE_EPOCH) * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

function formatAmount(amount: unknown): string {
  if (typeof amount === 'string') {
    return dropsToXrp(amount) + ' XRP';
  }
  if (typeof amount === 'object' && amount !== null) {
    const a = amount as { value?: string; currency?: string; mpt_issuance_id?: string };
    if (a.mpt_issuance_id) return `${a.value ?? '?'} MPT(${a.mpt_issuance_id.slice(0, 8)}…)`;
    return `${a.value ?? '?'} ${a.currency ?? '?'}`;
  }
  return '—';
}

function summarizeTx(tx: any): string {
  if (!tx) return '—';
  switch (tx.TransactionType) {
    case 'Payment': {
      const dest = tx.Destination ?? '?';
      const amt  = formatAmount(tx.Amount);
      return `→ ${dest.slice(0, 12)}… ${amt}`;
    }
    case 'OfferCreate': {
      const gets = formatAmount(tx.TakerGets);
      const pays = formatAmount(tx.TakerPays);
      return `buy ${gets} for ${pays}`;
    }
    case 'TrustSet': {
      const la = tx.LimitAmount;
      if (la && typeof la === 'object') {
        return `${la.currency} limit ${la.value} @ ${String(la.issuer ?? '').slice(0, 10)}…`;
      }
      return '—';
    }
    case 'EscrowCreate':
      return `→ ${String(tx.Destination ?? '').slice(0, 12)}… ${formatAmount(tx.Amount)}`;
    case 'CheckCreate':
      return `→ ${String(tx.Destination ?? '').slice(0, 12)}… max ${formatAmount(tx.SendMax)}`;
    case 'NFTokenMint':
      return `taxon ${tx.NFTokenTaxon ?? 0}`;
    case 'MPTokenIssuanceCreate':
      return `max supply ${tx.MaximumAmount ?? 'unlimited'}`;
    case 'AccountSet':
      return tx.SetFlag != null ? `setFlag ${tx.SetFlag}` : tx.ClearFlag != null ? `clearFlag ${tx.ClearFlag}` : '—';
    default:
      return '—';
  }
}

// ── tx list ───────────────────────────────────────────────────────────────────

export interface TxListOptions {
  account?: string;
  limit?: number;
  local?: boolean;
  network?: string;
}

export async function txListCommand(options: TxListOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching transactions on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    let address = options.account;
    if (!address) {
      const store    = new WalletStore(networkName);
      const accounts = store.all();
      if (accounts.length === 0) {
        spinner.fail('No accounts found');
        if (isLocal) {
          logger.warning('Run xrpl-up node --local first to populate the local account store.');
        } else {
          logger.warning(`Pass an account address: xrpl-up tx list <address> --network ${networkName}`);
        }
        process.exit(1);
      }
      address = accounts[0].address;
    }

    const limit = options.limit ?? 20;
    if (isNaN(limit) || limit < 1) {
      spinner.fail('Invalid --limit value');
      logger.error('--limit must be a positive integer (e.g. --limit 20)');
      process.exit(1);
    }

    await manager.connect();
    const res = await manager.client.request({
      command: 'account_tx',
      account: address,
      limit,
      ledger_index_min: -1,
      ledger_index_max: -1,
    } as any);
    await manager.disconnect();

    const entries = (res.result as any).transactions as any[];
    spinner.succeed(`${entries.length} transaction${entries.length === 1 ? '' : 's'} for ${chalk.dim(address)}`);
    logger.blank();

    if (entries.length === 0) {
      logger.dim('  No transactions found.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 10;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (let i = 0; i < entries.length; i++) {
      const entry  = entries[i];
      const txJson = entry.tx_json ?? entry.tx;           // v2 uses tx_json, v1 uses tx
      const hash   = entry.hash ?? txJson?.hash ?? '—';
      const date   = txJson?.date != null ? formatDate(txJson.date) : 'pending';

      const metaResult = (entry.meta ?? entry.metaData)?.TransactionResult ?? '—';
      const resultStr  = metaResult === 'tesSUCCESS'
        ? chalk.green(metaResult)
        : chalk.red(metaResult);

      if (i > 0) logger.blank();
      logger.log(chalk.dim(`  ── ${date} ${'─'.repeat(35)}`));
      row('Type',    chalk.cyan(txJson?.TransactionType ?? '—'));
      row('Result',  resultStr);
      row('Hash',    chalk.dim((hash as string).slice(0, 12) + '…'));
      row('Summary', chalk.dim(summarizeTx(txJson)));
    }

    logger.blank();
    logger.dim(`  Showing ${entries.length} transaction${entries.length === 1 ? '' : 's'} — use --limit to fetch more.`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fetch transactions');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
