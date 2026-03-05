import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { stopService, startService, waitForPort, LOCAL_WS_PORT, FAUCET_PORT } from '../core/compose';
import { logger } from '../utils/logger';

const VOLUME_NAME = 'xrpl-up-local-db';
const SNAPSHOTS_DIR = path.join(os.homedir(), '.xrpl-up', 'snapshots');
const WALLET_STORE_PATH = path.join(os.homedir(), '.xrpl-up', 'local-accounts.json');

/** Returns true if the named Docker volume exists. */
function volumeExists(): boolean {
  try {
    execSync(`docker volume inspect ${VOLUME_NAME}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to a snapshot tarball by name. */
function snapshotPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}.tar.gz`);
}

/** Absolute path to the WalletStore sidecar for a snapshot. */
function walletSidecarPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}-accounts.json`);
}

/** Ensure the snapshots directory exists. */
function ensureSnapshotsDir(): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

/**
 * Save the current ledger state as a named snapshot.
 * Requires the sandbox to have been started with --persist.
 */
export async function snapshotSave(name: string): Promise<void> {
  if (!volumeExists()) {
    throw new Error(
      `No persist volume found (${VOLUME_NAME}).\n` +
      `  Snapshots require --persist mode. Start with:\n` +
      `  xrpl-up node --local --persist`
    );
  }

  ensureSnapshotsDir();
  const dest = snapshotPath(name);

  if (fs.existsSync(dest)) {
    logger.warning(`Snapshot "${name}" already exists — overwriting.`);
    fs.unlinkSync(dest);
  }

  logger.blank();

  // Stop faucet then rippled to quiesce NuDB file locks before copying.
  // Faucet must stop first — its WebSocket to rippled would otherwise crash it.
  const stopSpinner = ora({ text: chalk.dim('Pausing sandbox…'), prefixText: ' ' }).start();
  try {
    stopService('faucet');
    stopService('rippled');
    stopSpinner.succeed(chalk.dim('Sandbox paused'));
  } catch {
    stopSpinner.fail('Failed to stop sandbox — is it running?');
    throw new Error(
      'Could not stop sandbox. Is it running?\n' +
      '  Start with: xrpl-up node --local --persist'
    );
  }

  // Tar the volume via an alpine sidecar
  const saveSpinner = ora({ text: chalk.dim(`Saving snapshot "${name}"…`), prefixText: ' ' }).start();
  try {
    execSync(
      `docker run --rm ` +
      `-v ${VOLUME_NAME}:/data ` +
      `-v "${SNAPSHOTS_DIR}":/snapshots ` +
      `alpine tar czf /snapshots/${name}.tar.gz -C /data .`,
      { stdio: 'ignore' }
    );
    saveSpinner.succeed(chalk.green(`Snapshot "${name}" saved`));
  } catch (err) {
    saveSpinner.fail(`Failed to save snapshot "${name}"`);
    // Try to restart both services even on failure
    startService('rippled');
    startService('faucet');
    throw err;
  }

  // Save WalletStore sidecar so restore can roll it back together with the ledger
  const sidecar = walletSidecarPath(name);
  if (fs.existsSync(WALLET_STORE_PATH)) {
    fs.copyFileSync(WALLET_STORE_PATH, sidecar);
  } else {
    fs.writeFileSync(sidecar, '[]');
  }

  // Restart rippled then faucet, and wait for both to be ready
  const startSpinner = ora({ text: chalk.dim('Resuming sandbox…'), prefixText: ' ' }).start();
  startService('rippled');
  startService('faucet');
  await waitForPort(LOCAL_WS_PORT, 30_000, 'rippled WebSocket');
  await waitForPort(FAUCET_PORT, 30_000, 'faucet HTTP');
  startSpinner.succeed(chalk.dim('Sandbox resumed'));

  // Show file size
  const stats = fs.statSync(dest);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  logger.dim(`  Saved to ${dest} (${sizeMb} MB)`);
  logger.blank();
}

/**
 * Restore ledger state from a named snapshot.
 * Requires the sandbox to have been started with --persist.
 */
export async function snapshotRestore(name: string): Promise<void> {
  const src = snapshotPath(name);

  if (!fs.existsSync(src)) {
    const available = listSnapshotNames();
    const hint = available.length > 0
      ? `\n  Available snapshots: ${available.join(', ')}`
      : '\n  No snapshots found. Save one with: xrpl-up snapshot save <name>';
    throw new Error(`Snapshot "${name}" not found.${hint}`);
  }

  if (!volumeExists()) {
    throw new Error(
      `No persist volume found (${VOLUME_NAME}).\n` +
      `  Snapshots require --persist mode. Start with:\n` +
      `  xrpl-up node --local --persist`
    );
  }

  logger.blank();

  // Stop faucet then rippled (faucet must stop first to avoid crashing on disconnect)
  const stopSpinner = ora({ text: chalk.dim('Pausing sandbox…'), prefixText: ' ' }).start();
  try {
    stopService('faucet');
    stopService('rippled');
    stopSpinner.succeed(chalk.dim('Sandbox paused'));
  } catch {
    stopSpinner.fail('Failed to stop sandbox — is it running?');
    throw new Error(
      'Could not stop sandbox. Is it running?\n' +
      '  Start with: xrpl-up node --local --persist'
    );
  }

  // Wipe and restore the volume via alpine sidecar
  const restoreSpinner = ora({ text: chalk.dim(`Restoring snapshot "${name}"…`), prefixText: ' ' }).start();
  try {
    execSync(
      `docker run --rm ` +
      `-v ${VOLUME_NAME}:/data ` +
      `-v "${SNAPSHOTS_DIR}":/snapshots ` +
      `alpine sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /snapshots/${name}.tar.gz -C /data"`,
      { stdio: 'ignore' }
    );
    restoreSpinner.succeed(chalk.green(`Snapshot "${name}" restored`));
  } catch (err) {
    restoreSpinner.fail(`Failed to restore snapshot "${name}"`);
    // Try to restart both services even on failure
    startService('rippled');
    startService('faucet');
    throw err;
  }

  // Restore WalletStore sidecar so account list matches the rolled-back ledger
  const sidecar = walletSidecarPath(name);
  if (fs.existsSync(sidecar)) {
    fs.copyFileSync(sidecar, WALLET_STORE_PATH);
  } else {
    // Old snapshot created before this fix — clear stale accounts to avoid mismatch
    if (fs.existsSync(WALLET_STORE_PATH)) fs.unlinkSync(WALLET_STORE_PATH);
  }

  // Restart rippled then faucet, and wait for both to be ready
  const startSpinner = ora({ text: chalk.dim('Resuming sandbox…'), prefixText: ' ' }).start();
  startService('rippled');
  startService('faucet');
  await waitForPort(LOCAL_WS_PORT, 30_000, 'rippled WebSocket');
  await waitForPort(FAUCET_PORT, 30_000, 'faucet HTTP');
  startSpinner.succeed(chalk.dim('Sandbox resumed'));

  logger.blank();
  logger.success(`Ledger state restored to snapshot "${name}"`);
  logger.dim('  Run xrpl-up status --local to confirm the ledger index.');
  logger.blank();
}

