import { it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import type { VaultCreate, VaultDeposit } from "xrpl";
import {
  DEVNET_WS,
  fundMasterDevnet,
  initTicketPoolDevnet,
  createFundedDevnet,
} from "../helpers/devnet";

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(DEVNET_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMasterDevnet(client);
  await initTicketPoolDevnet(client, master, 13);
  // Budget: 13 × 0.2 + 11 × 5 = 2.6 + 55 = 57.6 ≤ 99
}, 180_000);

afterAll(async () => {
  await client.disconnect();
});

/** Create an XRP vault via xrpl.js directly (setup only, not under test). Returns vaultId. */
async function xrplCreateVault(wallet: Wallet): Promise<string> {
  const tx: VaultCreate = await client.autofill({
    TransactionType: "VaultCreate",
    Account: wallet.address,
    Asset: { currency: "XRP" },
    Fee: "200000",
  });
  const result = await client.submitAndWait(wallet.sign(tx).tx_blob);
  const meta = result.result.meta as {
    AffectedNodes?: Array<{
      CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string };
    }>;
  };
  const vaultNode = meta?.AffectedNodes?.find(
    (n) => n.CreatedNode?.LedgerEntryType === "Vault"
  );
  const vaultId = vaultNode?.CreatedNode?.LedgerIndex ?? "";
  if (!vaultId) throw new Error("Failed to extract VaultID from VaultCreate metadata");
  return vaultId;
}

/** Deposit XRP into vault via xrpl.js directly (setup only, not under test). */
async function xrplDeposit(wallet: Wallet, vaultId: string, amountXrp: string): Promise<void> {
  const tx: VaultDeposit = await client.autofill({
    TransactionType: "VaultDeposit",
    Account: wallet.address,
    VaultID: vaultId,
    Amount: (BigInt(Math.round(parseFloat(amountXrp) * 1_000_000))).toString(),
  });
  await client.submitAndWait(wallet.sign(tx).tx_blob);
}

// ── vault deposit ─────────────────────────────────────────────────────────────

it.concurrent("deposit: XRP into a vault and outputs Vault ID", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  const result = runCLI([
    "--node", "devnet",
    "vault", "deposit",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 120_000);

it.concurrent("deposit: --json outputs {result, vaultId, tx}", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  const result = runCLI([
    "--node", "devnet",
    "vault", "deposit",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
    "--json",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { result: string; vaultId: string; tx: string };
  expect(out.result).toBe("success");
  expect(out.vaultId).toBe(vaultId);
  expect(typeof out.tx).toBe("string");
  expect(out.tx).toHaveLength(64);
}, 120_000);

it.concurrent("deposit: --dry-run prints VaultDeposit tx JSON without submitting", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  const result = runCLI([
    "--node", "devnet",
    "vault", "deposit",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as {
    tx_blob: string;
    tx: { TransactionType: string; VaultID: string; Amount: string };
  };
  expect(out.tx.TransactionType).toBe("VaultDeposit");
  expect(out.tx.VaultID).toBe(vaultId);
  expect(typeof out.tx_blob).toBe("string");
  expect(out.tx.Amount).toBeDefined();
}, 60_000);

it.concurrent("deposit: --no-wait submits without waiting and outputs Transaction hash", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  const result = runCLI([
    "--node", "devnet",
    "vault", "deposit",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
    "--no-wait",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Transaction: [0-9A-Fa-f]{64}/);
}, 60_000);

it.concurrent("deposit: --account + --keystore + --password key material deposits successfully", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-vault-deposit-test-"));
  try {
    const importResult = runCLI([
      "wallet", "import",
      wallet.seed!,
      "--password", "pw789",
      "--keystore", tmpDir,
    ]);
    expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "devnet",
      "vault", "deposit",
      "--vault-id", vaultId,
      "--amount", "1",
      "--account", wallet.address,
      "--keystore", tmpDir,
      "--password", "pw789",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
    expect(result.stdout).toContain("tesSUCCESS");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, 120_000);

// ── vault withdraw ────────────────────────────────────────────────────────────

it.concurrent("withdraw: deposits XRP then withdraws, outputs Vault ID and tesSUCCESS", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  await xrplDeposit(wallet, vaultId, "2");
  const result = runCLI([
    "--node", "devnet",
    "vault", "withdraw",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 120_000);

it.concurrent("withdraw: --destination sends redeemed assets to a different account", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  await xrplDeposit(wallet, vaultId, "2");

  // Fund a receiver via direct xrpl.js payment so it exists on ledger
  const receiver = Wallet.generate();
  await client.submitAndWait(
    {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: receiver.address,
      Amount: "1000000", // 1 XRP
    },
    { wallet }
  );

  const result = runCLI([
    "--node", "devnet",
    "vault", "withdraw",
    "--vault-id", vaultId,
    "--amount", "1",
    "--destination", receiver.address,
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 120_000);

it.concurrent("withdraw: --json outputs {result, vaultId, tx}", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  await xrplDeposit(wallet, vaultId, "2");
  const result = runCLI([
    "--node", "devnet",
    "vault", "withdraw",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
    "--json",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { result: string; vaultId: string; tx: string };
  expect(out.result).toBe("success");
  expect(out.vaultId).toBe(vaultId);
  expect(typeof out.tx).toBe("string");
  expect(out.tx).toHaveLength(64);
}, 120_000);

it.concurrent("withdraw: --dry-run prints VaultWithdraw tx JSON without submitting", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  const result = runCLI([
    "--node", "devnet",
    "vault", "withdraw",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as {
    tx_blob: string;
    tx: { TransactionType: string; VaultID: string; Amount: string };
  };
  expect(out.tx.TransactionType).toBe("VaultWithdraw");
  expect(out.tx.VaultID).toBe(vaultId);
  expect(typeof out.tx_blob).toBe("string");
  expect(out.tx.Amount).toBeDefined();
}, 60_000);

it.concurrent("withdraw: --no-wait submits without waiting and outputs Transaction hash", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  await xrplDeposit(wallet, vaultId, "2");
  const result = runCLI([
    "--node", "devnet",
    "vault", "withdraw",
    "--vault-id", vaultId,
    "--amount", "1",
    "--seed", wallet.seed!,
    "--no-wait",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Transaction: [0-9A-Fa-f]{64}/);
}, 120_000);

it.concurrent("withdraw: --account + --keystore + --password key material withdraws successfully", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 5);
  const vaultId = await xrplCreateVault(wallet);
  await xrplDeposit(wallet, vaultId, "2");
  const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-vault-withdraw-test-"));
  try {
    const importResult = runCLI([
      "wallet", "import",
      wallet.seed!,
      "--password", "pw789",
      "--keystore", tmpDir,
    ]);
    expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "devnet",
      "vault", "withdraw",
      "--vault-id", vaultId,
      "--amount", "1",
      "--account", wallet.address,
      "--keystore", tmpDir,
      "--password", "pw789",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
    expect(result.stdout).toContain("tesSUCCESS");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, 120_000);
