/**
 * Sandbox lifecycle — amendment list command tests.
 *
 * Requires the local rippled stack to be running (started by globalSetup).
 * All tests are read-only — no amendments are enabled or disabled.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { runXrplUp } from "../../helpers/sandbox-cli";

/** Parse amendment names from the [amendments] section of compose.ts. */
function getConfiguredAmendmentNames(): Set<string> {
  const composePath = path.resolve(process.cwd(), "src/core/compose.ts");
  const composeSrc = fs.readFileSync(composePath, "utf-8");
  const section = composeSrc.match(/\[amendments\]\n([\s\S]*?)# sync:end/);
  if (!section) throw new Error("Could not find [amendments] section in compose.ts");

  const names = new Set<string>();
  for (const line of section[1].split("\n")) {
    const m = line.trim().match(/^[0-9A-Fa-f]{64}\s+(\S+)/);
    if (m) names.add(m[1]);
  }
  return names;
}

describe("sandbox amendment list", () => {
  it("exits 0", () => {
    const result = runXrplUp(["amendment", "list"], {}, 30_000);
    expect(result.status).toBe(0);
  });

  it("stdout contains the Enabled and Supported column headers", () => {
    const result = runXrplUp(["amendment", "list"], {}, 30_000);
    expect(result.stdout).toContain("Enabled");
    expect(result.stdout).toContain("Supported");
  });

  it("stdout contains the summary count line", () => {
    const result = runXrplUp(["amendment", "list"], {}, 30_000);
    expect(result.stdout).toContain("total known");
  });

  it("all configured genesis amendments are known to the local rippled build", () => {
    // Verify every amendment hash in our [amendments] config is recognized by
    // the running rippled binary (shows up in the feature list). This catches
    // config entries with wrong hashes or amendments removed from rippled.
    //
    // Note: in consensus mode, amendments activate through voting (~17 min),
    // NOT at genesis. So we check "known" (appears in feature list), not "enabled".
    const configuredNames = getConfiguredAmendmentNames();
    // Re-curated for rippled 3.3.0 (see SPEC.md §5.6.1): the list dropped from
    // ~77 to 37 after live-verifying which entries actually force-enable on a
    // fresh genesis. Sanity bound tightened to match, not loosened blindly.
    expect(configuredNames.size).toBeGreaterThan(30);

    const result = runXrplUp(["amendment", "list"], {}, 30_000);
    expect(result.status).toBe(0);

    const unknownAmendments: string[] = [];
    for (const name of configuredNames) {
      const lineRegex = new RegExp(`^.*?\\b${name}\\b.*$`, "m");
      if (!result.stdout.match(lineRegex)) {
        unknownAmendments.push(name);
      }
    }

    expect(
      unknownAmendments,
      `Configured amendments NOT recognized by rippled build: ${unknownAmendments.join(", ")}. ` +
      `These may have incorrect hashes or were removed from rippled.`,
    ).toEqual([]);
  });
});

describe("sandbox amendment list --disabled", () => {
  it("exits 0", () => {
    const result = runXrplUp(
      ["amendment", "list", "--disabled"],
      {},
      30_000,
    );
    expect(result.status).toBe(0);
  });
});

describe("sandbox amendment info (known amendment)", () => {
  it("looks up a known amendment by name and exits 0", () => {
    const result = runXrplUp(
      ["amendment", "info", "fixUniversalNumber"],
      {},
      30_000,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fixUniversalNumber");
  });

  it("unknown amendment name exits 1", () => {
    const result = runXrplUp(
      ["amendment", "info", "ThisAmendmentDoesNotExist"],
      {},
      30_000,
    );
    expect(result.status).toBe(1);
  });
});

describe("sandbox amendment list --diff testnet", () => {
  it("exits 0 and shows side-by-side columns", () => {
    const result = runXrplUp(
      ["amendment", "list", "--diff", "testnet"],
      {},
      60_000,
    );
    expect(result.status).toBe(0);
    // Diff view prints the target and diff network as column headers
    expect(result.stdout).toContain("local");
    expect(result.stdout).toContain("testnet");
  });

  it("accepts a raw WebSocket URL for --diff", () => {
    const result = runXrplUp(
      ["amendment", "list", "--diff", "wss://s.altnet.rippletest.net:51233"],
      {},
      60_000,
    );
    expect(result.status).toBe(0);
  });
});

describe("sandbox amendments match mainnet", () => {
  it("no mainnet-enabled amendment is missing from the configured set", () => {
    // Query the local node's feature list — it reports ALL amendments the
    // rippled build knows about, with enabled/supported status.
    // Amendments that are enabled on mainnet but missing from our config
    // would show as supported:true, enabled:false and NOT be in our config.
    //
    // We can't query mainnet directly in e2e tests (slow, flaky), so we
    // check the inverse: every amendment the local node reports as
    // supported:true should either be enabled:true (in our config) or be
    // a known legacy/non-mainnet amendment.

    const configuredNames = getConfiguredAmendmentNames();

    const result = runXrplUp(["amendment", "list"], {}, 30_000);
    expect(result.status).toBe(0);

    // Amendments that are built into rippled (always active, show enabled:false
    // in consensus mode). These are on mainnet but don't need [amendments] config.
    // Original 16, found and removed in 845d4e0 (rippled 3.1/3.2 curation).
    const LEGACY_BUILTIN = new Set([
      "Escrow", "PayChan", "CryptoConditions", "FlowCross", "MultiSign",
      "TickSize", "TrustSetAuth", "SortedDirectories", "EnforceInvariants",
      "FeeEscalation", "fix1373", "fix1201", "fix1512", "fix1528", "fix1523",
      "fix1368",
    ]);

    // Same phenomenon as LEGACY_BUILTIN above, found again during the rippled
    // 3.3.0 re-curation (see SPEC.md §5.6.1): these are on mainnet and fully
    // functional, but no longer force-enable at genesis on this rippled build,
    // so they were deliberately dropped from [amendments] rather than left in
    // as false advertising. Live-verified functional despite enabled:false:
    // `check create`, `escrow create`, `account set --set-flag depositAuth`
    // all succeeded on a fresh genesis where the corresponding amendment
    // showed disabled. Re-verify against LEGACY_BUILTIN's method (fresh
    // genesis + feature RPC diff) before adding to either set after a future
    // rippled upgrade — don't assume growth here is more of the same without
    // checking.
    const NO_LONGER_FORCE_ENABLES = new Set([
      "CheckCashMakesTrustLine", "Checks", "Clawback", "DeletableAccounts",
      "DepositAuth", "DepositPreauth", "DisallowIncoming", "ExpandedSignerList",
      "fix1513", "fix1515", "fix1543", "fix1571", "fix1578", "fix1623",
      "fix1781", "fixAmendmentMajorityCalc", "fixCheckThreading",
      "fixDisallowIncomingV1", "fixInnerObjTemplate", "fixMasterKeyAsRegularKey",
      "fixNFTokenRemint", "fixNFTokenReserve", "fixNonFungibleTokensV1_2",
      "fixPayChanRecipientOwnerDir", "fixQualityUpperBound",
      "fixReducedOffersV1", "fixRmSmallIncreasedQOffers",
      "fixSTAmountCanonicalize", "fixTakerDryOfferRemoval",
      "fixTrustLinesToSelf", "fixUniversalNumber", "Flow", "FlowSortStrands",
      "HardenedValidations", "ImmediateOfferKilled", "MultiSignReserve",
      "NegativeUNL", "NonFungibleTokensV1_1", "RequireFullyCanonicalSig",
      "TicketBatch",
    ]);

    // Amendments known to rippled but NOT on mainnet — ok to be disabled.
    const NOT_ON_MAINNET = new Set([
      "CryptoConditionsSuite", "NonFungibleTokensV1", "fixNFTokenDirV1",
      "fixNFTokenNegOffer", "fixXChainRewardRounding",
      "XChainBridge", "LendingProtocol", "SingleAssetVault",
      // New in rippled 3.3.0, 0% validator consensus as of 2026-08-11 — not
      // yet on mainnet. See https://data.xrpl.org/v1/network/amendments/vote/main.
      "BatchV1_1", "ConfidentialTransfer", "DynamicMPT", "fixCleanup3_3_0",
      "PermissionDelegationV1_1", "Sponsor",
    ]);

    // Parse all amendment lines from the output
    // Lines: "  <name-padded>  <hash…>  ✔/✗  ✔/✗"
    const lines = result.stdout.split("\n");
    const supportedButNotEnabled: string[] = [];

    for (const line of lines) {
      // Match lines with amendment data (contain a hash-like pattern)
      const m = line.match(/^\s+(\S+)\s+[0-9A-Fa-f]{12,}…?\s+([✔✗])\s+([✔✗])/);
      if (!m) continue;

      const [, name, enabledMark, supportedMark] = m;
      const isEnabled = enabledMark === "✔";
      const isSupported = supportedMark === "✔";

      if (isSupported && !isEnabled) {
        // This amendment is supported but not enabled.
        // It's a problem if it's not in our config AND not a known exception.
        if (
          !configuredNames.has(name) &&
          !LEGACY_BUILTIN.has(name) &&
          !NO_LONGER_FORCE_ENABLES.has(name) &&
          !NOT_ON_MAINNET.has(name)
        ) {
          supportedButNotEnabled.push(name);
        }
      }
    }

    expect(
      supportedButNotEnabled,
      `These amendments are supported by rippled but not in our config ` +
      `and not in the known exceptions list. If they are enabled on mainnet ` +
      `AND actually force-enable on a fresh genesis, add them to [amendments] ` +
      `in src/core/compose.ts. If they're on mainnet but no longer force-enable ` +
      `(verify per SPEC.md §5.6.1's method before assuming this), add them to ` +
      `NO_LONGER_FORCE_ENABLES. If not on mainnet at all, add them to ` +
      `NOT_ON_MAINNET.\n` +
      `Missing: ${supportedButNotEnabled.join(", ")}`,
    ).toEqual([]);
  });
});
