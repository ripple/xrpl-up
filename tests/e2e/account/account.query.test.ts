import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { XRPL_WS } from "../helpers/fund";

// All query tests use a well-known funded testnet address — no faucet call needed.
const KNOWN_TESTNET_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

// ─── account info ─────────────────────────────────────────────────────────────

describe("account info", () => {
  it.concurrent("returns account data with --node testnet flag", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "info", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Address:");
    expect(result.stdout).toContain("Balance:");
    expect(result.stdout).toContain("Sequence:");
    expect(result.stdout).toContain("Owner Count:");
    expect(result.stdout).toContain("Reserve:");
    expect(result.stdout).toContain("Flags:");
  });

  it.concurrent("returns account data using XRPL_NODE env var", () => {
    const result = runCLI(["account", "info", KNOWN_TESTNET_ADDRESS], {
      XRPL_NODE: "testnet",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Address:");
    expect(result.stdout).toContain("Balance:");
  });

  it.concurrent("--json outputs Account and Balance fields", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "info", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { Account: string; Balance: string };
    expect(data.Account).toBe(KNOWN_TESTNET_ADDRESS);
    expect(typeof data.Balance).toBe("string");
  });

  it.concurrent("alias 'i' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "i", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Address:");
  });
});

// ─── account balance ──────────────────────────────────────────────────────────

describe("account balance", () => {
  it.concurrent("outputs balance in XRP format", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "balance", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+(\.\d+)? XRP$/);
  });

  it.concurrent("alias 'bal' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "bal", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+(\.\d+)? XRP$/);
  });

  it.concurrent("--drops outputs a plain integer string with no 'XRP' suffix", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "balance", "--drops", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const output = result.stdout.trim();
    expect(output).toMatch(/^\d+$/);
    expect(output).not.toContain("XRP");
  });

  it.concurrent("--json outputs address, balanceXrp, and balanceDrops fields", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "balance", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { address: string; balanceXrp: number; balanceDrops: string };
    expect(data.address).toBe(KNOWN_TESTNET_ADDRESS);
    expect(typeof data.balanceXrp).toBe("number");
    expect(typeof data.balanceDrops).toBe("string");
    expect(data.balanceDrops).toMatch(/^\d+$/);
  });
});

// ─── account transactions ─────────────────────────────────────────────────────

describe("account transactions", () => {
  it.concurrent("lists transactions for an account with history", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "transactions", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).not.toBe("(no transactions)");
    // Each line should match: ledger  type  result  hash (4 space-separated columns)
    expect(lines[0]).toMatch(/^\d+\s+\S+\s+\S+\s+\S+$/);
  });

  it.concurrent("alias 'txs' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "txs", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
  });

  it.concurrent("--limit restricts number of results", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "transactions", "--limit", "3", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it.concurrent("--json outputs transactions array and optional marker", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "transactions", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { transactions: unknown[]; marker?: unknown };
    expect(Array.isArray(data.transactions)).toBe(true);
    expect(data.transactions.length).toBeGreaterThan(0);
  });
});

// ─── account trust-lines ──────────────────────────────────────────────────────

describe("account trust-lines", () => {
  it.concurrent("shows (no trust lines) or a list for a testnet account", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "trust-lines", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    if (stdout === "(no trust lines)") {
      expect(stdout).toBe("(no trust lines)");
    } else {
      const lines = stdout.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/\w+\/r\w+\s+balance:/);
      }
    }
  });

  it.concurrent("alias 'lines' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "lines", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
  });

  it.concurrent("--json outputs an array", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "trust-lines", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── account offers ───────────────────────────────────────────────────────────

describe("account offers", () => {
  it.concurrent("shows (no open offers) or a list for a testnet account", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "offers", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    if (stdout === "(no open offers)") {
      expect(stdout).toBe("(no open offers)");
    } else {
      const lines = stdout.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it.concurrent("alias 'of' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "of", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
  });

  it.concurrent("--json outputs an array", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "offers", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── account channels ─────────────────────────────────────────────────────────

describe("account channels", () => {
  it.concurrent("shows (no payment channels) or a list for a testnet account", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "channels", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    if (stdout === "(no payment channels)") {
      expect(stdout).toBe("(no payment channels)");
    } else {
      const lines = stdout.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/dest:\s+r\w+\s+amount:/);
      }
    }
  });

  it.concurrent("alias 'chan' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "chan", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
  });

  it.concurrent("--json outputs an array", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "channels", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── account nfts ─────────────────────────────────────────────────────────────

describe("account nfts", () => {
  it.concurrent("shows (no NFTs) or a list for a testnet account", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "nfts", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    if (stdout === "(no NFTs)") {
      expect(stdout).toBe("(no NFTs)");
    } else {
      const lines = stdout.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/taxon:\s+\d+\s+serial:\s+\d+/);
      }
    }
  });

  it.concurrent("alias 'nft' works", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "nft", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
  });

  it.concurrent("--json outputs an array", () => {
    const result = runCLI(["--node", XRPL_WS, "account", "nfts", "--json", KNOWN_TESTNET_ADDRESS]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});
