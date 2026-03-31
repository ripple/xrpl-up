import { it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet, xrpToDrops } from "xrpl";
import type { AccountSet, TrustSet, Payment as XrplPayment, VaultCreate, VaultDeposit } from "xrpl";
import { AccountSetAsfFlags } from "xrpl";
import {
  DEVNET_WS,
  fundMasterDevnet,
  initTicketPoolDevnet,
  createFundedDevnet,
} from "../helpers/devnet";

const CURRENCY = "VCB";
// One fresh holder per test case — prevents state bleed from prior clawbacks
const N_HOLDERS = 6;

let client: Client;
let master: Wallet;
let issuer: Wallet;
let holders: Wallet[];
let vaultId: string;

/** Deposit IOU into vault directly via xrpl.js (setup helper, not under test) */
async function holderDeposit(holder: Wallet, amountStr: string): Promise<void> {
  const tx: VaultDeposit = await client.autofill({
    TransactionType: "VaultDeposit",
    Account: holder.address,
    VaultID: vaultId,
    Amount: { value: amountStr, currency: CURRENCY, issuer: issuer.address },
  });
  await client.submitAndWait(holder.sign(tx).tx_blob);
}

beforeAll(async () => {
  client = new Client(DEVNET_WS);
  await client.connect();

  master = await fundMasterDevnet(client); // 1 faucet call

  // 8 tickets: 1 for issuer (10 XRP) + 6 for holders (3 XRP each) + 1 buffer
  // Budget: 8 × 0.2 + 1 × 10 + 6 × 3 = 1.6 + 10 + 18 = 29.6 ≤ 99
  await initTicketPoolDevnet(client, master, 8);

  // Fund issuer via master using a ticket
  [issuer] = await createFundedDevnet(client, master, 1, 10);

  // Enable DefaultRipple on issuer — required for IOU vault creation on devnet
  const defaultRippleTx: AccountSet = await client.autofill({
    TransactionType: "AccountSet",
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  });
  await client.submitAndWait(issuer.sign(defaultRippleTx).tx_blob);

  // Enable AllowTrustLineClawback on issuer BEFORE any trust lines are created.
  // Required for VaultClawback to succeed on IOU vaults.
  const clawbackFlagTx: AccountSet = await client.autofill({
    TransactionType: "AccountSet",
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfAllowTrustLineClawback,
  });
  await client.submitAndWait(issuer.sign(clawbackFlagTx).tx_blob);

  // Create IOU vault
  const vaultCreateTx: VaultCreate = await client.autofill({
    TransactionType: "VaultCreate",
    Account: issuer.address,
    Asset: { currency: CURRENCY, issuer: issuer.address },
    Fee: "200000",
  });
  const vaultCreateResult = await client.submitAndWait(issuer.sign(vaultCreateTx).tx_blob);

  const txResult = vaultCreateResult.result as {
    meta?: {
      AffectedNodes?: Array<{
        CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string };
      }>;
    };
  };
  const vaultNode = txResult.meta?.AffectedNodes?.find(
    (n) => n.CreatedNode?.LedgerEntryType === "Vault"
  );
  vaultId = vaultNode?.CreatedNode?.LedgerIndex ?? "";
  if (!vaultId) throw new Error("Failed to extract VaultID from VaultCreate metadata");

  // Create N_HOLDERS fresh holder wallets via master tickets, then set up trust lines
  // and issue VCB sequentially to avoid issuer sequence conflicts.
  holders = [];
  for (let i = 0; i < N_HOLDERS; i++) {
    // Fund holder from master using a ticket (concurrent-safe)
    const [holder] = await createFundedDevnet(client, master, 1, 3);
    holders.push(holder);

    // Holder creates trust line to issuer
    const trustTx: TrustSet = await client.autofill({
      TransactionType: "TrustSet",
      Account: holder.address,
      LimitAmount: { currency: CURRENCY, issuer: issuer.address, value: "10000" },
    });
    await client.submitAndWait(holder.sign(trustTx).tx_blob);

    // Issuer issues 100 VCB to holder (sequential to avoid issuer seq conflicts)
    const issueTx: XrplPayment = await client.autofill({
      TransactionType: "Payment",
      Account: issuer.address,
      Destination: holder.address,
      Amount: { currency: CURRENCY, issuer: issuer.address, value: "100" },
    });
    await client.submitAndWait(issuer.sign(issueTx).tx_blob);
  }
}, 600_000);

