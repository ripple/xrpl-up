import chalk from 'chalk';
import fs from 'node:fs';
import { composeLogs, COMPOSE_FILE, startCommandHint, nodeServiceName, MAX_CONSENSUS_NODES } from '../core/compose';
import { logger } from '../utils/logger';

export interface LogsOptions {
  service?: string;
}

function resolveService(input: string): string | null {
  const m = input.match(/^node(\d+)$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= MAX_CONSENSUS_NODES) return nodeServiceName(n);
    return null; // out of range
  }
  return input;
}

export async function logsCommand(options: LogsOptions = {}): Promise<void> {
  if (!fs.existsSync(COMPOSE_FILE)) {
    logger.error(
      `No local stack found. Run \`${startCommandHint()}\` first to start the stack.`
    );
    process.exit(1);
  }

  const rawInput = options.service;
  const resolved = rawInput ? resolveService(rawInput) : undefined;
  if (resolved === null) {
    logger.error(`Unknown service "${rawInput}". Use node1–node${MAX_CONSENSUS_NODES} or faucet.`);
    process.exit(1);
  }
  const service = resolved;
  const label = rawInput ? chalk.cyan(rawInput) : chalk.cyan('all services');

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
