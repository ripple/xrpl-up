"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotSave = snapshotSave;
exports.snapshotRestore = snapshotRestore;
exports.snapshotList = snapshotList;
const child_process_1 = require("child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const xrpl_1 = require("xrpl");
const compose_1 = require("../core/compose");
const logger_1 = require("../utils/logger");
const SNAPSHOTS_DIR = node_path_1.default.join(node_os_1.default.homedir(), '.xrpl-up', 'snapshots');
const WALLET_STORE_PATH = node_path_1.default.join(node_os_1.default.homedir(), '.xrpl-up', 'local-accounts.json');
const SNAPSHOT_RESTORE_START_TIMEOUT_MS = 90_000;
// The rippled/faucet ports opening (waited on above) doesn't mean the restored
// ledger is queryable yet — consensus needs a moment to catch up and produce a
// validated ledger after resume. 30s was observed to be too tight after heavy
// back-to-back Docker churn (e.g. an amendment-enable genesis rebuild
// immediately followed by a restore): the account existed and was queryable
// only a few seconds after this window closed, so the failure was a false
// negative, not an actual restore problem.
const SNAPSHOT_RESTORE_VERIFY_TIMEOUT_MS = 60_000;
/** Returns true if the named Docker volume exists. */
function volumeExists(name = compose_1.VOLUME_NAME) {
    try {
        (0, child_process_1.execSync)(`docker volume inspect ${name}`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/** Absolute path to a snapshot tarball by name. */
function snapshotPath(name) {
    return node_path_1.default.join(SNAPSHOTS_DIR, `${name}.tar.gz`);
}
/** Absolute path to the WalletStore sidecar for a snapshot. */
function walletSidecarPath(name) {
    return node_path_1.default.join(SNAPSHOTS_DIR, `${name}-accounts.json`);
}
/** Absolute path to metadata sidecar for a snapshot. */
function metaSidecarPath(name) {
    return node_path_1.default.join(SNAPSHOTS_DIR, `${name}-meta.json`);
}
/**
 * Genesis lineage + amendment set recorded in a snapshot's meta sidecar.
 * Both are absent for snapshots saved before this was recorded, in which case
 * the restore proceeds unchanged (nothing to reconcile).
 */
function readSnapshotMeta(name) {
    try {
        const meta = JSON.parse(node_fs_1.default.readFileSync(metaSidecarPath(name), 'utf-8'));
        return {
            lineage: meta.lineage && meta.lineage !== 'unknown' ? meta.lineage : null,
            amendments: meta.amendments ?? '',
        };
    }
    catch {
        return { lineage: null, amendments: '' };
    }
}
function backupPath(filePath) {
    return `${filePath}.bak`;
}
function safeCommandOutput(command) {
    try {
        return (0, child_process_1.execSync)(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    }
    catch (err) {
        const stdout = err.stdout?.toString() ?? '';
        const stderr = err.stderr?.toString() ?? '';
        return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
    }
}
/**
 * Wait until every account in the wallet store exists on the validated ledger.
 *
 * Keeps `snapshot save` from capturing a ledger that predates its own accounts
 * sidecar (see call site). Best-effort: on timeout it warns rather than failing,
 * so a snapshot is still produced.
 */
async function waitForWalletStoreValidated(timeoutMs = 30_000) {
    let addresses = [];
    try {
        const store = JSON.parse(node_fs_1.default.readFileSync(WALLET_STORE_PATH, 'utf-8'));
        addresses = store.map((a) => a.address).filter((a) => Boolean(a));
    }
    catch {
        return; // no wallet store — nothing to wait for
    }
    if (addresses.length === 0)
        return;
    const spinner = (0, ora_1.default)({ text: chalk_1.default.dim('Waiting for accounts to be validated…'), prefixText: ' ' }).start();
    const deadline = Date.now() + timeoutMs;
    const client = new xrpl_1.Client(compose_1.LOCAL_WS_URL, { timeout: 10_000 });
    try {
        await client.connect();
        while (Date.now() < deadline) {
            const results = await Promise.all(addresses.map(async (address) => {
                try {
                    await client.request({ command: 'account_info', account: address, ledger_index: 'validated' });
                    return null;
                }
                catch {
                    return address;
                }
            }));
            const missing = results.filter((a) => a !== null);
            if (missing.length === 0) {
                spinner.succeed(chalk_1.default.dim(`All ${addresses.length} accounts validated`));
                return;
            }
            await new Promise((r) => setTimeout(r, 2_000));
        }
        spinner.warn(chalk_1.default.yellow('Some accounts are not yet validated — snapshot may not include them'));
    }
    catch {
        spinner.stop(); // node unreachable; the save itself will surface the problem
    }
    finally {
        await client.disconnect().catch(() => { });
    }
}
/** Ensure the snapshots directory exists. */
function ensureSnapshotsDir() {
    if (!node_fs_1.default.existsSync(SNAPSHOTS_DIR)) {
        node_fs_1.default.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
}
/**
 * Guard: snapshots require the 2-node consensus network (--local-network).
 * In standalone mode (the default), rippled doesn't create SQLite and can't resume state.
 */
function assertConsensusMode(action) {
    if (!(0, compose_1.isConsensusMode)()) {
        throw new Error(`Cannot ${action} snapshots in standalone mode.\n` +
            `  Standalone mode does not persist ledger state across restarts.\n` +
            `  Snapshots require the --local-network flag. Restart with:\n` +
            `\n` +
            `    xrpl-up start --local --local-network\n`);
    }
}
/**
 * Save the current ledger state as a named snapshot.
 *
 * Strategy: stop → tar → restart.
 *
 * Stopping all services first ensures rippled flushes buffers, checkpoints
 * the SQLite WAL, and closes NuDB cleanly. Tarring a stopped volume gives a
 * guaranteed-consistent snapshot with no risk of torn pages from concurrent
 * writes. The ~10-15s downtime is an acceptable trade-off for reliability.
 *
 * Only the primary node's volume is captured. On restore, the same tarball is
 * extracted into both the primary and peer volumes. This works because both
 * nodes in the private 2-node network validate the same transactions and
 * produce identical ledger state (same NuDB entries and SQLite rows). The
 * peer node starts with --load from the restored data and re-syncs from the
 * primary. If nodes could diverge (e.g., different NuDB compaction), the
 * post-restore verification step would catch it.
 */
async function snapshotSave(name) {
    assertConsensusMode('save');
    if (!volumeExists()) {
        throw new Error(`No ledger volume found (${compose_1.VOLUME_NAME}).\n` +
            `  Start the sandbox first: xrpl-up start --local --local-network`);
    }
    ensureSnapshotsDir();
    const dest = snapshotPath(name);
    if (node_fs_1.default.existsSync(dest)) {
        logger_1.logger.warning(`Snapshot "${name}" already exists — overwriting.`);
    }
    logger_1.logger.blank();
    // ── Wait for the accounts we're about to record to be on a validated ledger ─
    // The accounts sidecar comes from the wallet store, which is written as soon
    // as a funding transaction is submitted. In consensus mode validation takes
    // ~4s, so saving immediately after `start`/`faucet` can capture a ledger that
    // predates those accounts — the snapshot then restores a ledger the sidecar
    // does not match, and post-restore verification fails with "account ... not
    // found". Block until they are actually validated so the tarball and the
    // sidecar always agree.
    await waitForWalletStoreValidated();
    // ── Stop services first ────────────────────────────────────────────────────
    // Graceful shutdown ensures rippled flushes all buffers, checkpoints SQLite
    // WAL, and closes NuDB cleanly. Tarring a stopped volume gives a guaranteed-
    // consistent snapshot — no risk of torn pages from concurrent writes.
    const stopStartMs = Date.now();
    const stopSpinner = (0, ora_1.default)({ text: chalk_1.default.dim('Stopping sandbox for snapshot…'), prefixText: ' ' }).start();
    try {
        (0, child_process_1.execSync)(`docker compose -p ${compose_1.COMPOSE_PROJECT} -f "${compose_1.COMPOSE_FILE}" stop`, { stdio: ['ignore', 'pipe', 'pipe'] });
        const stopElapsed = ((Date.now() - stopStartMs) / 1000).toFixed(1);
        stopSpinner.succeed(chalk_1.default.dim(`Sandbox stopped (${stopElapsed}s)`));
    }
    catch (err) {
        stopSpinner.fail('Failed to stop sandbox');
        const stderr = err.stderr?.toString().trim();
        throw new Error('Could not stop sandbox for snapshot.\n' +
            (stderr ? `Docker error: ${stderr}\n` : '') +
            '  Check:  docker ps | grep xrpl-up\n' +
            '  Logs:   docker compose -p xrpl-up-local logs --tail 20');
    }
    // ── Tar the volume ─────────────────────────────────────────────────────────
    const tmpDest = dest + '.tmp';
    const saveStartMs = Date.now();
    const saveSpinner = (0, ora_1.default)({ text: chalk_1.default.dim(`Saving snapshot "${name}"…`), prefixText: ' ' }).start();
    try {
        (0, child_process_1.execSync)(`docker run --rm ` +
            `-v ${compose_1.VOLUME_NAME}:/data ` +
            `-v "${SNAPSHOTS_DIR}":/snapshots ` +
            `alpine tar czf /snapshots/${node_path_1.default.basename(tmpDest)} -C /data .`, { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch (err) {
        const stderr = err.stderr?.toString().trim();
        saveSpinner.fail(`Failed to save snapshot "${name}"${stderr ? `: ${stderr}` : ''}`);
        if (node_fs_1.default.existsSync(tmpDest))
            node_fs_1.default.unlinkSync(tmpDest);
        // Restart services even on failure
        (0, child_process_1.execSync)(`docker compose -p ${compose_1.COMPOSE_PROJECT} -f "${compose_1.COMPOSE_FILE}" start`, { stdio: 'ignore' });
        throw err;
    }
    // ── Write sidecar files and atomically swap ────────────────────────────────
    const tmpSidecar = walletSidecarPath(name) + '.tmp';
    const tmpMeta = metaSidecarPath(name) + '.tmp';
    if (node_fs_1.default.existsSync(WALLET_STORE_PATH)) {
        node_fs_1.default.copyFileSync(WALLET_STORE_PATH, tmpSidecar);
    }
    else {
        node_fs_1.default.writeFileSync(tmpSidecar, '[]');
    }
    // Record which genesis lineage this ledger descends from. A snapshot only
    // restores correctly onto the same lineage — see readGenesisLineage().
    node_fs_1.default.writeFileSync(tmpMeta, JSON.stringify({
        format: 'consensus-v1',
        lineage: (0, compose_1.readGenesisLineage)() ?? 'unknown',
        // The manually enabled amendments this genesis was built with, so restore
        // can rebuild a matching config instead of asking the user to remember.
        amendments: node_fs_1.default.existsSync(compose_1.EXTRA_AMENDMENTS_FILE)
            ? node_fs_1.default.readFileSync(compose_1.EXTRA_AMENDMENTS_FILE, 'utf-8')
            : '',
    }));
    const finalSidecar = walletSidecarPath(name);
    const finalMeta = metaSidecarPath(name);
    const backups = [
        { file: finalSidecar, backup: backupPath(finalSidecar) },
        { file: finalMeta, backup: backupPath(finalMeta) },
        { file: dest, backup: backupPath(dest) },
    ];
    try {
        for (const { file, backup } of backups) {
            if (node_fs_1.default.existsSync(backup))
                node_fs_1.default.unlinkSync(backup);
            if (node_fs_1.default.existsSync(file))
                node_fs_1.default.renameSync(file, backup);
        }
        node_fs_1.default.renameSync(tmpSidecar, finalSidecar);
        node_fs_1.default.renameSync(tmpMeta, finalMeta);
        node_fs_1.default.renameSync(tmpDest, dest);
        for (const { backup } of backups) {
            if (node_fs_1.default.existsSync(backup))
                node_fs_1.default.unlinkSync(backup);
        }
        const saveElapsed = ((Date.now() - saveStartMs) / 1000).toFixed(1);
        saveSpinner.succeed(chalk_1.default.green(`Snapshot "${name}" saved`) + chalk_1.default.dim(` (${saveElapsed}s)`));
    }
    catch (err) {
        for (const file of [finalSidecar, finalMeta, dest]) {
            if (node_fs_1.default.existsSync(file))
                node_fs_1.default.unlinkSync(file);
        }
        for (const { file, backup } of backups) {
            if (node_fs_1.default.existsSync(backup))
                node_fs_1.default.renameSync(backup, file);
        }
        for (const tmp of [tmpSidecar, tmpMeta, tmpDest]) {
            if (node_fs_1.default.existsSync(tmp))
                node_fs_1.default.unlinkSync(tmp);
        }
        saveSpinner.fail(`Failed to finalize snapshot "${name}"`);
        throw err;
    }
    // ── Restart all services ───────────────────────────────────────────────────
    // Use `up -d` instead of `start` — containers may have been removed by
    // `xrpl-up stop` (which runs compose down). `up -d` recreates them.
    const resumeStartMs = Date.now();
    const startSpinner = (0, ora_1.default)({ text: chalk_1.default.dim('Resuming sandbox…'), prefixText: ' ' }).start();
    try {
        (0, child_process_1.execSync)(`docker compose -p ${compose_1.COMPOSE_PROJECT} -f "${compose_1.COMPOSE_FILE}" up -d`, { stdio: ['ignore', 'pipe', 'pipe'] });
        await (0, compose_1.waitForPort)(compose_1.LOCAL_WS_PORT, 60_000, 'rippled WebSocket');
        await (0, compose_1.waitForPort)(compose_1.FAUCET_PORT, 30_000, 'faucet HTTP');
        const resumeElapsed = ((Date.now() - resumeStartMs) / 1000).toFixed(1);
        startSpinner.succeed(chalk_1.default.dim(`Sandbox resumed (${resumeElapsed}s)`));
    }
    catch (err) {
        const stderr = err.stderr?.toString().trim();
        startSpinner.fail(chalk_1.default.red('Sandbox failed to resume') + (stderr ? `: ${stderr}` : ''));
        throw err;
    }
    const stats = node_fs_1.default.statSync(dest);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
    logger_1.logger.dim(`  Saved to ${dest} (${sizeMb} MB)`);
    logger_1.logger.blank();
}
/**
 * Restore ledger state from a named snapshot.
 *
 * Extracts the tarball to BOTH node volumes (primary + peer), then restarts
 * the stack. The entrypoint detects ledger.db and uses --load to resume.
 */
async function snapshotRestore(name) {
    assertConsensusMode('restore');
    const src = snapshotPath(name);
    if (!node_fs_1.default.existsSync(src)) {
        const available = listSnapshotNames();
        const hint = available.length > 0
            ? `\n  Available snapshots: ${available.join(', ')}`
            : '\n  No snapshots found. Save one with: xrpl-up snapshot save <name>';
        throw new Error(`Snapshot "${name}" not found.${hint}`);
    }
    if (!volumeExists()) {
        throw new Error(`No ledger volume found (${compose_1.VOLUME_NAME}).\n` +
            `  Start the sandbox first: xrpl-up start --local --local-network`);
    }
    // A snapshot is a copy of one ledger chain's database, so it only restores
    // onto a sandbox descending from the same genesis. Enabling or clearing
    // amendments rebuilds genesis (that is how the stanza takes effect) and so
    // starts a new lineage. Rather than refusing, adopt the snapshot's amendment
    // set below so the regenerated config matches the ledger being restored.
    const snapshotMeta = readSnapshotMeta(name);
    const currentLineage = (0, compose_1.readGenesisLineage)();
    const adopting = Boolean(snapshotMeta.lineage && currentLineage && snapshotMeta.lineage !== currentLineage);
    logger_1.logger.blank();
    // ── Stop all services ──────────────────────────────────────────────────────
    // Use `down` instead of `stop` — works whether containers are running,
    // stopped, or already removed (e.g. after `xrpl-up stop`). We use `up -d`
    // to recreate them after restoring the volume data.
    const restoreStopMs = Date.now();
    const stopSpinner = (0, ora_1.default)({ text: chalk_1.default.dim('Stopping sandbox…'), prefixText: ' ' }).start();
    try {
        (0, child_process_1.execSync)(`docker compose -p ${compose_1.COMPOSE_PROJECT} -f "${compose_1.COMPOSE_FILE}" down`, { stdio: ['ignore', 'pipe', 'pipe'] });
        const restoreStopElapsed = ((Date.now() - restoreStopMs) / 1000).toFixed(1);
        stopSpinner.succeed(chalk_1.default.dim(`Sandbox stopped (${restoreStopElapsed}s)`));
    }
    catch (err) {
        stopSpinner.fail('Failed to stop sandbox');
        const stderr = err.stderr?.toString().trim();
        throw new Error('Could not stop sandbox.\n' +
            (stderr ? `Docker error: ${stderr}\n` : '') +
            '  Check:  docker ps | grep xrpl-up\n' +
            '  Logs:   docker compose -p xrpl-up-local logs --tail 20');
    }
    // ── Wipe and extract to BOTH volumes ───────────────────────────────────────
    const restoreExtractMs = Date.now();
    const restoreSpinner = (0, ora_1.default)({ text: chalk_1.default.dim(`Restoring snapshot "${name}"…`), prefixText: ' ' }).start();
    try {
        for (const vol of [compose_1.VOLUME_NAME, compose_1.PEER_VOLUME_NAME]) {
            // Extract the primary node's snapshot into both volumes. For the peer
            // volume, delete wallet.db afterwards so rippled regenerates a fresh
            // node identity key on startup. Without this, both nodes share the
            // same peer-to-peer identity (cloned from the primary's wallet.db)
            // and reject each other's connections — causing 0 peers / no consensus.
            // Validator identity is unaffected — it comes from rippled.cfg.
            const rmWalletDb = vol === compose_1.PEER_VOLUME_NAME ? ' && rm -f /data/wallet.db' : '';
            (0, child_process_1.execSync)(`docker run --rm ` +
                `-v ${vol}:/data ` +
                `-v "${SNAPSHOTS_DIR}":/snapshots ` +
                `alpine sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /snapshots/${name}.tar.gz -C /data${rmWalletDb}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        const restoreExtractElapsed = ((Date.now() - restoreExtractMs) / 1000).toFixed(1);
        restoreSpinner.succeed(chalk_1.default.green(`Snapshot "${name}" restored to both nodes`) + chalk_1.default.dim(` (${restoreExtractElapsed}s)`));
    }
    catch (err) {
        const stderr = err.stderr?.toString().trim();
        restoreSpinner.fail(`Failed to restore snapshot "${name}"${stderr ? `: ${stderr}` : ''}`);
        throw err;
    }
    // ── Restore WalletStore sidecar ────────────────────────────────────────────
    const sidecar = walletSidecarPath(name);
    if (node_fs_1.default.existsSync(sidecar)) {
        node_fs_1.default.copyFileSync(sidecar, WALLET_STORE_PATH);
    }
    else if (node_fs_1.default.existsSync(WALLET_STORE_PATH)) {
        node_fs_1.default.unlinkSync(WALLET_STORE_PATH);
    }
    // ── Align the amendment config with the restored ledger ────────────────────
    // Must happen before the containers come back up so rippled reads a config
    // that matches the ledger it is about to load.
    if (adopting && snapshotMeta.lineage) {
        (0, compose_1.adoptGenesisLineage)(snapshotMeta.lineage, snapshotMeta.amendments);
        const count = snapshotMeta.amendments.split('\n').filter((l) => l.trim()).length;
        logger_1.logger.dim(count > 0
            ? `  Restored the ${count} manually enabled amendment${count === 1 ? '' : 's'} this snapshot was saved with`
            : '  Cleared manually enabled amendments to match this snapshot');
    }
    // ── Restart all services ───────────────────────────────────────────────────
    // The entrypoint detects ledger.db → uses --load to resume from SQLite.
    // Use `up -d` instead of `start` — containers may have been removed by
    // `xrpl-up stop` (which runs compose down). `up -d` recreates them.
    const restoreResumeMs = Date.now();
    const startSpinner = (0, ora_1.default)({ text: chalk_1.default.dim('Resuming sandbox…'), prefixText: ' ' }).start();
    try {
        (0, child_process_1.execSync)(`docker compose -p ${compose_1.COMPOSE_PROJECT} -f "${compose_1.COMPOSE_FILE}" up -d`, { stdio: ['ignore', 'pipe', 'pipe'] });
        await (0, compose_1.waitForPort)(compose_1.LOCAL_WS_PORT, SNAPSHOT_RESTORE_START_TIMEOUT_MS, 'rippled WebSocket');
        await (0, compose_1.waitForPort)(compose_1.FAUCET_PORT, SNAPSHOT_RESTORE_START_TIMEOUT_MS, 'faucet HTTP');
        const restoreResumeElapsed = ((Date.now() - restoreResumeMs) / 1000).toFixed(1);
        startSpinner.succeed(chalk_1.default.dim(`Sandbox resumed (${restoreResumeElapsed}s)`));
    }
    catch (err) {
        startSpinner.fail(chalk_1.default.red('Sandbox failed to resume'));
        const stderr = err.stderr?.toString().trim();
        const rippledLogs = safeCommandOutput(`docker compose -p ${compose_1.COMPOSE_PROJECT} -f "${compose_1.COMPOSE_FILE}" logs --no-color --tail 30 rippled`);
        throw new Error(`${err.message}\n\n` +
            (stderr ? `Docker error: ${stderr}\n\n` : '') +
            `rippled logs (last 30 lines):\n${rippledLogs}`);
    }
    // ── Post-restore verification ──────────────────────────────────────────────
    const restoredAccounts = (() => {
        try {
            const raw = node_fs_1.default.readFileSync(walletSidecarPath(name), 'utf-8');
            return JSON.parse(raw);
        }
        catch {
            return [];
        }
    })();
    if (restoredAccounts.length > 0) {
        const verifyStartMs = Date.now();
        const verifySpinner = (0, ora_1.default)({ text: chalk_1.default.dim('Verifying restored ledger state…'), prefixText: ' ' }).start();
        const probe = restoredAccounts[0].address;
        try {
            const client = new xrpl_1.Client(compose_1.LOCAL_WS_URL, { timeout: 60_000 });
            await client.connect();
            // Wait a moment for consensus to produce a validated ledger after restart
            const deadline = Date.now() + SNAPSHOT_RESTORE_VERIFY_TIMEOUT_MS;
            let found = false;
            while (Date.now() < deadline) {
                try {
                    await client.request({
                        command: 'account_info',
                        account: probe,
                        ledger_index: 'validated',
                    });
                    found = true;
                    break;
                }
                catch {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            await client.disconnect();
            if (found) {
                const verifyElapsed = ((Date.now() - verifyStartMs) / 1000).toFixed(1);
                verifySpinner.succeed(chalk_1.default.dim(`Verified account ${probe.slice(0, 8)}… exists on restored ledger (${verifyElapsed}s)`));
            }
            else {
                throw new Error('Account not found after waiting');
            }
        }
        catch (err) {
            verifySpinner.fail(chalk_1.default.red('Post-restore verification failed'));
            throw new Error(`Account ${probe} from the snapshot sidecar was not found on the restored ledger.\n` +
                `  The restore may not have applied correctly. Check:\n` +
                `  - docker compose -p ${compose_1.COMPOSE_PROJECT} logs rippled\n` +
                `  - xrpl-up accounts\n` +
                `  - Re-save the snapshot from a running sandbox and try again.`);
        }
    }
    logger_1.logger.blank();
    logger_1.logger.success(`Ledger state restored to snapshot "${name}"`);
    logger_1.logger.dim('  Run xrpl-up accounts to verify balances.');
    logger_1.logger.blank();
}
/** Returns sorted snapshot names (without .tar.gz extension). */
function listSnapshotNames() {
    if (!node_fs_1.default.existsSync(SNAPSHOTS_DIR))
        return [];
    return node_fs_1.default
        .readdirSync(SNAPSHOTS_DIR)
        .filter(f => f.endsWith('.tar.gz'))
        .map(f => f.replace(/\.tar\.gz$/, ''))
        .sort();
}
/** Print all saved snapshots with size and modification date. */
function snapshotList() {
    const names = listSnapshotNames();
    logger_1.logger.blank();
    if (names.length === 0) {
        logger_1.logger.dim('No snapshots found.');
        logger_1.logger.dim('  Save one with: xrpl-up snapshot save <name>');
        logger_1.logger.blank();
        return;
    }
    logger_1.logger.section('Snapshots');
    logger_1.logger.blank();
    const col = {
        name: Math.max(4, ...names.map(n => n.length)),
    };
    logger_1.logger.log(chalk_1.default.dim(`  ${'Name'.padEnd(col.name)}  ${'Size'.padStart(8)}  Created`));
    logger_1.logger.log(chalk_1.default.dim(`  ${'─'.repeat(col.name + 30)}`));
    for (const name of names) {
        const filePath = snapshotPath(name);
        const stats = node_fs_1.default.statSync(filePath);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';
        const date = stats.mtime.toLocaleString();
        const accounts = node_fs_1.default.existsSync(walletSidecarPath(name)) ? chalk_1.default.dim(' +accounts') : '';
        logger_1.logger.log(`  ${chalk_1.default.white(name.padEnd(col.name))}  ${chalk_1.default.dim(sizeMb.padStart(8))}  ${chalk_1.default.dim(date)}${accounts}`);
    }
    logger_1.logger.blank();
}
