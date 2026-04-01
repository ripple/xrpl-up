/**
 * Vitest config for snapshot integration tests.
 *
 * Snapshot save/restore stops and restarts the local rippled + faucet
 * services, so these tests MUST run in isolation — not alongside the main
 * test:e2e:local suite.
 *
 * Usage:
 *   npm run test:e2e:snapshot
 *
 * The globalSetup starts the local node with --persist so the Docker volume
 * (xrpl-up-local-db) exists and snapshot save/restore can operate on it.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Serial execution — save/restore restarts the node, concurrent runs
    // would race against the restart window.
    maxConcurrency: 1,
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 1 },
    },
    // snapshot save/restore can take ~30s each (docker stop/start + tar/untar)
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: ["tests/e2e/sandbox/snapshot.test.ts"],
    // Use snapshot-setup (not local-node) so the node is always restarted
    // with --persist, even when the node was already running without it.
    globalSetup: ["tests/setup/snapshot-setup.ts"],
  },
});
