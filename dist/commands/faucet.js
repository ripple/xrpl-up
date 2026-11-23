"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.faucetCommand = faucetCommand;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const xrpl_1 = require("xrpl");
const config_1 = require("../core/config");
const network_1 = require("../core/network");
const compose_1 = require("../core/compose");
const wallet_store_1 = require("../core/wallet-store");
const logger_1 = require("../utils/logger");
async function faucetCommand(options = {}) {
    // ── Local faucet (POST to localhost:3001) ────────────────────────────────────
    if (options.network === 'local') {
        const targetWallet = options.seed ? xrpl_1.Wallet.fromSeed(options.seed) : undefined;
        const targetAddress = targetWallet?.address ?? 'new account';
        const spinner = options.json ? undefined : (0, ora_1.default)({
            text: `Funding ${chalk_1.default.cyan(targetAddress)} via local faucet…`,
            color: 'cyan',
            indent: 2,
        }).start();
        try {
            const body = targetWallet ? JSON.stringify({ destination: targetWallet.address }) : undefined;
            const res = await fetch(`${compose_1.FAUCET_URL}/faucet`, {
                method: 'POST',
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body,
            });
            if (!res.ok)
                throw new Error(`Faucet responded with ${res.status}: ${res.statusText}`);
            const data = await res.json();
            // When seed was provided: use the caller's wallet (server returns no seed).
            // When no seed:            build wallet from the server-generated seed.
            const wallet = targetWallet ?? (data.seed ? xrpl_1.Wallet.fromSeed(data.seed) : undefined);
            if (wallet)
                new wallet_store_1.WalletStore('local').add(wallet, data.balance);
            if (options.json) {
                console.log(JSON.stringify({
                    address: data.address,
                    seed: wallet?.seed,
                    privateKey: wallet?.privateKey,
                    balance: data.balance,
                }));
                return;
            }
            spinner.succeed(chalk_1.default.green('Account funded on local sandbox'));
            logger_1.logger.blank();
            logger_1.logger.log(`${chalk_1.default.dim('Address:')}     ${chalk_1.default.white(data.address)}`);
            logger_1.logger.log(`${chalk_1.default.dim('Balance:')}     ${chalk_1.default.green(data.balance + ' XRP')}`);
            if (wallet?.seed)
                logger_1.logger.log(`${chalk_1.default.dim('Seed:')}        ${chalk_1.default.dim(wallet.seed)}`);
            if (wallet?.privateKey)
                logger_1.logger.log(`${chalk_1.default.dim('Private Key:')} ${chalk_1.default.dim(wallet.privateKey)}`);
            logger_1.logger.blank();
        }
        catch (err) {
            spinner?.fail('Local faucet request failed');
            const cause = err?.cause;
            const isConnRefused = cause?.code === 'ECONNREFUSED' ||
                (err instanceof Error && err.message.includes('fetch failed'));
            if (isConnRefused) {
                logger_1.logger.error(`Cannot reach local faucet at ${compose_1.FAUCET_URL}`);
                logger_1.logger.error(`Is the sandbox running?  Try: ${(0, compose_1.startCommandHint)()}`);
            }
            else {
                logger_1.logger.error(err instanceof Error ? err.message : String(err));
            }
            process.exit(1);
        }
        return;
    }
    // ── Remote faucet (testnet / devnet) ────────────────────────────────────────
    const config = (0, config_1.loadConfig)();
    const { name: networkName, config: networkConfig } = (0, config_1.resolveNetwork)(config, options.network);
    if ((0, config_1.isMainnet)(networkName, networkConfig)) {
        logger_1.logger.error('Faucet is not available on Mainnet.');
        process.exit(1);
    }
    const manager = new network_1.NetworkManager(networkName, networkConfig);
    const targetWallet = options.seed ? xrpl_1.Wallet.fromSeed(options.seed) : undefined;
    const targetAddress = targetWallet?.address ?? 'new account';
    const spinner = options.json ? undefined : (0, ora_1.default)({
        text: `Funding ${chalk_1.default.cyan(targetAddress)} on ${chalk_1.default.cyan(manager.displayName)}…`,
        color: 'cyan',
        indent: 2,
    }).start();
    try {
        await manager.connect();
        const result = await manager.client.fundWallet(targetWallet);
        await manager.disconnect();
        new wallet_store_1.WalletStore(networkName).add(result.wallet, result.balance);
        if (options.json) {
            console.log(JSON.stringify({
                address: result.wallet.address,
                seed: result.wallet.seed,
                privateKey: result.wallet.privateKey,
                balance: result.balance,
            }));
            return;
        }
        spinner.succeed(chalk_1.default.green(`Account funded on ${chalk_1.default.cyan(manager.displayName)}`));
        logger_1.logger.blank();
        logger_1.logger.log(`${chalk_1.default.dim('Address:')}     ${chalk_1.default.white(result.wallet.address)}`);
        logger_1.logger.log(`${chalk_1.default.dim('Balance:')}     ${chalk_1.default.green(result.balance + ' XRP')}`);
        if (result.wallet.seed) {
            logger_1.logger.log(`${chalk_1.default.dim('Seed:')}        ${chalk_1.default.dim(result.wallet.seed)}`);
        }
        logger_1.logger.log(`${chalk_1.default.dim('Private Key:')} ${chalk_1.default.dim(result.wallet.privateKey)}`);
        logger_1.logger.blank();
    }
    catch (err) {
        spinner?.fail('Faucet request failed');
        logger_1.logger.error(err instanceof Error ? err.message : String(err));
        await manager.disconnect();
        process.exit(1);
    }
}
