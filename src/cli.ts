#!/usr/bin/env node
import { Command } from 'commander';
import { nodeCommand } from './commands/node';
import { accountsCommand } from './commands/accounts';
import { faucetCommand } from './commands/faucet';
import { runCommand } from './commands/run';
import { initCommand } from './commands/init';
import { logsCommand } from './commands/logs';
import { statusCommand } from './commands/status';
import { composeDown } from './core/compose';
import { snapshotSave, snapshotRestore, snapshotList } from './commands/snapshot';
import { configExport, configValidate } from './commands/config';
import { ammInfoCommand, ammCreateCommand } from './commands/amm';
import { resetCommand } from './commands/reset';

import { logger } from './utils/logger';

const pkg = require('../package.json') as { version: string };
const program = new Command();

program
  .name('xrpl-up')
  .description('XRPL sandbox for local development')
  .version(pkg.version, '-v, --version');

// ── node ─────────────────────────────────────────────────────────────────────
program
  .command('node')
  .description('Start an XRPL sandbox with pre-funded accounts')
  .option(
    '-n, --network <network>',
    'Network to connect to (testnet | devnet)',
    'testnet'
  )
  .option(
    '-a, --accounts <number>',
    'Number of accounts to fund (default: 0 with --fork, 10 otherwise)'
  )
  .option(
    '--local',
    'Run a local rippled node via Docker instead of connecting to testnet/devnet'
  )
  .option(
    '--image <image>',
    'Docker image to use for local rippled',
    'xrpllabsofficial/xrpld:latest'
  )
  .option(
    '--ledger-interval <ms>',
    'Ledger auto-advance interval in milliseconds (local mode only)',
    '1000'
  )
  .option(
    '--persist',
    'Persist ledger state and accounts across restarts (local mode only)'
  )
  .option(
    '--fork',
    'Fork XRP balances from a remote network into the local node (requires --local)'
  )
  .option(
    '--fork-accounts <addresses>',
    'Comma-separated addresses to fork (optional if --add-accounts-from-ledger is given)'
  )
  .option(
    '--add-accounts-from-ledger <ledger>',
    'Scan this ledger for active accounts and add them to the fork'
  )
  .option(
    '--fork-at-ledger <ledger>',
    'Ledger index to snapshot balances from (default: N-1 when --add-accounts-from-ledger is used, latest otherwise)'
  )
  .option(
    '--fork-source <url>',
    'WebSocket URL of the network to fork from',
    'wss://xrplcluster.com'
  )
  .option(
    '--no-auto-advance',
    'Disable automatic ledger advancement'
  )
  .option(
    '--detach',
    'Start sandbox in the background and exit (for CI/CD pipelines)'
  )
  .option(
    '--no-secrets',
    'Do not print seeds or private keys to stdout (auto-enabled with --detach)'
  )
  .option(
    '--debug',
    'Enable debug-level rippled logging (view with: xrpl-up logs rippled)'
  )
  .option(
    '--config <path>',
    'Path to a custom rippled.cfg — skips auto-generation (local mode only)'
  )
  .action((opts: {
    network: string;
    accounts?: string;
    local?: boolean;
    persist?: boolean;
    image?: string;
    ledgerInterval: string;
    fork?: boolean;
    forkAccounts?: string;
    addAccountsFromLedger?: string;
    forkAtLedger?: string;
    forkSource?: string;
    autoAdvance?: boolean;
    debug?: boolean;
    detach?: boolean;
    secrets?: boolean;
    config?: string;
  }) => {
    nodeCommand({
      network: opts.local ? undefined : opts.network,
      accountCount: opts.accounts !== undefined ? parseInt(opts.accounts, 10) : undefined,
      local: opts.local,
      persist: opts.persist,
      image: opts.image,
      ledgerInterval: parseInt(opts.ledgerInterval, 10),
      fork: opts.fork,
      forkAccounts: opts.forkAccounts,
      accountsFromLedger: opts.addAccountsFromLedger ? parseInt(opts.addAccountsFromLedger, 10) : undefined,
      forkAtLedger: opts.forkAtLedger ? parseInt(opts.forkAtLedger, 10) : undefined,
      forkSource: opts.forkSource,
      noAutoAdvance: opts.autoAdvance === false,
      noSecrets: opts.secrets === false,
      debug: opts.debug,
      detach: opts.detach,
      config: opts.config,
    }).catch(handleError);
  });

// ── accounts ──────────────────────────────────────────────────────────────────
program
  .command('accounts')
  .description('List sandbox accounts and their live XRP balances')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('--local', 'Show accounts for the local Docker sandbox')
  .option('--address <address>', 'Query a specific address directly (bypasses wallet store)')
  .action((opts: { network: string; local?: boolean; address?: string }) => {
    accountsCommand({ network: opts.network, local: opts.local, address: opts.address }).catch(handleError);
  });

