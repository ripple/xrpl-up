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

const TESTNET_ALIASES = new Set([
  "testnet",
  "wss://s.altnet.rippletest.net:51233",
  "wss://testnet.xrpl-labs.com/",
]);

function applyNodeOverride(args: string[], override: string): string[] {
  const result = [...args];
  for (let i = 0; i < result.length; i++) {
    if (result[i] === "--node" && i + 1 < result.length && TESTNET_ALIASES.has(result[i + 1])) {
      result[i + 1] = override;
    }
  }
  return result;
}

export function runCLI(args: string[], extraEnv: Record<string, string> = {}, timeout = 120_000) {
  const nodeOverride = process.env.XRPL_NODE_OVERRIDE;
  const effectiveArgs = nodeOverride ? applyNodeOverride(args, nodeOverride) : args;
  return spawnSync(TSX, [CLI, ...effectiveArgs], {
    encoding: "utf-8",
    env: { ...process.env, PATH: E2E_PATH, ...extraEnv },
    timeout,
  });
}
