import { spawnSync } from "child_process";
import net from "net";
import { resolve } from "path";
import Socket from "@xrplf/isomorphic/ws";
import { startStatsSampler, stopStatsSampler, formatPeakStats, formatProcessMemory } from "./docker-stats";

const LOCAL_WS_PORT = 6006;
const LOCAL_FAUCET_HEALTH = "http://localhost:3001/health";
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 60_000;
// Maximum tolerated ledger drift in seconds. If the validated ledger's
// close_time is more than this far ahead of wall clock, the local node is
// restarted to ensure Date.now()-based timestamps in tests remain valid.
const MAX_LEDGER_DRIFT_SECONDS = 60;
// Ripple epoch offset (seconds between Unix epoch and Ripple epoch)
const RIPPLE_EPOCH = 946684800;

// Genesis account on standalone rippled
const GENESIS_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
// One pre-funded master wallet per worker task (test file). Max ~20 wallets × 100 XRP
// per file, so 10_000 XRP gives 5× headroom. 80 × 10_000 = 800k XRP from 100M genesis.
const WORKER_PREFUND_XRP = 10_000;
// VITEST_WORKER_ID is a per-task counter (one per test file), not a per-fork index.
// With ~62 included test files, IDs can reach 62+. Pre-fund enough to cover all.
const MAX_PREFUND_WORKERS = 80;

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Returns the ledger close_time drift in seconds:
 * positive = ledger is ahead of wall clock, negative = ledger is behind.
 * Returns null if the node is unreachable or the response is unexpected.
 */
function getLedgerDrift(): Promise<number | null> {
  return new Promise((resolve) => {
    const ws = new Socket(`ws://127.0.0.1:${LOCAL_WS_PORT}`);
    const timer = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 3000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ command: "ledger", ledger_index: "validated" }));
    });

    ws.addEventListener("message", (event: { data: unknown }) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(event.data as string) as {
          result?: { ledger?: { close_time?: number } };
        };
        const closeTime = r.result?.ledger?.close_time;
        if (typeof closeTime === "number") {
          const wallRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
          resolve(closeTime - wallRipple);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      } finally {
        ws.close();
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

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
    `Local faucet did not become healthy within ${timeoutMs / 1000}s. ` +
      `Check that xrpl-up start is running correctly.`,
  );
}

async function startNode(): Promise<void> {
  console.log("[local-node] Starting local rippled stack…");
  // Reset to clean state: stops containers, removes volumes, clears wallet store.
  spawnSync(TSX, [CLI, "reset"], {
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env },
  });
  const result = spawnSync(TSX, [CLI, "start", "--local", "--detach"], {
    encoding: "utf-8",
    timeout: 120_000,   // standalone is fast but first run pulls Docker image
    env: { ...process.env },
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to start local rippled node:\n${result.stderr || result.stdout}`,
    );
  }
}

async function waitForWorkerAccount(
  client: import("xrpl").Client,
  address: string,
  retries = 30,
  delayMs = 500,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await client.request({ command: "account_info", account: address, ledger_index: "validated" });
      return;
    } catch {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Worker master account ${address} did not appear after ${retries} retries`);
}

async function prefundWorkerMasters(): Promise<void> {
  const { Client, Wallet, xrpToDrops } = await import("xrpl");
  const client = new Client(`ws://127.0.0.1:${LOCAL_WS_PORT}`, { timeout: 60_000 });
  await client.connect();

  try {
    const genesis = Wallet.fromSeed(GENESIS_SEED, { algorithm: "secp256k1" });

    // Fetch starting sequence once — we'll increment manually to avoid autofill
    // fetching stale sequence for each subsequent tx (txs are pending, not yet validated)
    const infoResp = await client.request({
      command: "account_info",
      account: genesis.address,
      ledger_index: "current",
    });
    let seq: number = infoResp.result.account_data.Sequence;
    const ledgerIndex = await client.getLedgerIndex();

    const wallets: Wallet[] = [];
    for (let i = 0; i < MAX_PREFUND_WORKERS; i++) {
      const w = Wallet.generate();
      wallets.push(w);

      const tx = {
        TransactionType: "Payment" as const,
        Account: genesis.address,
        Sequence: seq++,
        Fee: "12",
        LastLedgerSequence: ledgerIndex + 50,
        Amount: xrpToDrops(String(WORKER_PREFUND_XRP)),
        Destination: w.address,
      };
      const { tx_blob } = genesis.sign(tx);
      await client.submit(tx_blob);
    }

    // Wait for all accounts to appear in the validated ledger
    await Promise.all(wallets.map((w) => waitForWorkerAccount(client, w.address)));

    // Publish seeds — workers are forked after globalSetup, so they inherit these
    wallets.forEach((w, i) => {
      process.env[`XRPL_WORKER_SEED_${i}`] = w.seed!;
    });
    console.log(`[local-node] Pre-funded ${MAX_PREFUND_WORKERS} worker master accounts`);
  } finally {
    await client.disconnect();
  }
}

