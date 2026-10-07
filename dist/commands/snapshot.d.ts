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
export declare function snapshotSave(name: string): Promise<void>;
/**
 * Restore ledger state from a named snapshot.
 *
 * Extracts the tarball to BOTH node volumes (primary + peer), then restarts
 * the stack. The entrypoint detects ledger.db and uses --load to resume.
 */
export declare function snapshotRestore(name: string): Promise<void>;
/** Print all saved snapshots with size and modification date. */
export declare function snapshotList(): void;
//# sourceMappingURL=snapshot.d.ts.map