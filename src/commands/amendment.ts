import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import { Client } from 'xrpl';
import { loadConfig, resolveNetwork, DEFAULT_CONFIG } from '../core/config';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_WS_URL, EXTRA_AMENDMENTS_FILE, writeRippledConfig } from '../core/compose';
import { logger } from '../utils/logger';
import { resetCommand } from './reset';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AmendmentInfo {
  hash: string;
  name: string;
  enabled: boolean;
  supported: boolean;
  vetoed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveSourceUrl(from: string): string {
  const config = loadConfig();
  // Allow named networks from config (mainnet, testnet, devnet, custom)
  try {
    const { config: netCfg } = resolveNetwork(config, from);
    return netCfg.url;
  } catch {
    throw new Error(
      `Unknown source network: "${from}". ` +
      `Available: ${Object.keys(DEFAULT_CONFIG.networks).join(', ')}`
    );
  }
}

async function fetchFeatures(url: string): Promise<AmendmentInfo[]> {
  const client = new Client(url, { timeout: 60_000 });
  await client.connect();
  try {
    const resp = await client.request({ command: 'feature' } as any);
    const features = (resp.result as any).features as Record<string, {
      name?: string;
      enabled: boolean;
      supported: boolean;
      vetoed: boolean;
    }>;
    return Object.entries(features).map(([hash, info]) => ({
      hash,
      name: info.name ?? hash.slice(0, 20) + '…',
      enabled:   info.enabled,
      supported: info.supported,
      vetoed:    info.vetoed,
    }));
  } finally {
    await client.disconnect();
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printQueuedAmendments(): void {
  if (!fs.existsSync(EXTRA_AMENDMENTS_FILE)) return;
  const lines = fs.readFileSync(EXTRA_AMENDMENTS_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return;
  logger.blank();
  logger.log(`  ${chalk.bold('Queued genesis amendments:')}`);
  for (const line of lines) {
    const [, ...nameParts] = line.split(' ');
    const name = nameParts.join(' ') || line.slice(0, 20) + '…';
    logger.log(`    ${chalk.green('✔')} ${chalk.white(name)}`);
  }
  logger.blank();
}

function confirm(question: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + ' ', answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ── amendment list ────────────────────────────────────────────────────────────

export interface AmendmentListOptions {
  local?: boolean;
  network?: string;
  diff?: string;         // compare against this network
  disabled?: boolean;    // show only disabled
}

export async function amendmentListCommand(options: AmendmentListOptions): Promise<void> {
  const targetUrl = options.local
    ? LOCAL_WS_URL
    : resolveNetwork(loadConfig(), options.network).config.url;

  const targetLabel = options.local ? 'local' : (options.network ?? loadConfig().defaultNetwork);

  const spinner = ora({
    text: `Fetching amendments from ${chalk.cyan(targetLabel)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    const amendments = await fetchFeatures(targetUrl);

    let diffMap: Map<string, AmendmentInfo> | null = null;
    if (options.diff) {
      spinner.text = `Fetching amendments from ${chalk.cyan(options.diff)} for comparison…`;
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
      logger.log(
        `\n  ${chalk.bold(pad('Name', NAME_W))}  ${chalk.bold(pad('Hash', HASH_W))}  ` +
        `${chalk.bold(pad(targetLabel, 8))}  ${chalk.bold(options.diff!)}`
      );
      logger.log('  ' + '─'.repeat(NAME_W + HASH_W + 26));

      for (const a of sorted) {
        const localMark  = a.enabled ? chalk.green('✔') : chalk.dim('✗');
        const diffInfo   = diffMap.get(a.hash);
        const diffMark   = diffInfo?.enabled ? chalk.green('✔') : chalk.dim('✗');
        const nameStr    = a.enabled ? chalk.white(pad(a.name, NAME_W)) : chalk.dim(pad(a.name, NAME_W));
        const gap        = a.enabled !== diffInfo?.enabled ? chalk.yellow(' ◄ gap') : '';
        logger.log(`  ${nameStr}  ${chalk.dim(pad(a.hash.slice(0, 16) + '…', HASH_W))}  ${pad(localMark, 8)}  ${diffMark}${gap}`);
      }

      // Amendments on diff network not in local at all
      for (const [hash, info] of diffMap.entries()) {
        if (!amendments.find(a => a.hash === hash) && info.enabled) {
          logger.log(
            `  ${chalk.red(pad(info.name, NAME_W))}  ${chalk.dim(pad(hash.slice(0, 16) + '…', HASH_W))}  ` +
            `${chalk.dim('✗ (n/s)')}  ${chalk.green('✔')}${chalk.yellow(' ◄ unsupported by local build')}`
          );
        }
      }
    } else {
      // Simple list
      logger.log(
        `\n  ${chalk.bold(pad('Name', NAME_W))}  ${chalk.bold(pad('Hash', HASH_W))}  ` +
        `${chalk.bold('Enabled')}  ${chalk.bold('Supported')}`
      );
      logger.log('  ' + '─'.repeat(NAME_W + HASH_W + 20));

      for (const a of sorted) {
        const enabledMark   = a.enabled   ? chalk.green('✔') : chalk.dim('✗');
        const supportedMark = a.supported ? chalk.green('✔') : chalk.dim('✗');
        const nameStr       = a.enabled   ? chalk.white(pad(a.name, NAME_W)) : chalk.dim(pad(a.name, NAME_W));
        logger.log(`  ${nameStr}  ${chalk.dim(pad(a.hash.slice(0, 16) + '…', HASH_W))}  ${pad(enabledMark, 9)}  ${supportedMark}`);
      }
    }

    logger.blank();
    const enabled   = amendments.filter(a => a.enabled).length;
    const supported = amendments.filter(a => a.supported && !a.enabled).length;
    logger.dim(`  ${enabled} enabled  ·  ${supported} supported but not enabled  ·  ${amendments.length} total known`);
    logger.blank();
  } catch (err: unknown) {
    spinner.fail('Failed to fetch amendments');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── amendment info ────────────────────────────────────────────────────────────

export interface AmendmentInfoOptions {
  local?: boolean;
  network?: string;
}

export async function amendmentInfoCommand(nameOrHash: string, options: AmendmentInfoOptions): Promise<void> {
  const targetUrl = options.local
    ? LOCAL_WS_URL
    : resolveNetwork(loadConfig(), options.network).config.url;

  const targetLabel = options.local ? 'local' : (options.network ?? loadConfig().defaultNetwork);

  const spinner = ora({
    text: `Looking up amendment on ${chalk.cyan(targetLabel)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    const amendments = await fetchFeatures(targetUrl);

    const query = nameOrHash.toLowerCase();
    const found = amendments.find(
      a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query)
    );

    if (!found) {
      spinner.fail(`Amendment not found: ${nameOrHash}`);
      logger.dim(`  Run: xrpl-up amendment list${options.local ? ' --local' : ''} to see all known amendments.`);
      process.exit(1);
    }

    spinner.succeed(chalk.green(`Amendment: ${found.name}`));
    logger.blank();

    const W = 12;
    const row = (k: string, v: string) => logger.log(`  ${chalk.dim(pad(k + ':', W))} ${v}`);

    row('Name',      chalk.white(found.name));
    row('Hash',      chalk.dim(found.hash));
    row('Enabled',   found.enabled   ? chalk.green('✔ yes') : chalk.dim('✗ no'));
    row('Supported', found.supported ? chalk.green('✔ yes') : chalk.red('✗ no (rippled image too old)'));
    row('Vetoed',    found.vetoed    ? chalk.red('✔ yes') : chalk.dim('no'));
    logger.blank();

    if (!found.enabled && found.supported) {
      logger.dim(`  Enable with: xrpl-up amendment enable ${found.name} --local`);
      logger.blank();
    }
    if (!found.supported) {
      logger.dim('  Upgrade the local rippled image to support this amendment:');
      logger.dim('    Edit the rippled-image field in your xrpl-up config (xrpl-up config export to view path)');
      logger.dim('    xrpl-up reset --local && xrpl-up start');
      logger.blank();
    }
  } catch (err: unknown) {
    spinner.fail('Failed to look up amendment');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── amendment enable ──────────────────────────────────────────────────────────

export interface AmendmentToggleOptions {
  local?: boolean;
  autoReset?: boolean;
}

export async function amendmentEnableCommand(nameOrHash: string, options: AmendmentToggleOptions): Promise<void> {
  if (!options.local) {
    logger.error('amendment enable only works with --local (cannot admin-RPC a public node).');
    process.exit(1);
  }

  const spinner = ora({
    text: `Enabling amendment ${chalk.cyan(nameOrHash)} on local sandbox…`,
    color: 'cyan',
    indent: 2,
  }).start();

  const client = new Client(LOCAL_WS_URL, { timeout: 60_000 });
  try {
    await client.connect();

    // Resolve name → hash
    const amendments = await fetchFeatures(LOCAL_WS_URL);
    const query = nameOrHash.toLowerCase();
    const found = amendments.find(
      a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query)
    );

    if (!found) {
      spinner.fail(`Amendment not found: ${nameOrHash}`);
      logger.dim('  Run: xrpl-up amendment list --local to see available amendments.');
      await client.disconnect();
      process.exit(1);
    }

    if (!found.supported) {
      spinner.fail(`Amendment not supported by local rippled build: ${found.name}`);
      logger.dim('  Upgrade the local rippled image to include this amendment.');
      await client.disconnect();
      process.exit(1);
    }

    if (found.enabled) {
      spinner.succeed(chalk.green(`Already enabled: ${found.name}`));
      await client.disconnect();
      return;
    }

    // Amendments cannot be activated at runtime in standalone mode — the voting
    // process requires validator messages that ledger_accept does not generate.
    // Instead, add the amendment to the genesis config so it activates on the
    // next fresh start (after xrpl-up reset).
    spinner.text = `Adding ${chalk.cyan(found.name)} to genesis config…`;

    const line = `${found.hash} ${found.name}`;
    const existing = fs.existsSync(EXTRA_AMENDMENTS_FILE)
      ? fs.readFileSync(EXTRA_AMENDMENTS_FILE, 'utf-8')
      : '';

    if (!existing.includes(found.hash)) {
      fs.mkdirSync(path.dirname(EXTRA_AMENDMENTS_FILE), { recursive: true });
      fs.writeFileSync(EXTRA_AMENDMENTS_FILE, existing + line + '\n', 'utf-8');
    }

    // Regenerate rippled.cfg so the next `xrpl-up start` picks it up automatically.
    writeRippledConfig();

    spinner.succeed(chalk.green(`Amendment queued for next genesis: ${found.name}`));
    logger.blank();
    logger.dim(`  Hash: ${found.hash}`);
    logger.blank();

    logger.log(
      chalk.yellow('  ⚠  Activating this amendment requires a full node reset.\n') +
      chalk.dim('     All ledger data, funded accounts, and snapshots will be wiped.')
    );
    logger.blank();

    const yes = options.autoReset || await confirm(chalk.bold('  Reset and restart the local node now? [y/N]'));

    if (yes) {
      logger.blank();
      resetCommand();
      printQueuedAmendments();
      logger.dim('  Run the following to start with the new amendment active:');
      logger.dim('    xrpl-up start --local');
      logger.blank();
    } else {
      logger.blank();
      logger.dim('  To activate later, run:');
      logger.dim('    xrpl-up reset');
      logger.dim('    xrpl-up start --local');
      logger.blank();
    }
  } catch (err: unknown) {
    await client.disconnect().catch(() => {});
    spinner.fail('Failed to enable amendment');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  await client.disconnect().catch(() => {});
}


// ── amendment disable ─────────────────────────────────────────────────────────

export async function amendmentDisableCommand(nameOrHash: string, options: AmendmentToggleOptions): Promise<void> {
  if (!options.local) {
    logger.error('amendment disable only works with --local (cannot admin-RPC a public node).');
    process.exit(1);
  }

  const spinner = ora({
    text: `Looking up amendment ${chalk.cyan(nameOrHash)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    // Resolve name → hash
    const amendments = await fetchFeatures(LOCAL_WS_URL);
    const query = nameOrHash.toLowerCase();
    const found = amendments.find(
      a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query)
    );

    if (!found) {
      spinner.fail(`Amendment not found: ${nameOrHash}`);
      logger.dim('  Run: xrpl-up amendment list --local to see available amendments.');
      process.exit(1);
    }

    // Check whether this amendment is user-enabled (present in EXTRA_AMENDMENTS_FILE)
    const existing = fs.existsSync(EXTRA_AMENDMENTS_FILE)
      ? fs.readFileSync(EXTRA_AMENDMENTS_FILE, 'utf-8')
      : '';

    if (!existing.includes(found.hash)) {
      spinner.fail(`Amendment not in user-enabled list: ${found.name}`);
      if (found.enabled) {
        logger.dim('  This amendment is part of the default genesis config and cannot be disabled.');
      } else {
        logger.dim('  This amendment is not currently queued for activation.');
      }
      process.exit(1);
    }

    // Remove the line from EXTRA_AMENDMENTS_FILE
    spinner.text = `Removing ${chalk.cyan(found.name)} from genesis config…`;

    const updated = existing
      .split('\n')
      .filter(line => !line.includes(found.hash))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    fs.writeFileSync(EXTRA_AMENDMENTS_FILE, updated, 'utf-8');

    // Regenerate rippled.cfg
    writeRippledConfig();

    spinner.succeed(chalk.green(`Amendment removed from genesis config: ${found.name}`));
    logger.blank();
    logger.dim(`  Hash: ${found.hash}`);
    logger.blank();

    logger.log(
      chalk.yellow('  ⚠  Deactivating this amendment requires a full node reset.\n') +
      chalk.dim('     All ledger data, funded accounts, and snapshots will be wiped.')
    );
    logger.blank();

    const yes = options.autoReset || await confirm(chalk.bold('  Reset and restart the local node now? [y/N]'));

    if (yes) {
      logger.blank();
      resetCommand();
      printQueuedAmendments();
      logger.dim('  Run the following to start without the removed amendment:');
      logger.dim('    xrpl-up start --local');
      logger.blank();
    } else {
      logger.blank();
      logger.dim('  To deactivate later, run:');
      logger.dim('    xrpl-up reset');
      logger.dim('    xrpl-up start --local');
      logger.blank();
    }
  } catch (err: unknown) {
    spinner.fail('Failed to disable amendment');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
