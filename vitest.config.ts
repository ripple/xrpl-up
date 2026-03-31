import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 300_000,
    maxConcurrency: 3,
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/dist/**"],
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
  },
});
