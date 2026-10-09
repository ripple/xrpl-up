import { defineConfig } from "vitest/config";
import path from "path";
import os from "node:os";

export default defineConfig({
  resolve: {
    alias: [
      {
        // Redirect any import whose raw import string ends in /helpers/fund
        // → local.ts (same public API, uses local faucet instead of testnet).
        // NOTE: Vite matches resolve.alias against the raw import id ("../helpers/fund"),
        // not the resolved absolute path, so the pattern must match the relative string.
        find: /.*\/helpers\/fund$/,
        replacement: path.resolve(__dirname, "tests/e2e/helpers/local"),
      },
    ],
  },
  test: {
    globals: true,
    // Patch Date.now() to account for standalone rippled startup ledger drift.
    // See tests/setup/patch-clock.ts for details.
    setupFiles: ["tests/setup/patch-clock.ts", "tests/setup/dev-build.ts"],
    // Standalone mode: fast, instant ledger close
    testTimeout: 10_000,
    hookTimeout: 30_000,
    maxConcurrency: 10,
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        // One worker per core, up to 4. Each worker spawns CLI processes next to the
        // node's Docker containers, and the tests are timing-sensitive (a transaction
        // expires a few ledgers after it is built). 4 workers on a 2-core runner
        // starved them and failed different tests on every run.
        maxForks: Math.min(4, os.availableParallelism()),
      },
    },
    include: ["tests/e2e/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/dist/**",
      // Calls the xrpl-up CLI faucet command which checks for altnet/devnet URL
      "tests/e2e/wallet/fund.test.ts",
      // These features target devnet specifically and import helpers/devnet.ts
      "tests/e2e/vault/**",
      "tests/e2e/permissioned-domain/**",
      // Snapshot tests restart the node (stop+start rippled & faucet) — must run
      // in isolation via: npm run test:e2e:snapshot
      "tests/e2e/sandbox/snapshot.test.ts",
      // Amendment activation resets the whole stack — must run in isolation
      // via: npm run test:e2e:amendment
      "tests/e2e/sandbox/amendment.activate.test.ts",
    ],
    globalSetup: ["tests/setup/local-node.ts"],
  },
});
