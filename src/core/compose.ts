import { execSync, spawn, ChildProcess } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

export const COMPOSE_PROJECT = 'xrpl-up-local';
export const LOCAL_WS_PORT = 6006;
export const FAUCET_PORT = 3001;
export const LOCAL_WS_URL = `ws://localhost:${LOCAL_WS_PORT}`;
export const FAUCET_URL = `http://localhost:${FAUCET_PORT}`;
export const DEFAULT_IMAGE = 'xrpllabsofficial/xrpld:latest';

const XRPL_UP_DIR = path.join(os.homedir(), '.xrpl-up');
const COMPOSE_FILE = path.join(XRPL_UP_DIR, 'docker-compose.yml');

export { COMPOSE_FILE };

/** Throws if Docker daemon is not running or not installed. */
export function checkDockerAvailable(): void {
  try {
    execSync('docker info', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'Docker is not available.\n' +
        '  Install Docker from https://docker.com and make sure the daemon is running.'
    );
  }
}

/**
 * Returns the absolute path to the faucet build context directory.
 *
 * At runtime (compiled):  __dirname = dist/core/  → ../faucet-server = dist/faucet-server/
 * In dev mode (tsx):      __dirname = src/core/   → fallback to dist/faucet-server/ from project root
 */
function getFaucetBuildContext(): string {
  const fromDist = path.resolve(__dirname, '..', 'faucet-server');

  // If running via tsx (src/core), point at the compiled dist instead
  if (__dirname.includes(`${path.sep}src${path.sep}`)) {
    // Walk up to project root (src/core → src → project root)
    const projectRoot = path.resolve(__dirname, '..', '..');
    return path.join(projectRoot, 'dist', 'faucet-server');
  }

  return fromDist;
}

const RIPPLED_CFG_FILE = path.join(XRPL_UP_DIR, 'rippled.cfg');
const VALIDATORS_CFG_FILE = path.join(XRPL_UP_DIR, 'validators.txt');
export { RIPPLED_CFG_FILE };

/**
 * Returns the default rippled.cfg content as a string (pure, no side effects).
 * Exported so callers can display or save it without starting a node.
 */
export function generateRippledConfig(debug = false): string {
  return `
[server]
port_rpc_admin_local
port_ws_admin_local
port_peer

[port_rpc_admin_local]
port = 5005
ip = 127.0.0.1
admin = 127.0.0.1
protocol = http

[port_ws_admin_local]
port = ${LOCAL_WS_PORT}
ip = 0.0.0.0
admin = 0.0.0.0
protocol = ws
send_queue_limit = 500

[port_peer]
port = 51235
ip = 0.0.0.0
protocol = peer

[node_size]
small

[node_db]
type=NuDB
path=/var/lib/rippled/db/nudb
advisory_delete=0

[database_path]
/var/lib/rippled/db

[debug_logfile]
/var/log/rippled/debug.log

[sntp_servers]
time.windows.com
time.apple.com
time.nist.gov
pool.ntp.org

[validators_file]
validators.txt

[rpc_startup]
{ "command": "log_level", "severity": "${debug ? 'debug' : 'warning'}" }

[ssl_verify]
0

# Force-enable amendments at genesis ledger creation.
# The [amendments] stanza only takes effect on the very first start
# (--start flag creates the genesis ledger). Format: <hash> <name>
#
# AMM (featureAMM) — base AMM transaction types (AMMCreate, AMMDeposit, etc.)
# fixUniversalNumber — required dependency: ammEnabled() checks both featureAMM
#                     AND fixUniversalNumber internally before allowing AMM txs
[amendments]
8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455 AMM
2E2FB9CF8A44EB80F4694D38AADAE9B8B7ADAFD2F092E10068E61C98C4F092B0 fixUniversalNumber
`.trim();
}

/**
 * Write a minimal standalone rippled.cfg that exposes the WebSocket admin port
 * on 0.0.0.0 so the faucet container can reach it via host.docker.internal.
 * Also writes a companion validators.txt required by the [amendments] section.
 */
function writeRippledConfig(debug = false): void {
  fs.writeFileSync(RIPPLED_CFG_FILE, generateRippledConfig(debug), 'utf-8');
  // The [amendments] section in rippled.cfg requires a validators_file with a
  // [validators] section (even empty). Write a minimal one alongside rippled.cfg.
  if (!fs.existsSync(VALIDATORS_CFG_FILE)) {
    fs.writeFileSync(VALIDATORS_CFG_FILE, '[validators]\n', 'utf-8');
  }
}

/**
 * Generate and write docker-compose.yml to ~/.xrpl-up/.
 * @param configPath - optional path to a custom rippled.cfg; if omitted, the
 *   default config is auto-generated and written to RIPPLED_CFG_FILE.
 */
