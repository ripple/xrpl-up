import http from 'node:http';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL, FAUCET_URL } from '../core/compose';
import { logger } from '../utils/logger';

export interface StatusOptions {
  network?: string;
  local?: boolean;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!parts.length) parts.push(`${seconds % 60}s`);
  return parts.join(' ');
}

async function checkFaucetHealth(): Promise<'healthy' | 'unreachable'> {
  return new Promise((resolve) => {
    const req = http.request(`${FAUCET_URL}/health`, { method: 'GET' }, (res) => {
      resolve(res.statusCode === 200 ? 'healthy' : 'unreachable');
    });
    req.setTimeout(3000, () => { req.destroy(); resolve('unreachable'); });
    req.on('error', () => resolve('unreachable'));
    req.end();
  });
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  let networkName: string;
  let networkConfig: { url: string; name?: string };
  const isLocal = options.local ?? false;

  if (isLocal) {
    networkName = 'local';
    networkConfig = { url: LOCAL_WS_URL, name: 'Local rippled (Docker)' };
  } else {
    const config = loadConfig();
    const resolved = resolveNetwork(config, options.network);
    networkName = resolved.name;
    networkConfig = resolved.config;
  }

  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching status from ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    // Get full server_info (more fields than getServerInfo() helper)
    const res = await manager.client.request({ command: 'server_info' });
    const info = res.result.info as Record<string, any>;

    // For local mode, also check faucet health in parallel
    const faucetStatus = isLocal ? await checkFaucetHealth() : null;

    await manager.disconnect();
    spinner.stop();

    const ledgerSeq  = info.validated_ledger?.seq ?? info.ledger_index ?? '—';
    const state      = info.server_state ?? '—';
    const version    = info.build_version ?? '—';
    const uptime     = typeof info.uptime === 'number' ? formatUptime(info.uptime) : '—';
    const loadFactor = info.load_factor != null ? String(info.load_factor) : '—';
    const ledgers    = info.complete_ledgers ?? '—';
    const peers      = info.peers ?? 0;

    logger.blank();
    logger.section('Status · ' + chalk.cyan(manager.displayName));

    logger.log(`${chalk.dim('Version:')}         ${chalk.white(version)}`);
    logger.log(`${chalk.dim('State:')}           ${state === 'proposing' || state === 'full' ? chalk.green(state) : chalk.yellow(state)}`);
    logger.log(`${chalk.dim('Ledger:')}          ${chalk.white('#' + String(ledgerSeq))}`);
    logger.log(`${chalk.dim('Complete:')}        ${chalk.dim(ledgers)}`);
    logger.log(`${chalk.dim('Uptime:')}          ${chalk.white(uptime)}`);
    logger.log(`${chalk.dim('Load factor:')}     ${chalk.white(loadFactor)}`);
    logger.log(`${chalk.dim('Peers:')}           ${chalk.dim(String(peers))}`);
    logger.log(`${chalk.dim('Endpoint:')}        ${chalk.dim(networkConfig.url)}`);

    if (faucetStatus !== null) {
      const faucetLine = faucetStatus === 'healthy'
        ? chalk.green('✓ healthy') + chalk.dim('  ' + FAUCET_URL)
        : chalk.red('✗ unreachable') + chalk.dim('  ' + FAUCET_URL);
      logger.log(`${chalk.dim('Faucet:')}          ${faucetLine}`);
    }

    logger.blank();
  } catch (err: unknown) {
    spinner.fail(`Failed to fetch status from ${chalk.dim(networkConfig.url)}`);
    logger.error(err instanceof Error ? err.message : String(err));
    if (isLocal) {
      logger.dim('  Is the local sandbox running? Check with:');
      logger.dim('    docker ps | grep xrpl-up');
      logger.dim('  Start it with: xrpl-up start --local --detach');
    }
    await manager.disconnect();
    process.exit(1);
  }
}