/** Returns sorted snapshot names (without .tar.gz extension). */
function listSnapshotNames(): string[] {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return [];
  return fs
    .readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.tar.gz'))
    .map(f => f.replace(/\.tar\.gz$/, ''))
    .sort();
}

/** Print all saved snapshots with size and modification date. */
export function snapshotList(): void {
  const names = listSnapshotNames();

  logger.blank();
  if (names.length === 0) {
    logger.dim('No snapshots found.');
    logger.dim('  Save one with: xrpl-up snapshot save <name>');
    logger.blank();
    return;
  }

  logger.section('Snapshots');
  logger.blank();

  const col = {
    name: Math.max(4, ...names.map(n => n.length)),
  };

  logger.log(
    chalk.dim(
      `  ${'Name'.padEnd(col.name)}  ${'Size'.padStart(8)}  Created`
    )
  );
  logger.log(chalk.dim(`  ${'─'.repeat(col.name + 30)}`));

  for (const name of names) {
    const filePath = snapshotPath(name);
    const stats = fs.statSync(filePath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';
    const date = stats.mtime.toLocaleString();
    const accounts = fs.existsSync(walletSidecarPath(name)) ? chalk.dim(' +accounts') : '';
    logger.log(
      `  ${chalk.white(name.padEnd(col.name))}  ${chalk.dim(sizeMb.padStart(8))}  ${chalk.dim(date)}${accounts}`
    );
  }

  logger.blank();
}
