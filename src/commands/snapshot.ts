import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { Client } from 'xrpl';
import {
  stopService, startService, waitForPort, composeDown, isConsensusMode,
  LOCAL_WS_PORT, LOCAL_WS_URL, FAUCET_PORT, COMPOSE_FILE, COMPOSE_PROJECT,
  VOLUME_NAME, PEER_VOLUME_NAME,
} from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

const SNAPSHOTS_DIR = path.join(os.homedir(), '.xrpl-up', 'snapshots');
const WALLET_STORE_PATH = path.join(os.homedir(), '.xrpl-up', 'local-accounts.json');
const SNAPSHOT_RESTORE_START_TIMEOUT_MS = 90_000;

/** Returns true if the named Docker volume exists. */
function volumeExists(name: string = VOLUME_NAME): boolean {
  try {
    execSync(`docker volume inspect ${name}`, { stdio: 'ignore' });
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

/** Absolute path to metadata sidecar for a snapshot. */
function metaSidecarPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}-meta.json`);
}

function backupPath(filePath: string): string {
  return `${filePath}.bak`;
}

function safeCommandOutput(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stdout = (err as { stdout?: string | Buffer }).stdout?.toString() ?? '';
    const stderr = (err as { stderr?: string | Buffer }).stderr?.toString() ?? '';
    return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
  }
}

/** Ensure the snapshots directory exists. */
function ensureSnapshotsDir(): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

/**
 * Guard: snapshots require the 2-node consensus network (--local-network).
 * In standalone mode (the default), rippled doesn't create SQLite and can't resume state.
 */
function assertConsensusMode(action: 'save' | 'restore'): void {
  if (!isConsensusMode()) {
    throw new Error(
      `Cannot ${action} snapshots in standalone mode.\n` +
      `  Standalone mode does not persist ledger state across restarts.\n` +
      `  Snapshots require the --local-network flag. Restart with:\n` +
      `\n` +
      `    xrpl-up start --local --local-network --detach\n`
    );
  }
}

/**
 * Save the current ledger state as a named snapshot.
 *
 * In consensus mode the volume contains NuDB + SQLite. We stop all services,
 * tar the primary node's volume, then restart.
 *
 * Only the primary node's volume is captured. On restore, the same tarball is
 * extracted into both the primary and peer volumes. This works because both
 * nodes in the private 2-node network validate the same transactions and
 * produce identical ledger state (same NuDB entries and SQLite rows). The
 * peer node starts with --load from the restored data and re-syncs from the
 * primary. If nodes could diverge (e.g., different NuDB compaction), the
 * post-restore verification step would catch it.
 */
export async function snapshotSave(name: string): Promise<void> {
  assertConsensusMode('save');

  if (!volumeExists()) {
    throw new Error(
      `No ledger volume found (${VOLUME_NAME}).\n` +
      `  Start the sandbox first: xrpl-up start --local --local-network --detach`
    );
  }

  ensureSnapshotsDir();
  const dest = snapshotPath(name);

  if (fs.existsSync(dest)) {
    logger.warning(`Snapshot "${name}" already exists — overwriting.`);
  }

  logger.blank();

  // ── Flush: wait until all wallet-store accounts are confirmed on-chain ─────
  const walletAccounts = new WalletStore('local').all();
  const flushStartMs = Date.now();
  const flushSpinner = ora({
    text: chalk.dim(walletAccounts.length > 0
      ? `Waiting for ${walletAccounts.length} account(s) to confirm on-chain…`
      : 'Flushing pending transactions…'),
    prefixText: ' ',
  }).start();

  try {
    const client = new Client(LOCAL_WS_URL, { timeout: 60_000 });
    await client.connect();

    const TIMEOUT_MS = 60_000;
    const POLL_MS    = 1000;
    const deadline   = Date.now() + TIMEOUT_MS;
    let allConfirmed = false;

    while (Date.now() < deadline) {
      let missing = 0;
      for (const acct of walletAccounts) {
        try {
          await client.request({
            command: 'account_info',
            account: acct.address,
            ledger_index: 'validated',
          });
        } catch {
          missing++;
        }
      }

      if (missing === 0) { allConfirmed = true; break; }
      flushSpinner.text = chalk.dim(`Waiting for ${missing} account(s) to confirm…`);
      await new Promise(r => setTimeout(r, POLL_MS));
    }

    await client.disconnect();

    if (allConfirmed) {
      const flushElapsed = ((Date.now() - flushStartMs) / 1000).toFixed(1);
      flushSpinner.succeed(chalk.dim(`All accounts confirmed on-chain (${flushElapsed}s)`));
    } else {
      flushSpinner.fail(chalk.red('Timed out waiting for accounts to confirm on-chain'));
      throw new Error(
        `Snapshot aborted: not all accounts confirmed on the validated ledger.\n` +
        `  Wait for ledger closes, then retry:\n` +
        `  xrpl-up accounts --local\n` +
        `  xrpl-up snapshot save ${name}`
      );
    }
  } catch (err) {
    if ((err as Error).message?.startsWith('Snapshot aborted')) throw err;
    flushSpinner.fail(chalk.red('Could not verify accounts — snapshot aborted'));
    throw new Error(
      `Snapshot aborted: failed to connect to local rippled at ${LOCAL_WS_URL}.\n` +
      `  Is the sandbox running?  xrpl-up status`
    );
  }

  // ── Stop services, tar volume, restart ─────────────────────────────────────
  const stopStartMs = Date.now();
  const stopSpinner = ora({ text: chalk.dim('Stopping sandbox for snapshot…'), prefixText: ' ' }).start();
  try {
    // Stop all services — ensures clean SQLite state (WAL checkpointed)
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" stop`,
      { stdio: 'ignore' },
    );
    const stopElapsed = ((Date.now() - stopStartMs) / 1000).toFixed(1);
    stopSpinner.succeed(chalk.dim(`Sandbox stopped (${stopElapsed}s)`));
  } catch {
    stopSpinner.fail('Failed to stop sandbox');
    throw new Error(
      'Could not stop sandbox for snapshot.\n' +
      '  Check:  docker ps | grep xrpl-up\n' +
      '  Logs:   docker compose -p xrpl-up-local logs --tail 20'
    );
  }

  const tmpDest = dest + '.tmp';
  const saveStartMs = Date.now();
  const saveSpinner = ora({ text: chalk.dim(`Saving snapshot "${name}"…`), prefixText: ' ' }).start();
  try {
    execSync(
      `docker run --rm ` +
      `-v ${VOLUME_NAME}:/data ` +
      `-v "${SNAPSHOTS_DIR}":/snapshots ` +
      `alpine tar czf /snapshots/${path.basename(tmpDest)} -C /data .`,
      { stdio: 'ignore' },
    );
  } catch (err) {
    saveSpinner.fail(`Failed to save snapshot "${name}"`);
    if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest);
    // Restart services even on failure
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" start`,
      { stdio: 'ignore' },
    );
    throw err;
  }

  // ── Write sidecar files and atomically swap ────────────────────────────────
  const tmpSidecar = walletSidecarPath(name) + '.tmp';
  const tmpMeta = metaSidecarPath(name) + '.tmp';

  if (fs.existsSync(WALLET_STORE_PATH)) {
    fs.copyFileSync(WALLET_STORE_PATH, tmpSidecar);
  } else {
    fs.writeFileSync(tmpSidecar, '[]');
  }
  fs.writeFileSync(tmpMeta, JSON.stringify({ format: 'consensus-v1' }));

  const finalSidecar = walletSidecarPath(name);
  const finalMeta = metaSidecarPath(name);
  const backups = [
    { file: finalSidecar, backup: backupPath(finalSidecar) },
    { file: finalMeta, backup: backupPath(finalMeta) },
    { file: dest, backup: backupPath(dest) },
  ];

  try {
    for (const { file, backup } of backups) {
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      if (fs.existsSync(file)) fs.renameSync(file, backup);
    }
    fs.renameSync(tmpSidecar, finalSidecar);
    fs.renameSync(tmpMeta, finalMeta);
    fs.renameSync(tmpDest, dest);
    for (const { backup } of backups) {
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
    }
    const saveElapsed = ((Date.now() - saveStartMs) / 1000).toFixed(1);
    saveSpinner.succeed(chalk.green(`Snapshot "${name}" saved`) + chalk.dim(` (${saveElapsed}s)`));
  } catch (err) {
    for (const file of [finalSidecar, finalMeta, dest]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    for (const { file, backup } of backups) {
      if (fs.existsSync(backup)) fs.renameSync(backup, file);
    }
    for (const tmp of [tmpSidecar, tmpMeta, tmpDest]) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
    saveSpinner.fail(`Failed to finalize snapshot "${name}"`);
    throw err;
  }

  // ── Restart all services ───────────────────────────────────────────────────
  // Use `up -d` instead of `start` — containers may have been removed by
  // `xrpl-up stop` (which runs compose down). `up -d` recreates them.
  const resumeStartMs = Date.now();
  const startSpinner = ora({ text: chalk.dim('Resuming sandbox…'), prefixText: ' ' }).start();
  try {
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up -d`,
      { stdio: 'ignore' },
    );
    await waitForPort(LOCAL_WS_PORT, 60_000, 'rippled WebSocket');
    await waitForPort(FAUCET_PORT, 30_000, 'faucet HTTP');
    const resumeElapsed = ((Date.now() - resumeStartMs) / 1000).toFixed(1);
    startSpinner.succeed(chalk.dim(`Sandbox resumed (${resumeElapsed}s)`));
  } catch (err) {
    startSpinner.fail(chalk.red('Sandbox failed to resume'));
    throw err;
  }

  const stats = fs.statSync(dest);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  logger.dim(`  Saved to ${dest} (${sizeMb} MB)`);
  logger.blank();
}

/**
 * Restore ledger state from a named snapshot.
 *
 * Extracts the tarball to BOTH node volumes (primary + peer), then restarts
 * the stack. The entrypoint detects ledger.db and uses --load to resume.
 */
export async function snapshotRestore(name: string): Promise<void> {
  assertConsensusMode('restore');

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
      `No ledger volume found (${VOLUME_NAME}).\n` +
      `  Start the sandbox first: xrpl-up start --local --local-network --detach`
    );
  }

  logger.blank();

  // ── Stop all services ──────────────────────────────────────────────────────
  // Use `down` instead of `stop` — works whether containers are running,
  // stopped, or already removed (e.g. after `xrpl-up stop`). We use `up -d`
  // to recreate them after restoring the volume data.
  const restoreStopMs = Date.now();
  const stopSpinner = ora({ text: chalk.dim('Stopping sandbox…'), prefixText: ' ' }).start();
  try {
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" down`,
      { stdio: 'ignore' },
    );
    const restoreStopElapsed = ((Date.now() - restoreStopMs) / 1000).toFixed(1);
    stopSpinner.succeed(chalk.dim(`Sandbox stopped (${restoreStopElapsed}s)`));
  } catch {
    stopSpinner.fail('Failed to stop sandbox');
    throw new Error(
      'Could not stop sandbox.\n' +
      '  Check:  docker ps | grep xrpl-up\n' +
      '  Logs:   docker compose -p xrpl-up-local logs --tail 20'
    );
  }

  // ── Wipe and extract to BOTH volumes ───────────────────────────────────────
  const restoreExtractMs = Date.now();
  const restoreSpinner = ora({ text: chalk.dim(`Restoring snapshot "${name}"…`), prefixText: ' ' }).start();
  try {
    for (const vol of [VOLUME_NAME, PEER_VOLUME_NAME]) {
      execSync(
        `docker run --rm ` +
        `-v ${vol}:/data ` +
        `-v "${SNAPSHOTS_DIR}":/snapshots ` +
        `alpine sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /snapshots/${name}.tar.gz -C /data"`,
        { stdio: 'ignore' },
      );
    }
    const restoreExtractElapsed = ((Date.now() - restoreExtractMs) / 1000).toFixed(1);
    restoreSpinner.succeed(chalk.green(`Snapshot "${name}" restored to both nodes`) + chalk.dim(` (${restoreExtractElapsed}s)`));
  } catch (err) {
    restoreSpinner.fail(`Failed to restore snapshot "${name}"`);
    throw err;
  }

  // ── Restore WalletStore sidecar ────────────────────────────────────────────
  const sidecar = walletSidecarPath(name);
  if (fs.existsSync(sidecar)) {
    fs.copyFileSync(sidecar, WALLET_STORE_PATH);
  } else if (fs.existsSync(WALLET_STORE_PATH)) {
    fs.unlinkSync(WALLET_STORE_PATH);
  }

  // ── Restart all services ───────────────────────────────────────────────────
  // The entrypoint detects ledger.db → uses --load to resume from SQLite.
  // Use `up -d` instead of `start` — containers may have been removed by
  // `xrpl-up stop` (which runs compose down). `up -d` recreates them.
  const restoreResumeMs = Date.now();
  const startSpinner = ora({ text: chalk.dim('Resuming sandbox…'), prefixText: ' ' }).start();
  try {
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up -d`,
      { stdio: 'ignore' },
    );
    await waitForPort(LOCAL_WS_PORT, SNAPSHOT_RESTORE_START_TIMEOUT_MS, 'rippled WebSocket');
    await waitForPort(FAUCET_PORT, SNAPSHOT_RESTORE_START_TIMEOUT_MS, 'faucet HTTP');
    const restoreResumeElapsed = ((Date.now() - restoreResumeMs) / 1000).toFixed(1);
    startSpinner.succeed(chalk.dim(`Sandbox resumed (${restoreResumeElapsed}s)`));
  } catch (err) {
    startSpinner.fail(chalk.red('Sandbox failed to resume'));
    const rippledLogs = safeCommandOutput(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" logs --no-color --tail 30 rippled`
    );
    throw new Error(
      `${(err as Error).message}\n\n` +
      `rippled logs (last 30 lines):\n${rippledLogs}`
    );
  }

  // ── Post-restore verification ──────────────────────────────────────────────
  const restoredAccounts = (() => {
    try {
      const raw = fs.readFileSync(walletSidecarPath(name), 'utf-8');
      return JSON.parse(raw) as { address: string }[];
    } catch { return []; }
  })();

  if (restoredAccounts.length > 0) {
    const verifyStartMs = Date.now();
    const verifySpinner = ora({ text: chalk.dim('Verifying restored ledger state…'), prefixText: ' ' }).start();
    const probe = restoredAccounts[0].address;
    try {
      const client = new Client(LOCAL_WS_URL, { timeout: 60_000 });
      await client.connect();
      // Wait a moment for consensus to produce a validated ledger after restart
      const deadline = Date.now() + 30_000;
      let found = false;
      while (Date.now() < deadline) {
        try {
          await client.request({
            command: 'account_info',
            account: probe,
            ledger_index: 'validated',
          });
          found = true;
          break;
        } catch {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      await client.disconnect();
      if (found) {
        const verifyElapsed = ((Date.now() - verifyStartMs) / 1000).toFixed(1);
        verifySpinner.succeed(chalk.dim(`Verified account ${probe.slice(0, 8)}… exists on restored ledger (${verifyElapsed}s)`));
      } else {
        throw new Error('Account not found after waiting');
      }
    } catch (err) {
      verifySpinner.fail(chalk.red('Post-restore verification failed'));
      throw new Error(
        `Account ${probe} from the snapshot sidecar was not found on the restored ledger.\n` +
        `  The restore may not have applied correctly. Check:\n` +
        `  - docker compose -p ${COMPOSE_PROJECT} logs rippled\n` +
        `  - xrpl-up accounts --local\n` +
        `  - Re-save the snapshot from a running sandbox and try again.`
      );
    }
  }

  logger.blank();
  logger.success(`Ledger state restored to snapshot "${name}"`);
  logger.dim('  Run xrpl-up accounts --local to verify balances.');
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
