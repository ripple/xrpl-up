/**
 * Vitest setupFile: patches Date.now() to account for rippled ledger clock drift.
 *
 * Problem: Tests compute timestamps relative to Date.now() (e.g. EscrowCreate
 * finishAfter = Date.now() + 30s), but the ledger's close_time may differ from
 * wall clock. This happens in two scenarios:
 *
 * 1. **Standalone**: rippled creates a burst of initial ledgers on startup,
 *    advancing close_time ahead of wall clock by D seconds.
 * 2. **Consensus with pre-seeded DB**: The genesis DB was built at a past date,
 *    so the ledger's close_time starts behind wall clock by D seconds.
 *
 * If the test's timestamp is in the ledger's past (standalone) or far future
 * (consensus), rippled returns tecNO_PERMISSION.
 *
 * Fix: shift Date.now() by the measured drift so it tracks ledger time:
 *   - Positive drift (ledger ahead): shift Date.now() forward
 *   - Negative drift (ledger behind): shift Date.now() backward
 *
 * Safety: Vitest uses performance.now() (monotonic) for test timeouts — not
 * Date.now() — so this patch does not affect timeout detection.
 *
 * Dynamic measurement: drift is measured fresh here (not just in globalSetup)
 * because the faucet timer fires every ~1030 ms (1000 + WS round-trip), so
 * the effective drift decreases by ~30 ms/s over time. Measuring here gives
 * the accurate drift right before the test file runs.
 */

import Socket from "@xrplf/isomorphic/ws";

const XRPL_WS = process.env.XRPL_NODE_OVERRIDE ?? "ws://127.0.0.1:6006";
const RIPPLE_EPOCH = 946684800;
// Maximum time to wait for a ledger response before giving up
const WS_TIMEOUT_MS = 3_000;

async function measureLedgerDrift(): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (drift: number) => {
      if (!settled) {
        settled = true;
        resolve(drift);
      }
    };

    const timer = setTimeout(() => done(0), WS_TIMEOUT_MS);

    try {
      const ws = new Socket(XRPL_WS);

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
            done(closeTime - wallRipple);
          } else {
            done(0);
          }
        } catch {
          done(0);
        } finally {
          ws.close();
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timer);
        done(0);
      });
    } catch {
      clearTimeout(timer);
      done(0);
    }
  });
}

const driftS = await measureLedgerDrift();

if (driftS !== 0) {
  // Apply offset so Date.now() tracks ledger time:
  //   Positive drift (ledger ahead): shift Date.now() forward by (drift - 0.5s)
  //   Negative drift (ledger behind): shift Date.now() backward by (drift + 0.5s)
  // The 0.5s buffer keeps timestamps slightly behind ledger time so that
  // EscrowCreate finishAfter is in the ledger's future, not its past.
  const sign = driftS > 0 ? 1 : -1;
  const adjustedOffsetMs = driftS * 1000 - sign * 500;
  if (Math.abs(adjustedOffsetMs) > 100) {
    const _originalNow = Date.now.bind(Date);
    Date.now = () => _originalNow() + adjustedOffsetMs;
  }
}