afterAll(async () => {
  await client.disconnect();
});

it.concurrent("full clawback: holder deposits IOU, issuer claws back all (explicit amount)", async () => {
  const holder = holders[0];
  await holderDeposit(holder, "10");

  const result = runCLI([
    "--node", "devnet",
    "vault", "clawback",
    "--vault-id", vaultId,
    "--holder", holder.address,
    "--amount", `10/${CURRENCY}/${issuer.address}`,
    "--seed", issuer.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain(`Holder:   ${holder.address}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 90_000);

it.concurrent("partial clawback with --amount", async () => {
  const holder = holders[1];
  await holderDeposit(holder, "10");

  const result = runCLI([
    "--node", "devnet",
    "vault", "clawback",
    "--vault-id", vaultId,
    "--holder", holder.address,
    "--amount", `5/${CURRENCY}/${issuer.address}`,
    "--seed", issuer.seed!,
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
  expect(result.stdout).toContain("tesSUCCESS");
}, 120_000);

it.concurrent("--json outputs {result, vaultId, holder, tx}", async () => {
  const holder = holders[2];
  await holderDeposit(holder, "10");

  const result = runCLI([
    "--node", "devnet",
    "vault", "clawback",
    "--vault-id", vaultId,
    "--holder", holder.address,
    "--amount", `10/${CURRENCY}/${issuer.address}`,
    "--seed", issuer.seed!,
    "--json",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as {
    result: string;
    vaultId: string;
    holder: string;
    tx: string;
  };
  expect(out.result).toBe("success");
  expect(out.vaultId).toBe(vaultId);
  expect(out.holder).toBe(holder.address);
  expect(typeof out.tx).toBe("string");
  expect(out.tx).toHaveLength(64);
}, 90_000);

it.concurrent("--dry-run prints VaultClawback tx JSON without submitting", async () => {
  const holder = holders[3];
  await holderDeposit(holder, "10");

  const result = runCLI([
    "--node", "devnet",
    "vault", "clawback",
    "--vault-id", vaultId,
    "--holder", holder.address,
    "--seed", issuer.seed!,
    "--dry-run",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout) as {
    tx_blob: string;
    tx: { TransactionType: string; VaultID: string; Holder: string };
  };
  expect(out.tx.TransactionType).toBe("VaultClawback");
  expect(out.tx.VaultID).toBe(vaultId);
  expect(out.tx.Holder).toBe(holder.address);
  expect(typeof out.tx_blob).toBe("string");
}, 90_000);

it.concurrent("--no-wait submits without waiting and outputs Transaction hash", async () => {
  const holder = holders[4];
  await holderDeposit(holder, "10");

  const result = runCLI([
    "--node", "devnet",
    "vault", "clawback",
    "--vault-id", vaultId,
    "--holder", holder.address,
    "--seed", issuer.seed!,
    "--no-wait",
  ]);
  expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toMatch(/Transaction: [0-9A-Fa-f]{64}/);
}, 60_000);

it.concurrent("--account + --keystore + --password key material claws back successfully", async () => {
  const holder = holders[5];
  await holderDeposit(holder, "10");

  const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-vault-clawback-test-"));
  try {
    const importResult = runCLI([
      "wallet", "import",
      issuer.seed!,
      "--password", "pw456",
      "--keystore", tmpDir,
    ]);
    expect(importResult.status, `import: ${importResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "devnet",
      "vault", "clawback",
      "--vault-id", vaultId,
      "--holder", holder.address,
      "--amount", `10/${CURRENCY}/${issuer.address}`,
      "--account", issuer.address,
      "--keystore", tmpDir,
      "--password", "pw456",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Vault ID: ${vaultId}`);
    expect(result.stdout).toContain("tesSUCCESS");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, 90_000);
