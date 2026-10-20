import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// compose.ts resolves ~/.xrpl-up from os.homedir() at import time, so point HOME
// at a temp dir and re-import per test.
let home: string;
let dir: string;
const origHome = process.env.HOME;

async function load() {
  vi.resetModules();
  return import("../../src/core/compose");
}

function composeWith(services: string[]): string {
  return `name: xrpl-up-local\nservices:\n${services.map((s) => `  ${s}:\n    image: x\n`).join("")}  faucet:\n    image: y\n`;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "xrpl-up-test-"));
  dir = path.join(home, ".xrpl-up");
  fs.mkdirSync(dir, { recursive: true });
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("readConsensusNodeCount", () => {
  it("defaults to 3 when there is no record and no compose file", async () => {
    const { readConsensusNodeCount } = await load();
    expect(readConsensusNodeCount()).toBe(3);
  });

  it("returns the recorded count", async () => {
    fs.writeFileSync(path.join(dir, "local-network-nodes.txt"), "5");
    const { readConsensusNodeCount } = await load();
    expect(readConsensusNodeCount()).toBe(5);
  });

  it("counts node services in an existing compose file when there is no record (legacy 2-node sandbox)", async () => {
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), composeWith(["rippled", "rippled-peer"]));
    const { readConsensusNodeCount } = await load();
    expect(readConsensusNodeCount()).toBe(2);
  });

  it("counts rippled-node{N} services", async () => {
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      composeWith(["rippled", "rippled-peer", "rippled-node3", "rippled-node4"]),
    );
    const { readConsensusNodeCount } = await load();
    expect(readConsensusNodeCount()).toBe(4);
  });

  it("ignores a standalone compose file (single rippled service)", async () => {
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), composeWith(["rippled"]));
    const { readConsensusNodeCount } = await load();
    expect(readConsensusNodeCount()).toBe(3);
  });

  it("ignores an out-of-range record", async () => {
    fs.writeFileSync(path.join(dir, "local-network-nodes.txt"), "9");
    const { readConsensusNodeCount } = await load();
    expect(readConsensusNodeCount()).toBe(3);
  });
});

describe("logs service alias", () => {
  it("maps node<N> to the compose service name", async () => {
    vi.resetModules();
    const { resolveService } = await import("../../src/commands/logs");
    expect(resolveService("node1")).toBe("rippled");
    expect(resolveService("node2")).toBe("rippled-peer");
    expect(resolveService("node3")).toBe("rippled-node3");
    expect(resolveService("NODE5")).toBe("rippled-node5");
  });

  it("rejects out-of-range node numbers", async () => {
    vi.resetModules();
    const { resolveService } = await import("../../src/commands/logs");
    expect(resolveService("node0")).toBeNull();
    expect(resolveService("node6")).toBeNull();
  });

  it("passes other service names through", async () => {
    vi.resetModules();
    const { resolveService } = await import("../../src/commands/logs");
    expect(resolveService("faucet")).toBe("faucet");
  });
});
