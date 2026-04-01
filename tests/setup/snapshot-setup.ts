/**
 * Vitest globalSetup for the snapshot e2e test suite.
 *
 * Unlike local-node.ts, this setup ALWAYS stops any running stack and
 * restarts it with --persist so the Docker volume (xrpl-up-local-db)
 * is guaranteed to exist for snapshot save/restore operations.
 *
 * If local-node.ts were used instead, it would skip startNode() whenever
 * the node is already running — even when it was started without --persist.
 *
 * No prefundWorkerMasters() here: snapshot tests don't submit XRPL
 * transactions, so per-worker funded accounts are not needed.
 */
import { spawnSync } from "child_process";
import { resolve } from "path";

const LOCAL_FAUCET_HEALTH = "http://localhost:3001/health";
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 60_000;

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");

function stopLocalStack(): void {
  try {
    spawnSync("docker", ["compose", "-p", "xrpl-up-local", "down"], {
      stdio: "ignore",
    });
  } catch {
    // best effort
  }
}

async function waitForFaucetHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(LOCAL_FAUCET_HEALTH);
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Local faucet did not become healthy within ${timeoutMs / 1000}s.`,
  );
}

export async function setup(): Promise<void> {
  // Always stop first so we can restart with --persist regardless of prior state.
  console.log("[snapshot-setup] Stopping any running stack…");
  stopLocalStack();

  console.log("[snapshot-setup] Removing stale persist volume (if any)…");
  spawnSync("docker", ["volume", "rm", "-f", "xrpl-up-local-db"], {
    stdio: "ignore",
  });

  console.log("[snapshot-setup] Starting node with --persist…");
  const result = spawnSync(
    TSX,
    [CLI, "node", "--local", "--persist", "--detach"],
    {
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to start local rippled node:\n${result.stderr || result.stdout}`,
    );
  }

  console.log("[snapshot-setup] Waiting for faucet health…");
  await waitForFaucetHealth(HEALTH_TIMEOUT_MS);
  console.log("[snapshot-setup] Stack ready");

  // Publish override so any helper that respects it uses the local node.
  process.env.XRPL_NODE_OVERRIDE = "ws://localhost:6006";
}

export async function teardown(): Promise<void> {
  if (process.env.XRPL_LOCAL_TEARDOWN === "1") {
    console.log("[snapshot-setup] Stopping local stack…");
    stopLocalStack();
  }
}
