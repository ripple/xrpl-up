import { spawnSync } from "child_process";
import { resolve } from "path";
import { dirname } from "path";
import { delimiter } from "path";

const CLI = resolve(process.cwd(), "src/cli/index.ts");
const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");

/**
 * Runtime-resolved PATH that works in any Node environment
 * (fnm locally, setup-node in CI, etc.)
 */
const E2E_PATH = dirname(process.execPath) + delimiter + (process.env.PATH ?? "");

export function runCLI(args: string[], extraEnv: Record<string, string> = {}, timeout = 120_000) {
  return spawnSync(TSX, [CLI, ...args], {
    encoding: "utf-8",
    env: { ...process.env, PATH: E2E_PATH, ...extraEnv },
    timeout,
  });
}
