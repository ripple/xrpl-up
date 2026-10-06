/**
 * Sandbox lifecycle — amendment list command tests.
 *
 * Requires the local rippled stack to be running (started by globalSetup).
 * All tests are read-only — no amendments are enabled or disabled.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { Client } from "xrpl";
import { runXrplUp } from "../../helpers/sandbox-cli";

/** Names of the amendments xrpl-up force-enables at genesis (generated per xrpld build). */
function getConfiguredAmendmentNames(): Set<string> {
  const file = path.resolve(process.cwd(), "src/core/default-amendments.json");
  const { amendments } = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    amendments: { name: string }[];
  };
  return new Set(amendments.map((a) => a.name));
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
    // The list is derived per xrpld build, so only sanity-check that it is
    // non-trivial rather than pinning an exact count.
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

describe("sandbox default amendments", () => {
  it("every default amendment is enabled on the local node", async () => {
    // default-amendments.json is derived for this exact xrpld build (mainnet-enabled,
    // supported, not Obsolete — see scripts/generate-default-amendments.ts), so
    // each entry must actually have activated at genesis. This is the check
    // that the [amendments] stanza took effect.
    const { amendments } = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "src/core/default-amendments.json"), "utf-8"),
    ) as { amendments: { hash: string; name: string }[] };

    const client = new Client("ws://localhost:6006");
    await client.connect();
    try {
      const { result } = (await client.request({ command: "feature" } as never)) as unknown as {
        result: { features: Record<string, { enabled?: boolean }> };
      };
      const byHash = new Map(Object.entries(result.features).map(([h, f]) => [h.toUpperCase(), f]));
      const notEnabled = amendments.filter((a) => !byHash.get(a.hash.toUpperCase())?.enabled).map((a) => a.name);
      expect(notEnabled, `default amendments that did not activate: ${notEnabled.join(", ")}`).toEqual([]);
    } finally {
      await client.disconnect();
    }
  });
});
