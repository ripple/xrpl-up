import { execSync } from 'child_process';
import net from 'net';

export const CONTAINER_NAME = 'xrpl-up-local';
export const DEFAULT_IMAGE = 'xrpllabsofficial/xrpld:latest';
export const LOCAL_WS_PORT = 6006;
export const LOCAL_WS_URL = `ws://localhost:${LOCAL_WS_PORT}`;

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

/** Returns true if the xrpl-up-local container is currently running. */
export function isContainerRunning(): boolean {
  try {
    const out = execSync(
      `docker inspect --format='{{.State.Running}}' ${CONTAINER_NAME}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    )
      .trim()
      .replace(/'/g, '');
    return out === 'true';
  } catch {
    return false;
  }
}

/** Force-removes the container if it exists (stopped or running). */
export function removeContainerIfExists(): void {
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'ignore' });
  } catch {
    // didn't exist — fine
  }
}

/**
 * Pull the image (if needed), start a detached rippled container,
 * wait until the WebSocket port is accepting connections, and return
 * the local WebSocket URL.
 */
export async function startRippled(image = DEFAULT_IMAGE): Promise<string> {
  removeContainerIfExists();

  // Container port 80 is the WebSocket endpoint in xrpllabsofficial/xrpld.
  // We map it to LOCAL_WS_PORT (6006) on the host so XRPL_NETWORK_URL stays unchanged.
  // -a = standalone mode (no peers), --start = begin from genesis ledger.
  execSync(
    `docker run -d --name ${CONTAINER_NAME} -p ${LOCAL_WS_PORT}:80 ${image} -a --start`,
    { stdio: 'ignore' }
  );

  await waitForPort(LOCAL_WS_PORT, 30_000);
  return LOCAL_WS_URL;
}

/** Stop and remove the rippled container. */
export function stopRippled(): void {
  try {
    execSync(`docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}`, {
      stdio: 'ignore',
    });
  } catch {
    // already gone
  }
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
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
              `rippled did not become reachable on port ${port} within ${timeoutMs / 1000}s`
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
