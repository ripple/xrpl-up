"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetCommand = resetCommand;
const child_process_1 = require("child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const compose_1 = require("../core/compose");
const wallet_store_1 = require("../core/wallet-store");
const logger_1 = require("../utils/logger");
const SNAPSHOTS_DIR = node_path_1.default.join(node_os_1.default.homedir(), '.xrpl-up', 'snapshots');
/**
 * Wipe all local sandbox state:
 *  - Stop containers (docker compose down)
 *  - Remove the persist ledger volume
 *  - Clear the WalletStore (local-accounts.json)
 *  - Clear amendments added via `amendment enable` (unless --keep-amendments)
 *  - Optionally delete all snapshots (--snapshots)
 */
function resetCommand(options = {}) {
    logger_1.logger.blank();
    // Stop containers and remove volumes in one step (docker compose down -v)
    const stopSpinner = (0, ora_1.default)({ text: chalk_1.default.dim('Stopping sandbox and removing volumes…'), prefixText: ' ' }).start();
    try {
        (0, child_process_1.execSync)(`docker compose -p xrpl-up-local -f "${node_path_1.default.join(node_os_1.default.homedir(), '.xrpl-up', 'docker-compose.yml')}" down -v`, { stdio: 'ignore' });
    }
    catch {
        // already gone or never started — try removing volumes individually
        (0, compose_1.composeDown)();
    }
    // Also remove any orphaned volumes not attached to compose
    let removedAny = false;
    for (const vol of [compose_1.VOLUME_NAME, compose_1.PEER_VOLUME_NAME]) {
        try {
            (0, child_process_1.execSync)(`docker volume rm -f ${vol}`, { stdio: 'ignore' });
            removedAny = true;
        }
        catch {
            // volume not found — ok
        }
    }
    stopSpinner.succeed(chalk_1.default.dim('Sandbox stopped and volumes removed'));
    // Volumes are gone — any previously recorded --local-network image is stale
    (0, compose_1.clearLocalNetworkImageRecord)();
    // Volumes are gone, so the recorded genesis lineage no longer describes anything.
    (0, compose_1.clearGenesisLineage)();
    // Clear WalletStore
    new wallet_store_1.WalletStore('local').clear();
    logger_1.logger.dim('  Account store cleared');
    // Clear amendments the user added via `amendment enable`. Without this, a
    // "factory state" reset would silently re-apply them at the next genesis.
    if (!options.keepAmendments) {
        if (node_fs_1.default.existsSync(compose_1.EXTRA_AMENDMENTS_FILE)) {
            const kept = node_fs_1.default.readFileSync(compose_1.EXTRA_AMENDMENTS_FILE, 'utf-8')
                .split('\n').filter((l) => l.trim()).length;
            node_fs_1.default.rmSync(compose_1.EXTRA_AMENDMENTS_FILE, { force: true });
            // Regenerate the config so it no longer carries the removed amendments.
            (0, compose_1.writeRippledConfig)();
            logger_1.logger.dim(`  Cleared ${kept} manually enabled amendment${kept === 1 ? '' : 's'} (use --keep-amendments to preserve)`);
        }
    }
    else {
        logger_1.logger.dim('  Manually enabled amendments preserved (--keep-amendments)');
    }
    // Optionally clear snapshots
    if (options.snapshots) {
        if (node_fs_1.default.existsSync(SNAPSHOTS_DIR)) {
            node_fs_1.default.rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
            logger_1.logger.dim('  Snapshots cleared');
        }
        else {
            logger_1.logger.dim('  No snapshots found');
        }
    }
    logger_1.logger.blank();
    logger_1.logger.success('Local sandbox reset to factory state.');
    logger_1.logger.dim(`  Run ${(0, compose_1.startCommandHint)()} to start fresh.`);
    logger_1.logger.blank();
}
