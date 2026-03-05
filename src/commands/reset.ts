import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { composeDown } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

const VOLUME_NAME = 'xrpl-up-local-db';
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

  // Stop containers
  const stopSpinner = ora({ text: chalk.dim('Stopping sandbox…'), prefixText: ' ' }).start();
  composeDown();
  stopSpinner.succeed(chalk.dim('Sandbox stopped'));

  // Remove Docker persist volume
  const volumeSpinner = ora({ text: chalk.dim('Removing ledger volume…'), prefixText: ' ' }).start();
  try {
    execSync(`docker volume rm ${VOLUME_NAME}`, { stdio: 'ignore' });
    volumeSpinner.succeed(chalk.dim('Ledger volume removed'));
  } catch {
    volumeSpinner.succeed(chalk.dim('No ledger volume found'));
  }

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
  logger.dim('  Run xrpl-up node --local to start fresh.');
  logger.blank();
}
