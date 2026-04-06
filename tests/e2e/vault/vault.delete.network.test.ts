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
  resilientRequestDevnet,
} from "../helpers/devnet";

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(DEVNET_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMasterDevnet(client);
  await initTicketPoolDevnet(client, master, 7);
  // Budget: 7 × 0.2 + 5 × 3 = 1.4 + 15 = 16.4 ≤ 99
}, 180_000);

afterAll(async () => {
  await client.disconnect();
});

/** Create a fresh XRP vault via CLI using the given wallet seed, return vault ID. */
function cliCreateVault(seed: string): string {
  const result = runCLI([
    "--node", "devnet",
    "vault", "create",
    "--asset", "0",
    "--seed", seed,
  ]);
  if (result.status !== 0) {
    throw new Error(`vault create failed: ${result.stderr}`);
  }
  const match = result.stdout.match(/Vault ID: ([0-9A-F]{64})/);
  if (!match) throw new Error(`no vault ID in output: ${result.stdout}`);
  return match[1];
}

it.concurrent("creates a vault then deletes it; outputs 'Deleted vault' and tesSUCCESS, verified gone via ledger_entry", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);

  const result = runCLI([
    "--node", "devnet",
    "vault", "delete",
    "--vault-id", vaultId,
    "--seed", wallet.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Deleted vault: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");

  // Verify vault is gone via ledger_entry RPC
  let gone = false;
  try {
    await resilientRequestDevnet(client, {
      command: "ledger_entry",
      index: vaultId,
      ledger_index: "validated",
    });
  } catch (e: unknown) {
    const errData = (e as { data?: { error?: string } }).data;
    if (errData?.error === "entryNotFound") {
      gone = true;
    } else {
      throw e;
    }
  }
  expect(gone, "vault should be gone from ledger after delete").toBe(true);
}, 120_000);

it.concurrent("--json outputs {result, vaultId, tx}", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);

  const result = runCLI([
    "--node", "devnet",
    "vault", "delete",
    "--vault-id", vaultId,
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

it.concurrent("--dry-run prints VaultDelete tx JSON without submitting (vault still exists after)", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);

  const result = runCLI([
    "--node", "devnet",
    "vault", "delete",
    "--vault-id", vaultId,
    "--seed", wallet.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as {
    tx_blob: string;
    tx: { TransactionType: string; VaultID: string };
  };
  expect(out.tx.TransactionType).toBe("VaultDelete");
  expect(out.tx.VaultID).toBe(vaultId);
  expect(typeof out.tx_blob).toBe("string");

  // Vault should still exist since dry-run did not submit
  let stillExists = false;
  try {
    await resilientRequestDevnet(client, {
      command: "ledger_entry",
      index: vaultId,
      ledger_index: "validated",
    });
    stillExists = true;
  } catch {
    stillExists = false;
  }
  expect(stillExists, "vault should still exist after dry-run").toBe(true);
}, 120_000);

it.concurrent("--no-wait submits without waiting and outputs Transaction hash", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);

  const result = runCLI([
    "--node", "devnet",
    "vault", "delete",
    "--vault-id", vaultId,
    "--seed", wallet.seed!,
    "--no-wait",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Transaction: [0-9A-Fa-f]{64}/);
}, 120_000);

it.concurrent("--account + --keystore + --password key material deletes successfully", async () => {
  const [wallet] = await createFundedDevnet(client, master, 1, 3);
  const vaultId = cliCreateVault(wallet.seed!);

  const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-vault-delete-test-"));
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
      "vault", "delete",
      "--vault-id", vaultId,
      "--account", wallet.address,
      "--keystore", tmpDir,
      "--password", "pw123",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Deleted vault: ${vaultId}`);
    expect(result.stdout).toContain("tesSUCCESS");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, 120_000);
