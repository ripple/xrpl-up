/**
 * Vitest globalSetup for the snapshot e2e test suite.
 *
 * Unlike local-node.ts, this setup ALWAYS stops any running stack and
 * restarts it with --local-network (consensus mode) so the Docker volume
 * (xrpl-up-local-db) is guaranteed to exist for snapshot save/restore.
 *
 * If local-node.ts were used instead, it would skip startNode() whenever
 * the node is already running — even when it was started without --local-network.
 *
 * No prefundWorkerMasters() here: snapshot tests don't submit XRPL
 * transactions, so per-worker funded accounts are not needed.
 */
import { spawnSync } from "child_process";
import { resolve } from "path";
import fs from "fs";
import os from "os";
import path from "path";

const LOCAL_FAUCET_HEALTH = "http://localhost:3001/health";
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 60_000;
const XRPL_UP_DIR = path.join(os.homedir(), ".xrpl-up");
const SNAPSHOTS_DIR = path.join(XRPL_UP_DIR, "snapshots");
const WALLET_STORE_PATH = path.join(XRPL_UP_DIR, "local-accounts.json");
const GENERATED_LOCAL_FILES = [
  WALLET_STORE_PATH,
  path.join(XRPL_UP_DIR, "docker-compose.yml"),
  path.join(XRPL_UP_DIR, "rippled.cfg"),
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
  for (const file of GENERATED_LOCAL_FILES) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ok if already missing
    }
  }

  try {
    const names = fs.readdirSync(SNAPSHOTS_DIR);
    for (const name of names) {
      if (name.endsWith(".tmp") || name.endsWith(".bak")) {
        try {
          fs.unlinkSync(path.join(SNAPSHOTS_DIR, name));
        } catch {
          // best effort
        }
      }
    }
  } catch {
    // ok if snapshots dir missing
  }
}

async function waitForAccountsValidated(timeoutMs: number): Promise<void> {
  const walletStorePath = path.join(XRPL_UP_DIR, "local-accounts.json");
  let accounts: { address: string }[] = [];
  try {
    accounts = JSON.parse(fs.readFileSync(walletStorePath, "utf-8"));
  } catch {
    return; // no wallet store — nothing to wait for
  }
  if (accounts.length === 0) return;

  const probe = accounts[0].address;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch("http://localhost:3001/health");
      if (!resp.ok) { await resp.text(); throw new Error("faucet not ready"); }
      await resp.text();

      // Check via a direct WebSocket call to rippled
      const { Client } = await import("xrpl");
      const client = new Client("ws://localhost:6006", { timeout: 5_000 });
      await client.connect();
      try {
        await client.request({
          command: "account_info",
          account: probe,
          ledger_index: "validated",
        });
        await client.disconnect();
        console.log(`[snapshot-setup] Account ${probe.slice(0, 8)}… confirmed on validated ledger`);
        return;
      } catch {
        await client.disconnect();
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.warn("[snapshot-setup] Warning: timed out waiting for accounts to validate");
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
  // Always stop first so we can restart in consensus mode regardless of prior state.
  console.log("[snapshot-setup] Stopping any running stack…");
  stopLocalStack();

  console.log("[snapshot-setup] Removing stale persist volume (if any)…");
  spawnSync("docker", ["volume", "rm", "-f", "xrpl-up-local-db"], {
    stdio: "ignore",
  });

  console.log("[snapshot-setup] Clearing generated local sandbox state…");
  clearGeneratedLocalState();

  console.log("[snapshot-setup] Starting node in --local-network consensus mode…");
  const result = spawnSync(
    TSX,
    [CLI, "start", "--local", "--local-network", "--detach"],
    {
      encoding: "utf-8",
      timeout: 180_000,   // consensus bootstrap: ~60s for consensus + faucet
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

  // The `start` command auto-funds accounts via the faucet, but returns
  // before those accounts appear on the validated ledger (~4s consensus close).
  // Snapshot save stops the node immediately — if accounts aren't validated yet,
  // they won't be in the tarball. Wait for at least one account to confirm.
  console.log("[snapshot-setup] Waiting for funded accounts to be validated…");
  await waitForAccountsValidated(30_000);

  // Publish override so any helper that respects it uses the local node.
  process.env.XRPL_NODE_OVERRIDE = "ws://localhost:6006";
}

export async function teardown(): Promise<void> {
  if (process.env.XRPL_LOCAL_TEARDOWN === "1") {
    console.log("[snapshot-setup] Stopping local stack…");
    stopLocalStack();
  }
}
