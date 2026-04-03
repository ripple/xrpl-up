import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { composeDown, VOLUME_NAME, PEER_VOLUME_NAME } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

const SNAPSHOTS_DIR = path.join(os.homedir(), '.xrpl-up', 'snapshots');

export interface ResetOptions {
  snapshots?: boolean;
}

/**
 * Wipe all local sandbox state:
 *  - Stop containers (docker compose down)
 *  - Remove the persist ledger volume
 *  - Clear the WalletStore (local-accounts.json)
 *  - Optionally delete all snapshots (--snapshots)
 */
export function resetCommand(options: ResetOptions = {}): void {
  logger.blank();

  // Stop containers and remove volumes in one step (docker compose down -v)
  const stopSpinner = ora({ text: chalk.dim('Stopping sandbox and removing volumes…'), prefixText: ' ' }).start();
  try {
    execSync(
      `docker compose -p xrpl-up-local -f "${path.join(os.homedir(), '.xrpl-up', 'docker-compose.yml')}" down -v`,
      { stdio: 'ignore' }
    );
  } catch {
    // already gone or never started — try removing volumes individually
    composeDown();
  }
  // Also remove any orphaned volumes not attached to compose
  let removedAny = false;
  for (const vol of [VOLUME_NAME, PEER_VOLUME_NAME]) {
    try {
      execSync(`docker volume rm -f ${vol}`, { stdio: 'ignore' });
      removedAny = true;
    } catch {
      // volume not found — ok
    }
  }
  stopSpinner.succeed(chalk.dim('Sandbox stopped and volumes removed'));

  // Clear WalletStore
  new WalletStore('local').clear();
  logger.dim('  Account store cleared');

  // Optionally clear snapshots
  if (options.snapshots) {
    if (fs.existsSync(SNAPSHOTS_DIR)) {
      fs.rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
      logger.dim('  Snapshots cleared');
    } else {
      logger.dim('  No snapshots found');
    }
  }

  logger.blank();
  logger.success('Local sandbox reset to factory state.');
  logger.dim('  Run xrpl-up start --local to start fresh.');
  logger.blank();
}
