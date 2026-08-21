/**
 * Vitest globalSetup for the amendment-activation e2e test suite.
 *
 * Enabling an amendment does a full reset + restart of the local-network
 * stack, which would wipe funded worker accounts other e2e test files
 * depend on — so this test MUST run in isolation, not alongside the main
 * test:e2e:local-network suite (same reasoning as snapshot-setup.ts).
 *
 * Starts fresh in --local-network mode with a clean genesis-amendments
 * queue, so the test's own `amendment enable` call is the only thing that
 * has ever queued anything for this run.
 */
import { spawnSync } from "child_process";
import { resolve } from "path";
import fs from "fs";
import os from "os";
import path from "path";

const LOCAL_FAUCET_HEALTH = "http://localhost:3001/health";
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 120_000;
const XRPL_UP_DIR = path.join(os.homedir(), ".xrpl-up");
const GENESIS_AMENDMENTS_FILE = path.join(XRPL_UP_DIR, "genesis-amendments.txt");
const GENERATED_LOCAL_FILES = [
  path.join(XRPL_UP_DIR, "local-accounts.json"),
  path.join(XRPL_UP_DIR, "docker-compose.yml"),
  path.join(XRPL_UP_DIR, "rippled.cfg"),
  path.join(XRPL_UP_DIR, "rippled-node1.cfg"),
  path.join(XRPL_UP_DIR, "rippled-node2.cfg"),
  path.join(XRPL_UP_DIR, "validators.txt"),
];

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

function clearGeneratedLocalState(): void {
  for (const file of [...GENERATED_LOCAL_FILES, GENESIS_AMENDMENTS_FILE]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ok if already missing
    }
  }
}

async function waitForFaucetHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(LOCAL_FAUCET_HEALTH);
      if (resp.ok) {
        await resp.text();
        return;
      }
      await resp.text();
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
  console.log("[amendment-activate-setup] Stopping any running stack…");
  stopLocalStack();

  console.log("[amendment-activate-setup] Removing persistent volumes and generated state…");
  spawnSync("docker", ["volume", "rm", "-f", "xrpl-up-local-db", "xrpl-up-local-peer-db"], {
    stdio: "ignore",
  });
  clearGeneratedLocalState();

  console.log("[amendment-activate-setup] Starting fresh --local-network stack…");
  const result = spawnSync(
    TSX,
    [CLI, "start", "--local-network"],
    {
      encoding: "utf-8",
      timeout: 180_000,
      env: { ...process.env },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to start local-network node:\n${result.stderr || result.stdout}`,
    );
  }

  console.log("[amendment-activate-setup] Waiting for faucet health…");
  await waitForFaucetHealth(HEALTH_TIMEOUT_MS);
  console.log("[amendment-activate-setup] Stack ready");
}

export async function teardown(): Promise<void> {
  if (process.env.XRPL_LOCAL_TEARDOWN === "1") {
    console.log("[amendment-activate-setup] Stopping local stack…");
    stopLocalStack();
  }
}
