"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_WS_URL = exports.LOCAL_WS_PORT = exports.DEFAULT_IMAGE = exports.CONTAINER_NAME = void 0;
exports.checkDockerAvailable = checkDockerAvailable;
exports.isContainerRunning = isContainerRunning;
exports.removeContainerIfExists = removeContainerIfExists;
exports.startRippled = startRippled;
exports.stopRippled = stopRippled;
const child_process_1 = require("child_process");
const net_1 = __importDefault(require("net"));
exports.CONTAINER_NAME = 'xrpl-up-local';
exports.DEFAULT_IMAGE = 'xrpllabsofficial/xrpld:3.3.0';
exports.LOCAL_WS_PORT = 6006;
exports.LOCAL_WS_URL = `ws://localhost:${exports.LOCAL_WS_PORT}`;
/** Throws if Docker daemon is not running or not installed. */
function checkDockerAvailable() {
    try {
        (0, child_process_1.execSync)('docker info', { stdio: 'ignore' });
    }
    catch {
        throw new Error('Docker is not available.\n' +
            '  Install Docker from https://docker.com and make sure the daemon is running.');
    }
}
/** Returns true if the xrpl-up-local container is currently running. */
function isContainerRunning() {
    try {
        const out = (0, child_process_1.execSync)(`docker inspect --format='{{.State.Running}}' ${exports.CONTAINER_NAME}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
            .trim()
            .replace(/'/g, '');
        return out === 'true';
    }
    catch {
        return false;
    }
}
/** Force-removes the container if it exists (stopped or running). */
function removeContainerIfExists() {
    try {
        (0, child_process_1.execSync)(`docker rm -f ${exports.CONTAINER_NAME}`, { stdio: 'ignore' });
    }
    catch {
        // didn't exist — fine
    }
}
/**
 * Pull the image (if needed), start a detached rippled container,
 * wait until the WebSocket port is accepting connections, and return
 * the local WebSocket URL.
 */
async function startRippled(image = exports.DEFAULT_IMAGE) {
    removeContainerIfExists();
    // Container port 80 is the WebSocket endpoint in xrpllabsofficial/xrpld.
    // We map it to LOCAL_WS_PORT (6006) on the host so XRPL_NETWORK_URL stays unchanged.
    // -a = standalone mode (no peers), --start = begin from genesis ledger.
    (0, child_process_1.execSync)(`docker run -d --name ${exports.CONTAINER_NAME} -p ${exports.LOCAL_WS_PORT}:80 ${image} -a --start`, { stdio: 'ignore' });
    await waitForPort(exports.LOCAL_WS_PORT, 30_000);
    return exports.LOCAL_WS_URL;
}
/** Stop and remove the rippled container. */
function stopRippled() {
    try {
        (0, child_process_1.execSync)(`docker stop ${exports.CONTAINER_NAME} && docker rm ${exports.CONTAINER_NAME}`, {
            stdio: 'ignore',
        });
    }
    catch {
        // already gone
    }
}
function waitForPort(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        function attempt() {
            const socket = new net_1.default.Socket();
            socket.setTimeout(1000);
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            const onFail = () => {
                socket.destroy();
                if (Date.now() > deadline) {
                    reject(new Error(`rippled did not become reachable on port ${port} within ${timeoutMs / 1000}s`));
                }
                else {
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
