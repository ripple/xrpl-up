import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { WalletStore } from '../core/wallet-store';
import { LOCAL_WS_URL } from '../core/compose';
import { logger } from '../utils/logger';

export interface AccountsOptions {
  network?: string;
  local?: boolean;
  address?: string;
}

export async function accountsCommand(options: AccountsOptions = {}): Promise<void> {
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

  // ── Single address lookup (--address) ─────────────────────────────────────
  if (options.address) {
    const spinner = ora({
      text: `Looking up ${chalk.cyan(options.address)}…`,
      color: 'cyan',
      indent: 2,
    }).start();

    try {
      await manager.connect();
      const res = await manager.client.request({
        command: 'account_info',
        account: options.address,
        ledger_index: 'validated',
      });
      await manager.disconnect();

      const data = res.result.account_data as any;
      const balance = Number(data.Balance) / 1_000_000;
      const seq: number = data.Sequence;

      spinner.succeed(`Found ${chalk.cyan(options.address)}`);
      logger.blank();

      const table = new Table({
        head: [chalk.cyan('Address'), chalk.cyan('Balance'), chalk.cyan('Sequence')],
        style: { head: [], border: [] },
        colWidths: [38, 20, 12],
      });
      table.push([
        chalk.white(options.address),
        chalk.green(balance.toFixed(6) + ' XRP'),
        chalk.dim(String(seq)),
      ]);

      const tableStr = table.toString().split('\n').map((l) => '  ' + l).join('\n');
      console.log(tableStr);
      logger.blank();
    } catch (err: unknown) {
      await manager.disconnect().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('actNotFound') || msg.includes('Account not found')) {
        spinner.fail(`Account not found on ${networkName}: ${options.address}`);
      } else {
        spinner.fail('Lookup failed');
        logger.error(msg);
      }
      process.exit(1);
    }
    return;
  }

  // ── Wallet store listing ───────────────────────────────────────────────────
  const store = new WalletStore(networkName);
  const accounts = store.all();

  if (accounts.length === 0) {
    logger.warning(
      `No sandbox accounts found for "${networkName}". Run \`xrpl-up node\` first.`
    );
    return;
  }

  const spinner = ora({
    text: `Fetching live balances from ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    const rows: [string, string, string, string][] = [];
    let anyCached = false;

    for (const acct of accounts) {
      let balance = acct.balance;
      let cached = false;
      try {
        const res = await manager.client.request({
          command: 'account_info',
          account: acct.address,
          ledger_index: 'validated',
        });
        balance =
          Number(res.result.account_data.Balance) / 1_000_000;
      } catch {
        // use stored balance
        cached = true;
        anyCached = true;
      }
      rows.push([
        chalk.dim(String(acct.index)),
        chalk.white(acct.address),
        cached
          ? chalk.yellow(balance.toFixed(6) + ' XRP') + chalk.dim(' (cached)')
          : chalk.green(balance.toFixed(6) + ' XRP'),
        chalk.dim(acct.seed || '—'),
      ]);
    }

    await manager.disconnect();

    spinner.succeed(
      `${accounts.length} accounts on ${chalk.cyan(networkName)}`
    );
    logger.blank();

    const table = new Table({
      head: [
        chalk.cyan('#'),
        chalk.cyan('Address'),
        chalk.cyan('Balance'),
        chalk.cyan('Seed'),
      ],
      style: { head: [], border: [] },
      colWidths: [4, 38, 28, 34],
    });

    for (const row of rows) {
      table.push(row);
    }

    const tableStr = table
      .toString()
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n');
    console.log(tableStr);
    if (anyCached) {
      logger.warning('Some balances shown from cache — node may not be ready yet.');
    }
    logger.blank();
  } catch (err: unknown) {
    spinner.fail('Failed to fetch balances');
    logger.error(err instanceof Error ? err.message : String(err));
    await manager.disconnect();
    process.exit(1);
  }
}
