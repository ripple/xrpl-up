#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ── Node.js version guard ─────────────────────────────────────────────────────
// Must run before any import so the error is readable rather than a cryptic
// crash inside a dependency.  package.json engines.node mirrors this value.
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22) {
    process.stderr.write(`xrpl-up requires Node.js 22 or later.\n` +
        `You are running Node.js ${process.versions.node}.\n` +
        `Please upgrade: https://nodejs.org/en/download\n`);
    process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────
const commander_1 = require("commander");
const node_1 = require("./commands/node");
const accounts_1 = require("./commands/accounts");
const faucet_1 = require("./commands/faucet");
const run_1 = require("./commands/run");
const init_1 = require("./commands/init");
const logs_1 = require("./commands/logs");
const status_1 = require("./commands/status");
const compose_1 = require("./core/compose");
const snapshot_1 = require("./commands/snapshot");
const config_1 = require("./commands/config");
const reset_1 = require("./commands/reset");
const amendment_1 = require("./commands/amendment");
const logger_1 = require("./utils/logger");
// ── XRPL interaction commands ─────────────────────────────────────────────────
const index_1 = require("./cli/commands/wallet/index");
const index_2 = require("./cli/commands/account/index");
const payment_1 = require("./cli/commands/payment");
const trust_1 = require("./cli/commands/trust");
const credential_1 = require("./cli/commands/credential");
const did_1 = require("./cli/commands/did");
const multisig_1 = require("./cli/commands/multisig");
const oracle_1 = require("./cli/commands/oracle");
const mptoken_1 = require("./cli/commands/mptoken");
const deposit_preauth_1 = require("./cli/commands/deposit-preauth");
const permissioned_domain_1 = require("./cli/commands/permissioned-domain");
const vault_1 = require("./cli/commands/vault");
const amm_1 = require("./cli/commands/amm");
const nft_1 = require("./cli/commands/nft");
const channel_1 = require("./cli/commands/channel");
const offer_1 = require("./cli/commands/offer");
const escrow_1 = require("./cli/commands/escrow");
const check_1 = require("./cli/commands/check");
const ticket_1 = require("./cli/commands/ticket");
const clawback_1 = require("./cli/commands/clawback");
const pkg = require('../package.json');
const program = new commander_1.Command();
program
    .name('xrpl-up')
    .description('XRPL sandbox for local development')
    .version(pkg.version, '-v, --version')
    .option('-n, --network <url>', 'XRPL network name or node URL (local|testnet|devnet|wss://...)', process.env.XRPL_NETWORK ?? 'local');
// ── start ────────────────────────────────────────────────────────────────────
program
    .command('start')
    .description('Start an XRPL sandbox with pre-funded accounts')
    .option('-a, --accounts <number>', 'Number of accounts to fund (default: 10)')
    .option('--image <image>', 'Docker image to use for local rippled', compose_1.DEFAULT_IMAGE)
    .option('--ledger-interval <ms>', 'Ledger auto-advance interval in milliseconds (local mode only)', '1000')
    .option('--local-network', 'Start a 2-node consensus network (persistent state, snapshot support)')
    .option('--no-auto-advance', 'Disable automatic ledger advancement')
    .option('--foreground', 'Keep the sandbox attached in the foreground with live logs (local sandboxes only; Ctrl+C stops it)')
    .option('--no-secrets', 'Do not print seeds or private keys to stdout (auto-enabled unless --foreground is used)')
    .option('--debug', 'Enable debug-level rippled logging (view with: xrpl-up logs rippled)')
    .option('--config <path>', 'Path to a custom rippled.cfg — skips auto-generation (local mode only; forces standalone, incompatible with --local-network)')
    .option('--exit-on-crash', 'Bypass the wrapper entrypoint so the container exits with rippled\'s code when it crashes (useful for observing exit code 134 on SIGABRT)')
    .option('--bind-address <ip>', 'IP address for Docker port bindings (default: 127.0.0.1, use 0.0.0.0 for remote access)', '127.0.0.1')
    .action((opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    const isLocal = opts.localNetwork || network === 'local';
    // Local sandboxes detach by default (every real usage pattern wants this —
    // docs, CI, and scripting all attached-and-blocked before this change);
    // --foreground opts back into the old blocking/live-log behavior.
    // --exit-on-crash implies foreground too — its crash watcher only makes
    // sense while attached. Remote (testnet/devnet) start is unaffected — it
    // has always stayed attached regardless of these flags.
    const detach = isLocal ? !(opts.foreground || opts.exitOnCrash) : false;
    (0, node_1.nodeCommand)({
        network: isLocal ? undefined : network,
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
    .option('--address <address>', 'Query a specific address directly (bypasses wallet store)')
    .action((opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    (0, accounts_1.accountsCommand)({ network, local: network === 'local', address: opts.address }).catch(handleError);
});
// ── faucet ────────────────────────────────────────────────────────────────────
program
    .command('faucet')
    .description('Fund an account using the faucet')
    .option('-s, --seed <seed>', 'Wallet seed to fund (insecure, prefer $WALLET_SEED env var; omit to generate a new wallet)')
    .option('--json', 'Output as JSON', false)
    .action((opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    const seed = opts.seed ?? process.env['WALLET_SEED'];
    if (opts.seed)
        process.stderr.write('Warning: passing seed via flag is insecure. Use $WALLET_SEED env var instead.\n');
    (0, faucet_1.faucetCommand)({ network, seed, json: opts.json }).catch(handleError);
});
// ── run ───────────────────────────────────────────────────────────────────────
program
    .command('run <script> [scriptArgs...]')
    .description('Run a TypeScript/JavaScript script against an XRPL network')
    .action((script, scriptArgs, _opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    (0, run_1.runCommand)({ script, network, scriptArgs }).catch(handleError);
});
// ── init ──────────────────────────────────────────────────────────────────────
program
    .command('init [directory]')
    .description('Scaffold a new XRPL project')
    .action((directory) => {
    (0, init_1.initCommand)({ directory }).catch(handleError);
});
// ── status ────────────────────────────────────────────────────────────────────
program
    .command('status')
    .description('Show rippled server info and faucet health (defaults to local sandbox)')
    .action((_opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    (0, status_1.statusCommand)({ network, local: network === 'local' }).catch(handleError);
});
// ── logs ──────────────────────────────────────────────────────────────────────
program
    .command('logs [service]')
    .description('Stream Docker Compose logs for the local stack (rippled | faucet)')
    .action((service) => {
    (0, logs_1.logsCommand)({ service }).catch(handleError);
});
// ── stop ───────────────────────────────────────────────────────────────────────
program
    .command('stop')
    .description('Stop the local sandbox Docker stack')
    .action(() => {
    (0, compose_1.composeDown)();
    logger_1.logger.success('Local sandbox stopped.');
});
// ── reset ──────────────────────────────────────────────────────────────────────
program
    .command('reset')
    .description('Wipe all local sandbox state (containers, ledger volume, accounts, manually enabled amendments)')
    .option('--snapshots', 'Also delete all saved snapshots')
    .option('--keep-amendments', 'Preserve amendments added via `amendment enable` instead of clearing them')
    .action((opts) => {
    (0, reset_1.resetCommand)({ snapshots: opts.snapshots, keepAmendments: opts.keepAmendments });
});
// ── snapshot ──────────────────────────────────────────────────────────────────
const snapshot = program
    .command('snapshot')
    .description('Manage ledger state snapshots (requires --local-network)');
snapshot
    .command('save <name>')
    .description('Save current ledger state as a named snapshot')
    .action((name) => {
    (0, snapshot_1.snapshotSave)(name).catch(handleError);
});
snapshot
    .command('restore <name>')
    .description('Restore ledger state from a named snapshot')
    .action((name) => {
    (0, snapshot_1.snapshotRestore)(name).catch(handleError);
});
snapshot
    .command('list')
    .description('List saved snapshots with size and date')
    .action(() => {
    (0, snapshot_1.snapshotList)();
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
    .action((opts) => {
    (0, config_1.configExport)({ output: opts.output, debug: opts.debug });
});
configCmd
    .command('validate <file>')
    .description('Validate a rippled.cfg for compatibility with xrpl-up')
    .action((file) => {
    (0, config_1.configValidate)(file);
});
// ── amendment ─────────────────────────────────────────────────────────────────
const amendment = program
    .command('amendment')
    .description('Inspect and manage XRPL amendments (list, info, enable)');
amendment
    .command('list')
    .description('List all amendments and their status')
    .option('--diff <network>', 'Compare against another network (e.g. --diff testnet)')
    .option('--disabled', 'Show only disabled amendments')
    .action((opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    (0, amendment_1.amendmentListCommand)({ local: network === 'local', network, diff: opts.diff, disabled: opts.disabled })
        .catch(handleError);
});
amendment
    .command('info <nameOrHash>')
    .description('Show details for a single amendment (look up by name or hash prefix)')
    .action((nameOrHash, _opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    (0, amendment_1.amendmentInfoCommand)(nameOrHash, { local: network === 'local', network })
        .catch(handleError);
});
amendment
    .command('enable <nameOrHash...>')
    .description('Queue one or more amendments for activation in the local sandbox genesis config')
    .option('--auto-reset', 'Automatically reset and restart the node without prompting')
    .action((namesOrHashes, opts, cmd) => {
    const network = cmd.optsWithGlobals().network;
    (0, amendment_1.amendmentEnableCommand)(namesOrHashes, { local: network === 'local', autoReset: opts.autoReset })
        .catch(handleError);
});
// ── XRPL interaction commands ──────────────────────────────────────────────────
program.addCommand(index_1.walletCommand);
program.addCommand(index_2.accountCommand);
program.addCommand(payment_1.paymentCommand);
program.addCommand(trust_1.trustCommand);
program.addCommand(credential_1.credentialCommand);
program.addCommand(did_1.didCommand);
program.addCommand(multisig_1.multisigCommand);
program.addCommand(oracle_1.oracleCommand);
program.addCommand(mptoken_1.mptokenCommand);
program.addCommand(deposit_preauth_1.depositPreauthCommand);
program.addCommand(permissioned_domain_1.permissionedDomainCommand);
program.addCommand(vault_1.vaultCommand);
program.addCommand(amm_1.ammCommand);
program.addCommand(nft_1.nftCommand);
program.addCommand(channel_1.channelCommand);
program.addCommand(offer_1.offerCommand);
program.addCommand(escrow_1.escrowCommand);
program.addCommand(check_1.checkCommand);
program.addCommand(ticket_1.ticketCommand);
program.addCommand(clawback_1.clawbackCommand);
/* ── Error handling ─────────────────────────────────────────────────────────── */
function handleError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n  ' + msg);
    const isLocalFail = /ECONNREFUSED|WebSocket.*clos|connect.*fail/i.test(msg)
        && /(localhost|127\.0\.0\.1|:6006)/.test(msg);
    if (isLocalFail) {
        console.error('\n  Local XRPL node is not running.');
        console.error('  Check:                 docker ps | grep xrpl-up');
        console.error(`  Start it:              ${(0, compose_1.startCommandHint)()}`);
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
