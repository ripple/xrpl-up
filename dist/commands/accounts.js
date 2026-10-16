"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountsCommand = accountsCommand;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const config_1 = require("../core/config");
const network_1 = require("../core/network");
const wallet_store_1 = require("../core/wallet-store");
const compose_1 = require("../core/compose");
const logger_1 = require("../utils/logger");
async function accountsCommand(options = {}) {
    let networkName;
    let networkConfig;
    if (options.local) {
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
    // ── Single address lookup (--address) ─────────────────────────────────────
    if (options.address) {
        const spinner = (0, ora_1.default)({
            text: `Looking up ${chalk_1.default.cyan(options.address)}…`,
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
            const data = res.result.account_data;
            const balance = Number(data.Balance) / 1_000_000;
            const seq = data.Sequence;
            spinner.succeed(`Found ${chalk_1.default.cyan(options.address)}`);
            logger_1.logger.blank();
            const table = new cli_table3_1.default({
                head: [chalk_1.default.cyan('Address'), chalk_1.default.cyan('Balance'), chalk_1.default.cyan('Sequence')],
                style: { head: [], border: [] },
                colWidths: [38, 20, 12],
            });
            table.push([
                chalk_1.default.white(options.address),
                chalk_1.default.green(balance.toFixed(6) + ' XRP'),
                chalk_1.default.dim(String(seq)),
            ]);
            const tableStr = table.toString().split('\n').map((l) => '  ' + l).join('\n');
            console.log(tableStr);
            logger_1.logger.blank();
        }
        catch (err) {
            await manager.disconnect().catch(() => { });
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('actNotFound') || msg.includes('Account not found')) {
                spinner.fail(`Account not found on ${networkName}: ${options.address}`);
            }
            else {
                spinner.fail('Lookup failed');
                logger_1.logger.error(msg);
            }
            process.exit(1);
        }
        return;
    }
    // ── Wallet store listing ───────────────────────────────────────────────────
    const store = new wallet_store_1.WalletStore(networkName);
    const accounts = store.all();
    if (accounts.length === 0) {
        logger_1.logger.warning(`No sandbox accounts found for "${networkName}". Run \`xrpl-up start\` first.`);
        return;
    }
    const spinner = (0, ora_1.default)({
        text: `Fetching live balances from ${chalk_1.default.cyan(manager.displayName)}…`,
        color: 'cyan',
        indent: 2,
    }).start();
    try {
        await manager.connect();
        const rows = [];
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
            }
            catch {
                // use stored balance
                cached = true;
                anyCached = true;
            }
            rows.push([
                chalk_1.default.dim(String(acct.index)),
                chalk_1.default.white(acct.address),
                cached
                    ? chalk_1.default.yellow(balance.toFixed(6) + ' XRP') + chalk_1.default.dim(' (cached)')
                    : chalk_1.default.green(balance.toFixed(6) + ' XRP'),
                chalk_1.default.dim(acct.seed || '—'),
            ]);
        }
        await manager.disconnect();
        spinner.succeed(`${accounts.length} accounts on ${chalk_1.default.cyan(networkName)}`);
        logger_1.logger.blank();
        const table = new cli_table3_1.default({
            head: [
                chalk_1.default.cyan('#'),
                chalk_1.default.cyan('Address'),
                chalk_1.default.cyan('Balance'),
                chalk_1.default.cyan('Seed'),
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
            logger_1.logger.warning('Some balances shown from cache — node may not be ready yet.');
        }
        logger_1.logger.blank();
    }
    catch (err) {
        spinner.fail('Failed to fetch balances');
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        await manager.disconnect();
        process.exit(1);
    }
}
