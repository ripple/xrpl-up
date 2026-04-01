#!/usr/bin/env node
// ── Node.js version guard ─────────────────────────────────────────────────────
// Must run before any import so the error is readable rather than a cryptic
// crash inside a dependency.  package.json engines.node mirrors this value.
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 20) {
  process.stderr.write(
    `xrpl-up requires Node.js 20 or later.\n` +
    `You are running Node.js ${process.versions.node}.\n` +
    `Please upgrade: https://nodejs.org/en/download\n`,
  );
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

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
import { resetCommand } from './commands/reset';
import { nftCommand } from './cli/commands/nft';
import { channelCommand } from './cli/commands/channel';
import { offerCommand } from './cli/commands/offer';
import { escrowCommand } from './cli/commands/escrow';
import { checkCommand } from './cli/commands/check';
import { ticketCommand } from './cli/commands/ticket';
import { clawbackCommand } from './cli/commands/clawback';
import {
  amendmentListCommand, amendmentInfoCommand,
  amendmentEnableCommand, amendmentDisableCommand, amendmentSyncCommand,
} from './commands/amendment';

import { logger } from './utils/logger';

// ── xrpl-cli commands (merged from xrpl-cli) ──────────────────────────────────
import { walletCommand } from './cli/commands/wallet/index';
import { accountCommand } from './cli/commands/account/index';
import { paymentCommand } from './cli/commands/payment';
import { trustCommand } from './cli/commands/trust';
import { credentialCommand } from './cli/commands/credential';
import { didCommand } from './cli/commands/did';
import { multisigCommand } from './cli/commands/multisig';
import { oracleCommand } from './cli/commands/oracle';
import { mptokenCommand } from './cli/commands/mptoken';
import { depositPreauthCommand as depositPreauthCliCommand } from './cli/commands/deposit-preauth';
import { permissionedDomainCommand } from './cli/commands/permissioned-domain';
import { vaultCommand } from './cli/commands/vault';
import { ammCommand } from './cli/commands/amm';

const pkg = require('../package.json') as { version: string };
const program = new Command();

program
  .name('xrpl-up')
  .description('XRPL sandbox for local development')
  .version(pkg.version, '-v, --version')
  .option(
    '--node <url>',
    'XRPL node URL or network name (mainnet|testnet|devnet) — used by wallet/account/payment commands',
    process.env.XRPL_NODE ?? 'testnet'
  );

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
  .option(
    '--exit-on-crash',
    'Bypass the wrapper entrypoint so the container exits with rippled\'s code when it crashes (useful for observing exit code 134 on SIGABRT)'
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
    exitOnCrash?: boolean;
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
      noRestart: opts.exitOnCrash,
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
  .command('run <script> [scriptArgs...]')
  .description('Run a TypeScript/JavaScript script against an XRPL network')
  .option('-n, --network <network>', 'Network: local | testnet | devnet | mainnet', 'testnet')
  .option('--local', 'Alias for --network local')
  .action((script: string, scriptArgs: string[], opts: { network: string; local?: boolean }) => {
    const network = opts.local ? 'local' : opts.network;
    runCommand({ script, network, scriptArgs }).catch(handleError);
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
  .description('Show rippled server info and faucet health (defaults to local sandbox)')
  .option('-n, --network <network>', 'Remote network to query: testnet | devnet | mainnet')
  .option('--local', 'Show status for the local Docker sandbox')
  .action((opts: { network?: string; local?: boolean }) => {
    const local = opts.local ?? !opts.network;   // default to local when no --network given
    statusCommand({ network: opts.network, local }).catch(handleError);
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

// ── amendment ─────────────────────────────────────────────────────────────────
const amendment = program
  .command('amendment')
  .description('Inspect and manage XRPL amendments (list, enable, disable, sync)');

amendment
  .command('list')
  .description('List all amendments and their status')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network to query', 'testnet')
  .option('--diff <network>', 'Compare against another network (e.g. --diff mainnet)')
  .option('--disabled', 'Show only disabled amendments')
  .action((opts: { local?: boolean; network: string; diff?: string; disabled?: boolean }) => {
    amendmentListCommand({ local: opts.local, network: opts.network, diff: opts.diff, disabled: opts.disabled })
      .catch(handleError);
  });

amendment
  .command('info <nameOrHash>')
  .description('Show details for a single amendment (look up by name or hash prefix)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network to query', 'testnet')
  .action((nameOrHash: string, opts: { local?: boolean; network: string }) => {
    amendmentInfoCommand(nameOrHash, { local: opts.local, network: opts.network })
      .catch(handleError);
  });

amendment
  .command('enable <nameOrHash>')
  .description('Force-enable an amendment in the local sandbox (admin RPC, local only)')
  .option('--local', 'Use the local Docker sandbox')
  .action((nameOrHash: string, opts: { local?: boolean }) => {
    amendmentEnableCommand(nameOrHash, { local: opts.local })
      .catch(handleError);
  });

amendment
  .command('disable <nameOrHash>')
  .description('Veto an amendment in the local sandbox (admin RPC, local only)')
  .option('--local', 'Use the local Docker sandbox')
  .action((nameOrHash: string, opts: { local?: boolean }) => {
    amendmentDisableCommand(nameOrHash, { local: opts.local })
      .catch(handleError);
  });

amendment
  .command('sync')
  .description('Enable all amendments from a source network that are missing locally (local only)')
  .requiredOption('--from <network>', 'Source network to sync from (mainnet | testnet | devnet)')
  .option('--local', 'Apply to the local Docker sandbox')
  .option('--dry-run', 'Show what would change without applying')
  .action((opts: { from: string; local?: boolean; dryRun?: boolean }) => {
    amendmentSyncCommand({ from: opts.from, local: opts.local, dryRun: opts.dryRun })
      .catch(handleError);
  });

// ── XRPL interaction commands ──────────────────────────────────────────────────
program.addCommand(walletCommand);
program.addCommand(accountCommand);
program.addCommand(paymentCommand);
program.addCommand(trustCommand);
program.addCommand(credentialCommand);
program.addCommand(didCommand);
program.addCommand(multisigCommand);
program.addCommand(oracleCommand);
program.addCommand(mptokenCommand);
program.addCommand(depositPreauthCliCommand);
program.addCommand(permissionedDomainCommand);
program.addCommand(vaultCommand);
program.addCommand(ammCommand);
program.addCommand(nftCommand);
program.addCommand(channelCommand);
program.addCommand(offerCommand);
program.addCommand(escrowCommand);
program.addCommand(checkCommand);
program.addCommand(ticketCommand);
program.addCommand(clawbackCommand);

/* ── Error handling ─────────────────────────────────────────────────────────── */
function handleError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('\n  ' + msg);
  process.exit(1);
}

program.parse();
