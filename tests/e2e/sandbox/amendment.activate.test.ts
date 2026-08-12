/**
 * Sandbox — `amendment enable` ACTIVATION test (--local-network mode).
 *
 * amendment.enable.test.ts (the shared-sandbox suite) only checks that the
 * command exits 0 and queues the amendment — it deliberately skips the reset
 * so it doesn't disrupt other tests sharing that sandbox. Nothing there
 * verified that a queued amendment actually ends up enabled, so this test
 * drives the full cycle: enable -> reset -> restart -> assert `Enabled: yes`.
 *
 * --local-network mode on purpose: normally every sandbox in this mode
 * resumes from the pre-built genesis DB tarball via `--load`, which bypasses
 * the `[amendments]` config stanza (it only applies on a genesis `--start`).
 * When the amendment queue is non-empty, `seedConsensusVolumes()`
 * (src/core/compose.ts) skips reseeding so the entrypoint does a real
 * genesis `--start` instead, at the cost of a slower boot (real 2-node
 * consensus bootstrap instead of resuming a canned ledger). That genesis
 * starts a new ledger lineage, tracked in ~/.xrpl-up/genesis-lineage.txt —
 * see the snapshot-lineage test below for the interaction with snapshots.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runXrplUp } from "../../helpers/sandbox-cli";

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

/**
 * Candidates must be amendments that genuinely activate via the `[amendments]`
 * genesis stanza. Do NOT pick arbitrarily from `amendment list --disabled`:
 * that list also contains the legacy amendments (Checks, Escrow, PayChan,
 * MultiSign, DepositAuth, fix1201, ...) which rippled compiles in as
 * permanently active. Those are fully functional but never report
 * `enabled: true` on a freshly created genesis, so asserting activation on one
 * of them fails for a reason unrelated to the code under test (live-verified:
 * `check create`/`escrow create`/`depositAuth` all succeed while disabled).
 *
 * Keep these as newer, not-yet-on-mainnet amendments. Any already enabled are
 * filtered out, and the tests skip themselves if none remain.
 */
const ACTIVATABLE_CANDIDATES = [
  "SingleAssetVault",
  "DynamicMPT",
  "LendingProtocol",
  "ConfidentialTransfer",
  "Sponsor",
  "PermissionDelegationV1_1",
];

/** Returns up to `count` candidates that are currently supported-but-disabled. */
function findCandidates(count: number): string[] {
  const result = runXrplUp(["amendment", "list", "--local", "--disabled"], {}, 30_000);
  if (result.status !== 0) {
    throw new Error(
      `amendment list --local --disabled failed (exit ${result.status}):\n` +
      (result.stderr || result.stdout),
    );
  }

  const disabled = new Set<string>();
  for (const line of stripAnsi(result.stdout).split("\n")) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("Name") ||
      trimmed.startsWith("─") ||
      trimmed.includes("total known")
    ) {
      continue;
    }
    // Row: [name, hash, enabledMark, supportedMark] — supported but disabled
    const parts = trimmed.split(/\s{2,}/);
    if (parts.length >= 4 && parts[parts.length - 1].includes("✔")) {
      disabled.add(parts[0].trim());
    }
  }

  return ACTIVATABLE_CANDIDATES.filter((n) => disabled.has(n)).slice(0, count);
}

/**
 * `start` returns once the WebSocket port is reachable, which can be a moment
 * before the freshly created genesis ledger's amendments are reflected in the
 * `feature` RPC — a real race observed under load. Retry briefly rather than
 * asserting on the very first query.
 */
async function assertEnabled(name: string, retries = 5, delayMs = 3_000): Promise<void> {
  let last = "";
  for (let i = 0; i < retries; i++) {
    const info = runXrplUp(["amendment", "info", name, "--local"], {}, 30_000);
    expect(info.status).toBe(0);
    last = stripAnsi(info.stdout);
    if (last.includes("Enabled:     ✔ yes")) return;
    if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  expect(last).toContain("Enabled:     ✔ yes");
}

function restartLocalNetwork(): void {
  const start = runXrplUp(["start", "--local", "--local-network"], {}, 180_000);
  expect(start.status).toBe(0);
}

describe("amendment enable — single amendment activates in --local-network", () => {
  let target: string | null = null;

  beforeAll(() => {
    target = findCandidates(1)[0] ?? null;
  });

  it("enable --auto-reset then restart --local-network actually activates it", async () => {
    if (!target) {
      console.log("  ℹ  No activatable candidate available — skipping.");
      return;
    }

    const enable = runXrplUp(
      ["amendment", "enable", target, "--local", "--auto-reset"],
      {},
      60_000,
    );
    expect(enable.status).toBe(0);

    restartLocalNetwork();
    await assertEnabled(target);
  }, 220_000);
});

describe("amendment enable — multiple amendments in one command", () => {
  let targets: string[] = [];

  beforeAll(() => {
    // The block above already activated one candidate on this sandbox, so it no
    // longer appears as disabled — pick from whatever remains.
    targets = findCandidates(2);
  });

  it("enable <a> <b> --auto-reset queues and activates both", async () => {
    if (targets.length < 2) {
      console.log("  ℹ  Fewer than 2 activatable candidates remain — skipping.");
      return;
    }

    const enable = runXrplUp(
      ["amendment", "enable", ...targets, "--local", "--auto-reset"],
      {},
      60_000,
    );
    expect(enable.status).toBe(0);

    restartLocalNetwork();
    for (const name of targets) await assertEnabled(name);
  }, 220_000);
});

describe("snapshot lineage — restore across an amendment-driven genesis change", () => {
  // Regression test for the bug this whole file exists to catch: enabling an
  // amendment rebuilds the --local-network genesis (a new "lineage"), which
  // previously left an older snapshot's ledger and the post-enable config out
  // of sync — restore would load an old ledger while the account sidecar
  // referenced accounts that were never on it, and post-restore verification
  // failed with "account ... not found". snapshot restore now detects the
  // lineage mismatch and adopts the snapshot's amendment set automatically.
  let target: string | null = null;

  beforeAll(() => {
    // Start from the plain seeded lineage so the snapshot below is taken
    // without any manually enabled amendments.
    runXrplUp(["reset"], {}, 30_000);
    restartLocalNetwork();
    target = findCandidates(1)[0] ?? null;
  });

  it("save on the seed lineage, enable an amendment, restore — accounts and lineage both come back", async () => {
    if (!target) {
      console.log("  ℹ  No activatable candidate available — skipping.");
      return;
    }

    const save = runXrplUp(["snapshot", "save", "lineage-test"], {}, 60_000);
    expect(save.status).toBe(0);

    const enable = runXrplUp(
      ["amendment", "enable", target, "--local", "--auto-reset"],
      {},
      60_000,
    );
    expect(enable.status).toBe(0);
    restartLocalNetwork();
    await assertEnabled(target);

    const restore = runXrplUp(["snapshot", "restore", "lineage-test"], {}, 120_000);
    expect(restore.status).toBe(0);
    expect(stripAnsi(restore.stdout)).not.toContain("not found on the restored ledger");

    // The restored ledger predates the enable, so the amendment should be
    // back to disabled — proving the config was realigned to match, not just
    // left pointing at the (no-longer-applicable) new-genesis amendment set.
    const info = runXrplUp(["amendment", "info", target, "--local"], {}, 30_000);
    expect(info.status).toBe(0);
    expect(stripAnsi(info.stdout)).toContain("Enabled:     ✗ no");
  }, 300_000);
});
