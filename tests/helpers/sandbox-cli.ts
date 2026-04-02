import { spawnSync } from "child_process";
import { resolve, dirname, delimiter } from "path";

/**
 * Resolves to src/cli.ts — the xrpl-up binary entry point.
 * Sandbox lifecycle commands (node, stop, reset, status, accounts, faucet,
 * logs, config, snapshot, amendment, run, init) live here.
 *
 * Contrast with tests/helpers/cli.ts which points at src/cli/index.ts
 * (the xrpl binary used by wallet/account/payment commands).
 */
const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");

/**
 * Runtime-resolved PATH that works in any Node environment
 * (fnm locally, setup-node in CI, etc.)
 */
const E2E_PATH = dirname(process.execPath) + delimiter + (process.env.PATH ?? "");

/**
 * Run an xrpl-up sandbox command via tsx → src/cli.ts.
 * Returns the spawnSync result with stdout/stderr as strings.
 */
export function runXrplUp(
  args: string[],
  extraEnv: Record<string, string> = {},
  timeout = 30_000,
  input?: string,
) {
  return spawnSync(TSX, [CLI, ...args], {
    encoding: "utf-8",
    env: { ...process.env, PATH: E2E_PATH, ...extraEnv },
    timeout,
    ...(input !== undefined ? { input } : {}),
  });
}
