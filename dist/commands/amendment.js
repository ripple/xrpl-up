"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.amendmentListCommand = amendmentListCommand;
exports.amendmentInfoCommand = amendmentInfoCommand;
exports.amendmentEnableCommand = amendmentEnableCommand;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const node_readline_1 = __importDefault(require("node:readline"));
const xrpl_1 = require("xrpl");
const config_1 = require("../core/config");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const compose_1 = require("../core/compose");
const logger_1 = require("../utils/logger");
const reset_1 = require("./reset");
// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveSourceUrl(from) {
    // Accept raw WebSocket URLs directly
    if (from.startsWith('ws://') || from.startsWith('wss://')) {
        return from;
    }
    const config = (0, config_1.loadConfig)();
    try {
        const { config: netCfg } = (0, config_1.resolveNetwork)(config, from);
        return netCfg.url;
    }
    catch {
        throw new Error(`Unknown source network: "${from}". ` +
            `Available: ${Object.keys(config_1.DEFAULT_CONFIG.networks).join(', ')}, or a raw WebSocket URL`);
    }
}
async function fetchFeatures(url) {
    const client = new xrpl_1.Client(url, { timeout: 60_000 });
    await client.connect();
    try {
        const resp = await client.request({ command: 'feature' });
        const features = resp.result.features;
        return Object.entries(features).map(([hash, info]) => ({
            hash,
            name: info.name ?? hash.slice(0, 20) + '…',
            enabled: info.enabled,
            supported: info.supported,
            vetoed: info.vetoed,
        }));
    }
    finally {
        await client.disconnect();
    }
}
function pad(s, n) {
    return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function printQueuedAmendments() {
    if (!node_fs_1.default.existsSync(compose_1.EXTRA_AMENDMENTS_FILE))
        return;
    const lines = node_fs_1.default.readFileSync(compose_1.EXTRA_AMENDMENTS_FILE, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));
    if (lines.length === 0)
        return;
    logger_1.logger.blank();
    logger_1.logger.log(`  ${chalk_1.default.bold('Queued genesis amendments:')}`);
    for (const line of lines) {
        const [, ...nameParts] = line.split(' ');
        const name = nameParts.join(' ') || line.slice(0, 20) + '…';
        logger_1.logger.log(`    ${chalk_1.default.green('✔')} ${chalk_1.default.white(name)}`);
    }
    logger_1.logger.blank();
}
function confirm(question) {
    return new Promise(resolve => {
        const rl = node_readline_1.default.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question + ' ', answer => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}
async function amendmentListCommand(options) {
    const targetUrl = options.local
        ? compose_1.LOCAL_WS_URL
        : (0, config_1.resolveNetwork)((0, config_1.loadConfig)(), options.network).config.url;
    const targetLabel = options.local ? 'local' : (options.network ?? (0, config_1.loadConfig)().defaultNetwork);
    const spinner = (0, ora_1.default)({
        text: `Fetching amendments from ${chalk_1.default.cyan(targetLabel)}…`,
        color: 'cyan',
        indent: 2,
    }).start();
    try {
        const amendments = await fetchFeatures(targetUrl);
        let diffMap = null;
        if (options.diff) {
            spinner.text = `Fetching amendments from ${chalk_1.default.cyan(options.diff)} for comparison…`;
            const diffAmendments = await fetchFeatures(resolveSourceUrl(options.diff));
            diffMap = new Map(diffAmendments.map(a => [a.hash, a]));
        }
        spinner.stop();
        const filtered = options.disabled
            ? amendments.filter(a => !a.enabled)
            : amendments;
        const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
        const NAME_W = 34;
        const HASH_W = 18;
        if (diffMap) {
            // Side-by-side diff view
            logger_1.logger.log(`\n  ${chalk_1.default.bold(pad('Name', NAME_W))}  ${chalk_1.default.bold(pad('Hash', HASH_W))}  ` +
                `${chalk_1.default.bold(pad(targetLabel, 8))}  ${chalk_1.default.bold(options.diff)}`);
            logger_1.logger.log('  ' + '─'.repeat(NAME_W + HASH_W + 26));
            for (const a of sorted) {
                const localMark = a.enabled ? chalk_1.default.green('✔') : chalk_1.default.dim('✗');
                const diffInfo = diffMap.get(a.hash);
                const diffMark = diffInfo?.enabled ? chalk_1.default.green('✔') : chalk_1.default.dim('✗');
                const nameStr = a.enabled ? chalk_1.default.white(pad(a.name, NAME_W)) : chalk_1.default.dim(pad(a.name, NAME_W));
                const gap = a.enabled !== diffInfo?.enabled ? chalk_1.default.yellow(' ◄ gap') : '';
                logger_1.logger.log(`  ${nameStr}  ${chalk_1.default.dim(pad(a.hash.slice(0, 16) + '…', HASH_W))}  ${pad(localMark, 8)}  ${diffMark}${gap}`);
            }
            // Amendments on diff network not in local at all
            for (const [hash, info] of diffMap.entries()) {
                if (!amendments.find(a => a.hash === hash) && info.enabled) {
                    logger_1.logger.log(`  ${chalk_1.default.red(pad(info.name, NAME_W))}  ${chalk_1.default.dim(pad(hash.slice(0, 16) + '…', HASH_W))}  ` +
                        `${chalk_1.default.dim('✗ (n/s)')}  ${chalk_1.default.green('✔')}${chalk_1.default.yellow(' ◄ unsupported by local build')}`);
                }
            }
        }
        else {
            // Simple list
            logger_1.logger.log(`\n  ${chalk_1.default.bold(pad('Name', NAME_W))}  ${chalk_1.default.bold(pad('Hash', HASH_W))}  ` +
                `${chalk_1.default.bold('Enabled')}  ${chalk_1.default.bold('Supported')}`);
            logger_1.logger.log('  ' + '─'.repeat(NAME_W + HASH_W + 20));
            for (const a of sorted) {
                const enabledMark = a.enabled ? chalk_1.default.green('✔') : chalk_1.default.dim('✗');
                const supportedMark = a.supported ? chalk_1.default.green('✔') : chalk_1.default.dim('✗');
                const nameStr = a.enabled ? chalk_1.default.white(pad(a.name, NAME_W)) : chalk_1.default.dim(pad(a.name, NAME_W));
                logger_1.logger.log(`  ${nameStr}  ${chalk_1.default.dim(pad(a.hash.slice(0, 16) + '…', HASH_W))}  ${pad(enabledMark, 9)}  ${supportedMark}`);
            }
        }
        logger_1.logger.blank();
        const enabled = amendments.filter(a => a.enabled).length;
        const supported = amendments.filter(a => a.supported && !a.enabled).length;
        logger_1.logger.dim(`  ${enabled} enabled  ·  ${supported} supported but not enabled  ·  ${amendments.length} total known`);
        logger_1.logger.blank();
    }
    catch (err) {
        spinner.fail('Failed to fetch amendments');
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
async function amendmentInfoCommand(nameOrHash, options) {
    const targetUrl = options.local
        ? compose_1.LOCAL_WS_URL
        : (0, config_1.resolveNetwork)((0, config_1.loadConfig)(), options.network).config.url;
    const targetLabel = options.local ? 'local' : (options.network ?? (0, config_1.loadConfig)().defaultNetwork);
    const spinner = (0, ora_1.default)({
        text: `Looking up amendment on ${chalk_1.default.cyan(targetLabel)}…`,
        color: 'cyan',
        indent: 2,
    }).start();
    try {
        const amendments = await fetchFeatures(targetUrl);
        const query = nameOrHash.toLowerCase();
        const found = amendments.find(a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query));
        if (!found) {
            spinner.fail(`Amendment not found: ${nameOrHash}`);
            logger_1.logger.dim('  Run: xrpl-up amendment list to see all known amendments.');
            process.exit(1);
        }
        spinner.succeed(chalk_1.default.green(`Amendment: ${found.name}`));
        logger_1.logger.blank();
        const W = 12;
        const row = (k, v) => logger_1.logger.log(`  ${chalk_1.default.dim(pad(k + ':', W))} ${v}`);
        row('Name', chalk_1.default.white(found.name));
        row('Hash', chalk_1.default.dim(found.hash));
        row('Enabled', found.enabled ? chalk_1.default.green('✔ yes') : chalk_1.default.dim('✗ no'));
        row('Supported', found.supported ? chalk_1.default.green('✔ yes') : chalk_1.default.red('✗ no (rippled image too old)'));
        row('Vetoed', found.vetoed === 'Obsolete'
            ? chalk_1.default.yellow('retired (Obsolete) — always on in this rippled, cannot be enabled')
            : found.vetoed ? chalk_1.default.red('✔ yes') : chalk_1.default.dim('no'));
        logger_1.logger.blank();
        if (!found.enabled && found.supported && found.vetoed !== 'Obsolete') {
            logger_1.logger.dim(`  Enable with: xrpl-up amendment enable ${found.name}`);
            logger_1.logger.blank();
        }
        if (!found.supported) {
            logger_1.logger.dim('  Upgrade the local rippled image to support this amendment:');
            logger_1.logger.dim('    xrpl-up reset && xrpl-up start --image <newer-image>');
            logger_1.logger.blank();
        }
    }
    catch (err) {
        spinner.fail('Failed to look up amendment');
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
async function amendmentEnableCommand(namesOrHashes, options) {
    if (!options.local) {
        logger_1.logger.error('amendment enable only works on the local sandbox (cannot admin-RPC a public node) — omit --network, or pass --network local.');
        process.exit(1);
    }
    const spinner = (0, ora_1.default)({
        text: namesOrHashes.length === 1
            ? `Enabling amendment ${chalk_1.default.cyan(namesOrHashes[0])} on local sandbox…`
            : `Enabling ${namesOrHashes.length} amendments on local sandbox…`,
        color: 'cyan',
        indent: 2,
    }).start();
    const client = new xrpl_1.Client(compose_1.LOCAL_WS_URL, { timeout: 60_000 });
    try {
        await client.connect();
        // Resolve each name/hash up front — fail fast on the first bad one before
        // queuing anything, so a typo in a batch doesn't leave a partial queue.
        const amendments = await fetchFeatures(compose_1.LOCAL_WS_URL);
        const toQueue = [];
        const alreadyEnabled = [];
        for (const nameOrHash of namesOrHashes) {
            const query = nameOrHash.toLowerCase();
            const found = amendments.find(a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query));
            if (!found) {
                spinner.fail(`Amendment not found: ${nameOrHash}`);
                logger_1.logger.dim('  Run: xrpl-up amendment list to see available amendments.');
                await client.disconnect();
                process.exit(1);
            }
            if (!found.supported) {
                spinner.fail(`Amendment not supported by local rippled build: ${found.name}`);
                logger_1.logger.dim('  Upgrade the local rippled image to include this amendment.');
                await client.disconnect();
                process.exit(1);
            }
            if (found.vetoed === 'Obsolete') {
                spinner.fail(`${found.name} is retired (Obsolete) in this rippled and cannot be enabled`);
                logger_1.logger.dim('  Its behaviour is already always on; queueing it would do nothing.');
                await client.disconnect();
                process.exit(1);
            }
            if (found.enabled) {
                alreadyEnabled.push(found);
            }
            else if (!toQueue.some(a => a.hash === found.hash)) {
                toQueue.push(found);
            }
        }
        for (const a of alreadyEnabled) {
            logger_1.logger.dim(`  Already enabled: ${a.name}`);
        }
        if (toQueue.length === 0) {
            spinner.succeed(chalk_1.default.green('Nothing to do — all requested amendments are already enabled.'));
            await client.disconnect();
            return;
        }
        // Amendments cannot be activated at runtime in standalone mode — the voting
        // process requires validator messages that ledger_accept does not generate.
        // Instead, add them to the genesis config so they activate on the
        // next fresh start (after xrpl-up reset).
        spinner.text = toQueue.length === 1
            ? `Adding ${chalk_1.default.cyan(toQueue[0].name)} to genesis config…`
            : `Adding ${toQueue.length} amendments to genesis config…`;
        const existing = node_fs_1.default.existsSync(compose_1.EXTRA_AMENDMENTS_FILE)
            ? node_fs_1.default.readFileSync(compose_1.EXTRA_AMENDMENTS_FILE, 'utf-8')
            : '';
        let updated = existing;
        for (const found of toQueue) {
            if (!updated.includes(found.hash)) {
                updated += `${found.hash} ${found.name}\n`;
            }
        }
        if (updated !== existing) {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(compose_1.EXTRA_AMENDMENTS_FILE), { recursive: true });
            node_fs_1.default.writeFileSync(compose_1.EXTRA_AMENDMENTS_FILE, updated, 'utf-8');
        }
        // Regenerate rippled.cfg so the next `xrpl-up start` picks it up automatically.
        (0, compose_1.writeRippledConfig)();
        spinner.succeed(chalk_1.default.green(toQueue.length === 1
            ? `Amendment queued for next genesis: ${toQueue[0].name}`
            : `${toQueue.length} amendments queued for next genesis: ${toQueue.map(a => a.name).join(', ')}`));
        logger_1.logger.blank();
        for (const a of toQueue) {
            logger_1.logger.dim(`  ${a.name}: ${a.hash}`);
        }
        logger_1.logger.blank();
        logger_1.logger.log(chalk_1.default.yellow(`  ⚠  Activating ${toQueue.length === 1 ? 'this amendment' : 'these amendments'} requires a full node reset.\n`) +
            chalk_1.default.dim('     Ledger data and funded accounts will be wiped. Saved snapshots are kept.'));
        logger_1.logger.blank();
        const yes = options.autoReset || await confirm(chalk_1.default.bold('  Reset and restart the local node now? [y/N]'));
        // Capture the mode before resetting, so the restart hint below names the
        // mode the user was actually running. Suggesting bare `start` to someone
        // on --local-network would silently drop them into standalone.
        const startCommand = (0, compose_1.startCommandHint)();
        // isConsensusMode() reads docker-compose.yml, which resetCommand() below
        // regenerates — capture this before resetting or it always reads as
        // standalone afterward.
        const wasConsensusMode = (0, compose_1.isConsensusMode)();
        if (yes) {
            logger_1.logger.blank();
            // keepAmendments: the reset here exists purely to rebuild genesis with the
            // amendments just queued above — clearing them would defeat the point.
            (0, reset_1.resetCommand)({ keepAmendments: true });
            printQueuedAmendments();
            logger_1.logger.dim('  Run the following to start with the new amendment(s) active:');
            logger_1.logger.dim(`    ${startCommand}`);
            logger_1.logger.blank();
        }
        else {
            logger_1.logger.blank();
            logger_1.logger.dim('  To activate later, run:');
            logger_1.logger.dim('    xrpl-up reset');
            logger_1.logger.dim(`    ${startCommand}`);
            logger_1.logger.blank();
        }
    }
    catch (err) {
        await client.disconnect().catch(() => { });
        spinner.fail('Failed to enable amendment(s)');
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    await client.disconnect().catch(() => { });
}
