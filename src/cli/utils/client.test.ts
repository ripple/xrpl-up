import { describe, it, expect } from "vitest";
import { resolveNodeUrl, TESTNET_URL, DEVNET_URL, shouldBlockMainnet } from "./client";

describe("resolveNodeUrl", () => {
  it("resolves 'testnet' to testnet URL", () => {
    expect(resolveNodeUrl("testnet")).toBe(TESTNET_URL);
  });

  it("resolves 'devnet' to devnet URL", () => {
    expect(resolveNodeUrl("devnet")).toBe(DEVNET_URL);
  });

  it("resolves 'local' to localhost URL", () => {
    expect(resolveNodeUrl("local")).toBe("ws://localhost:6006");
  });

  it("passes through a custom WebSocket URL unchanged", () => {
    const custom = "wss://custom.example.com:51233";
    expect(resolveNodeUrl(custom)).toBe(custom);
  });

  it("passes through 'mainnet' as a raw string (not a named network)", () => {
    expect(resolveNodeUrl("mainnet")).toBe("mainnet");
  });
});

describe("shouldBlockMainnet", () => {
  it("blocks networkID 0 (mainnet) on a non-local connection, unconditionally", () => {
    expect(shouldBlockMainnet(0, false)).toBe(true);
  });

  it("does not block networkID 0 on a local connection", () => {
    expect(shouldBlockMainnet(0, true)).toBe(false);
  });

  it("does not block a non-mainnet networkID (e.g. testnet/devnet)", () => {
    expect(shouldBlockMainnet(1, false)).toBe(false);
    expect(shouldBlockMainnet(2, false)).toBe(false);
  });

  it("does not block when networkID is undefined (unknown — can't tell, don't guess)", () => {
    expect(shouldBlockMainnet(undefined, false)).toBe(false);
  });
});
