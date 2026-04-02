import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { Client } from 'xrpl';
import {
  stopService, startService, waitForPort,
  LOCAL_WS_PORT, LOCAL_WS_URL, FAUCET_PORT, COMPOSE_FILE,
} from '../core/compose';
import { WalletStore } from '../core/wallet-store';
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

/** Absolute path to the ledger-hash metadata for a snapshot. */
function metaSidecarPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${name}-meta.json`);
}

/**
 * Patch the rippled entrypoint line in the existing compose file so it includes
 * the .restore-hash check, without touching any other settings (debug mode,
 * custom config paths, ledger interval, image, etc.).
 *
 * Replaces only the `entrypoint:` line. If the compose file has no entrypoint
 * line (older non-persist format) the patch is skipped — the node will start
 * with --start instead, which is safe for that case.
 */
function patchComposeEntrypoint(): void {
  if (!fs.existsSync(COMPOSE_FILE)) return;

  const RIPPLED_BIN = '/opt/ripple/bin/rippled';
  const RIPPLED_CFG = '--conf /config/rippled.cfg';
  const HASH_FILE   = '/var/lib/rippled/db/.restore-hash';
  const newEntrypoint =
    `    entrypoint: ["/bin/sh", "-c", ` +
    `"if [ -f ${HASH_FILE} ]; then HASH=$(cat ${HASH_FILE}); rm -f ${HASH_FILE}; ` +
    `exec ${RIPPLED_BIN} ${RIPPLED_CFG} -a --ledger $HASH; ` +
    `else exec ${RIPPLED_BIN} ${RIPPLED_CFG} -a --start; fi"]`;

  const content = fs.readFileSync(COMPOSE_FILE, 'utf-8');
  const patched = content.replace(/^\s+entrypoint:.*$/m, newEntrypoint);
  if (patched !== content) {
    fs.writeFileSync(COMPOSE_FILE, patched, 'utf-8');
  }
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

  // Wait until all wallet store accounts are confirmed on-chain before
  // stopping rippled. With --detach, the faucet funds accounts asynchronously
  // after node start, so a single ledger_accept is not enough — we poll until
  // every address in the wallet store responds to account_info.
  const walletAccounts = new WalletStore('local').all();
  const flushSpinner = ora({
    text: chalk.dim(walletAccounts.length > 0
      ? `Waiting for ${walletAccounts.length} account(s) to confirm on-chain…`
      : 'Flushing pending transactions…'),
    prefixText: ' ',
  }).start();

  let ledgerHash: string | null = null;

  try {
    const client = new Client(LOCAL_WS_URL);
    await client.connect();

    const TIMEOUT_MS = 60_000;
    const POLL_MS    = 500;
    const deadline   = Date.now() + TIMEOUT_MS;
    let allConfirmed = false;

    while (Date.now() < deadline) {
      await (client as any).request({ command: 'ledger_accept' });

      let missing = 0;
      for (const acct of walletAccounts) {
        try {
          await client.request({ command: 'account_info', account: acct.address, ledger_index: 'validated' });
        } catch {
          missing++;
        }
      }

      if (missing === 0) { allConfirmed = true; break; }
      flushSpinner.text = chalk.dim(`Waiting for ${missing} account(s) to confirm…`);
      await new Promise(r => setTimeout(r, POLL_MS));
    }

    // Capture the current validated ledger hash so restore can load it directly
    // from NuDB via --ledger <hash>. rippled standalone mode does not populate
    // a SQLite ledger index, so this hash is the only way to resume from NuDB.
    try {
      const lc = await (client as any).request({ command: 'ledger_closed' });
      ledgerHash = lc.result.ledger_hash ?? null;
    } catch { /* not fatal — restore will warn if hash is missing */ }

    await client.disconnect();

    if (allConfirmed) {
      flushSpinner.succeed(chalk.dim('All accounts confirmed on-chain'));
    } else {
      flushSpinner.fail(chalk.red('Timed out waiting for accounts to confirm on-chain'));
      throw new Error(
        `Snapshot aborted: ${walletAccounts.length} wallet-store account(s) are not confirmed on the validated ledger.\n` +
        `  Wait for the faucet to finish funding, then retry:\n` +
        `  xrpl-up accounts   (all rows must show a live balance, not "(cached)")\n` +
        `  xrpl-up snapshot save <name>`
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

  // Stop faucet only — rippled keeps running so its NuDB data stays consistent.
  // NuDB is append-only: tarring a live NuDB directory is safe. We never stop
  // rippled during save because restarting requires a ledger hash (rippled
  // standalone mode does not write a SQLite ledger index).
  const stopSpinner = ora({ text: chalk.dim('Pausing faucet…'), prefixText: ' ' }).start();
  try {
    stopService('faucet');
    stopSpinner.succeed(chalk.dim('Faucet paused'));
  } catch {
    stopSpinner.fail('Failed to stop faucet — is the sandbox running?');
    throw new Error(
      'Could not stop faucet. Is the sandbox running?\n' +
      '  Start with: xrpl-up node --local --persist'
    );
  }

  // Tar the volume via an alpine sidecar (rippled is still running — online backup)
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

  // Save ledger hash metadata so restore can start rippled with --ledger <hash>
  if (ledgerHash) {
    fs.writeFileSync(metaSidecarPath(name), JSON.stringify({ ledger_hash: ledgerHash }));
  }

  // Restart faucet only
  const startSpinner = ora({ text: chalk.dim('Resuming faucet…'), prefixText: ' ' }).start();
  startService('faucet');
  await waitForPort(FAUCET_PORT, 30_000, 'faucet HTTP');
  startSpinner.succeed(chalk.dim('Faucet resumed'));

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

  // Read the ledger hash saved during snapshot save. Without this hash, rippled
  // cannot locate the ledger in NuDB (standalone mode has no SQLite ledger index).
  const metaPath = metaSidecarPath(name);
  let ledgerHash: string | null = null;
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      ledgerHash = meta.ledger_hash ?? null;
    } catch { /* treat as missing */ }
  }

  if (!ledgerHash) {
    throw new Error(
      `Snapshot "${name}" has no ledger hash and cannot be restored.\n` +
      `  This snapshot was saved before hash capture was introduced.\n` +
      `  Re-save it with the running sandbox: xrpl-up snapshot save ${name}`
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

  // Wipe and restore the volume via alpine sidecar, then write the ledger hash
  // to .restore-hash. The rippled entrypoint reads this file and starts with
  // --ledger <hash> to load directly from NuDB (the only resume path in
  // standalone mode — rippled does not maintain a SQLite ledger index).
  const restoreSpinner = ora({ text: chalk.dim(`Restoring snapshot "${name}"…`), prefixText: ' ' }).start();
  try {
    const hashStep = ledgerHash
      ? `; echo '${ledgerHash}' > /data/.restore-hash`
      : '';
    execSync(
      `docker run --rm ` +
      `-v ${VOLUME_NAME}:/data ` +
      `-v "${SNAPSHOTS_DIR}":/snapshots ` +
      `alpine sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /snapshots/${name}.tar.gz -C /data${hashStep}"`,
      { stdio: 'ignore' }
    );
    restoreSpinner.succeed(chalk.green(`Snapshot "${name}" restored`));
  } catch (err) {
    restoreSpinner.fail(`Failed to restore snapshot "${name}"`);
    startService('rippled');
    startService('faucet');
    throw err;
  }

  // Restore WalletStore sidecar so account list matches the rolled-back ledger
  const sidecar = walletSidecarPath(name);
  if (fs.existsSync(sidecar)) {
    fs.copyFileSync(sidecar, WALLET_STORE_PATH);
  } else {
    if (fs.existsSync(WALLET_STORE_PATH)) fs.unlinkSync(WALLET_STORE_PATH);
  }

  // Patch only the entrypoint line in the existing compose file so the
  // .restore-hash check is present, without disturbing any other settings
  // (debug mode, custom config paths, ledger interval, etc.).
  patchComposeEntrypoint();

  // Restart rippled first and wait for it to be ready before starting the faucet.
  const startSpinner = ora({ text: chalk.dim('Resuming sandbox…'), prefixText: ' ' }).start();
  startService('rippled');
  await waitForPort(LOCAL_WS_PORT, 30_000, 'rippled WebSocket');
  startService('faucet');
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
