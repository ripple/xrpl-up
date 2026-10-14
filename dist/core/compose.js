"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RIPPLED_CFG_FILE = exports.EXTRA_AMENDMENTS_FILE = exports.PEER_VOLUME_NAME = exports.VOLUME_NAME = exports.COMPOSE_FILE = exports.DEFAULT_IMAGE = exports.FAUCET_URL = exports.LOCAL_WS_URL = exports.FAUCET_PORT = exports.LOCAL_WS_PORT = exports.COMPOSE_PROJECT = void 0;
exports.checkDockerAvailable = checkDockerAvailable;
exports.generateRippledConfig = generateRippledConfig;
exports.writeRippledConfig = writeRippledConfig;
exports.writeComposeFile = writeComposeFile;
exports.readComposeImage = readComposeImage;
exports.readComposeLedgerInterval = readComposeLedgerInterval;
exports.stopService = stopService;
exports.startService = startService;
exports.composeDown = composeDown;
exports.volumeHasData = volumeHasData;
exports.readGenesisLineage = readGenesisLineage;
exports.adoptGenesisLineage = adoptGenesisLineage;
exports.clearGenesisLineage = clearGenesisLineage;
exports.clearLocalNetworkImageRecord = clearLocalNetworkImageRecord;
exports.composeUp = composeUp;
exports.isConsensusMode = isConsensusMode;
exports.startCommandHint = startCommandHint;
exports.composeLogs = composeLogs;
exports.waitForPort = waitForPort;
const child_process_1 = require("child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_net_1 = __importDefault(require("node:net"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const xrpld_image_1 = require("./xrpld-image");
Object.defineProperty(exports, "DEFAULT_IMAGE", { enumerable: true, get: function () { return xrpld_image_1.DEFAULT_IMAGE; } });
const genesis_amendments_1 = require("./genesis-amendments");
exports.COMPOSE_PROJECT = 'xrpl-up-local';
exports.LOCAL_WS_PORT = 6006;
exports.FAUCET_PORT = 3001;
exports.LOCAL_WS_URL = `ws://localhost:${exports.LOCAL_WS_PORT}`;
exports.FAUCET_URL = `http://localhost:${exports.FAUCET_PORT}`;
const XRPL_UP_DIR = node_path_1.default.join(node_os_1.default.homedir(), '.xrpl-up');
const COMPOSE_FILE = node_path_1.default.join(XRPL_UP_DIR, 'docker-compose.yml');
exports.COMPOSE_FILE = COMPOSE_FILE;
// ── Hardcoded validator keys for local 2-node consensus (dev-only) ───────────
// These are NOT secret — they're for local sandbox use only, just like the
// genesis account seed snoPBrXtMeMyMHUVTgbuqAfg1SUTb.
const VALIDATOR_1_SEED = 'ssUi9ifdKYGKs16Auvjv8UKcqDwMz';
const VALIDATOR_1_PUBKEY = 'n9K1v5WwXvBCDL2CKFFGUkMEFuHcjzgwCm19hQ5sMkTKMkLqbnVP';
const VALIDATOR_2_SEED = 'ss5xTzsXe9gFPjYFnvkko4EUqzHs1';
const VALIDATOR_2_PUBKEY = 'n94BNfvffQG4Q1VWbRVGmjsgQoKrPqmDZSUFBJyqQ6ieZcco2yeX';
exports.VOLUME_NAME = 'xrpl-up-local-db';
exports.PEER_VOLUME_NAME = 'xrpl-up-local-peer-db';
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
/**
 * Returns the absolute path to the faucet build context directory.
 *
 * At runtime (compiled):  __dirname = dist/core/  → ../faucet-server = dist/faucet-server/
 * In dev mode (tsx):      __dirname = src/core/   → fallback to dist/faucet-server/ from project root
 */
function getFaucetBuildContext() {
    const fromDist = node_path_1.default.resolve(__dirname, '..', 'faucet-server');
    // If running via tsx (src/core), point at the compiled dist instead
    if (__dirname.includes(`${node_path_1.default.sep}src${node_path_1.default.sep}`)) {
        // Walk up to project root (src/core → src → project root)
        const projectRoot = node_path_1.default.resolve(__dirname, '..', '..');
        return node_path_1.default.join(projectRoot, 'dist', 'faucet-server');
    }
    return fromDist;
}
const RIPPLED_CFG_FILE = node_path_1.default.join(XRPL_UP_DIR, 'rippled.cfg');
exports.RIPPLED_CFG_FILE = RIPPLED_CFG_FILE;
const RIPPLED_CFG_FILE_NODE1 = node_path_1.default.join(XRPL_UP_DIR, 'rippled-node1.cfg');
const RIPPLED_CFG_FILE_NODE2 = node_path_1.default.join(XRPL_UP_DIR, 'rippled-node2.cfg');
const VALIDATORS_CFG_FILE = node_path_1.default.join(XRPL_UP_DIR, 'validators.txt');
/** Extra amendments written by `amendment enable`; merged at genesis. */
exports.EXTRA_AMENDMENTS_FILE = node_path_1.default.join(XRPL_UP_DIR, 'genesis-amendments.txt');
/** Records which image last started the persistent --local-network volumes. */
const LOCAL_NETWORK_IMAGE_FILE = node_path_1.default.join(XRPL_UP_DIR, 'local-network-image.txt');
/**
 * Identifies which genesis ledger the current --local-network volumes descend
 * from ("lineage"). Snapshots record this so `snapshot restore` can tell
 * whether a snapshot belongs to the sandbox it is being restored into.
 *
 * A snapshot only restores correctly onto the same lineage: it is a copy of
 * that ledger chain's database. `base` is a genesis built from the default
 * amendment list alone; force-enabling extra amendments builds a different
 * genesis, which starts a different lineage.
 */
const GENESIS_LINEAGE_FILE = node_path_1.default.join(XRPL_UP_DIR, 'genesis-lineage.txt');
/** Lineage of a genesis built from the default amendment list alone. */
const BASE_LINEAGE = 'base';
/**
 * Returns the default rippled.cfg content as a string (pure, no side effects).
 * Exported so callers can display or save it without starting a node.
 */
function generateRippledConfig(debug = false, amendments = genesis_amendments_1.DEFAULT_AMENDMENTS) {
    const amendmentLines = amendments.map((a) => `${a.hash} ${a.name}`).join('\n');
    return `
[network_id]
15791

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
port = ${exports.LOCAL_WS_PORT}
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
path=/var/lib/xrpld/db/nudb
advisory_delete=0

[database_path]
/var/lib/xrpld/db

[debug_logfile]
/var/log/xrpld/debug.log

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

[amendment_majority_time]
15 minutes

# Force-enable amendments at genesis ledger creation. Only takes effect on the
# very first start (--start creates the genesis ledger). Format: <hash> <name>
#
# Generated per xrpld build: every amendment enabled on mainnet that this xrpld
# supports and has not retired (Obsolete). See src/core/default-amendments.json.
[amendments]
${amendmentLines}
# sync:end
`.trim();
}
/**
 * Generate a consensus-mode config for one of the two private-network nodes.
 * Takes the base config and appends [validation_seed] + [ips_fixed].
 */
function generateConsensusNodeConfig(nodeIndex, debug = false) {
    const base = generateRippledConfig(debug);
    const seed = nodeIndex === 1 ? VALIDATOR_1_SEED : VALIDATOR_2_SEED;
    const peerName = nodeIndex === 1 ? 'rippled-peer' : 'rippled';
    return base + `

[validation_seed]
${seed}

[ips_fixed]
${peerName} 51235`;
}
/**
 * Merge extra amendments from genesis-amendments.txt into a config string.
 */
function mergeExtraAmendments(cfg) {
    if (!node_fs_1.default.existsSync(exports.EXTRA_AMENDMENTS_FILE))
        return cfg;
    const extra = node_fs_1.default.readFileSync(exports.EXTRA_AMENDMENTS_FILE, 'utf-8').trim();
    if (!extra)
        return cfg;
    const merged = cfg.replace('# sync:end', extra + '\n# sync:end');
    if (merged === cfg) {
        throw new Error('writeRippledConfig: "# sync:end" sentinel not found in generated config — ' +
            'extra amendments could not be merged. Check the generateRippledConfig template.');
    }
    return merged;
}
/**
 * Write rippled config(s) and validators.txt to ~/.xrpl-up/.
 *
 * In consensus mode (default): writes rippled-node1.cfg + rippled-node2.cfg
 * with validator seeds and mutual [ips_fixed] references.
 *
 * In standalone mode (default): writes a single rippled.cfg.
 */
function writeRippledConfig(debug = false, noConsensus = false) {
    if (!node_fs_1.default.existsSync(XRPL_UP_DIR)) {
        node_fs_1.default.mkdirSync(XRPL_UP_DIR, { recursive: true });
    }
    if (noConsensus) {
        // Standalone mode: single config, no validator keys
        const cfg = mergeExtraAmendments(generateRippledConfig(debug));
        node_fs_1.default.writeFileSync(RIPPLED_CFG_FILE, cfg, 'utf-8');
        // Standalone mode needs a validators.txt for the [amendments] section
        if (!node_fs_1.default.existsSync(VALIDATORS_CFG_FILE)) {
            node_fs_1.default.writeFileSync(VALIDATORS_CFG_FILE, '[validators]\n', 'utf-8');
        }
    }
    else {
        // Consensus mode: two configs with validator keys + ips_fixed
        for (const idx of [1, 2]) {
            const cfg = mergeExtraAmendments(generateConsensusNodeConfig(idx, debug));
            const target = idx === 1 ? RIPPLED_CFG_FILE_NODE1 : RIPPLED_CFG_FILE_NODE2;
            node_fs_1.default.writeFileSync(target, cfg, 'utf-8');
        }
        // Validators.txt with both public keys (shared by both nodes)
        node_fs_1.default.writeFileSync(VALIDATORS_CFG_FILE, `[validators]\n    ${VALIDATOR_1_PUBKEY}\n    ${VALIDATOR_2_PUBKEY}\n`, 'utf-8');
    }
}
/**
 * Generate and write docker-compose.yml to ~/.xrpl-up/.
 *
 * Default (noConsensus=true): single rippled with -a --start, no
 * persistence, instant ledger_accept.
 *
 * With --local-network (noConsensus=false): 2-node private consensus network
 * with persistent volumes, SQLite index, and automatic ledger close (~4s).
 *
 * @param configPath - optional path to a custom rippled.cfg; implies
 *   standalone mode (custom configs can't carry validator seeds).
 */
function writeComposeFile(image = xrpld_image_1.DEFAULT_IMAGE, noConsensus = false, debug = false, ledgerIntervalMs = 0, configPath, noRestart = false, bindAddress = '127.0.0.1') {
    if (!node_fs_1.default.existsSync(XRPL_UP_DIR)) {
        node_fs_1.default.mkdirSync(XRPL_UP_DIR, { recursive: true });
    }
    // Custom config always forces standalone mode
    if (configPath)
        noConsensus = true;
    // Only force linux/amd64 on ARM hosts (e.g. Apple Silicon) where the
    // official xrpld image ships amd64-only and needs Rosetta 2 emulation.
    const platformLine = node_os_1.default.arch() === 'arm64' ? '\n    platform: linux/amd64' : '';
    const faucetContext = getFaucetBuildContext();
    const yaml = noConsensus
        ? generateStandaloneYaml(image, debug, ledgerIntervalMs, configPath, noRestart, platformLine, faucetContext, bindAddress)
        : generateConsensusYaml(image, debug, ledgerIntervalMs, platformLine, faucetContext, bindAddress);
    node_fs_1.default.writeFileSync(COMPOSE_FILE, yaml, 'utf-8');
    return COMPOSE_FILE;
}
// ── Standalone YAML (default) ────────────────────────────────────────────────
function generateStandaloneYaml(image, debug, ledgerIntervalMs, configPath, noRestart, platformLine, faucetContext, bindAddress) {
    const resolvedConfigPath = configPath ? node_path_1.default.resolve(configPath) : RIPPLED_CFG_FILE;
    if (!configPath)
        writeRippledConfig(debug, true);
    const customValidatorsPath = configPath
        ? node_path_1.default.join(node_path_1.default.dirname(node_path_1.default.resolve(configPath)), 'validators.txt')
        : null;
    const resolvedValidatorsPath = customValidatorsPath && node_fs_1.default.existsSync(customValidatorsPath)
        ? customValidatorsPath
        : VALIDATORS_CFG_FILE;
    const restartLine = noRestart ? '\n    restart: "no"' : '';
    // Two INDEPENDENT properties of an image — do not conflate them:
    //
    // 1. Binary path — images named "xrpld" ship the binary at /usr/bin/xrpld;
    //    the pre-rebrand "rippled" name uses the legacy /opt/ripple/bin/rippled.
    //    Verified true for both xrpllabsofficial/xrpld and rippleci/xrpld.
    //
    // 2. Whether the entrypoint auto-injects --conf — ONLY xrpllabsofficial/xrpld
    //    has a real wrapper script (/entrypoint.sh) that copies the mounted config
    //    into place internally. rippleci/xrpld's entrypoint is the raw binary
    //    (no wrapper) — passing no --conf there means rippled silently falls back
    //    to its own built-in defaults. This must default to "needs an explicit
    //    flag" for anything that isn't the one confirmed wrapper image.
    const imageRepo = image.split(':')[0];
    const usesNewXrpldBinary = imageRepo === 'xrpld' || imageRepo.endsWith('/xrpld');
    const RIPPLED_BIN = usesNewXrpldBinary ? '/usr/bin/xrpld' : '/opt/ripple/bin/rippled';
    const RIPPLED_CFG = '--conf /config/rippled.cfg';
    const hasConfInjectingEntrypoint = imageRepo === 'xrpllabsofficial/xrpld';
    const needsConfFlag = !hasConfInjectingEntrypoint;
    const confArg = needsConfFlag ? `, "--conf", "/config/rippled.cfg"` : '';
    const entrypointLine = noRestart
        ? `\n    entrypoint: ["/bin/sh", "-c", "${RIPPLED_BIN} ${RIPPLED_CFG} -a --start 2>/tmp/rip.err & RPID=$! ; wait $RPID ; EC=$? ; cat /tmp/rip.err >&2 ; grep -qF Logic\\ error: /tmp/rip.err 2>/dev/null && exit 134 ; exit $EC"]`
        : '';
    const commandLine = noRestart ? '' : `\n    command: ["-a", "--start"${confArg}]`;
    return `# Generated by xrpl-up — do not edit manually
# Standalone mode (default): no persistence, instant ledger_accept

name: ${exports.COMPOSE_PROJECT}

services:
  rippled:
    image: ${image}${platformLine}${restartLine}${entrypointLine}${commandLine}
    ports:
      - "${bindAddress}:${exports.LOCAL_WS_PORT}:${exports.LOCAL_WS_PORT}"
    volumes:
      - "${resolvedConfigPath}:/config/rippled.cfg:ro"
      - "${resolvedValidatorsPath}:/config/validators.txt:ro"
    networks:
      - xrpl-net
    healthcheck:
      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/${exports.LOCAL_WS_PORT}"]
      interval: 2s
      timeout: 2s
      retries: 20
      start_period: 5s

  faucet:
    build:
      context: ${faucetContext}
      dockerfile: Dockerfile
    environment:
      - RIPPLED_WS_URL=ws://rippled:${exports.LOCAL_WS_PORT}
      - FAUCET_PORT=${exports.FAUCET_PORT}
      - FUND_AMOUNT_XRP=1000
      - LEDGER_INTERVAL_MS=${ledgerIntervalMs}
    ports:
      - "${bindAddress}:${exports.FAUCET_PORT}:${exports.FAUCET_PORT}"
    networks:
      - xrpl-net
    depends_on:
      rippled:
        condition: service_healthy

networks:
  xrpl-net:
    driver: bridge
`;
}
// ── Consensus YAML (default 2-node network) ──────────────────────────────────
function generateConsensusYaml(image, debug, ledgerIntervalMs, platformLine, faucetContext, bindAddress) {
    writeRippledConfig(debug, false);
    // Same two independent properties as standalone mode (see generateStandaloneYaml
    // above) — binary path and whether the entrypoint auto-injects --conf. Only
    // xrpllabsofficial/xrpld has the /entrypoint.sh wrapper; anything else (e.g.
    // rippleci/xrpld) needs the binary invoked directly with an explicit --conf.
    const imageRepo = image.split(':')[0];
    const usesNewXrpldBinary = imageRepo === 'xrpld' || imageRepo.endsWith('/xrpld');
    const RIPPLED_BIN = usesNewXrpldBinary ? '/usr/bin/xrpld' : '/opt/ripple/bin/rippled';
    const hasConfInjectingEntrypoint = imageRepo === 'xrpllabsofficial/xrpld';
    const confFlag = hasConfInjectingEntrypoint ? '' : ' --conf /config/rippled.cfg';
    const startCmd = hasConfInjectingEntrypoint ? '/entrypoint.sh' : `${RIPPLED_BIN}${confFlag}`;
    // Node1 (primary): creates genesis with --start on first boot, --load on resume.
    // Both nodes build the genesis ledger themselves on first boot (--start), from
    // the same [amendments] config, so they produce the identical ledger 1 and
    // there is nothing to race on; --load on resume.
    //
    // Do NOT use --net on the peer. It fetches the initial ledger from the network,
    // but a lone node1 never closes a ledger until a peer connects, so node2 has
    // nothing to fetch, times out, and builds its own default genesis with none of
    // the forced amendments. The nodes then compete, and when node2's chain wins
    // the network comes up with no amendments (about 1 boot in 10).
    // Do NOT combine --start with --net: xrpld handles --net last and it wins.
    const entrypointPrimary = `["/bin/bash", "-c", "if [ -f /var/lib/xrpld/db/ledger.db ]; then exec ${startCmd} --load; else exec ${startCmd} --start; fi"]`;
    const entrypointPeer = `["/bin/bash", "-c", "if [ -f /var/lib/xrpld/db/ledger.db ]; then exec ${startCmd} --load; else exec ${startCmd} --start; fi"]`;
    return `# Generated by xrpl-up — do not edit manually
# 2-node private consensus network (default mode)
# Ledger state persists across restarts. Snapshots are supported.

name: ${exports.COMPOSE_PROJECT}

services:
  rippled:
    image: ${image}${platformLine}
    entrypoint: ${entrypointPrimary}
    ports:
      - "${bindAddress}:${exports.LOCAL_WS_PORT}:${exports.LOCAL_WS_PORT}"
    volumes:
      - "${RIPPLED_CFG_FILE_NODE1}:/config/rippled.cfg:ro"
      - "${VALIDATORS_CFG_FILE}:/config/validators.txt:ro"
      - rippled-db:/var/lib/xrpld/db
    networks:
      - xrpl-net
    healthcheck:
      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/${exports.LOCAL_WS_PORT}"]
      interval: 2s
      timeout: 2s
      retries: 30
      start_period: 10s

  rippled-peer:
    image: ${image}${platformLine}
    entrypoint: ${entrypointPeer}
    volumes:
      - "${RIPPLED_CFG_FILE_NODE2}:/config/rippled.cfg:ro"
      - "${VALIDATORS_CFG_FILE}:/config/validators.txt:ro"
      - rippled-peer-db:/var/lib/xrpld/db
    networks:
      - xrpl-net
    depends_on:
      rippled:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/${exports.LOCAL_WS_PORT}"]
      interval: 2s
      timeout: 2s
      retries: 30
      start_period: 10s

  faucet:
    build:
      context: ${faucetContext}
      dockerfile: Dockerfile
    environment:
      - RIPPLED_WS_URL=ws://rippled:${exports.LOCAL_WS_PORT}
      - FAUCET_PORT=${exports.FAUCET_PORT}
      - FUND_AMOUNT_XRP=1000
      - LEDGER_INTERVAL_MS=${ledgerIntervalMs}
    ports:
      - "${bindAddress}:${exports.FAUCET_PORT}:${exports.FAUCET_PORT}"
    networks:
      - xrpl-net
    depends_on:
      rippled:
        condition: service_healthy

networks:
  xrpl-net:
    driver: bridge

volumes:
  rippled-db:
    name: ${exports.VOLUME_NAME}
  rippled-peer-db:
    name: ${exports.PEER_VOLUME_NAME}
`;
}
/** Read the rippled image from the current compose file (for use in restore). */
function readComposeImage() {
    try {
        const content = node_fs_1.default.readFileSync(COMPOSE_FILE, 'utf-8');
        const match = content.match(/^\s+image:\s+(.+)$/m);
        return match?.[1]?.trim() ?? xrpld_image_1.DEFAULT_IMAGE;
    }
    catch {
        return xrpld_image_1.DEFAULT_IMAGE;
    }
}
/** Read the faucet ledger interval from the current compose file. */
function readComposeLedgerInterval() {
    try {
        const content = node_fs_1.default.readFileSync(COMPOSE_FILE, 'utf-8');
        const match = content.match(/LEDGER_INTERVAL_MS=(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }
    catch {
        return 0;
    }
}
/** Stop a single service without removing containers or volumes. */
function stopService(service) {
    (0, child_process_1.execSync)(`docker compose -p ${exports.COMPOSE_PROJECT} -f "${COMPOSE_FILE}" stop ${service}`, { stdio: 'ignore' });
}
/** Start a previously stopped service (or create it if the container is missing).
 *
 * --no-deps skips the depends_on health-check gate so the faucet can be
 * started independently after we have already confirmed rippled is ready.
 */
function startService(service) {
    (0, child_process_1.execSync)(`docker compose -p ${exports.COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up -d --no-deps ${service}`, { stdio: 'ignore' });
}
/** Run `docker compose down` (removes containers, keeps volumes). */
function composeDown() {
    try {
        (0, child_process_1.execSync)(`docker compose -p ${exports.COMPOSE_PROJECT} -f "${COMPOSE_FILE}" down`, { stdio: 'ignore' });
    }
    catch {
        // already gone or never started
    }
}
/**
 * Returns true if a Docker volume exists AND contains a ledger.db file.
 * This is the same sentinel the entrypoint checks to decide --load vs --start.
 */
function volumeHasData(volumeName) {
    try {
        (0, child_process_1.execSync)(`docker run --rm -v ${volumeName}:/data alpine test -f /data/ledger.db`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Guard against silently booting a --local-network image against a
 * persistent volume laid out by a different image. Different rippled
 * images can lay out their data directory differently, so an old volume
 * booted under a new image can fail unpredictably instead of cleanly.
 *
 * Only blocks when there's actually data at risk (a fresh volume has
 * nothing to be incompatible with) and only compares against a recorded
 * image (older xrpl-up versions never wrote this file, so upgrading
 * xrpl-up itself doesn't spuriously trigger this).
 */
function checkLocalNetworkImageCompatibility(image) {
    if (!node_fs_1.default.existsSync(LOCAL_NETWORK_IMAGE_FILE))
        return;
    const previousImage = node_fs_1.default.readFileSync(LOCAL_NETWORK_IMAGE_FILE, 'utf-8').trim();
    if (!previousImage || previousImage === image)
        return;
    if (!volumeHasData(exports.VOLUME_NAME))
        return;
    throw new Error(`This --local-network sandbox was last started with ${previousImage}, ` +
        `but you're starting it with ${image}. Different rippled images can lay ` +
        `out their data directory differently, so booting the new image against ` +
        `the old volume can fail unpredictably instead of cleanly.\n\n` +
        `Run "xrpl-up reset" first, then start again with the new image.`);
}
function recordLocalNetworkImage(image) {
    node_fs_1.default.writeFileSync(LOCAL_NETWORK_IMAGE_FILE, image);
}
/** Called by `xrpl-up reset` — the volumes are gone, so the recorded image is stale. */
/**
 * Current --local-network lineage, or null if no sandbox has been created yet.
 * `base` is a genesis built from the default amendment list alone; anything
 * else is a fingerprint of the extra amendments it was built with (see
 * GENESIS_LINEAGE_FILE).
 */
function readGenesisLineage() {
    try {
        return node_fs_1.default.readFileSync(GENESIS_LINEAGE_FILE, 'utf-8').trim() || null;
    }
    catch {
        return null;
    }
}
function writeGenesisLineage(lineage) {
    node_fs_1.default.mkdirSync(XRPL_UP_DIR, { recursive: true });
    node_fs_1.default.writeFileSync(GENESIS_LINEAGE_FILE, lineage);
}
/**
 * Make this machine's config match a restored snapshot's genesis.
 *
 * `snapshot restore` replaces the ledger wholesale, so the amendment set is
 * whatever that ledger was built with. Writing those amendments back (and
 * regenerating the config) keeps config and ledger in agreement, so restoring
 * across an `amendment enable` just works instead of leaving a mismatch.
 */
function adoptGenesisLineage(lineage, amendments) {
    node_fs_1.default.mkdirSync(XRPL_UP_DIR, { recursive: true });
    if (amendments.trim()) {
        node_fs_1.default.writeFileSync(exports.EXTRA_AMENDMENTS_FILE, amendments.endsWith('\n') ? amendments : amendments + '\n');
    }
    else {
        try {
            node_fs_1.default.unlinkSync(exports.EXTRA_AMENDMENTS_FILE);
        }
        catch { /* already absent */ }
    }
    writeRippledConfig(false, !isConsensusMode());
    writeGenesisLineage(lineage);
}
/** Called by `xrpl-up reset` — the volumes are gone, so the lineage is stale. */
function clearGenesisLineage() {
    try {
        node_fs_1.default.unlinkSync(GENESIS_LINEAGE_FILE);
    }
    catch { /* not present — ok */ }
}
/**
 * Lineage a genesis built from the current config would have: a short digest of
 * the extra (manually enabled) amendments, since those are what make a locally
 * built genesis differ from the shipped seed.
 */
function pendingGenesisLineage() {
    const extra = node_fs_1.default.existsSync(exports.EXTRA_AMENDMENTS_FILE)
        ? node_fs_1.default.readFileSync(exports.EXTRA_AMENDMENTS_FILE, 'utf-8').trim()
        : '';
    if (!extra)
        return BASE_LINEAGE;
    const hashes = extra.split('\n')
        .map((l) => l.trim().split(/\s+/)[0])
        .filter(Boolean)
        .sort()
        .join(',');
    return 'amd-' + node_crypto_1.default.createHash('sha256').update(hashes).digest('hex').slice(0, 12);
}
function clearLocalNetworkImageRecord() {
    try {
        node_fs_1.default.unlinkSync(LOCAL_NETWORK_IMAGE_FILE);
    }
    catch { /* not present — ok */ }
}
/**
 * Seed consensus volumes with pre-built genesis DB if they are empty.
 *
 * Uses pre-built tarballs containing a ledger at ~seq 782 with all mainnet
 * amendments already activated through voting. This avoids the ~38-minute
 * amendment voting delay on first boot.
 *
 * The entrypoint checks for /var/lib/xrpld/db/ledger.db and uses
 * --load (instead of --start) when it exists, so pre-seeded volumes
 * boot immediately into a functioning consensus network.
 */
/**
 * Returns the "uid:gid" the given image's container runs as, so extracted
 * genesis DB files can be chowned to match. Falls back to root (0:0 — a
 * no-op chown) if the image can't be queried, which matches older rippled
 * images that ran as root anyway.
 */
function getImageUidGid(image) {
    // Pin the platform on ARM hosts, matching the compose file — the official
    // xrpld image is amd64-only, and omitting it makes Docker print a noisy
    // "requested image's platform does not match" warning on every call.
    const platformArg = (0, xrpld_image_1.dockerPlatformArg)();
    try {
        // One container, both values — halves the (emulated, slow) container starts.
        const out = (0, child_process_1.execSync)(`docker run --rm ${platformArg}--entrypoint sh "${image}" -c "id -u; id -g"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const [uid, gid] = out.split('\n').map((s) => s.trim());
        if (uid && gid)
            return `${uid}:${gid}`;
    }
    catch { /* fall through to root */ }
    return '0:0';
}
/**
 * Create the consensus volumes (if missing) and make them writable by the
 * image's runtime user. Docker creates named volumes as root:root; 3.3.0+
 * images run as a non-root user and fail with a permission error otherwise.
 * Empty volumes make rippled build a real genesis from [amendments] on first
 * start, so a fresh --local-network genesis always matches this build's
 * amendment list.
 */
function prepareConsensusVolumes(image) {
    const lineage = pendingGenesisLineage();
    const empty = [exports.VOLUME_NAME, exports.PEER_VOLUME_NAME].filter((vol) => !volumeHasData(vol));
    if (empty.length === 0)
        return false;
    const uidGid = getImageUidGid(image);
    for (const vol of empty) {
        (0, child_process_1.execSync)(`docker volume create ${vol}`, { stdio: 'ignore' });
        (0, child_process_1.execSync)(`docker run --rm -v ${vol}:/data alpine chown -R ${uidGid} /data`, { stdio: 'ignore' });
    }
    writeGenesisLineage(lineage);
    return true;
}
/**
 * Names of the default amendments that are not enabled on the running node.
 * Empty means the genesis took the full list.
 */
async function missingDefaultAmendments() {
    const { Client } = await Promise.resolve().then(() => __importStar(require('xrpl')));
    const client = new Client(exports.LOCAL_WS_URL, { timeout: 15_000 });
    try {
        await client.connect();
        const res = await client.request({ command: 'feature' });
        const features = res.result.features;
        const enabled = new Set(Object.entries(features).filter(([, f]) => f.enabled).map(([hash]) => hash.toUpperCase()));
        return genesis_amendments_1.DEFAULT_AMENDMENTS.filter((a) => !enabled.has(a.hash.toUpperCase())).map((a) => a.name);
    }
    finally {
        try {
            await client.disconnect();
        }
        catch { /* ignore */ }
    }
}
/**
 * Start the compose stack (`docker compose up --build -d`),
 * wait for ports and (in consensus mode) for the first validated ledger.
 *
 * Default (noConsensus=true): standalone rippled, torn down clean each start.
 * With --local-network (noConsensus=false): 2-node consensus network. Volumes preserved.
 */
async function composeUp(image = xrpld_image_1.DEFAULT_IMAGE, noConsensus = false, debug = false, ledgerIntervalMs = 0, configPath, noRestart = false, bindAddress = '127.0.0.1') {
    if (!noConsensus)
        checkLocalNetworkImageCompatibility(image);
    writeComposeFile(image, noConsensus, debug, ledgerIntervalMs, configPath, noRestart, bindAddress);
    if (noConsensus)
        composeDown(); // clean slate only in standalone mode
    // Make sure the consensus volumes exist and are writable. `fresh` means rippled
    // is about to build a new genesis (as opposed to resuming existing ledger data).
    const fresh = !noConsensus && prepareConsensusVolumes(image);
    // Build (deb pin) or pull (registry image) xrpld if it isn't cached yet —
    // gives clear feedback on first run instead of hanging inside compose up.
    (0, xrpld_image_1.ensureImage)(image);
    const bringUp = async () => {
        // This runs on every start, not just a fresh genesis build — surface the
        // real Docker error on failure (e.g. a bad --config path outside Docker
        // Desktop's shared folders, a port conflict, a faucet build failure)
        // instead of a bare "Command failed" with no detail regardless of --debug.
        try {
            (0, child_process_1.execSync)(`docker compose -p ${exports.COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up --build -d`, { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (err) {
            const stderr = err.stderr?.toString().trim();
            throw new Error(`Failed to start the Docker Compose stack.\n` +
                (stderr ? `Docker error: ${stderr}\n` : '') +
                `Check: docker compose -p ${exports.COMPOSE_PROJECT} -f "${COMPOSE_FILE}" logs`);
        }
        // Wait for rippled WebSocket port
        await waitForPort(exports.LOCAL_WS_PORT, 30_000, 'rippled WebSocket');
        // In consensus mode, wait for the network to reach validated state.
        // First boot: ~30-70s (real 2-node peer discovery + consensus).
        if (!noConsensus)
            await waitForConsensus(120_000);
    };
    await bringUp();
    // A fresh --local-network genesis intermittently comes up with none of its
    // [amendments] active (nodes healthy, config correct, cause not isolated —
    // see SPEC.md 5.6.1); a second genesis is fine. Only ever redo a genesis we
    // just created: a resumed network holds the user's ledger and accounts.
    if (!noConsensus && fresh) {
        let missing = await missingDefaultAmendments();
        if (missing.length > 0) {
            console.log(`  Genesis came up without ${missing.length} default amendment(s); rebuilding it once…`);
            composeDown();
            for (const vol of [exports.VOLUME_NAME, exports.PEER_VOLUME_NAME]) {
                try {
                    (0, child_process_1.execSync)(`docker volume rm -f ${vol}`, { stdio: 'ignore' });
                }
                catch { /* absent */ }
            }
            prepareConsensusVolumes(image);
            await bringUp();
            missing = await missingDefaultAmendments();
            if (missing.length > 0) {
                console.log(`  ⚠ ${missing.length} default amendment(s) are still not enabled: ${missing.slice(0, 5).join(', ')}` +
                    `${missing.length > 5 ? ', …' : ''}. Run "xrpl-up reset" and start again.`);
            }
        }
    }
    // Check ledger clock drift and warn if significant
    if (!noConsensus)
        await warnIfDrifted();
    await waitForPort(exports.FAUCET_PORT, 30_000, 'faucet HTTP');
    if (!noConsensus)
        recordLocalNetworkImage(image);
    return exports.LOCAL_WS_URL;
}
/**
 * Returns true if the current compose file describes a 2-node consensus
 * network (has a rippled-peer service). False for standalone mode.
 */
function isConsensusMode() {
    try {
        const content = node_fs_1.default.readFileSync(COMPOSE_FILE, 'utf-8');
        return content.includes('rippled-peer:');
    }
    catch {
        return false;
    }
}
/**
 * The `start` invocation that resumes whichever mode the sandbox is
 * currently configured for — `--local-network` if the existing compose file
 * describes a consensus network, otherwise bare `start` (standalone).
 * No compose file yet (fresh install) falls through to standalone, the
 * right default for a first-time user. Use this instead of hardcoding
 * `xrpl-up start` in restart hints — suggesting standalone to a
 * --local-network user silently discards their wallet records (see
 * nodeCommand's pre-standalone-start warning).
 */
function startCommandHint() {
    return isConsensusMode() ? 'xrpl-up start --local-network' : 'xrpl-up start';
}
/**
 * Wait for the 2-node consensus network to produce validated ledgers.
 *
 * In consensus mode, amendments listed in [amendments] are configured for
 * voting but activate through the normal flag-ledger process (~256 ledgers
 * × ~4s = ~17 min). We don't wait for amendment activation here — only
 * for the network to reach "proposing" state with validated ledgers.
 *
 * The [amendments] config controls which amendments are voted on, not
 * which are force-enabled at genesis (that only works in standalone mode).
 */
/**
 * Measure ledger clock drift and warn if > 3 seconds.
 * Uses the `ledger` RPC (server_info does not include close_time).
 */
async function warnIfDrifted() {
    const RIPPLE_EPOCH = 946684800;
    try {
        const { Client } = await Promise.resolve().then(() => __importStar(require('xrpl')));
        const client = new Client(exports.LOCAL_WS_URL, { timeout: 5_000 });
        await client.connect();
        const res = await client.request({ command: 'ledger', ledger_index: 'validated' });
        const closeTime = res.result?.ledger?.close_time;
        await client.disconnect();
        if (typeof closeTime === 'number') {
            const wallRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
            const drift = closeTime - wallRipple;
            if (Math.abs(drift) > 3) {
                console.log(`  ⚠ Ledger clock drift: ${drift > 0 ? '+' : ''}${drift}s from wall clock. ` +
                    `Time-sensitive transactions (escrow, checks) should use timestamps ≥30s in the future.`);
            }
        }
    }
    catch {
        // best effort — don't block startup
    }
}
async function waitForConsensus(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const { Client } = await Promise.resolve().then(() => __importStar(require('xrpl')));
    let lastLogTime = 0;
    const LOG_INTERVAL_MS = 15_000;
    let firstSeq = 0; // track initial seq to detect advancement
    while (Date.now() < deadline) {
        let client = null;
        try {
            client = new Client(exports.LOCAL_WS_URL, { timeout: 60_000 });
            await client.connect();
            const res = await client.request({ command: 'server_info' });
            const info = res.result?.info;
            const seq = info?.validated_ledger?.seq ?? 0;
            const state = info?.server_state ?? '';
            // Record the first seq we see — on a pre-seeded DB this will be
            // the loaded value (e.g. 911). We need to see seq advance beyond
            // this to confirm the network is actually producing new ledgers.
            if (seq > 0 && firstSeq === 0)
                firstSeq = seq;
            if (seq > firstSeq && (state === 'proposing' || state === 'full')) {
                await client.disconnect();
                return;
            }
            // Progress log so CI doesn't look stuck
            const now = Date.now();
            if (now - lastLogTime > LOG_INTERVAL_MS) {
                lastLogTime = now;
                const elapsed = Math.round((now - (deadline - timeoutMs)) / 1000);
                console.log(`  [waitForConsensus] ${elapsed}s: seq=${seq} state=${state || '(connecting)'} — waiting for validated ledger…`);
            }
        }
        catch {
            // not ready yet
        }
        finally {
            try {
                await client?.disconnect();
            }
            catch { /* ignore */ }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Consensus network did not reach proposing state within ${timeoutMs / 1000}s.\n` +
        `  Check: docker compose -p ${exports.COMPOSE_PROJECT} logs rippled`);
}
/**
 * Spawn `docker compose logs --follow [service]` and stream to the caller's
 * stdout/stderr. Returns the child process so the caller can handle termination.
 */
function composeLogs(service) {
    const args = [
        'compose',
        '-p', exports.COMPOSE_PROJECT,
        '-f', COMPOSE_FILE,
        'logs',
        '--follow',
        '--no-log-prefix',
    ];
    if (service)
        args.push(service);
    return (0, child_process_1.spawn)('docker', args, { stdio: 'inherit' });
}
function waitForPort(port, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        function attempt() {
            const socket = new node_net_1.default.Socket();
            socket.setTimeout(1000);
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            const onFail = () => {
                socket.destroy();
                if (Date.now() > deadline) {
                    reject(new Error(`${label} did not become reachable on port ${port} within ${timeoutMs / 1000}s`));
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
