import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  resolveNetwork,
  isMainnet,
  looksLikeMainnetUrl,
} from "./config";

describe("resolveNetwork", () => {
  it("resolves 'testnet' from default config", () => {
    const result = resolveNetwork(DEFAULT_CONFIG, "testnet");
    expect(result.name).toBe("testnet");
    expect(result.config.url).toContain("altnet.rippletest.net");
  });

  it("resolves 'devnet' from default config", () => {
    const result = resolveNetwork(DEFAULT_CONFIG, "devnet");
    expect(result.name).toBe("devnet");
    expect(result.config.url).toContain("devnet.rippletest.net");
  });

  it("resolves 'local' from default config", () => {
    const result = resolveNetwork(DEFAULT_CONFIG, "local");
    expect(result.name).toBe("local");
    expect(result.config.url).toBe("ws://localhost:6006");
  });

  it("throws for unknown network name", () => {
    expect(() => resolveNetwork(DEFAULT_CONFIG, "mainnet")).toThrow("not found");
    expect(() => resolveNetwork(DEFAULT_CONFIG, "invalid-net")).toThrow("not found");
  });

  it("defaults to defaultNetwork when no name is given", () => {
    const result = resolveNetwork(DEFAULT_CONFIG);
    expect(result.name).toBe(DEFAULT_CONFIG.defaultNetwork);
  });
});

describe("isMainnet", () => {
  it("returns true for xrplcluster.com URL", () => {
    expect(isMainnet("custom", { url: "wss://xrplcluster.com" })).toBe(true);
  });

  it("returns true for s1.ripple.com URL", () => {
    expect(isMainnet("custom", { url: "wss://s1.ripple.com" })).toBe(true);
  });

  it("returns true for s2.ripple.com URL", () => {
    expect(isMainnet("custom", { url: "wss://s2.ripple.com" })).toBe(true);
  });

  it("returns false for testnet URL", () => {
    expect(isMainnet("testnet", { url: "wss://s.altnet.rippletest.net:51233" })).toBe(false);
  });

  it("returns false for devnet URL", () => {
    expect(isMainnet("devnet", { url: "wss://s.devnet.rippletest.net:51233" })).toBe(false);
  });

  it("returns false for local URL", () => {
    expect(isMainnet("local", { url: "ws://localhost:6006" })).toBe(false);
  });
});

describe("looksLikeMainnetUrl", () => {
  it("returns true for known production URLs", () => {
    expect(looksLikeMainnetUrl("wss://xrplcluster.com")).toBe(true);
    expect(looksLikeMainnetUrl("wss://s1.ripple.com")).toBe(true);
    expect(looksLikeMainnetUrl("wss://s2.ripple.com")).toBe(true);
  });

  it("returns false for testnet URL", () => {
    expect(looksLikeMainnetUrl("wss://s.altnet.rippletest.net:51233")).toBe(false);
  });

  it("returns false for devnet URL", () => {
    expect(looksLikeMainnetUrl("wss://s.devnet.rippletest.net:51233")).toBe(false);
  });

  it("returns false for local URL", () => {
    expect(looksLikeMainnetUrl("ws://localhost:6006")).toBe(false);
  });

  it("returns false for arbitrary custom URL", () => {
    expect(looksLikeMainnetUrl("wss://custom.example.com:51233")).toBe(false);
  });
});
