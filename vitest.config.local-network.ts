import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /.*\/helpers\/fund$/,
        replacement: path.resolve(__dirname, "tests/e2e/helpers/local"),
      },
    ],
  },
  test: {
    globals: true,
    setupFiles: ["tests/setup/patch-clock.ts"],
    // Consensus network: ~4s ledger close, needs generous timeouts
    testTimeout: 120_000,
    hookTimeout: 120_000,
    maxConcurrency: 10,
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
    include: ["tests/e2e/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/dist/**",
      "tests/e2e/wallet/fund.test.ts",
      "tests/e2e/vault/**",
      "tests/e2e/permissioned-domain/**",
      "tests/e2e/sandbox/snapshot.test.ts",
    ],
    globalSetup: ["tests/setup/local-network-node.ts"],
  },
});
