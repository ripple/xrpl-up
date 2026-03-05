import chalk from 'chalk';
import ora from 'ora';
import {
  Wallet,
  xrpToDrops,
  signPaymentChannelClaim,
  verifyPaymentChannelClaim,
} from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';
import { WalletStore } from '../core/wallet-store';
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

// ── channel create ────────────────────────────────────────────────────────────

export interface ChannelCreateOptions {
  destination: string;
  amount: string;       // XRP, e.g. "10"
  settleDelay?: number; // seconds, default 86400 (1 day)
  local?: boolean;
  network?: string;
  seed?: string;
}

export async function channelCreateCommand(options: ChannelCreateOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager    = new NetworkManager(networkName, networkConfig);
  const settleDelay = options.settleDelay ?? 86400;

  const spinner = ora({
    text: `Creating payment channel on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const client = manager.client;

    let wallet: Wallet;
    if (options.seed) {
      wallet = Wallet.fromSeed(options.seed);
    } else if (isLocal) {
      spinner.text = 'Funding source wallet…';
      // Fund enough for channel amount + base reserve + buffer
      const fundAmount = Number(options.amount) + 20;
      const r = await fundWalletFromGenesis(client, fundAmount);
      wallet = r.wallet;
    } else {
      logger.error('--seed <seed> is required on remote networks');
      process.exit(1);
    }

    const tx = {
      TransactionType: 'PaymentChannelCreate',
      Account:     wallet.address,
      Amount:      xrpToDrops(options.amount),
      Destination: options.destination,
      SettleDelay: settleDelay,
      PublicKey:   wallet.publicKey,
    };

    spinner.text = 'Submitting PaymentChannelCreate…';
    const prepared = await client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    // Extract channel ID from metadata
    const meta        = (result.result as any).meta as any;
    const channelNode = meta?.AffectedNodes?.find(
      (n: any) => n.CreatedNode?.LedgerEntryType === 'PayChannel'
    );
    const channelId = channelNode?.CreatedNode?.LedgerIndex as string | undefined;

    spinner.succeed(chalk.green('Payment channel created'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    if (channelId) row('Channel ID',   chalk.cyan(channelId));
    row('Source',       chalk.dim(wallet.address));
    row('Destination',  chalk.dim(options.destination));
    row('Amount',       chalk.green(options.amount + ' XRP'));
    row('Settle delay', chalk.dim(settleDelay + 's'));
    row('Public key',   chalk.dim(wallet.publicKey));
    logger.blank();

    if (channelId) {
      const net = isLocal ? ' --local' : '';
      logger.dim(`  Sign off-chain claim: xrpl-up channel sign ${channelId} <xrp-amount>${net} --seed <seed>`);
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create payment channel');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── channel list ──────────────────────────────────────────────────────────────

export interface ChannelListOptions {
  local?: boolean;
  network?: string;
  account?: string;
}

export async function channelListCommand(options: ChannelListOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);

  let address = options.account;
  if (!address) {
    if (isLocal) {
      const store    = new WalletStore('local');
      const accounts = store.all();
      if (accounts.length === 0) {
        logger.warning('No local accounts found. Run xrpl-up node --local first.');
        return;
      }
      address = accounts[0].address;
    } else {
      logger.error('Specify an account with --account <address>');
      process.exit(1);
    }
  }

  const manager = new NetworkManager(networkName, networkConfig);
  const spinner = ora({
    text: `Fetching channels for ${chalk.cyan(address)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const res = await manager.client.request({
      command: 'account_channels',
      account: address,
      ledger_index: 'validated',
    } as any);
    await manager.disconnect();

    const channels = (res.result as any).channels as any[];
    spinner.succeed(`${channels.length} channel${channels.length === 1 ? '' : 's'} for ${chalk.cyan(address)}`);
    logger.blank();

    if (channels.length === 0) {
      logger.dim('  No payment channels found for this account.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (const [i, ch] of channels.entries()) {
      logger.log(chalk.dim(`  ── Channel ${i + 1} ─────────────────────────────────────────────────────`));
      row('Channel ID',   chalk.cyan(ch.channel_id));
      row('Destination',  chalk.dim(ch.destination_account));
      row('Amount',       chalk.green((Number(ch.amount)  / 1_000_000).toFixed(6) + ' XRP'));
      row('Balance',      chalk.green((Number(ch.balance) / 1_000_000).toFixed(6) + ' XRP'));
      row('Settle delay', chalk.dim(ch.settle_delay + 's'));
      if (ch.expiration) row('Expiration', chalk.dim(String(ch.expiration)));
      if (i < channels.length - 1) logger.blank();
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fetch channels');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── channel fund ──────────────────────────────────────────────────────────────

export interface ChannelFundOptions {
  channelId: string;
  amount: string; // XRP
  local?: boolean;
  network?: string;
  seed: string;
}

export async function channelFundCommand(options: ChannelFundOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Adding ${options.amount} XRP to channel on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'PaymentChannelFund',
      Account: wallet.address,
      Channel: options.channelId,
      Amount:  xrpToDrops(options.amount),
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green(`Channel funded with ${options.amount} XRP`));
    logger.blank();
    logger.dim(`  Channel: ${options.channelId}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fund channel');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── channel claim ─────────────────────────────────────────────────────────────

export interface ChannelClaimOptions {
  channelId: string;
  local?: boolean;
  network?: string;
  seed: string;
  amount?: string;    // XRP amount to claim (off-chain claim)
  signature?: string; // hex signature from channel sign
  publicKey?: string; // public key of the wallet that produced the signature (source key)
  close?: boolean;    // request channel close
}

export async function channelClaimCommand(options: ChannelClaimOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  // Validate co-required options for off-chain claims
  if (options.signature && !options.amount) {
    logger.error('--amount <xrp> is required when --signature is provided');
    process.exit(1);
  }
  if (options.signature && !options.publicKey) {
    logger.error(
      '--public-key <hex> is required when --signature is provided\n' +
      '  (use the public key printed by: xrpl-up channel sign)'
    );
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Claiming channel on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    // tfClose = 0x00020000
    const flags = options.close ? 0x00020000 : 0;

    const tx: Record<string, unknown> = {
      TransactionType: 'PaymentChannelClaim',
      Account: wallet.address,
      Channel: options.channelId,
      Flags:   flags,
    };
    if (options.amount)    tx['Balance']   = xrpToDrops(options.amount);
    if (options.signature) {
      tx['Signature'] = options.signature;
      // PublicKey must be the key that produced the off-chain signature (the source/signer
      // wallet), NOT the claimant's key. Enforced above: options.publicKey is always set here.
      tx['PublicKey'] = options.publicKey!;
    }

    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Channel claim submitted'));
    logger.blank();
    logger.dim(`  Channel: ${options.channelId}`);
    if (options.close) logger.dim('  Channel close requested.');
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to claim channel');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── channel sign (no on-chain tx) ─────────────────────────────────────────────

export interface ChannelSignOptions {
  channelId: string;
  amount: string; // XRP amount to authorize
  seed: string;
}

export function channelSignCommand(options: ChannelSignOptions): void {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const wallet    = Wallet.fromSeed(options.seed);
  const signature = signPaymentChannelClaim(
    options.channelId,
    options.amount,
    wallet.privateKey
  );

  logger.blank();
  logger.success('Off-chain claim signature generated');
  logger.blank();

  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
  const W = 12;
  const row = (key: string, val: string) =>
    logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

  row('Signature',  chalk.cyan(signature));
  row('Public key', chalk.dim(wallet.publicKey));
  row('Channel',    chalk.dim(options.channelId));
  row('Amount',     chalk.green(options.amount + ' XRP'));
  logger.blank();
  logger.dim(
    `  Verify: xrpl-up channel verify ${options.channelId} ${options.amount} ${signature} ${wallet.publicKey}`
  );
  logger.dim(
    `  Claim:  xrpl-up channel claim ${options.channelId} --amount ${options.amount} --signature ${signature} --public-key ${wallet.publicKey} --seed <dest-seed>`
  );
  logger.blank();
}

// ── channel verify (no on-chain tx) ──────────────────────────────────────────

export interface ChannelVerifyOptions {
  channelId: string;
  amount: string;
  signature: string;
  publicKey: string;
}

export function channelVerifyCommand(options: ChannelVerifyOptions): void {
  const valid = verifyPaymentChannelClaim(
    options.channelId,
    options.amount,
    options.signature,
    options.publicKey
  );

  logger.blank();
  if (valid) {
    logger.success('Signature valid ✓');
  } else {
    logger.error('Signature invalid ✗');
  }
  logger.blank();

  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
  const W = 12;
  const row = (key: string, val: string) =>
    logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

  row('Channel', chalk.dim(options.channelId));
  row('Amount',  chalk.dim(options.amount + ' XRP'));
  row('Valid',   valid ? chalk.green('yes ✓') : chalk.red('no ✗'));
  logger.blank();

  if (!valid) process.exit(1);
}
