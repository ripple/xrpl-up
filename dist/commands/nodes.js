"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodesCommand = nodesCommand;
const child_process_1 = require("child_process");
const chalk_1 = __importDefault(require("chalk"));
const node_fs_1 = __importDefault(require("node:fs"));
const compose_1 = require("../core/compose");
const logger_1 = require("../utils/logger");
function containerName(serviceN) {
    return `${compose_1.COMPOSE_PROJECT}-${serviceN}-1`;
}
function dockerHealth(service) {
    try {
        const out = (0, child_process_1.execSync)(`docker inspect --format '{{.State.Health.Status}}' ${containerName(service)}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        return out || 'unknown';
    }
    catch {
        return 'not running';
    }
}
function serverInfo(service) {
    try {
        const raw = (0, child_process_1.execSync)(`docker exec ${containerName(service)} xrpld --conf /config/rippled.cfg server_info 2>/dev/null`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
        const stateM = raw.match(/"server_state"\s*:\s*"([^"]+)"/);
        const seqM = raw.match(/"seq"\s*:\s*(\d+)/);
        const peersM = raw.match(/"peers"\s*:\s*(\d+)/);
        return {
            state: stateM?.[1] ?? 'unknown',
            seq: seqM ? parseInt(seqM[1], 10) : null,
            peers: peersM ? parseInt(peersM[1], 10) : null,
        };
    }
    catch {
        return { state: 'unreachable', seq: null, peers: null };
    }
}
function colorHealth(h) {
    if (h === 'healthy')
        return chalk_1.default.green(h);
    if (h === 'starting')
        return chalk_1.default.yellow(h);
    return chalk_1.default.red(h);
}
function colorState(s) {
    if (s === 'proposing')
        return chalk_1.default.green(s);
    if (s === 'full' || s === 'validating')
        return chalk_1.default.green(s);
    if (s === 'connected')
        return chalk_1.default.yellow(s);
    return chalk_1.default.red(s);
}
async function nodesCommand() {
    if (!node_fs_1.default.existsSync(compose_1.COMPOSE_FILE) || !(0, compose_1.isConsensusMode)()) {
        logger_1.logger.error(`No local consensus network found. Run \`${(0, compose_1.startCommandHint)()}\` with --local-network first.`);
        process.exit(1);
    }
    const nodeCount = (0, compose_1.readConsensusNodeCount)();
    const rows = [];
    for (let i = 1; i <= nodeCount; i++) {
        const svc = (0, compose_1.nodeServiceName)(i);
        const health = dockerHealth(svc);
        const { state, seq, peers } = health === 'healthy' ? serverInfo(svc) : { state: '—', seq: null, peers: null };
        rows.push({ label: `validator${i}`, health, state, seq, peers });
    }
    logger_1.logger.blank();
    for (const r of rows) {
        const seqStr = r.seq != null ? `seq=${r.seq}` : 'seq=—';
        const peersStr = r.peers != null ? `peers=${r.peers}` : 'peers=—';
        logger_1.logger.log(`${chalk_1.default.cyan(r.label.padEnd(12))}  ${colorHealth(r.health.padEnd(10))}  ${colorState(r.state.padEnd(12))}  ${chalk_1.default.dim(seqStr)}  ${chalk_1.default.dim(peersStr)}`);
    }
    logger_1.logger.blank();
}
