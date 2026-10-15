import { ChildProcess } from 'child_process';
import { DEFAULT_IMAGE } from './xrpld-image';
import { type Amendment } from './genesis-amendments';
export declare const COMPOSE_PROJECT = "xrpl-up-local";
export declare const LOCAL_WS_PORT = 6006;
export declare const FAUCET_PORT = 3001;
export declare const LOCAL_WS_URL = "ws://localhost:6006";
export declare const FAUCET_URL = "http://localhost:3001";
export { DEFAULT_IMAGE };
declare const COMPOSE_FILE: string;
export { COMPOSE_FILE };
export declare const VOLUME_NAME = "xrpl-up-local-db";
export declare const PEER_VOLUME_NAME = "xrpl-up-local-peer-db";
/** Throws if Docker daemon is not running or not installed. */
export declare function checkDockerAvailable(): void;
declare const RIPPLED_CFG_FILE: string;
/** Extra amendments written by `amendment enable`; merged at genesis. */
export declare const EXTRA_AMENDMENTS_FILE: string;
export { RIPPLED_CFG_FILE };
/**
 * Returns the default rippled.cfg content as a string (pure, no side effects).
 * Exported so callers can display or save it without starting a node.
 */
export declare function generateRippledConfig(debug?: boolean, amendments?: Amendment[]): string;
/**
 * Write rippled config(s) and validators.txt to ~/.xrpl-up/.
 *
 * In consensus mode (default): writes rippled-node1.cfg + rippled-node2.cfg
 * with validator seeds and mutual [ips_fixed] references.
 *
 * In standalone mode (default): writes a single rippled.cfg.
 */
export declare function writeRippledConfig(debug?: boolean, noConsensus?: boolean): void;
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
export declare function writeComposeFile(image?: string, noConsensus?: boolean, debug?: boolean, ledgerIntervalMs?: number, configPath?: string, noRestart?: boolean, bindAddress?: string): string;
/** Read the rippled image from the current compose file (for use in restore). */
export declare function readComposeImage(): string;
/** Read the faucet ledger interval from the current compose file. */
export declare function readComposeLedgerInterval(): number;
/** Stop a single service without removing containers or volumes. */
export declare function stopService(service: string): void;
/** Start a previously stopped service (or create it if the container is missing).
 *
 * --no-deps skips the depends_on health-check gate so the faucet can be
 * started independently after we have already confirmed rippled is ready.
 */
export declare function startService(service: string): void;
/** Run `docker compose down` (removes containers, keeps volumes). */
export declare function composeDown(): void;
/**
 * Returns true if a Docker volume exists AND contains a ledger.db file.
 * This is the same sentinel the entrypoint checks to decide --load vs --start.
 */
export declare function volumeHasData(volumeName: string): boolean;
/** Called by `xrpl-up reset` — the volumes are gone, so the recorded image is stale. */
/**
 * Current --local-network lineage, or null if no sandbox has been created yet.
 * `base` is a genesis built from the default amendment list alone; anything
 * else is a fingerprint of the extra amendments it was built with (see
 * GENESIS_LINEAGE_FILE).
 */
export declare function readGenesisLineage(): string | null;
/**
 * Make this machine's config match a restored snapshot's genesis.
 *
 * `snapshot restore` replaces the ledger wholesale, so the amendment set is
 * whatever that ledger was built with. Writing those amendments back (and
 * regenerating the config) keeps config and ledger in agreement, so restoring
 * across an `amendment enable` just works instead of leaving a mismatch.
 */
export declare function adoptGenesisLineage(lineage: string, amendments: string): void;
/** Called by `xrpl-up reset` — the volumes are gone, so the lineage is stale. */
export declare function clearGenesisLineage(): void;
export declare function clearLocalNetworkImageRecord(): void;
/**
 * Start the compose stack (`docker compose up --build -d`),
 * wait for ports and (in consensus mode) for the first validated ledger.
 *
 * Default (noConsensus=true): standalone rippled, torn down clean each start.
 * With --local-network (noConsensus=false): 2-node consensus network. Volumes preserved.
 */
export declare function composeUp(image?: string, noConsensus?: boolean, debug?: boolean, ledgerIntervalMs?: number, configPath?: string, noRestart?: boolean, bindAddress?: string): Promise<string>;
/**
 * Returns true if the current compose file describes a 2-node consensus
 * network (has a rippled-peer service). False for standalone mode.
 */
export declare function isConsensusMode(): boolean;
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
export declare function startCommandHint(): string;
/**
 * Spawn `docker compose logs --follow [service]` and stream to the caller's
 * stdout/stderr. Returns the child process so the caller can handle termination.
 */
export declare function composeLogs(service?: string): ChildProcess;
export declare function waitForPort(port: number, timeoutMs: number, label: string): Promise<void>;
//# sourceMappingURL=compose.d.ts.map