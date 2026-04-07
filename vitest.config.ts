import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 300_000,
    maxConcurrency: 3,
    exclude: [
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/dist/**",
      // Sandbox tests that require a running local Docker node
      "tests/e2e/sandbox/snapshot.test.ts",
      "tests/e2e/sandbox/accounts.test.ts",
      "tests/e2e/sandbox/status.test.ts",
      "tests/e2e/sandbox/amendment.test.ts",
      "tests/e2e/sandbox/amendment.enable.test.ts",
    ],
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
  },
});
