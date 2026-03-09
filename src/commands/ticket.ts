import chalk from 'chalk';
import ora from 'ora';
import { Wallet } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

const XRP_FUNDED = 100;

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

// ── ticket create ─────────────────────────────────────────────────────────────

export interface TicketCreateOptions {
  count: number;
  seed?: string;
  autoFund?: boolean;
  local?: boolean;
  network?: string;
}

export async function ticketCreateCommand(options: TicketCreateOptions): Promise<void> {
  if (isNaN(options.count) || options.count < 1 || options.count > 250) {
    logger.error('Ticket count must be between 1 and 250.');
    process.exit(1);
  }

  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);

  if (!options.seed && !(options.autoFund && isLocal)) {
    logger.error('--seed <seed> is required (or use --auto-fund on a local network).');
    process.exit(1);
  }

  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Creating ${options.count} ticket${options.count === 1 ? '' : 's'} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    let wallet: Wallet;
    let autoFunded = false;
    if (options.seed) {
      wallet = Wallet.fromSeed(options.seed);
    } else {
      spinner.text = 'Funding wallet…';
      const r = await fundWalletFromGenesis(manager.client, XRP_FUNDED);
      wallet = r.wallet;
      autoFunded = true;
      // Persist the auto-funded wallet so the user can reference it later
      const store = new WalletStore(networkName);
      store.add(wallet, XRP_FUNDED);
    }

    const tx = {
      TransactionType: 'TicketCreate',
      Account: wallet.address,
      TicketCount: options.count,
    };

    spinner.text = 'Submitting TicketCreate…';
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    const meta    = (result.result as any).meta as any;
    const sequences: number[] = (meta?.AffectedNodes ?? [])
      .filter((n: any) => n.CreatedNode?.LedgerEntryType === 'Ticket')
      .map((n: any) => n.CreatedNode.NewFields.TicketSequence as number)
      .sort((a: number, b: number) => a - b);

    spinner.succeed(chalk.green(`${sequences.length} ticket${sequences.length === 1 ? '' : 's'} created`));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Account', chalk.dim(wallet.address));
    if (autoFunded) row('Seed', chalk.yellow(wallet.seed ?? ''));
    row('Count',   String(options.count));
    logger.blank();

    logger.section('Ticket Sequences');
    for (const seq of sequences) {
      logger.log(`  ${chalk.cyan(String(seq))}`);
    }
    logger.blank();
    logger.dim('  To use a ticket: set Sequence=0, TicketSequence=<n> in your transaction.');
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create tickets');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── ticket list ───────────────────────────────────────────────────────────────

export interface TicketListOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function ticketListCommand(options: TicketListOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching tickets on ${chalk.cyan(manager.displayName)}…`,
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
        logger.warning('Run xrpl-up node --local first, or pass an account address.');
        process.exit(1);
      }
      address = accounts[0].address;
    }

    await manager.connect();
    const res = await manager.client.request({
      command: 'account_objects',
      account: address,
      type: 'ticket',
      ledger_index: 'current',
    } as any);
    await manager.disconnect();

    const tickets = (res.result as any).account_objects as any[];
    spinner.succeed(
      `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} for ${chalk.dim(address)}`
    );
    logger.blank();

    if (tickets.length === 0) {
      logger.dim('  No tickets found.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 16;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (const t of tickets) {
      row('TicketSequence', chalk.cyan(String(t.TicketSequence ?? '—')));
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to list tickets');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
