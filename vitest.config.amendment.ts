/**
 * Vitest config for the amendment-activation e2e test.
 *
 * Enabling an amendment resets and restarts the local-network stack, so
 * this test MUST run in isolation — not alongside the main test:e2e suites.
 *
 * Usage:
 *   npm run test:e2e:amendment
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    maxConcurrency: 1,
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 1 },
    },
    // A fresh --local-network genesis boot can take ~1-2 minutes.
    testTimeout: 200_000,
    hookTimeout: 180_000,
    include: ["tests/e2e/sandbox/amendment.activate.test.ts"],
    globalSetup: ["tests/setup/amendment-activate-setup.ts"],
  },
});