export async function setup(): Promise<void> {
  let alreadyRunning = await isPortOpen(LOCAL_WS_PORT);

  if (alreadyRunning) {
    // Check for ledger time drift. Each faucet ledger_accept call advances the
    // ledger close_time by 1 second regardless of real time. If the node has
    // accumulated significant drift, Date.now()-based EscrowCreate/Cancel
    // timestamps would appear in the past to the ledger → tecNO_PERMISSION.
    // Restart cleanly in that case.
    const drift = await getLedgerDrift();
    if (drift !== null && drift > MAX_LEDGER_DRIFT_SECONDS) {
      console.log(
        `[local-node] Ledger close_time is ${drift}s ahead of wall clock (max: ${MAX_LEDGER_DRIFT_SECONDS}s). ` +
          `Restarting node for accurate timestamps…`,
      );
      stopLocalStack();
      alreadyRunning = false;
    } else {
      console.log(
        `[local-node] Local rippled already running on port 6006 (drift: ${drift ?? "unknown"}s)`,
      );
    }
  }

  if (!alreadyRunning) {
    if (process.env.XRPL_LOCAL_NO_AUTOSTART === "1") {
      throw new Error(
        "Local rippled is not running on port 6006.\n" +
          "Start it manually with: xrpl-up start --local --detach\n" +
          "Or unset XRPL_LOCAL_NO_AUTOSTART to allow auto-start.",
      );
    }
    await startNode();
  }

  console.log("[local-node] Waiting for faucet health check…");
  await waitForFaucetHealth(HEALTH_TIMEOUT_MS);
  console.log("[local-node] Local stack is ready");

  // Measure ledger clock drift and publish it so workers can compensate.
  // Standalone rippled creates initial ledgers during startup, advancing
  // close_time by several seconds with no real time passing. The drift is
  // fixed after startup (the periodic 1-second timer advances at real-time
  // rate), so measuring once here is sufficient for the whole test run.
  const finalDrift = await getLedgerDrift();
  if (finalDrift !== null && finalDrift > 0) {
    process.env.XRPL_CLOCK_OFFSET_MS = String(finalDrift * 1000);
    console.log(`[local-node] Ledger is ${finalDrift}s ahead of wall clock — publishing offset for Date.now patch`);
  } else {
    delete process.env.XRPL_CLOCK_OFFSET_MS;
  }

  // Set env var so all worker forks inherit it — workers are spawned after
  // globalSetup completes, so this mutation is visible to all of them.
  process.env.XRPL_NODE_OVERRIDE = "ws://localhost:6006";

  // Pre-fund one master wallet per worker fork. Each fork gets its own account,
  // eliminating cross-process genesis sequence conflicts when maxForks > 1.
  await prefundWorkerMasters();

  // Start background Docker stats sampler to track peak resource usage
  startStatsSampler();
}

export async function teardown(): Promise<void> {
  // Stop the background stats sampler and print peak resource usage
  stopStatsSampler();
  const peakStats = formatPeakStats();
  if (peakStats) {
    console.log(`[local-node] Peak container resource usage:\n${peakStats}`);
  }
  console.log(`[local-node] Test process memory: ${formatProcessMemory()}`);

  if (process.env.XRPL_LOCAL_TEARDOWN === "1") {
    console.log("[local-node] Stopping local stack…");
    stopLocalStack();
  }
}
