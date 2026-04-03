import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import type { AccountRoot } from "xrpl";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
  fundAddress,
} from "../helpers/fund";

// 12 tests concurrent with wallets (11 funded + 1 mnemonic via fundAddress); +3 buffer = 15
// Budget: 15 × 0.2 + 12 × 2 XRP = 3 + 24 = 27 ≤ 99 ✓
const TICKET_COUNT = 15;
const FUND_AMOUNT = 2;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

// ─── account set fields ───────────────────────────────────────────────────────

describe("account set fields", () => {
  it.concurrent("--email-hash sets EmailHash on-chain", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const emailHash = "AABBCCDDEEFF00112233445566778899";

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--email-hash", emailHash,
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    await new Promise((res) => setTimeout(res, 10_000));

    const infoResult = runCLI(["--node", XRPL_WS, "account", "info", "--json", wallet.address]);
    expect(infoResult.status, `stdout: ${infoResult.stdout} stderr: ${infoResult.stderr}`).toBe(0);
    const data = JSON.parse(infoResult.stdout) as AccountRoot;
    expect(data.EmailHash?.toUpperCase()).toBe(emailHash.toUpperCase());
  }, 90_000);

  it.concurrent("--transfer-rate sets TransferRate on-chain", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--transfer-rate", "1005000000",
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    await new Promise((res) => setTimeout(res, 10_000));

    const infoResult = runCLI(["--node", XRPL_WS, "account", "info", "--json", wallet.address]);
    expect(infoResult.status, `stdout: ${infoResult.stdout} stderr: ${infoResult.stderr}`).toBe(0);
    const data = JSON.parse(infoResult.stdout) as AccountRoot;
    expect(data.TransferRate).toBe(1005000000);
  }, 90_000);

  it.concurrent("--tick-size sets TickSize on-chain", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--tick-size", "5",
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    await new Promise((res) => setTimeout(res, 10_000));

    const infoResult = runCLI(["--node", XRPL_WS, "account", "info", "--json", wallet.address]);
    expect(infoResult.status, `stdout: ${infoResult.stdout} stderr: ${infoResult.stderr}`).toBe(0);
    const data = JSON.parse(infoResult.stdout) as AccountRoot;
    expect(data.TickSize).toBe(5);
  }, 90_000);
});

// ─── account set flags ────────────────────────────────────────────────────────

describe("account set flags", () => {
  it.concurrent("--set-flag defaultRipple sets lsfDefaultRipple bit on-chain", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--set-flag", "defaultRipple",
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    await new Promise((res) => setTimeout(res, 10_000));

    const infoResult = runCLI(["--node", XRPL_WS, "account", "info", "--json", wallet.address]);
    expect(infoResult.status, `stdout: ${infoResult.stdout} stderr: ${infoResult.stderr}`).toBe(0);
    const data = JSON.parse(infoResult.stdout) as AccountRoot;
    // lsfDefaultRipple = 0x00800000
    expect(data.Flags! & 0x00800000).not.toBe(0);
  }, 90_000);

  it.concurrent("--clear-flag defaultRipple clears lsfDefaultRipple bit on-chain", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--clear-flag", "defaultRipple",
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    await new Promise((res) => setTimeout(res, 10_000));

    const infoResult = runCLI(["--node", XRPL_WS, "account", "info", "--json", wallet.address]);
    expect(infoResult.status, `stdout: ${infoResult.stdout} stderr: ${infoResult.stderr}`).toBe(0);
    const data = JSON.parse(infoResult.stdout) as AccountRoot;
    // lsfDefaultRipple = 0x00800000 — should be cleared on a fresh wallet
    expect(data.Flags! & 0x00800000).toBe(0);
  }, 90_000);

  it.concurrent("--mnemonic key material submits AccountSet successfully", async () => {
    const mnemonic = generateMnemonic(wordlist);
    const mnemonicWallet = Wallet.fromMnemonic(mnemonic, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
    await fundAddress(client, master, mnemonicWallet.address, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--domain", "mnemonic.example.com",
      "--mnemonic", mnemonic,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Transaction submitted:/);
  }, 90_000);

  it.concurrent("--account + --keystore + --password submits AccountSet successfully", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        wallet.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `stdout: ${importResult.stdout} stderr: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", XRPL_WS,
        "account", "set",
        "--domain", "keystore.example.com",
        "--account", wallet.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toMatch(/Transaction submitted:/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});

// ─── account set clawback ─────────────────────────────────────────────────────

// lsfAllowTrustLineClawback = 0x80000000
const LSF_ALLOW_TRUST_LINE_CLAWBACK = 0x80000000;

describe("account set --allow-clawback", () => {
  it.concurrent("exits 1 with correct error message when --allow-clawback is used without --confirm", () => {
    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--allow-clawback",
      "--seed", "snoPBrXtMeMyMHUVTgbuqAfg1SUTb",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--allow-clawback is irreversible. Once enabled it cannot be disabled. To proceed, add --confirm to your command."
    );
  });

  it.concurrent("sets lsfAllowTrustLineClawback on-chain when --allow-clawback --confirm are both provided", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--allow-clawback",
      "--confirm",
      "--seed", wallet.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    await new Promise((res) => setTimeout(res, 10_000));

    const infoResult = runCLI(["--node", XRPL_WS, "account", "info", "--json", wallet.address]);
    expect(infoResult.status, `stdout: ${infoResult.stdout} stderr: ${infoResult.stderr}`).toBe(0);
    const data = JSON.parse(infoResult.stdout) as AccountRoot;
    expect(data.Flags! & LSF_ALLOW_TRUST_LINE_CLAWBACK).not.toBe(0);
  }, 90_000);
});

// ─── account set (domain + misc) ─────────────────────────────────────────────

describe("account set", () => {
  it.concurrent("sets domain and output contains transaction hash", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--seed", wallet.seed!,
      "--domain", "second.example.com",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Transaction submitted:");
    expect(result.stdout).toMatch(/Transaction submitted: [A-F0-9]+/i);
  }, 90_000);

  it.concurrent("--dry-run prints AccountSet JSON without submitting", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--seed", wallet.seed!,
      "--domain", "dryrun.example.com",
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as { TransactionType: string; Account: string; Domain: string };
    expect(tx.TransactionType).toBe("AccountSet");
    expect(tx.Account).toBe(wallet.address);
    expect(tx.Domain).toBe(
      Buffer.from("dryrun.example.com", "utf8").toString("hex").toUpperCase()
    );
  }, 90_000);

  it.concurrent("--json outputs hash, result, tx_blob", async () => {
    const [wallet] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--seed", wallet.seed!,
      "--set-flag", "requireDestTag",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { hash: string; result: string; tx_blob: string };
    expect(typeof data.hash).toBe("string");
    expect(data.hash.length).toBeGreaterThan(0);
    expect(typeof data.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("exits 1 when no key material provided", () => {
    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--domain", "example.com",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide key material");
  });

  it.concurrent("exits 1 when no setting fields provided", () => {
    const result = runCLI([
      "--node", XRPL_WS,
      "account", "set",
      "--seed", "snoPBrXtMeMyMHUVTgbuqAfg1SUTb",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: provide at least one setting");
  });
});
