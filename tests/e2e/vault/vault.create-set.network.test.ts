import { it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import {
  DEVNET_WS,
  fundMasterDevnet,
  initTicketPoolDevnet,
  createFundedDevnet,
} from "../helpers/devnet";

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(DEVNET_WS);
  await client.connect();
  master = await fundMasterDevnet(client);
  await initTicketPoolDevnet(client, master, 15);
  // Budget: 15 × 0.2 + 13 × 3 = 3 + 39 = 42 ≤ 99
}, 180_000);

afterAll(async () => {
  await client.disconnect();
});

/** Create a vault via CLI using the given wallet seed, return vault ID. */
function cliCreateVault(seed: string): string {
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--seed", seed,
  ]);
  if (result.status !== 0) throw new Error(`vault create failed: ${result.stderr}`);
  const match = result.stdout.match(/Vault ID: ([0-9A-F]{64})/);
  if (!match) throw new Error(`no vault ID in output: ${result.stdout}`);
  return match[1];
}

// ── vault create ──────────────────────────────────────────────────────────────

it.concurrent("create: creates an XRP vault and outputs Vault ID", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Vault ID: [0-9A-F]{64}/);
  expect(result.stdout).toContain("tesSUCCESS");
}, 90_000);

it.concurrent("create: --assets-maximum appears in dry-run tx", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--assets-maximum", "1000000000",
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; AssetsMaximum: string } };
  expect(out.tx.TransactionType).toBe("VaultCreate");
  expect(out.tx.AssetsMaximum).toBe("1000000000");
}, 60_000);

it.concurrent("create: --json outputs {result, vaultId, tx}", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--seed", wallet.seed!,
    "--json",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { result: string; vaultId: string; tx: string };
  expect(out.result).toBe("success");
  expect(typeof out.vaultId).toBe("string");
  expect(out.vaultId).toHaveLength(64);
  expect(typeof out.tx).toBe("string");
  expect(out.tx).toHaveLength(64);
}, 90_000);

it.concurrent("create: --dry-run outputs JSON with TransactionType VaultCreate and does not submit", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string; Asset: unknown } };
  expect(out.tx.TransactionType).toBe("VaultCreate");
  expect(typeof out.tx_blob).toBe("string");
  expect(out.tx.Asset).toBeDefined();
}, 60_000);

it.concurrent("create: --no-wait submits without waiting and outputs Transaction hash", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--seed", wallet.seed!,
    "--no-wait",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Transaction: [0-9A-Fa-f]{64}/);
}, 60_000);

it.concurrent("create: --non-transferable flag appears in dry-run tx flags", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--non-transferable",
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as { tx: { Flags?: number; TransactionType: string } };
  expect(out.tx.TransactionType).toBe("VaultCreate");
  // tfVaultShareNonTransferable = 131072
  expect((out.tx.Flags ?? 0) & 131072).toBe(131072);
}, 60_000);

it.concurrent("create: --account + --keystore + --password key material creates successfully", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-vault-test-keystore-"));
  try {
    const importResult = runCLI([
      "wallet", "import",
      wallet.seed!,
      "--password", "pw123",
      "--keystore", tmpDir,
    ]);
    expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "devnet",
      "vault", "create",
      "--asset", "0",
      "--account", wallet.address,
      "--keystore", tmpDir,
      "--password", "pw123",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Vault ID: [0-9A-F]{64}/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, 90_000);

// ── vault set ─────────────────────────────────────────────────────────────────

it.concurrent("set: updates --data on an existing vault", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);
  const result = runCLI([
    "--node", "devnet",
    "vault", "set",
    "--vault-id", vaultId,
    "--data", "DEADBEEF",
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 120_000);

it.concurrent("set: updates --assets-maximum on an existing vault", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);
  const result = runCLI([
    "--node", "devnet",
    "vault", "set",
    "--vault-id", vaultId,
    "--assets-maximum", "500000000",
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 120_000);

it.concurrent("set: --json outputs {result, vaultId, tx}", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);
  const result = runCLI([
    "--node", "devnet",
    "vault", "set",
    "--vault-id", vaultId,
    "--data", "CAFEBABE",
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

it.concurrent("set: --dry-run prints VaultSet tx JSON without submitting", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);
  const result = runCLI([
    "--node", "devnet",
    "vault", "set",
    "--vault-id", vaultId,
    "--data", "AABB",
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as {
    tx_blob: string;
    tx: { TransactionType: string; VaultID: string; Data: string };
  };
  expect(out.tx.TransactionType).toBe("VaultSet");
  expect(out.tx.VaultID).toBe(vaultId);
  expect(out.tx.Data).toBe("AABB");
  expect(typeof out.tx_blob).toBe("string");
}, 90_000);

it.concurrent("set: --no-wait submits without waiting and outputs Transaction hash", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);
  const result = runCLI([
    "--node", "devnet",
    "vault", "set",
    "--vault-id", vaultId,
    "--assets-maximum", "999999999",
    "--seed", wallet.seed!,
    "--no-wait",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Transaction: [0-9A-Fa-f]{64}/);
}, 90_000);

it.concurrent("set: --account + --keystore + --password key material updates successfully", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);
  const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-vault-set-test-"));
  try {
    const importResult = runCLI([
      "wallet", "import",
      wallet.seed!,
      "--password", "pw456",
      "--keystore", tmpDir,
    ]);
    expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "devnet",
      "vault", "set",
      "--vault-id", vaultId,
      "--data", "FF00FF",
      "--account", wallet.address,
      "--keystore", tmpDir,
      "--password", "pw456",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, 120_000);
