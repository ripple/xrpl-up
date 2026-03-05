import chalk from 'chalk';
import ora from 'ora';
import { Wallet } from 'xrpl';
import { loadConfig, resolveNetwork, isMainnet } from '../core/config';
import { NetworkManager } from '../core/network';
import { FAUCET_URL } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

export interface FaucetOptions {
  network?: string;  // 'local' | 'testnet' | 'devnet' | 'mainnet' | custom name
  seed?: string;
}

export async function faucetCommand(options: FaucetOptions = {}): Promise<void> {
  // ── Local faucet (POST to localhost:3001) ────────────────────────────────────
  if (options.network === 'local') {
    const targetWallet = options.seed ? Wallet.fromSeed(options.seed) : undefined;
    const targetAddress = targetWallet?.address ?? 'new account';

    const spinner = ora({
      text: `Funding ${chalk.cyan(targetAddress)} via local faucet…`,
      color: 'cyan',
      indent: 2,
    }).start();

    try {
      const body = targetWallet ? JSON.stringify({ destination: targetWallet.address }) : undefined;
      const res = await fetch(`${FAUCET_URL}/faucet`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body,
      });
      if (!res.ok) throw new Error(`Faucet responded with ${res.status}: ${res.statusText}`);
      const data = await res.json() as { address: string; seed?: string; balance: number };

      // When seed was provided: use the caller's wallet (server returns no seed).
      // When no seed:            build wallet from the server-generated seed.
      const wallet = targetWallet ?? (data.seed ? Wallet.fromSeed(data.seed) : undefined);

      if (wallet) new WalletStore('local').add(wallet, data.balance);

      spinner.succeed(chalk.green('Account funded on local sandbox'));
      logger.blank();
      logger.log(`${chalk.dim('Address:')}     ${chalk.white(data.address)}`);
      logger.log(`${chalk.dim('Balance:')}     ${chalk.green(data.balance + ' XRP')}`);
      if (wallet?.seed)       logger.log(`${chalk.dim('Seed:')}        ${chalk.dim(wallet.seed)}`);
      if (wallet?.privateKey) logger.log(`${chalk.dim('Private Key:')} ${chalk.dim(wallet.privateKey)}`);
      logger.blank();
    } catch (err: unknown) {
      spinner.fail('Local faucet request failed');
      const cause = (err as any)?.cause;
      const isConnRefused =
        (cause as any)?.code === 'ECONNREFUSED' ||
        (err instanceof Error && err.message.includes('fetch failed'));
      if (isConnRefused) {
        logger.error(`Cannot reach local faucet at ${FAUCET_URL}`);
        logger.error('Is the sandbox running?  Try: xrpl-up node --local --detach');
      } else {
        logger.error(err instanceof Error ? err.message : String(err));
      }
      process.exit(1);
    }
    return;
  }

  // ── Remote faucet (testnet / devnet) ────────────────────────────────────────
  const config = loadConfig();
  const { name: networkName, config: networkConfig } = resolveNetwork(config, options.network);

  if (isMainnet(networkName, networkConfig)) {
    logger.error('Faucet is not available on Mainnet.');
    process.exit(1);
  }

  const manager = new NetworkManager(networkName, networkConfig);

  const targetWallet = options.seed ? Wallet.fromSeed(options.seed) : undefined;
  const targetAddress = targetWallet?.address ?? 'new account';

  const spinner = ora({
    text: `Funding ${chalk.cyan(targetAddress)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const result = await manager.client.fundWallet(targetWallet);
    await manager.disconnect();

    new WalletStore(networkName).add(result.wallet, result.balance);

    spinner.succeed(chalk.green(`Account funded on ${chalk.cyan(manager.displayName)}`));
    logger.blank();
    logger.log(`${chalk.dim('Address:')}     ${chalk.white(result.wallet.address)}`);
    logger.log(`${chalk.dim('Balance:')}     ${chalk.green(result.balance + ' XRP')}`);
    if (result.wallet.seed) {
      logger.log(`${chalk.dim('Seed:')}        ${chalk.dim(result.wallet.seed)}`);
    }
    logger.log(`${chalk.dim('Private Key:')} ${chalk.dim(result.wallet.privateKey)}`);
    logger.blank();
  } catch (err: unknown) {
    spinner.fail('Faucet request failed');
    logger.error(err instanceof Error ? err.message : String(err));
    await manager.disconnect();
    process.exit(1);
  }
}
