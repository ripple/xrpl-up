import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import type { AccountSet as XrplAccountSet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 14 tests concurrent: 13×2 wallets + 1×1 wallet = 27 wallets; +3 buffer = 30
// Budget: 30 × 0.2 + 27 × 2 XRP = 6 + 54 = 60 ≤ 99 ✓ (credIssuer uses Wallet.generate() for some tests)
const TICKET_COUNT = 30;
const FUND_AMOUNT = 2;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

/**
 * Enable DepositAuth on a wallet using AccountSet SetFlag 9 (asfDepositAuth).
 */
async function enableDepositAuth(owner: Wallet): Promise<void> {
  const accountSetTx = await client.autofill({
    TransactionType: "AccountSet",
    Account: owner.address,
    SetFlag: 9, // asfDepositAuth
  } as XrplAccountSet);
  await client.submitAndWait(owner.sign(accountSetTx).tx_blob);
}

// ─── deposit-preauth set ──────────────────────────────────────────────────────

describe("deposit-preauth set", () => {
  it.concurrent("authorize an account succeeds", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("unauthorize an account succeeds (authorize then unauthorize)", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    // First authorize
    const authResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
    ]);
    expect(authResult.status, `auth: ${authResult.stderr}`).toBe(0);

    // Then unauthorize
    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--unauthorize", other.address,
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("authorize by credential succeeds", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize-credential", credIssuer.address,
      "--credential-type", "KYC",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("unauthorize by credential succeeds", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    // First authorize
    const authResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize-credential", credIssuer.address,
      "--credential-type", "KYC",
      "--seed", owner.seed!,
    ]);
    expect(authResult.status, `auth: ${authResult.stderr}`).toBe(0);

    // Then unauthorize
    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--unauthorize-credential", credIssuer.address,
      "--credential-type", "KYC",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("authorize with --credential-type-hex succeeds", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize-credential", credIssuer.address,
      "--credential-type-hex", "4B594332", // "KYC2"
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hash: string;
      result: string;
      fee: string;
      ledger: number;
    };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType DepositPreauth and does not submit", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("DepositPreauth");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 90_000);

  it.concurrent("--account + --keystore + --password key material authorizes successfully", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        owner.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", "testnet",
        "deposit-preauth", "set",
        "--authorize", other.address,
        "--account", owner.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});

// ─── deposit-preauth list ─────────────────────────────────────────────────────

describe("deposit-preauth list", () => {
  it.concurrent("shows 'No deposit preauthorizations.' for account with none", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "list",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("No deposit preauthorizations.");
  }, 90_000);

  it.concurrent("shows authorized account after authorize", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const setResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
    ]);
    expect(setResult.status, `set: ${setResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "list",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Account: ${other.address}`);
  }, 90_000);

  it.concurrent("shows credential preauth after authorize-credential", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const setResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize-credential", credIssuer.address,
      "--credential-type", "KYC",
      "--seed", owner.seed!,
    ]);
    expect(setResult.status, `set: ${setResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "list",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Credential: ${credIssuer.address} / KYC`);
  }, 90_000);

  it.concurrent("no longer shows account after unauthorize", async () => {
    const [owner, other] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    // Authorize
    const authResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize", other.address,
      "--seed", owner.seed!,
    ]);
    expect(authResult.status, `auth: ${authResult.stderr}`).toBe(0);

    // Unauthorize
    const unsetResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--unauthorize", other.address,
      "--seed", owner.seed!,
    ]);
    expect(unsetResult.status, `unset: ${unsetResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "list",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).not.toContain(`Account: ${other.address}`);
  }, 90_000);

  it.concurrent("--json outputs array of raw objects including credential preauth", async () => {
    const [owner, credIssuer] = await createFunded(client, master, 2, FUND_AMOUNT);
    await enableDepositAuth(owner);

    const setResult = runCLI([
      "--node", "testnet",
      "deposit-preauth", "set",
      "--authorize-credential", credIssuer.address,
      "--credential-type", "KYC",
      "--seed", owner.seed!,
    ]);
    expect(setResult.status, `set: ${setResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "testnet",
      "deposit-preauth", "list",
      owner.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const entries = JSON.parse(result.stdout) as Array<{
      LedgerEntryType: string;
      AuthorizeCredentials?: Array<{ Credential: { Issuer: string; CredentialType: string } }>;
    }>;
    expect(Array.isArray(entries)).toBe(true);
    const credEntry = entries.find(
      (e) =>
        e.LedgerEntryType === "DepositPreauth" &&
        e.AuthorizeCredentials !== undefined &&
        e.AuthorizeCredentials[0]?.Credential.Issuer === credIssuer.address
    );
    expect(credEntry, "credential preauth entry missing from JSON output").toBeDefined();
  }, 90_000);
});
