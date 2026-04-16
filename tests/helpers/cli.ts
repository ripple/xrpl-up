import { spawnSync } from "child_process";
import { resolve } from "path";
import { dirname } from "path";
import { delimiter } from "path";

const CLI = resolve(process.cwd(), "src/cli.ts");
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
  // Also override XRPL_NODE env var so tests that pass { XRPL_NODE: "testnet" }
  // via extraEnv are redirected to the local node in local test runs.
  const effectiveEnv = nodeOverride
    ? { ...process.env, PATH: E2E_PATH, ...extraEnv, XRPL_NODE: nodeOverride }
    : { ...process.env, PATH: E2E_PATH, ...extraEnv };
  return spawnSync(TSX, [CLI, ...effectiveArgs], {
    encoding: "utf-8",
    env: effectiveEnv,
    timeout,
  });
}

const TRANSIENT_RE = /DisconnectedError|websocket was closed|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i;

/**
 * Run a CLI command with automatic retries on transient network errors.
 * Useful for testnet tests where websocket connections can drop mid-operation.
 */
export function runCLIWithRetry(args: string[], extraEnv: Record<string, string> = {}, retries = 3, timeout = 120_000) {
  for (let i = 0; i < retries; i++) {
    const result = runCLI(args, extraEnv, timeout);
    if (result.status === 0) return result;
    if (!TRANSIENT_RE.test(result.stderr) || i === retries - 1) return result;
  }
  return runCLI(args, extraEnv, timeout); // unreachable, satisfies TS
}
