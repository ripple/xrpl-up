/**
 * Vitest setupFile: patches Date.now() to account for standalone rippled
 * ledger clock drift.
 *
 * Problem: Local standalone rippled creates a burst of initial ledgers during
 * startup (advancing close_time by D seconds with no real time passing).
 * Tests that compute `new Date(Date.now() + 5_000)` for EscrowCreate finishAfter
 * get a timestamp that is already in the ledger's past → tecNO_PERMISSION.
 *
 * Fix: shift Date.now() forward by (D - 500ms) so that:
 *   - EscrowCreate: finishAfter is D-0.5 + 5 = 4.5+ ledger-seconds in the future ✓
 *   - EscrowFinish/Cancel after 16-second wait: the 15-16 ledger closes are
 *     enough to advance past finishAfter/cancelAfter ✓
 *
 * Safety: Vitest uses performance.now() (monotonic) for test timeouts — not
 * Date.now() — so this patch does not affect timeout detection.
 *
 * Dynamic measurement: drift is measured fresh here (not just in globalSetup)
 * because the faucet timer fires every ~1030 ms (1000 + WS round-trip), so
 * the effective drift decreases by ~30 ms/s over time. Measuring here gives
 * the accurate drift right before the test file runs.
 */

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
      const ws = new globalThis.WebSocket(XRPL_WS);

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ command: "ledger", ledger_index: "validated" }));
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        clearTimeout(timer);
        try {
          const r = JSON.parse(event.data as string) as {
            result?: { ledger?: { close_time?: number } };
          };
          const closeTime = r.result?.ledger?.close_time;
          if (typeof closeTime === "number") {
            const wallRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
            done(Math.max(0, closeTime - wallRipple));
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

if (driftS > 0) {
  // Apply offset = drift - 0.5s  so that Date.now() returns
  //   wall_clock + drift - 0.5  ≈  ledger_time - 0.5 seconds
  // This ensures:
  //   finishAfter = (ledger - 0.5) + N > ledger  (EscrowCreate succeeds)
  //   finishAfter is only N-0.5 ledger-seconds away, within the 16-second wait
  const adjustedOffsetMs = Math.max(0, driftS * 1000 - 500);
  if (adjustedOffsetMs > 0) {
    const _originalNow = Date.now.bind(Date);
    Date.now = () => _originalNow() + adjustedOffsetMs;
  }
}