export function writeComposeFile(image = DEFAULT_IMAGE, persist = false, debug = false, ledgerIntervalMs = 0, configPath?: string): string {
  if (!fs.existsSync(XRPL_UP_DIR)) {
    fs.mkdirSync(XRPL_UP_DIR, { recursive: true });
  }

  // Use custom config if provided, otherwise auto-generate the default
  const resolvedConfigPath = configPath
    ? path.resolve(configPath)
    : RIPPLED_CFG_FILE;

  if (!configPath) {
    writeRippledConfig(debug);
  }

  // Determine validators.txt to mount alongside the rippled.cfg.
  // For auto-generated configs, use the companion file in ~/.xrpl-up/.
  // For custom configs, look for validators.txt next to the config file.
  const customValidatorsPath = configPath
    ? path.join(path.dirname(path.resolve(configPath)), 'validators.txt')
    : null;
  const resolvedValidatorsPath =
    customValidatorsPath && fs.existsSync(customValidatorsPath)
      ? customValidatorsPath
      : VALIDATORS_CFG_FILE;

  const faucetContext = getFaucetBuildContext();

  // In persist mode, mount a named volume for the NuDB database so ledger
  // state survives container restarts. In ephemeral mode, no volume is declared
  // and the database lives only in the container's writable layer.
  const dbVolume = persist
    ? `      - rippled-db:/var/lib/rippled/db`
    : '';
  const volumesSection = persist
    ? `\nvolumes:\n  rippled-db:\n    name: xrpl-up-local-db`
    : '';

  const yaml = `# Generated by xrpl-up — do not edit manually
# Regenerated on every 'xrpl-up node --local' run

name: ${COMPOSE_PROJECT}

services:
  rippled:
    image: ${image}
    command: ["-a", "--start"]
    ports:
      - "${LOCAL_WS_PORT}:${LOCAL_WS_PORT}"
    volumes:
      - "${resolvedConfigPath}:/config/rippled.cfg:ro"
      - "${resolvedValidatorsPath}:/config/validators.txt:ro"
${dbVolume}
    networks:
      - xrpl-net
    healthcheck:
      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/${LOCAL_WS_PORT}"]
      interval: 2s
      timeout: 2s
      retries: 20
      start_period: 5s

  faucet:
    build:
      context: ${faucetContext}
      dockerfile: Dockerfile
    environment:
      - RIPPLED_WS_URL=ws://host.docker.internal:${LOCAL_WS_PORT}
      - FAUCET_PORT=${FAUCET_PORT}
      - FUND_AMOUNT_XRP=1000
      - LEDGER_INTERVAL_MS=${ledgerIntervalMs}
    ports:
      - "${FAUCET_PORT}:${FAUCET_PORT}"
    networks:
      - xrpl-net
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      rippled:
        condition: service_healthy

networks:
  xrpl-net:
    driver: bridge
${volumesSection}
`;

  fs.writeFileSync(COMPOSE_FILE, yaml, 'utf-8');
  return COMPOSE_FILE;
}

/** Stop a single service without removing containers or volumes. */
export function stopService(service: string): void {
  execSync(
    `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" stop ${service}`,
    { stdio: 'ignore' }
  );
}

/** Start a previously stopped service. */
export function startService(service: string): void {
  execSync(
    `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" start ${service}`,
    { stdio: 'ignore' }
  );
}

/** Run `docker compose down` (removes containers, keeps volumes). */
export function composeDown(): void {
  try {
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" down`,
      { stdio: 'ignore' }
    );
  } catch {
    // already gone or never started
  }
}

/**
 * Start the compose stack (`docker compose up --build -d`),
 * wait for both ports to be reachable, and return the WebSocket URL.
 *
 * When `persist` is true, the rippled NuDB volume is preserved across restarts.
 * When false (default), containers are torn down clean before starting.
 */
export async function composeUp(image = DEFAULT_IMAGE, persist = false, debug = false, ledgerIntervalMs = 0, configPath?: string): Promise<string> {
  writeComposeFile(image, persist, debug, ledgerIntervalMs, configPath);
  if (!persist) composeDown(); // clean slate only in ephemeral mode

  execSync(
    `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up --build -d`,
    { stdio: 'ignore' }
  );

  // Wait for rippled WebSocket port then faucet HTTP port
  await waitForPort(LOCAL_WS_PORT, 30_000, 'rippled WebSocket');
  await waitForPort(FAUCET_PORT, 30_000, 'faucet HTTP');

  return LOCAL_WS_URL;
}

/**
 * Spawn `docker compose logs --follow [service]` and stream to the caller's
 * stdout/stderr. Returns the child process so the caller can handle termination.
 */
export function composeLogs(service?: string): ChildProcess {
  const args = [
    'compose',
    '-p', COMPOSE_PROJECT,
    '-f', COMPOSE_FILE,
    'logs',
    '--follow',
    '--no-log-prefix',
  ];
  if (service) args.push(service);

  return spawn('docker', args, { stdio: 'inherit' });
}

export function waitForPort(port: number, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      const onFail = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(
            new Error(
              `${label} did not become reachable on port ${port} within ${timeoutMs / 1000}s`
            )
          );
        } else {
          setTimeout(attempt, 1000);
        }
      };
      socket.once('error', onFail);
      socket.once('timeout', onFail);
      socket.connect(port, '127.0.0.1');
    }
    // Give Docker a moment before the first probe
    setTimeout(attempt, 2000);
  });
}
