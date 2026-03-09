import chalk from 'chalk';
import ora from 'ora';
import { Wallet } from 'xrpl';
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

// ── depositpreauth authorize ───────────────────────────────────────────────────

export interface DepositPreauthAuthorizeOptions {
  address: string;
  seed: string;
  local?: boolean;
  network?: string;
}

export async function depositPreauthAuthorizeCommand(options: DepositPreauthAuthorizeOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Authorizing ${chalk.cyan(options.address)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    const tx = {
      TransactionType: 'DepositPreauth',
      Account: wallet.address,
      Authorize: options.address,
    };

    spinner.text = 'Submitting DepositPreauth…';
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Address authorized for deposit'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Account',    chalk.dim(wallet.address));
    row('Authorized', chalk.cyan(options.address));
    logger.blank();

    const net = isLocal ? ' --local' : '';
    logger.dim(`  Revoke: xrpl-up depositpreauth unauthorize ${options.address}${net} --seed <seed>`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to authorize address');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── depositpreauth unauthorize ─────────────────────────────────────────────────

export interface DepositPreauthUnauthorizeOptions {
  address: string;
  seed: string;
  local?: boolean;
  network?: string;
}

export async function depositPreauthUnauthorizeCommand(options: DepositPreauthUnauthorizeOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Revoking authorization for ${chalk.cyan(options.address)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    const tx = {
      TransactionType: 'DepositPreauth',
      Account: wallet.address,
      Unauthorize: options.address,
    };

    spinner.text = 'Submitting DepositPreauth…';
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Authorization revoked'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Account',     chalk.dim(wallet.address));
    row('Unauthorized', chalk.cyan(options.address));
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to revoke authorization');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── depositpreauth list ────────────────────────────────────────────────────────

export interface DepositPreauthListOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function depositPreauthListCommand(options: DepositPreauthListOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching DepositPreauth entries on ${chalk.cyan(manager.displayName)}…`,
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
          logger.warning(`Pass an account address: xrpl-up depositpreauth list <address> --network ${networkName}`);
        }
        process.exit(1);
      }
      address = accounts[0].address;
    }

    await manager.connect();
    const res = await manager.client.request({
      command: 'account_objects',
      account: address,
      type: 'deposit_preauth',
      ledger_index: 'current',
    } as any);
    await manager.disconnect();

    const entries = (res.result as any).account_objects as any[];
    spinner.succeed(
      `${entries.length} DepositPreauth entr${entries.length === 1 ? 'y' : 'ies'} for ${chalk.dim(address)}`
    );
    logger.blank();

    if (entries.length === 0) {
      logger.dim('  No DepositPreauth entries found.');
      logger.dim('  (DepositAuth flag may not be enabled — use xrpl-up accountset set depositAuth)');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (i > 0) logger.blank();
      row('Authorized', chalk.cyan(e.Authorize ?? '—'));
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to list DepositPreauth entries');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
