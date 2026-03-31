import { describe, it, expect } from "vitest";
import { resolveNodeUrl, TESTNET_URL, MAINNET_URL, DEVNET_URL } from "./client";

describe("resolveNodeUrl", () => {
  it("resolves 'mainnet' to mainnet URL", () => {
    expect(resolveNodeUrl("mainnet")).toBe(MAINNET_URL);
  });

  it("resolves 'testnet' to testnet URL", () => {
    expect(resolveNodeUrl("testnet")).toBe(TESTNET_URL);
  });

  it("resolves 'devnet' to devnet URL", () => {
    expect(resolveNodeUrl("devnet")).toBe(DEVNET_URL);
  });

  it("passes through a custom WebSocket URL unchanged", () => {
    const custom = "wss://custom.example.com:51233";
    expect(resolveNodeUrl(custom)).toBe(custom);
  });
});
