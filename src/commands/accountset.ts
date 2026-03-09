import chalk from 'chalk';
import ora from 'ora';
import { Wallet, AccountSetAsfFlags } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── Named flag map ────────────────────────────────────────────────────────────

const FLAG_MAP: Record<string, number> = {
  requiredest:    AccountSetAsfFlags.asfRequireDest,            // 1
  requireauth:    AccountSetAsfFlags.asfRequireAuth,            // 2
  disallowxrp:    AccountSetAsfFlags.asfDisallowXRP,            // 3
  disablemaster:  AccountSetAsfFlags.asfDisableMaster,          // 4
  defaultripple:  AccountSetAsfFlags.asfDefaultRipple,          // 8
  depositauth:    AccountSetAsfFlags.asfDepositAuth,            // 9
  allowclawback:  AccountSetAsfFlags.asfAllowTrustLineClawback, // 16
};

const VALID_FLAGS = Object.keys(FLAG_MAP).join(', ');

// AccountRootFlags bitmask values for display
const ROOT_FLAGS: Array<[number, string]> = [
  [0x00020000, 'RequireDest'],
  [0x00040000, 'RequireAuth'],
  [0x00080000, 'DisallowXRP'],
  [0x00100000, 'DisableMaster'],
  [0x00800000, 'DefaultRipple'],
  [0x01000000, 'DepositAuth'],
  [0x00400000, 'PasswordSpent'],
  [0x00200000, 'GlobalFreeze'],
  [0x00000100, 'NoFreeze'],
];

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

function resolveFlag(name: string): number {
  const key = name.toLowerCase().replace(/[-_]/g, '');
  const val = FLAG_MAP[key];
  if (val == null) {
    throw new Error(
      `Unknown flag "${name}". Valid flags: ${VALID_FLAGS}`
    );
  }
  return val;
}

// ── accountset set ────────────────────────────────────────────────────────────

export interface AccountSetFlagOptions {
  flag: string;
  local?: boolean;
  network?: string;
  seed: string;
}

export async function accountSetFlagCommand(options: AccountSetFlagOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  let flagValue: number;
  try { flagValue = resolveFlag(options.flag); }
  catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }

  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Setting ${options.flag} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'AccountSet',
      Account: wallet.address,
      SetFlag: flagValue,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green(`${options.flag} enabled`));
    logger.blank();
    const net = isLocal ? ' --local' : '';
    logger.dim(`  Undo: xrpl-up accountset clear ${options.flag}${net} --seed <seed>`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail(`Failed to set ${options.flag}`);
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── accountset clear ──────────────────────────────────────────────────────────

export async function accountClearFlagCommand(options: AccountSetFlagOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  let flagValue: number;
  try { flagValue = resolveFlag(options.flag); }
  catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }

  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Clearing ${options.flag} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'AccountSet',
      Account: wallet.address,
      ClearFlag: flagValue,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green(`${options.flag} cleared`));
    logger.blank();
    const net = isLocal ? ' --local' : '';
    logger.dim(`  Re-enable: xrpl-up accountset set ${options.flag}${net} --seed <seed>`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail(`Failed to clear ${options.flag}`);
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── accountset signer-list ────────────────────────────────────────────────────

export interface SignerListOptions {
  quorum: number;
  signers: string; // "rAddress1:weight1,rAddress2:weight2"
  local?: boolean;
  network?: string;
  seed: string;
}

export async function accountSignerListCommand(options: SignerListOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  // Parse signer entries
  const signerEntries: Array<{ SignerEntry: { Account: string; SignerWeight: number } }> = [];
  for (const part of options.signers.split(',')) {
    const [addr, wStr] = part.trim().split(':');
    const weight = parseInt(wStr ?? '1', 10);
    if (!addr?.startsWith('r') || isNaN(weight) || weight < 1) {
      logger.error(
        `Invalid signer "${part.trim()}". Format: rAddress:weight (e.g. rAlice...:1)`
      );
      process.exit(1);
    }
    signerEntries.push({ SignerEntry: { Account: addr, SignerWeight: weight } });
  }

  if (signerEntries.length === 0) {
    logger.error('At least one signer is required.');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Setting signer list on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'SignerListSet',
      Account: wallet.address,
      SignerQuorum: options.quorum,
      SignerEntries: signerEntries,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Signer list set'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Quorum', chalk.cyan(String(options.quorum)));
    for (const e of signerEntries) {
      row('Signer', chalk.dim(`${e.SignerEntry.Account} (weight: ${e.SignerEntry.SignerWeight})`));
    }
    logger.blank();
    logger.warning('Keep the master key safe — disabling it requires a SignerListSet first.');
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to set signer list');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── accountset info ───────────────────────────────────────────────────────────

export interface AccountInfoOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function accountInfoCommand(options: AccountInfoOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching account info on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    let address = options.account;
    if (!address) {
      const store = new WalletStore(networkName);
      const accounts = store.all();
      if (accounts.length === 0) {
        spinner.fail('No accounts found');
        logger.warning('Run xrpl-up node --local first, or pass --account <address>.');
        process.exit(1);
      }
      address = accounts[0].address;
    }

    await manager.connect();

    const infoRes = await manager.client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'current',
    } as any);

    // Check for signer list
    let signerList: any = null;
    try {
      const objRes = await manager.client.request({
        command: 'account_objects',
        account: address,
        type: 'signer_list',
        ledger_index: 'current',
      } as any);
      const objs = (objRes.result as any).account_objects as any[];
      if (objs.length > 0) signerList = objs[0];
    } catch { /* no signer list */ }

    await manager.disconnect();

    const acct = (infoRes.result as any).account_data as any;
    spinner.succeed(chalk.green(`Account info: ${chalk.dim(address)}`));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 16;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Address',      chalk.dim(acct.Account));
    row('Balance',      chalk.green(String(Number(acct.Balance) / 1_000_000) + ' XRP'));
    row('Sequence',     chalk.dim(String(acct.Sequence)));
    row('OwnerCount',   chalk.dim(String(acct.OwnerCount ?? 0)));
    logger.blank();

    // Decode flags
    const flags    = acct.Flags ?? 0;
    const setFlags = ROOT_FLAGS.filter(([mask]) => (flags & mask) !== 0).map(([, name]) => name);
    logger.log(`  ${chalk.dim('Flags:')} ${setFlags.length ? chalk.yellow(setFlags.join(', ')) : chalk.dim('(none)')}`);
    logger.blank();

    // Signer list
    if (signerList) {
      logger.log(`  ${chalk.dim('Signer list')} ${chalk.dim('─'.repeat(40))}`);
      row('Quorum', chalk.cyan(String(signerList.SignerQuorum)));
      for (const e of signerList.SignerEntries ?? []) {
        row('Signer', chalk.dim(`${e.SignerEntry.Account} (weight: ${e.SignerEntry.SignerWeight})`));
      }
      logger.blank();
    }

    // Rollback guidance
    logger.dim('  Toggle flags: xrpl-up accountset set|clear <flag> --seed <seed>');
    logger.dim(`  Valid flags:  ${VALID_FLAGS}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fetch account info');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
