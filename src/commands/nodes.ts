import { execSync } from 'child_process';
import chalk from 'chalk';
import fs from 'node:fs';
import {
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  nodeServiceName,
  readConsensusNodeCount,
  isConsensusMode,
  startCommandHint,
} from '../core/compose';
import { logger } from '../utils/logger';

interface NodeInfo {
  label: string;
  health: string;
  state: string;
  seq: number | null;
  peers: number | null;
}

function containerName(serviceN: string): string {
  return `${COMPOSE_PROJECT}-${serviceN}-1`;
}

function dockerHealth(service: string): string {
  try {
    const out = execSync(
      `docker inspect --format '{{.State.Health.Status}}' ${containerName(service)}`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
    return out || 'unknown';
  } catch {
    return 'not running';
  }
}

function serverInfo(service: string): { state: string; seq: number | null; peers: number | null } {
  try {
    const raw = execSync(
      `docker exec ${containerName(service)} xrpld --conf /config/rippled.cfg server_info 2>/dev/null`,
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).toString();
    const stateM = raw.match(/"server_state"\s*:\s*"([^"]+)"/);
    const seqM = raw.match(/"seq"\s*:\s*(\d+)/);
    const peersM = raw.match(/"peers"\s*:\s*(\d+)/);
    return {
      state: stateM?.[1] ?? 'unknown',
      seq: seqM ? parseInt(seqM[1], 10) : null,
      peers: peersM ? parseInt(peersM[1], 10) : null,
    };
  } catch {
    return { state: 'unreachable', seq: null, peers: null };
  }
}

function colorHealth(h: string): string {
  if (h === 'healthy') return chalk.green(h);
  if (h === 'starting') return chalk.yellow(h);
  return chalk.red(h);
}

function colorState(s: string): string {
  if (s === 'proposing') return chalk.green(s);
  if (s === 'full' || s === 'validating') return chalk.green(s);
  if (s === 'connected') return chalk.yellow(s);
  return chalk.red(s);
}

export async function nodesCommand(): Promise<void> {
  if (!fs.existsSync(COMPOSE_FILE) || !isConsensusMode()) {
    logger.error(
      `No local consensus network found. Run \`${startCommandHint()}\` with --local-network first.`
    );
    process.exit(1);
  }

  const nodeCount = readConsensusNodeCount();
  const rows: NodeInfo[] = [];

  for (let i = 1; i <= nodeCount; i++) {
    const svc = nodeServiceName(i);
    const health = dockerHealth(svc);
    const { state, seq, peers } = health === 'healthy' ? serverInfo(svc) : { state: '—', seq: null, peers: null };
    rows.push({ label: `validator${i}`, health, state, seq, peers });
  }

  logger.blank();
  for (const r of rows) {
    const seqStr = r.seq != null ? `seq=${r.seq}` : 'seq=—';
    const peersStr = r.peers != null ? `peers=${r.peers}` : 'peers=—';
    logger.log(
      `${chalk.cyan(r.label.padEnd(12))}  ${colorHealth(r.health.padEnd(10))}  ${colorState(r.state.padEnd(12))}  ${chalk.dim(seqStr)}  ${chalk.dim(peersStr)}`
    );
  }
  logger.blank();
}
