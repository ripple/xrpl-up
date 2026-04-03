import chalk from 'chalk';
import fs from 'node:fs';
import { composeLogs, COMPOSE_FILE } from '../core/compose';
import { logger } from '../utils/logger';

export interface LogsOptions {
  service?: string;
}

export async function logsCommand(options: LogsOptions = {}): Promise<void> {
  if (!fs.existsSync(COMPOSE_FILE)) {
    logger.error(
      'No local stack found. Run `xrpl-up start --local` first to start the stack.'
    );
    process.exit(1);
  }

  const service = options.service;
  const label = service ? chalk.cyan(service) : chalk.cyan('all services');

  logger.info(`Streaming logs for ${label}  ${chalk.dim('· Ctrl+C to stop')}`);
  logger.blank();

  const child = composeLogs(service);

  child.on('error', (err) => {
    logger.error(`Failed to stream logs: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
  });

  // Forward Ctrl+C to the child process only
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });
}