// ── faucet ────────────────────────────────────────────────────────────────────
program
  .command('faucet')
  .description('Fund an account using the faucet')
  .option('-n, --network <network>', 'Network: local | testnet | devnet', 'testnet')
  .option('--local', '[deprecated] Alias for --network local')
  .option('-s, --seed <seed>', 'Wallet seed to fund (omit to generate a new wallet)')
  .action((opts: { network: string; local?: boolean; seed?: string }) => {
    const network = opts.local ? 'local' : opts.network;
    faucetCommand({ network, seed: opts.seed }).catch(handleError);
  });

// ── run ───────────────────────────────────────────────────────────────────────
program
  .command('run <script>')
  .description('Run a TypeScript/JavaScript script against an XRPL network')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((script: string, opts: { network: string }) => {
    runCommand({ script, network: opts.network }).catch(handleError);
  });

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init [directory]')
  .description('Scaffold a new XRPL project')
  .action((directory: string | undefined) => {
    initCommand({ directory }).catch(handleError);
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show rippled server info and faucet health')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('--local', 'Show status for the local Docker sandbox')
  .action((opts: { network: string; local?: boolean }) => {
    statusCommand({ network: opts.network, local: opts.local }).catch(handleError);
  });

// ── logs ──────────────────────────────────────────────────────────────────────
program
  .command('logs [service]')
  .description('Stream Docker Compose logs for the local stack (rippled | faucet)')
  .action((service: string | undefined) => {
    logsCommand({ service }).catch(handleError);
  });

// ── stop ───────────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop the local sandbox Docker stack')
  .action(() => {
    composeDown();
    logger.success('Local sandbox stopped.');
  });

// ── reset ──────────────────────────────────────────────────────────────────────
program
  .command('reset')
  .description('Wipe all local sandbox state (containers, ledger volume, accounts)')
  .option('--snapshots', 'Also delete all saved snapshots')
  .action((opts: { snapshots?: boolean }) => {
    resetCommand({ snapshots: opts.snapshots });
  });

// ── snapshot ──────────────────────────────────────────────────────────────────
const snapshot = program
  .command('snapshot')
  .description('Manage ledger state snapshots (requires --persist mode)');

snapshot
  .command('save <name>')
  .description('Save current ledger state as a named snapshot')
  .action((name: string) => {
    snapshotSave(name).catch(handleError);
  });

snapshot
  .command('restore <name>')
  .description('Restore ledger state from a named snapshot')
  .action((name: string) => {
    snapshotRestore(name).catch(handleError);
  });

snapshot
  .command('list')
  .description('List saved snapshots with size and date')
  .action(() => {
    snapshotList();
  });

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Manage rippled configuration');

configCmd
  .command('export')
  .description('Print the default rippled.cfg to stdout (use --output to save to a file)')
  .option('--output <file>', 'Write to a file instead of stdout')
  .option('--debug', 'Use debug log level in the exported config')
  .action((opts: { output?: string; debug?: boolean }) => {
    configExport({ output: opts.output, debug: opts.debug });
  });

configCmd
  .command('validate <file>')
  .description('Validate a rippled.cfg for compatibility with xrpl-up')
  .action((file: string) => {
    configValidate(file);
  });

// ── amm ───────────────────────────────────────────────────────────────────────
const amm = program
  .command('amm')
  .description('Query AMM pool state');

amm
  .command('create <asset1> <asset2>')
  .description(
    'Create an AMM pool with fresh funded accounts (e.g. XRP USD or USD EUR)'
  )
  .option('--amount1 <number>', 'Amount of asset1 to deposit (default: 100)')
  .option('--amount2 <number>', 'Amount of asset2 to deposit (default: 100)')
  .option('--fee <percent>', 'Trading fee in % e.g. 0.5 for 0.5% (default: 0.5)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((asset1: string, asset2: string, opts: {
    amount1?: string;
    amount2?: string;
    fee?: string;
    local?: boolean;
    network: string;
  }) => {
    ammCreateCommand({
      asset1,
      asset2,
      amount1: opts.amount1 !== undefined ? Number(opts.amount1) : undefined,
      amount2: opts.amount2 !== undefined ? Number(opts.amount2) : undefined,
      fee: opts.fee !== undefined ? Number(opts.fee) : undefined,
      local: opts.local,
      network: opts.network,
    }).catch(handleError);
  });

amm
  .command('info [asset1] [asset2]')
  .description(
    'Show AMM pool info for an asset pair (e.g. XRP USD.rIssuer) or by AMM account'
  )
  .option('--account <address>', 'Query by AMM account address instead of asset pair')
  .option('--local', 'Query the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((asset1: string | undefined, asset2: string | undefined, opts: {
    account?: string;
    local?: boolean;
    network: string;
  }) => {
    ammInfoCommand({
      asset1,
      asset2,
      account: opts.account,
      local: opts.local,
      network: opts.network,
    }).catch(handleError);
  });


/* ── Error handling ─────────────────────────────────────────────────────────── */
function handleError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('\n  ' + msg);
  process.exit(1);
}

program.parse();
