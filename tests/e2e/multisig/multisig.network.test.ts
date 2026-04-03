import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 12 tests concurrent × 1 funded owner each = 12 wallets; +2 buffer = 14
// Budget: 14 × 0.2 + 12 × 3 XRP = 2.8 + 36 = 38.8 ≤ 99 ✓ (signer wallets generated, not funded)
const TICKET_COUNT = 14;
// 3 XRP per owner: 1 base reserve + 0.2 for signer list + fees.
const FUND_AMOUNT = 3;

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

// ---------------------------------------------------------------------------
// multisig set
// ---------------------------------------------------------------------------
describe("multisig set", () => {
  it.concurrent("sets a 2-of-3 signer list and verifies via multisig list", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();
    const signer2 = Wallet.generate();
    const signer3 = Wallet.generate();

    const setResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "2",
      "--signer",
      `${signer1.address}:1`,
      "--signer",
      `${signer2.address}:1`,
      "--signer",
      `${signer3.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(
      setResult.status,
      `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`,
    ).toBe(0);
    expect(setResult.stdout).toContain("tesSUCCESS");

    const listResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "list",
      owner.address,
    ]);
    expect(
      listResult.status,
      `stdout: ${listResult.stdout} stderr: ${listResult.stderr}`,
    ).toBe(0);
    expect(listResult.stdout).toContain("Quorum: 2");
    expect(listResult.stdout).toContain(signer1.address);
    expect(listResult.stdout).toContain(signer2.address);
    expect(listResult.stdout).toContain(signer3.address);
    expect(listResult.stdout).toContain("weight: 1");
  }, 90_000);

  it.concurrent("updates the signer list (replace 2-of-3 with 2-of-2)", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();
    const signer2 = Wallet.generate();
    const signer3 = Wallet.generate();

    // Set initial 2-of-3
    const set1 = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "2",
      "--signer",
      `${signer1.address}:1`,
      "--signer",
      `${signer2.address}:1`,
      "--signer",
      `${signer3.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(set1.status, `stdout: ${set1.stdout} stderr: ${set1.stderr}`).toBe(0);

    // Update to 2-of-2
    const set2 = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "2",
      "--signer",
      `${signer1.address}:1`,
      "--signer",
      `${signer2.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(set2.status, `stdout: ${set2.stdout} stderr: ${set2.stderr}`).toBe(0);
    expect(set2.stdout).toContain("tesSUCCESS");

    const listResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "list",
      owner.address,
    ]);
    expect(listResult.stdout).toContain("Quorum: 2");
    expect(listResult.stdout).toContain(signer1.address);
    expect(listResult.stdout).toContain(signer2.address);
    expect(listResult.stdout).not.toContain(signer3.address);
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "1",
      "--signer",
      `${signer1.address}:1`,
      "--seed",
      owner.seed!,
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

  it.concurrent("--dry-run outputs JSON with TransactionType SignerListSet and does not submit", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "1",
      "--signer",
      `${signer1.address}:1`,
      "--seed",
      owner.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx.TransactionType).toBe("SignerListSet");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "1",
      "--signer",
      `${signer1.address}:1`,
      "--seed",
      owner.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 90_000);
});

// ---------------------------------------------------------------------------
// multisig list
// ---------------------------------------------------------------------------
describe("multisig list", () => {
  it.concurrent("shows correct quorum and signers with correct weights", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();
    const signer2 = Wallet.generate();
    const signer3 = Wallet.generate();

    const setResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "4",
      "--signer",
      `${signer1.address}:2`,
      "--signer",
      `${signer2.address}:3`,
      "--signer",
      `${signer3.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(
      setResult.status,
      `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`,
    ).toBe(0);

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "list",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Quorum: 4");
    expect(result.stdout).toContain(signer1.address);
    expect(result.stdout).toContain(signer2.address);
    expect(result.stdout).toContain(signer3.address);
    expect(result.stdout).toContain("weight: 2");
    expect(result.stdout).toContain("weight: 3");
    expect(result.stdout).toContain("weight: 1");
  }, 90_000);

  it.concurrent("--json outputs raw JSON array with SignerQuorum and SignerEntries", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();
    const signer2 = Wallet.generate();
    const signer3 = Wallet.generate();

    const setResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "4",
      "--signer",
      `${signer1.address}:2`,
      "--signer",
      `${signer2.address}:3`,
      "--signer",
      `${signer3.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(
      setResult.status,
      `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`,
    ).toBe(0);

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "list",
      owner.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as Array<{
      LedgerEntryType: string;
      SignerQuorum: number;
      SignerEntries: Array<{
        SignerEntry: { Account: string; SignerWeight: number };
      }>;
    }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
    expect(out[0].LedgerEntryType).toBe("SignerList");
    expect(out[0].SignerQuorum).toBe(4);
    expect(out[0].SignerEntries).toHaveLength(3);
    const accounts = out[0].SignerEntries.map((e) => e.SignerEntry.Account);
    expect(accounts).toContain(signer1.address);
    expect(accounts).toContain(signer2.address);
    expect(accounts).toContain(signer3.address);
  }, 90_000);

  it.concurrent("shows 'No signer list configured.' for account with no signer list", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "list",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("No signer list configured.");
  }, 90_000);
});

// ---------------------------------------------------------------------------
// multisig delete
// ---------------------------------------------------------------------------
describe("multisig delete", () => {
  it.concurrent("sets then deletes a signer list; list shows no signer list after deletion", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();
    const signer2 = Wallet.generate();

    const setResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "1",
      "--signer",
      `${signer1.address}:1`,
      "--signer",
      `${signer2.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(
      setResult.status,
      `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`,
    ).toBe(0);
    expect(setResult.stdout).toContain("tesSUCCESS");

    const deleteResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "delete",
      "--seed",
      owner.seed!,
    ]);
    expect(
      deleteResult.status,
      `stdout: ${deleteResult.stdout} stderr: ${deleteResult.stderr}`,
    ).toBe(0);
    expect(deleteResult.stdout).toContain("tesSUCCESS");

    const listResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "list",
      owner.address,
    ]);
    expect(
      listResult.status,
      `stdout: ${listResult.stdout} stderr: ${listResult.stderr}`,
    ).toBe(0);
    expect(listResult.stdout).toContain("No signer list configured.");
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();

    const setResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "1",
      "--signer",
      `${signer1.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(
      setResult.status,
      `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`,
    ).toBe(0);

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "delete",
      "--seed",
      owner.seed!,
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

  it.concurrent("--dry-run outputs signed tx JSON with TransactionType SignerListSet and does not submit", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "delete",
      "--seed",
      owner.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; SignerQuorum: number };
    };
    expect(out.tx.TransactionType).toBe("SignerListSet");
    expect(out.tx.SignerQuorum).toBe(0);
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [owner] = await createFunded(client, master, 1, FUND_AMOUNT);
    const signer1 = Wallet.generate();

    const setResult = runCLI([
      "--node",
      "testnet",
      "multisig",
      "set",
      "--quorum",
      "1",
      "--signer",
      `${signer1.address}:1`,
      "--seed",
      owner.seed!,
    ]);
    expect(
      setResult.status,
      `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`,
    ).toBe(0);

    const result = runCLI([
      "--node",
      "testnet",
      "multisig",
      "delete",
      "--seed",
      owner.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 90_000);
});
