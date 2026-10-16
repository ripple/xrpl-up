"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertConfigCompatibleWithMode = assertConfigCompatibleWithMode;
exports.nodeCommand = nodeCommand;
const node_http_1 = __importDefault(require("node:http"));
const chalk_1 = __importDefault(require("chalk"));
const inquirer_1 = __importDefault(require("inquirer"));
const ora_1 = __importDefault(require("ora"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const xrpl_1 = require("xrpl");
const banner_1 = require("../utils/banner");
const logger_1 = require("../utils/logger");
const config_1 = require("../core/config");
const network_1 = require("../core/network");
const wallet_store_1 = require("../core/wallet-store");
const compose_1 = require("../core/compose");
const config_2 = require("./config");
const standalone_1 = require("../core/standalone");
const tec_codes_1 = require("../utils/tec-codes");
/**
 * `--config` (writeComposeFile in compose.ts) always forces standalone mode —
 * a custom rippled.cfg replaces the generated 2-node consensus setup entirely.
 * Reject the combination up front instead of silently downgrading a mode the
 * user explicitly asked for.
 */
function assertConfigCompatibleWithMode(options) {
    if (options.config && options.localNetwork) {
        throw new Error('--config and --local-network cannot be used together — a custom rippled.cfg always ' +
            'runs standalone (see --config in `xrpl-up start --help`). Drop --local-network, or ' +
            'drop --config and use `xrpl-up config export` / `amendment enable` instead.');
    }
}
/** Call the local faucet HTTP server to fund a fresh wallet. */
async function callFaucet() {
    return new Promise((resolve, reject) => {
        const req = node_http_1.default.request(`${compose_1.FAUCET_URL}/faucet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (res.statusCode !== 200) {
                        reject(new Error(parsed.error ?? `Faucet returned HTTP ${res.statusCode}`));
                    }
                    else {
                        resolve(parsed);
                    }
                }
                catch {
                    reject(new Error(`Invalid faucet response: ${body}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}
const TABLE_CHARS = {
    top: '─',
    'top-mid': '┬',
    'top-left': '┌',
    'top-right': '┐',
    bottom: '─',
    'bottom-mid': '┴',
    'bottom-left': '└',
    'bottom-right': '┘',
    left: '│',
    'left-mid': '├',
    mid: '─',
    'mid-mid': '┼',
    right: '│',
    'right-mid': '┤',
    middle: '│',
};
function printTable(str) {
    console.log(str.split('\n').map((l) => '  ' + l).join('\n'));
}
async function nodeCommand(options = {}) {
    (0, banner_1.printBanner)();
    let networkName;
    let networkUrl;
    let networkDisplayName;
    let isLocal = false;
    // ── Resolve network ────────────────────────────────────────────────────────
    if (options.local) {
        isLocal = true;
        networkName = 'local';
        networkDisplayName = 'Local rippled (Docker)';
        networkUrl = compose_1.LOCAL_WS_URL;
        // Check Docker before doing anything else
        (0, compose_1.checkDockerAvailable)(); // throws if Docker is unavailable
    }
    else {
        const config = (0, config_1.loadConfig)();
        const resolved = (0, config_1.resolveNetwork)(config, options.network);
        networkName = resolved.name;
        networkUrl = resolved.config.url;
        networkDisplayName = resolved.config.name ?? resolved.name;
        if ((0, config_1.isMainnet)(resolved.name, resolved.config)) {
            logger_1.logger.error('Cannot start sandbox on Mainnet — use --network testnet, --network devnet, or omit --network for the local sandbox.');
            process.exit(1);
        }
    }
    const store = new wallet_store_1.WalletStore(networkName);
    // ── Start Docker Compose stack (local mode only) ───────────────────────────
    assertConfigCompatibleWithMode(options);
    const localNetwork = isLocal && (options.localNetwork ?? false);
    const noConsensus = isLocal && !localNetwork;
    const persist = isLocal && localNetwork; // --local-network always persists
    // Starting standalone always clears the wallet store (below, `if (!persist)
    // store.clear()`), but it never touches the --local-network ledger volumes —
    // they're a separate code path entirely. If those volumes still hold real
    // ledger data, warn before silently discarding the account records that are
    // the only way to reach them, since `xrpl-up accounts` won't list them
    // afterward and the seeds aren't recoverable without a snapshot.
    if (noConsensus && ((0, compose_1.volumeHasData)(compose_1.VOLUME_NAME) || (0, compose_1.volumeHasData)(compose_1.PEER_VOLUME_NAME))) {
        logger_1.logger.warning('Starting standalone mode will replace your current wallet records.\n' +
            '    Run with --local-network instead to keep using this data,\n' +
            '    or run `xrpl-up snapshot save <name>` first if you want it back later.');
        if (process.stdin.isTTY && process.stdout.isTTY) {
            const { proceed } = await inquirer_1.default.prompt([{
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Continue starting standalone mode?',
                    default: false,
                }]);
            if (!proceed) {
                logger_1.logger.dim('  Aborted.');
                return;
            }
        }
        logger_1.logger.blank();
    }
    if (isLocal) {
        const image = options.image ?? compose_1.DEFAULT_IMAGE;
        const dockerSpinner = (0, ora_1.default)({
            text: localNetwork
                ? `Starting 2-node consensus network${chalk_1.default.dim(' (first run may take a minute…)')}`
                : `Starting standalone node${chalk_1.default.dim(' (first run may take a minute…)')}`,
            color: 'cyan',
            indent: 2,
        }).start();
        const dockerStartMs = Date.now();
        try {
            // Validate custom config before starting Docker — surface errors early
            if (options.config) {
                const validation = (0, config_2.validateConfig)(options.config);
                if (validation.errors.length > 0 || validation.warnings.length > 0 || validation.recommendations.length > 0) {
                    (0, config_2.printValidationResult)(options.config, validation);
                }
                if (validation.errors.length > 0) {
                    throw new Error('Custom config has errors — fix them before starting (run: xrpl-up config validate ' + options.config + ')');
                }
            }
            // In --local-network mode, ledgers close via consensus (~4s) — no ledger_accept needed.
            // In standalone mode (default), faucet auto-advances ledgers when detached.
            const ledgerIntervalMs = noConsensus
                ? (options.detach ? (options.ledgerInterval ?? 1000) : 0)
                : 0;
            await (0, compose_1.composeUp)(image, noConsensus, options.debug ?? false, ledgerIntervalMs, options.config, options.noRestart ?? false, options.bindAddress);
            const dockerElapsed = ((Date.now() - dockerStartMs) / 1000).toFixed(1);
            const modeLabel = localNetwork ? 'Consensus network' : 'Standalone node';
            dockerSpinner.succeed(`${modeLabel} started ${chalk_1.default.dim(`(${dockerElapsed}s)`)}  ${chalk_1.default.dim('rippled ws://localhost:6006')}  ${chalk_1.default.dim('faucet http://localhost:3001')}`);
            // When --exit-on-crash is set, attach two background watchers:
            //
            // 1. Log poller  — polls `docker logs` every 500 ms looking for the
            //    "Logic error:" line that rippled always emits before abort().
            //    When detected it sends SIGABRT *directly to rippled's own PID*
            //    (not via `docker kill`, which targets PID 1) using `docker exec kill -6`.
            //    This is necessary because glibc's abort() uses tgkill() (thread-targeted)
            //    which under Rosetta 2 / Docker Desktop on Apple Silicon does not reliably
            //    deliver the signal.  Sending via `kill(rippled_pid, SIGABRT)` from
            //    another process bypasses that issue.
            //
            // 2. docker wait  — blocks until the container exits and reports the code.
            //    Exit 134 = 128 + SIGABRT(6), which is what rippled produces on abort().
            //
            // The compose entrypoint override (/bin/sh wrapper without exec) ensures
            // rippled is NOT PID 1.  This is critical: Linux silently drops unhandled
            // signals for PID 1, including SIGABRT.  As a non-PID-1 process rippled
            // receives the external SIGABRT normally and exits 134.
            if (options.noRestart && !options.detach) {
                const { spawn: spawnProc, execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
                const containerName = `${compose_1.COMPOSE_PROJECT}-rippled-1`;
                let abortSent = false;
                // Record the timestamp we start watching so we only look at new log lines.
                const watchFrom = new Date().toISOString();
                // Poll docker logs every 500 ms for the crash pattern.
                const pollInterval = setInterval(() => {
                    if (abortSent) {
                        clearInterval(pollInterval);
                        return;
                    }
                    try {
                        const recent = execSync(`docker logs --since "${watchFrom}" --tail 50 ${containerName} 2>&1`, { timeout: 2000 }).toString();
                        if (recent.includes('Logic error:') || recent.includes('Assertion failed:')) {
                            abortSent = true;
                            clearInterval(pollInterval);
                            // Send SIGABRT to rippled's own PID (not PID 1) via docker exec.
                            execSync(`docker exec ${containerName} sh -c "kill -6 \\$(ps ax | grep /opt/ripple/bin/rippled | grep -v 'sh -c\\|grep\\|ps' | awk '{print \\$1}' | head -1)"`, { timeout: 3000, stdio: 'pipe' });
                        }
                    }
                    catch { /* transient error — keep polling */ }
                }, 500);
                // docker wait blocks until the container exits and echoes the exit code.
                const waiter = spawnProc('docker', ['wait', containerName], {
                    stdio: ['ignore', 'pipe', 'inherit'],
                });
                waiter.stdout?.on('data', (data) => {
                    clearInterval(pollInterval);
                    const code = parseInt(data.toString().trim(), 10);
                    const note = code === 134 ? ' (SIGABRT — process crashed)' : '';
                    logger_1.logger.log(chalk_1.default.red(`\n✗ rippled exited — code ${code}${note}`));
                });
            }
        }
        catch (err) {
            const dockerElapsed = ((Date.now() - dockerStartMs) / 1000).toFixed(1);
            dockerSpinner.fail(`Failed to start local stack ${chalk_1.default.dim(`(${dockerElapsed}s)`)}`);
            logger_1.logger.error(err instanceof Error ? err.message : String(err));
            logger_1.logger.dim('  Troubleshooting:');
            logger_1.logger.dim('    docker ps -a                              # check container state');
            logger_1.logger.dim('    docker compose -p xrpl-up-local logs      # view container logs');
            logger_1.logger.dim('    docker info                               # verify Docker daemon');
            (0, compose_1.composeDown)();
            process.exit(1);
        }
    }
    // ── Connect ────────────────────────────────────────────────────────────────
    const localNetworkConfig = { url: networkUrl, name: networkDisplayName };
    const manager = new network_1.NetworkManager(networkName, localNetworkConfig);
    const connectSpinner = (0, ora_1.default)({
        text: `Connecting to ${chalk_1.default.cyan(networkDisplayName)}…`,
        color: 'cyan',
        indent: 2,
    }).start();
    const connectStartMs = Date.now();
    try {
        await manager.connect();
    }
    catch (err) {
        connectSpinner.fail(`Connection failed ${chalk_1.default.dim(`(${networkUrl})`)}`);
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        if (isLocal)
            (0, compose_1.composeDown)();
        process.exit(1);
    }
    const serverInfo = await manager.getServerInfo();
    const connectElapsed = ((Date.now() - connectStartMs) / 1000).toFixed(1);
    connectSpinner.succeed(`Connected to ${chalk_1.default.cyan.bold(networkDisplayName)} ${chalk_1.default.dim(`(${connectElapsed}s)`)}`);
    logger_1.logger.blank();
    logger_1.logger.section('Network');
    logger_1.logger.log(`${chalk_1.default.dim('Endpoint:')}   ${chalk_1.default.white(networkUrl)}`);
    logger_1.logger.log(`${chalk_1.default.dim('Ledger:')}     ${chalk_1.default.white('#' + serverInfo.ledgerIndex.toLocaleString())}`);
    if (serverInfo.buildVersion) {
        logger_1.logger.log(`${chalk_1.default.dim('Version:')}    ${chalk_1.default.dim(serverInfo.buildVersion)}`);
    }
    if (isLocal) {
        logger_1.logger.log(`${chalk_1.default.dim('Genesis:')}    ${chalk_1.default.dim(standalone_1.GENESIS_ADDRESS)}`);
        logger_1.logger.log(`${chalk_1.default.dim('Faucet:')}     ${chalk_1.default.dim('http://localhost:3001')}`);
        const ledgerInterval = options.ledgerInterval ?? 1000;
        if (noConsensus) {
            logger_1.logger.log(`${chalk_1.default.dim('Ledger:')}     ${chalk_1.default.dim(`auto-advance every ${ledgerInterval}ms (standalone)`)}`);
        }
        else {
            logger_1.logger.log(`${chalk_1.default.dim('Ledger:')}     ${chalk_1.default.dim('consensus close ~4s (persistent)')}`);
        }
        if (options.debug) {
            logger_1.logger.log(`${chalk_1.default.dim('Logs:')}       ${chalk_1.default.dim('debug level — run: xrpl-up logs rippled')}`);
        }
        if (options.noRestart) {
            logger_1.logger.log(`${chalk_1.default.dim('Restart:')}    ${chalk_1.default.dim('disabled — container will exit with rippled\'s code')}`);
        }
    }
    logger_1.logger.blank();
    // ── Fund accounts ──────────────────────────────────────────────────────────
    const config = (0, config_1.loadConfig)();
    // In persist mode, keep existing accounts — the ledger state is preserved.
    // In ephemeral mode, wipe and re-fund fresh accounts every run.
    if (!persist)
        store.clear();
    const existingAccounts = store.all();
    const count = options.accountCount ?? (config.accounts?.count ?? 10);
    // In persist mode with existing accounts, skip funding and reload from store.
    if (persist && existingAccounts.length > 0) {
        logger_1.logger.info(`Resuming with ${chalk_1.default.cyan(String(existingAccounts.length))} persisted accounts  ${chalk_1.default.dim('(use xrpl-up reset to start fresh)')}`);
        logger_1.logger.blank();
    }
    const fundLabel = isLocal ? 'local faucet' : 'testnet faucet';
    const shouldFund = !persist || existingAccounts.length === 0;
    const fundStartMs = Date.now();
    const fundSpinner = shouldFund ? (0, ora_1.default)({
        text: chalk_1.default.dim(`Funding account 1/${count} from ${fundLabel}…`),
        color: 'cyan',
        indent: 2,
    }).start() : null;
    const funded = shouldFund ? [] : existingAccounts
        .map(a => ({
        wallet: store.toWallet(a),
        balance: a.balance,
    }));
    if (shouldFund) {
        const FAUCET_DELAY_MS = 1200; // polite pause between remote faucet calls
        for (let i = 0; i < count; i++) {
            fundSpinner.text = chalk_1.default.dim(`Funding account ${i + 1}/${count} from ${fundLabel}…`);
            try {
                let wallet;
                let balance;
                if (isLocal) {
                    // Call the local faucet HTTP server
                    const result = await callFaucet();
                    wallet = xrpl_1.Wallet.fromSeed(result.seed);
                    balance = result.balance;
                }
                else {
                    const result = await manager.client.fundWallet();
                    wallet = result.wallet;
                    balance = result.balance;
                    if (i < count - 1)
                        await sleep(FAUCET_DELAY_MS);
                }
                funded.push({ wallet, balance });
                store.add(wallet, balance);
            }
            catch (err) {
                fundSpinner.fail(`Failed to fund account ${i + 1}`);
                logger_1.logger.error(err instanceof Error ? err.message : String(err));
                await manager.disconnect();
                if (isLocal)
                    (0, compose_1.composeDown)();
                process.exit(1);
            }
        }
        const fundElapsed = ((Date.now() - fundStartMs) / 1000).toFixed(1);
        fundSpinner.succeed(chalk_1.default.green(`${count} accounts funded on ${chalk_1.default.cyan(networkDisplayName)}`) + chalk_1.default.dim(` (${fundElapsed}s)`));
        logger_1.logger.blank();
    }
    // ── Address → friendly name map (used by transaction log) ─────────────────
    const addressMap = new Map();
    for (const [i, { wallet }] of funded.entries()) {
        addressMap.set(wallet.address, `Account #${i}`);
    }
    function labelAddress(addr) {
        return addressMap.get(addr) ?? addr.slice(0, 8) + '…';
    }
    // ── Warning ────────────────────────────────────────────────────────────────
    console.log(chalk_1.default.yellow.bold('  WARNING') +
        chalk_1.default.yellow(' — These accounts and their private keys are publicly known.'));
    console.log(chalk_1.default.yellow('           Any funds sent to them on Mainnet WILL BE LOST.'));
    logger_1.logger.blank();
    // ── Accounts table ─────────────────────────────────────────────────────────
    logger_1.logger.section('Accounts');
    const printSecrets = !options.noSecrets && !options.detach;
    const table = new cli_table3_1.default({
        head: printSecrets
            ? [chalk_1.default.cyan('#'), chalk_1.default.cyan('Address'), chalk_1.default.cyan('Balance'), chalk_1.default.cyan('Seed')]
            : [chalk_1.default.cyan('#'), chalk_1.default.cyan('Address'), chalk_1.default.cyan('Balance')],
        style: { head: [], border: [] },
        chars: TABLE_CHARS,
        colWidths: printSecrets ? [4, 38, 13, 34] : [4, 38, 13],
    });
    for (const [i, { wallet, balance }] of funded.entries()) {
        const row = [
            chalk_1.default.dim(String(i)),
            chalk_1.default.white(wallet.address),
            chalk_1.default.green(`${balance} XRP`),
        ];
        if (printSecrets)
            row.push(chalk_1.default.dim(wallet.seed ?? '—'));
        table.push(row);
    }
    printTable(table.toString());
    logger_1.logger.blank();
    // ── Private keys (suppressed when detached / --no-secrets) ────────────────
    if (printSecrets) {
        logger_1.logger.section('Private Keys');
        for (const [i, { wallet }] of funded.entries()) {
            logger_1.logger.log(`${chalk_1.default.dim('Account #' + i + ':')} ${chalk_1.default.white(wallet.address)}`);
            logger_1.logger.log(`${chalk_1.default.dim('Private Key: ')} ${chalk_1.default.dim(wallet.privateKey)}`);
            logger_1.logger.blank();
        }
    }
    // ── Detach mode (CI/CD) ────────────────────────────────────────────────────
    if (isLocal && options.detach) {
        logger_1.logger.log(`  ${chalk_1.default.green('✔')} Sandbox ready  ${chalk_1.default.dim('→')}  ${chalk_1.default.cyan(compose_1.LOCAL_WS_URL)}`);
        if (noConsensus) {
            logger_1.logger.dim(`  Auto-advancing ledger every ${options.ledgerInterval ?? 1000}ms via faucet server`);
        }
        else {
            logger_1.logger.dim(`  Consensus network — ledgers close automatically every ~4s`);
        }
        logger_1.logger.dim(`  Run ${chalk_1.default.white('xrpl-up stop')} to tear down`);
        logger_1.logger.blank();
        await manager.disconnect();
        return;
    }
    // ── Keep alive ─────────────────────────────────────────────────────────────
    logger_1.logger.section('Sandbox running');
    if (isLocal) {
        const ledgerInterval = options.ledgerInterval ?? 1000;
        const advanceMsg = options.noAutoAdvance
            ? 'auto-advance disabled'
            : `auto-advancing ledger every ${ledgerInterval}ms`;
        logger_1.logger.dim(`Local rippled  ·  ${advanceMsg}  ·  Press Ctrl+C to stop`);
        logger_1.logger.dim(`Logs: xrpl-up logs | xrpl-up logs rippled | xrpl-up logs faucet`);
    }
    else {
        logger_1.logger.dim('Subscribed to ledger stream  ·  Press Ctrl+C to stop');
    }
    logger_1.logger.blank();
    // ── Auto-ledger-advance (standalone local mode only) ────────────────────────
    let advanceHandle;
    if (isLocal && !noConsensus && !options.noAutoAdvance) {
        // Consensus mode: ledgers close automatically via consensus.
        // Subscribe to transactions for live display (no ledger_accept needed).
        await manager.subscribeToTransactions((tx) => {
            const t = (tx.transaction ?? tx);
            const meta = tx.meta;
            const result = meta?.TransactionResult ?? 'unknown';
            const ok = result === 'tesSUCCESS';
            const icon = ok ? chalk_1.default.green('✓') : chalk_1.default.red('✗');
            const type = chalk_1.default.white(String(t.TransactionType ?? '').padEnd(18));
            const from = chalk_1.default.dim(labelAddress(String(t.Account ?? '')));
            const to = t.Destination
                ? chalk_1.default.dim(' → ') + chalk_1.default.dim(labelAddress(String(t.Destination)))
                : '';
            const fee = chalk_1.default.dim(`fee: ${t.Fee ?? '?'} drops`);
            const outcome = ok ? '' : chalk_1.default.red(`  ${(0, tec_codes_1.tecMessage)(result)}`);
            console.log(`\n  ${icon} ${type} ${from}${to}  ${fee}${outcome}`);
        });
    }
    else if (isLocal && !options.noAutoAdvance) {
        const ledgerInterval = options.ledgerInterval ?? 1000;
        const scheduleAdvance = () => {
            advanceHandle = setTimeout(async () => {
                try {
                    const res = await manager.client.request({ command: 'ledger_accept' });
                    const idx = res.result.ledger_current_index ?? 0;
                    process.stdout.write(`\r  ${chalk_1.default.dim('Ledger')} ${chalk_1.default.cyan('#' + idx.toLocaleString())}` +
                        `  ${chalk_1.default.dim('·')}  ${chalk_1.default.dim('auto-advance')}` +
                        `  ${chalk_1.default.dim('·')}  ${chalk_1.default.dim(new Date().toLocaleTimeString())}` +
                        '          ');
                }
                catch { /* swallow — node may be shutting down */ }
                scheduleAdvance();
            }, ledgerInterval);
        };
        scheduleAdvance();
        // ── Live transaction log ─────────────────────────────────────────────────
        await manager.subscribeToTransactions((tx) => {
            const t = (tx.transaction ?? tx);
            const meta = tx.meta;
            const result = meta?.TransactionResult ?? 'unknown';
            const ok = result === 'tesSUCCESS';
            const icon = ok ? chalk_1.default.green('✓') : chalk_1.default.red('✗');
            const type = chalk_1.default.white(String(t.TransactionType ?? '').padEnd(18));
            const from = chalk_1.default.dim(labelAddress(String(t.Account ?? '')));
            const to = t.Destination
                ? chalk_1.default.dim(' → ') + chalk_1.default.dim(labelAddress(String(t.Destination)))
                : '';
            const fee = chalk_1.default.dim(`fee: ${t.Fee ?? '?'} drops`);
            const outcome = ok ? '' : chalk_1.default.red(`  ${(0, tec_codes_1.tecMessage)(result)}`);
            console.log(`\n  ${icon} ${type} ${from}${to}  ${fee}${outcome}`);
        });
    }
    else {
        // Remote networks: just display ledger closes
        await manager.subscribeToLedger((ledgerIndex, txnCount) => {
            process.stdout.write(`\r  ${chalk_1.default.dim('Ledger')} ${chalk_1.default.cyan('#' + ledgerIndex.toLocaleString())}` +
                `  ${chalk_1.default.dim('·')}  ${chalk_1.default.dim('Txns:')} ${chalk_1.default.white(String(txnCount))}` +
                `  ${chalk_1.default.dim('·')}  ${chalk_1.default.dim(new Date().toLocaleTimeString())}` +
                '          ');
        });
    }
    // ── Graceful shutdown ──────────────────────────────────────────────────────
    process.on('SIGINT', async () => {
        console.log('\n');
        if (advanceHandle)
            clearTimeout(advanceHandle);
        logger_1.logger.info('Shutting down sandbox…');
        await manager.disconnect();
        if (isLocal) {
            logger_1.logger.info('Stopping local stack…');
            (0, compose_1.composeDown)();
        }
        process.exit(0);
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
