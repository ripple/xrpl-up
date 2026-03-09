import chalk from 'chalk';
import ora from 'ora';
import { Wallet } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { logger } from '../utils/logger';

// ── Shared helpers ────────────────────────────────────────────────────────────

interface NetworkInfo {
  networkName: string;
  networkConfig: { url: string; name?: string };
  isLocal: boolean;
}

function resolveNetworkInfo(options: { local?: boolean; network?: string }): NetworkInfo {
  if (options.local) {
    return {
      networkName: 'local',
      networkConfig: { url: LOCAL_WS_URL, name: 'Local rippled (Docker)' },
      isLocal: true,
    };
  }
  const config = loadConfig();
  const resolved = resolveNetwork(config, options.network);
  return {
    networkName: resolved.name,
    networkConfig: resolved.config,
    isLocal: resolved.name === 'local',
  };
}

// ── clawback iou ──────────────────────────────────────────────────────────────

export interface ClawbackIouOptions {
  amount: string;
  currency: string;
  holder: string;
  seed: string;
  local?: boolean;
  network?: string;
}

export async function clawbackIouCommand(options: ClawbackIouOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  // Validate that the issuer (signing wallet) is not the same as the holder
  if (wallet.address === options.holder) {
    logger.error('The issuer (--seed) and holder addresses must be different.');
    process.exit(1);
  }

  const spinner = ora({
    text: `Clawing back ${options.amount} ${options.currency.toUpperCase()} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    // XRPL counterparty convention: Amount.issuer = holder's address, not the actual issuer
    // The SDK enforces: Account (issuer) !== Amount.issuer (holder)
    // The Holder field must NOT be present for IOU clawback
    const tx: Record<string, unknown> = {
      TransactionType: 'Clawback',
      Account: wallet.address,
      Amount: {
        currency: options.currency.toUpperCase(),
        issuer: options.holder,   // counterparty convention: holder address goes here
        value: options.amount,
      },
    };

    spinner.text = 'Submitting Clawback…';
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('IOU tokens clawed back'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Issuer',   chalk.dim(wallet.address));
    row('Holder',   chalk.dim(options.holder));
    row('Currency', chalk.cyan(options.currency.toUpperCase()));
    row('Amount',   chalk.green(options.amount));
    logger.blank();
    logger.dim('  Note: issuer must have asfAllowTrustLineClawback set to perform IOU clawback.');
    logger.dim('  Enable with: xrpl-up accountset set allowClawback --seed <issuer-seed>');
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to clawback IOU tokens');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── clawback mpt ──────────────────────────────────────────────────────────────

export interface ClawbackMptOptions {
  issuanceId: string;
  holder: string;
  amount: string;
  seed: string;
  local?: boolean;
  network?: string;
}

export async function clawbackMptCommand(options: ClawbackMptOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Clawing back ${options.amount} MPT on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    // For MPT clawback the Holder field is REQUIRED (unlike IOU where it must be absent).
    // The correct field name is "Holder" — NOT "MPTokenHolder".
    const tx: Record<string, unknown> = {
      TransactionType: 'Clawback',
      Account: wallet.address,
      Amount: {
        mpt_issuance_id: options.issuanceId,
        value: options.amount,
      },
      Holder: options.holder,   // required for MPT; SDK throws if missing
    };

    spinner.text = 'Submitting Clawback…';
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('MPT tokens clawed back'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W   = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Issuer',      chalk.dim(wallet.address));
    row('Holder',      chalk.dim(options.holder));
    row('Issuance ID', chalk.cyan(options.issuanceId));
    row('Amount',      chalk.green(options.amount));
    logger.blank();
    logger.dim('  Note: the MPT issuance must have been created with --can-clawback.');
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to clawback MPT tokens');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
