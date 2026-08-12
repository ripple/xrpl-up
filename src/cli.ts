#!/usr/bin/env node
// ── Node.js version guard ─────────────────────────────────────────────────────
// Must run before any import so the error is readable rather than a cryptic
// crash inside a dependency.  package.json engines.node mirrors this value.
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22) {
  process.stderr.write(
    `xrpl-up requires Node.js 22 or later.\n` +
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
import {
  amendmentListCommand, amendmentInfoCommand,
  amendmentEnableCommand,
} from './commands/amendment';

import { logger } from './utils/logger';

// ── XRPL interaction commands ─────────────────────────────────────────────────
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
import { nftCommand } from './cli/commands/nft';
import { channelCommand } from './cli/commands/channel';
import { offerCommand } from './cli/commands/offer';
import { escrowCommand } from './cli/commands/escrow';
import { checkCommand } from './cli/commands/check';
import { ticketCommand } from './cli/commands/ticket';
import { clawbackCommand } from './cli/commands/clawback';

const pkg = require('../package.json') as { version: string };
const program = new Command();

program
  .name('xrpl-up')
  .description('XRPL sandbox for local development')
  .version(pkg.version, '-v, --version')
  .option(
    '-n, --node <url>',
    'XRPL node URL or network name (local|testnet|devnet)',
    process.env.XRPL_NODE ?? 'local'
  );

// ── start ────────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start an XRPL sandbox with pre-funded accounts')
  .option(
    '--network <network>',
    'Network to connect to (testnet | devnet) — omit to run locally'
  )
  .option(
    '-a, --accounts <number>',
    'Number of accounts to fund (default: 10)'
  )
  .option(
    '--local',
    'Run a local rippled node via Docker instead of connecting to testnet/devnet'
  )
  .option(
    '--image <image>',
    'Docker image to use for local rippled',
    'rippleci/xrpld:3.3.0'
  )
  .option(
    '--ledger-interval <ms>',
    'Ledger auto-advance interval in milliseconds (local mode only)',
    '1000'
  )
  .option(
    '--local-network',
    'Start a 2-node consensus network (persistent state, snapshot support)'
  )
  .option(
    '--no-auto-advance',
    'Disable automatic ledger advancement'
  )
  .option(
    '--foreground',
    'Keep the sandbox attached in the foreground with live logs (local sandboxes only; Ctrl+C stops it)'
  )
  .option(
    '--no-secrets',
    'Do not print seeds or private keys to stdout (auto-enabled unless --foreground is used)'
  )
  .option(
    '--debug',
    'Enable debug-level rippled logging (view with: xrpl-up logs rippled)'
  )
  .option(
    '--config <path>',
    'Path to a custom rippled.cfg — skips auto-generation (local mode only; forces standalone, incompatible with --local-network)'
  )
  .option(
    '--exit-on-crash',
    'Bypass the wrapper entrypoint so the container exits with rippled\'s code when it crashes (useful for observing exit code 134 on SIGABRT)'
  )
  .option(
    '--bind-address <ip>',
    'IP address for Docker port bindings (default: 127.0.0.1, use 0.0.0.0 for remote access)',
    '127.0.0.1'
  )
  .action((opts: {
    network?: string;
    accounts?: string;
    local?: boolean;
    localNetwork?: boolean;
    image?: string;
    ledgerInterval: string;
    autoAdvance?: boolean;
    debug?: boolean;
    foreground?: boolean;
    secrets?: boolean;
    exitOnCrash?: boolean;
    config?: string;
    bindAddress: string;
  }) => {
    const isLocal = opts.local || opts.localNetwork || !opts.network || opts.network === 'local';
    // Local sandboxes detach by default (every real usage pattern wants this —
    // docs, CI, and scripting all attached-and-blocked before this change);
    // --foreground opts back into the old blocking/live-log behavior.
    // --exit-on-crash implies foreground too — its crash watcher only makes
    // sense while attached. Remote (testnet/devnet) start is unaffected — it
    // has always stayed attached regardless of these flags.
    const detach = isLocal ? !(opts.foreground || opts.exitOnCrash) : false;
    nodeCommand({
      network: isLocal ? undefined : opts.network,
      accountCount: opts.accounts !== undefined ? parseInt(opts.accounts, 10) : undefined,
      local: isLocal,
      localNetwork: opts.localNetwork ?? false,
      image: opts.image,
      ledgerInterval: parseInt(opts.ledgerInterval, 10),
      noAutoAdvance: opts.autoAdvance === false,
      noSecrets: opts.secrets === false,
      debug: opts.debug,
      detach,
      noRestart: opts.exitOnCrash,
      config: opts.config,
      bindAddress: opts.bindAddress,
    }).catch(handleError);
  });

// ── accounts ──────────────────────────────────────────────────────────────────
program
  .command('accounts')
  .description('List sandbox accounts and their live XRP balances')
  .option('--network <network>', 'Network (testnet | devnet) — omit for local sandbox')
  .option('--local', 'Show accounts for the local Docker sandbox')
  .option('--address <address>', 'Query a specific address directly (bypasses wallet store)')
  .action((opts: { network?: string; local?: boolean; address?: string }) => {
    const local = opts.local ?? !opts.network;
    accountsCommand({ network: opts.network, local, address: opts.address }).catch(handleError);
  });

// ── faucet ────────────────────────────────────────────────────────────────────
program
  .command('faucet')
  .description('Fund an account using the faucet')
  .option('--network <network>', 'Network: local | testnet | devnet — omit for local')
  .option('--local', '[deprecated] Alias for --network local')
  .option('-s, --seed <seed>', 'Wallet seed to fund (insecure, prefer $WALLET_SEED env var; omit to generate a new wallet)')
  .option('--json', 'Output as JSON', false)
  .action((opts: { network?: string; local?: boolean; seed?: string; json?: boolean }) => {
    const network = opts.local ? 'local' : (opts.network ?? 'local');
    const seed = opts.seed ?? process.env['WALLET_SEED'];
    if (opts.seed) process.stderr.write('Warning: passing seed via flag is insecure. Use $WALLET_SEED env var instead.\n');
    faucetCommand({ network, seed, json: opts.json }).catch(handleError);
  });

// ── run ───────────────────────────────────────────────────────────────────────
program
  .command('run <script> [scriptArgs...]')
  .description('Run a TypeScript/JavaScript script against an XRPL network')
  .option('--network <network>', 'Network: local | testnet | devnet — omit for local')
  .option('--local', 'Alias for --network local')
  .action((script: string, scriptArgs: string[], opts: { network?: string; local?: boolean }) => {
    const network = opts.local ? 'local' : (opts.network ?? 'local');
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
  .option('--network <network>', 'Remote network to query: testnet | devnet')
  .option('--local', 'Show status for the local Docker sandbox')
  .action((opts: { network?: string; local?: boolean }) => {
    const local = opts.local ?? !opts.network;
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
  .description('Wipe all local sandbox state (containers, ledger volume, accounts, manually enabled amendments)')
  .option('--snapshots', 'Also delete all saved snapshots')
  .option('--keep-amendments', 'Preserve amendments added via `amendment enable` instead of clearing them')
  .action((opts: { snapshots?: boolean; keepAmendments?: boolean }) => {
    resetCommand({ snapshots: opts.snapshots, keepAmendments: opts.keepAmendments });
  });

// ── snapshot ──────────────────────────────────────────────────────────────────
const snapshot = program
  .command('snapshot')
  .description('Manage ledger state snapshots (requires --local-network)');

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
  .description('Inspect and manage XRPL amendments (list, info, enable)');

amendment
  .command('list')
  .description('List all amendments and their status')
  .option('--local', 'Use the local Docker sandbox')
  .option('--network <network>', 'Network to query (testnet | devnet) — omit for local')
  .option('--diff <network>', 'Compare against another network (e.g. --diff testnet)')
  .option('--disabled', 'Show only disabled amendments')
  .action((opts: { local?: boolean; network?: string; diff?: string; disabled?: boolean }) => {
    const local = opts.local ?? !opts.network;
    amendmentListCommand({ local, network: opts.network, diff: opts.diff, disabled: opts.disabled })
      .catch(handleError);
  });

amendment
  .command('info <nameOrHash>')
  .description('Show details for a single amendment (look up by name or hash prefix)')
  .option('--local', 'Use the local Docker sandbox')
  .option('--network <network>', 'Network to query (testnet | devnet) — omit for local')
  .action((nameOrHash: string, opts: { local?: boolean; network?: string }) => {
    const local = opts.local ?? !opts.network;
    amendmentInfoCommand(nameOrHash, { local, network: opts.network })
      .catch(handleError);
  });

amendment
  .command('enable <nameOrHash...>')
  .description('Queue one or more amendments for activation in the local sandbox genesis config')
  .option('--local', 'Use the local Docker sandbox')
  .option('--auto-reset', 'Automatically reset and restart the node without prompting')
  .action((namesOrHashes: string[], opts: { local?: boolean; autoReset?: boolean }) => {
    amendmentEnableCommand(namesOrHashes, { local: opts.local, autoReset: opts.autoReset })
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
  const isLocalFail = /ECONNREFUSED|WebSocket.*clos|connect.*fail/i.test(msg)
    && /(localhost|127\.0\.0\.1|:6006)/.test(msg);
  if (isLocalFail) {
    console.error('\n  Local XRPL node is not running.');
    console.error('  Check:                 docker ps | grep xrpl-up');
    console.error('  Start it:              xrpl-up start --local');
    console.error('  Or target a network:   xrpl-up <sandbox-cmd> --network testnet');
    console.error('                         xrpl-up <xrpl-cmd> -n testnet');
  }
  const isDockerFail = /docker.*not available|daemon is not running|Cannot connect to the Docker/i.test(msg);
  if (isDockerFail) {
    console.error('\n  Docker is required for local sandbox commands.');
    console.error('  Install:  https://docker.com');
    console.error('  macOS:    open -a Docker');
  }
  process.exit(1);
}

// The 19 XRPL interaction commands added via program.addCommand(...) above
// (account, payment, trust, amm, nft, etc.) have async actions with no
// per-command .catch(handleError) — unlike the sandbox lifecycle commands
// defined directly on `program`. Without this, a rejected action promise
// (network error, invalid address, etc.) crashes with a raw Node.js stack
// trace instead of a clean CLI error message.
process.on('unhandledRejection', handleError);
process.on('uncaughtException', handleError);

program.parse();
