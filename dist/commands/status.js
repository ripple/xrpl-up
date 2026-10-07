"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCommand = statusCommand;
const node_http_1 = __importDefault(require("node:http"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const config_1 = require("../core/config");
const network_1 = require("../core/network");
const compose_1 = require("../core/compose");
const logger_1 = require("../utils/logger");
function formatUptime(seconds) {
    if (seconds < 60)
        return `${seconds}s`;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600) % 24;
    const d = Math.floor(seconds / 86400);
    const parts = [];
    if (d)
        parts.push(`${d}d`);
    if (h)
        parts.push(`${h}h`);
    if (m)
        parts.push(`${m}m`);
    if (!parts.length)
        parts.push(`${seconds % 60}s`);
    return parts.join(' ');
}
async function checkFaucetHealth() {
    return new Promise((resolve) => {
        const req = node_http_1.default.request(`${compose_1.FAUCET_URL}/health`, { method: 'GET' }, (res) => {
            resolve(res.statusCode === 200 ? 'healthy' : 'unreachable');
        });
        req.setTimeout(3000, () => { req.destroy(); resolve('unreachable'); });
        req.on('error', () => resolve('unreachable'));
        req.end();
    });
}
async function statusCommand(options = {}) {
    let networkName;
    let networkConfig;
    const isLocal = options.local ?? false;
    if (isLocal) {
        networkName = 'local';
        networkConfig = { url: compose_1.LOCAL_WS_URL, name: 'Local rippled (Docker)' };
    }
    else {
        const config = (0, config_1.loadConfig)();
        const resolved = (0, config_1.resolveNetwork)(config, options.network);
        networkName = resolved.name;
        networkConfig = resolved.config;
    }
    const manager = new network_1.NetworkManager(networkName, networkConfig);
    const spinner = (0, ora_1.default)({
        text: `Fetching status from ${chalk_1.default.cyan(manager.displayName)}…`,
        color: 'cyan',
        indent: 2,
    }).start();
    try {
        await manager.connect();
        // Get full server_info (more fields than getServerInfo() helper)
        const res = await manager.client.request({ command: 'server_info' });
        const info = res.result.info;
        // For local mode, also check faucet health in parallel
        const faucetStatus = isLocal ? await checkFaucetHealth() : null;
        await manager.disconnect();
        spinner.stop();
        const ledgerSeq = info.validated_ledger?.seq ?? info.ledger_index ?? '—';
        const state = info.server_state ?? '—';
        const version = info.build_version ?? '—';
        const uptime = typeof info.uptime === 'number' ? formatUptime(info.uptime) : '—';
        const loadFactor = info.load_factor != null ? String(info.load_factor) : '—';
        const ledgers = info.complete_ledgers ?? '—';
        const peers = info.peers ?? 0;
        logger_1.logger.blank();
        logger_1.logger.section('Status · ' + chalk_1.default.cyan(manager.displayName));
        if (isLocal) {
            const mode = (0, compose_1.isConsensusMode)() ? 'Local network (--local-network, consensus)' : 'Standalone';
            logger_1.logger.log(`${chalk_1.default.dim('Mode:')}            ${chalk_1.default.white(mode)}`);
        }
        logger_1.logger.log(`${chalk_1.default.dim('Version:')}         ${chalk_1.default.white(version)}`);
        logger_1.logger.log(`${chalk_1.default.dim('State:')}           ${state === 'proposing' || state === 'full' ? chalk_1.default.green(state) : chalk_1.default.yellow(state)}`);
        logger_1.logger.log(`${chalk_1.default.dim('Ledger:')}          ${chalk_1.default.white('#' + String(ledgerSeq))}`);
        logger_1.logger.log(`${chalk_1.default.dim('Complete:')}        ${chalk_1.default.dim(ledgers)}`);
        logger_1.logger.log(`${chalk_1.default.dim('Uptime:')}          ${chalk_1.default.white(uptime)}`);
        logger_1.logger.log(`${chalk_1.default.dim('Load factor:')}     ${chalk_1.default.white(loadFactor)}`);
        logger_1.logger.log(`${chalk_1.default.dim('Peers:')}           ${chalk_1.default.dim(String(peers))}`);
        logger_1.logger.log(`${chalk_1.default.dim('Endpoint:')}        ${chalk_1.default.dim(networkConfig.url)}`);
        if (faucetStatus !== null) {
            const faucetLine = faucetStatus === 'healthy'
                ? chalk_1.default.green('✓ healthy') + chalk_1.default.dim('  ' + compose_1.FAUCET_URL)
                : chalk_1.default.red('✗ unreachable') + chalk_1.default.dim('  ' + compose_1.FAUCET_URL);
            logger_1.logger.log(`${chalk_1.default.dim('Faucet:')}          ${faucetLine}`);
        }
        logger_1.logger.blank();
    }
    catch (err) {
        spinner.fail(`Failed to fetch status from ${chalk_1.default.dim(networkConfig.url)}`);
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        if (isLocal) {
            logger_1.logger.dim('  Is the local sandbox running? Check with:');
            logger_1.logger.dim('    docker ps | grep xrpl-up');
            logger_1.logger.dim(`  Start it with: ${(0, compose_1.startCommandHint)()}`);
        }
        await manager.disconnect();
        process.exit(1);
    }
}
