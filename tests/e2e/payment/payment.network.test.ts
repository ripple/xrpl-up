import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
  fundAddress,
} from "../helpers/fund";

// 11 tests × 2 wallets = 22 tickets (all run concurrently); +3 buffer = 25
// Budget: 25 × 0.2 + 22 × 3 XRP = 5 + 66 = 71 ≤ 99 ✓
const TICKET_COUNT = 25;

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

function getBalanceDrops(address: string): number {
  const result = runCLI(["--node", XRPL_WS, "account", "info", "--json", address]);
  const data = JSON.parse(result.stdout) as { Balance: string };
  return Number(data.Balance);
}

describe("payment network", () => {
  it.concurrent("sends 1 XRP between testnet accounts and prints tesSUCCESS", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const senderBefore = getBalanceDrops(sender.address);
    const receiverBefore = getBalanceDrops(receiver.address);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "1",
      "--seed", sender.seed!,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const senderAfter = getBalanceDrops(sender.address);
    const receiverAfter = getBalanceDrops(receiver.address);

    expect(senderBefore - senderAfter).toBeGreaterThanOrEqual(1_000_000);
    expect(receiverAfter - receiverBefore).toBe(1_000_000);
  }, 90_000);

  it.concurrent("alias 'send' works", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "send",
      "--to", receiver.address,
      "--amount", "0.5",
      "--seed", sender.seed!,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType Payment and does not submit", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const txsBefore = runCLI([
      "--node", XRPL_WS,
      "account", "transactions", "--json", "--limit", "5", sender.address,
    ]);
    expect(txsBefore.status).toBe(0);
    const countBefore = (JSON.parse(txsBefore.stdout) as { transactions: unknown[] }).transactions.length;

    const dryRunResult = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.1",
      "--seed", sender.seed!,
      "--dry-run",
    ]);
    expect(dryRunResult.status).toBe(0);
    const out = JSON.parse(dryRunResult.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("Payment");
    expect(typeof out.tx_blob).toBe("string");

    const txsAfter = runCLI([
      "--node", XRPL_WS,
      "account", "transactions", "--json", "--limit", "5", sender.address,
    ]);
    expect(txsAfter.status).toBe(0);
    expect((JSON.parse(txsAfter.stdout) as { transactions: unknown[] }).transactions.length).toBe(countBefore);
  }, 90_000);

  it.concurrent("--no-wait exits 0 and output contains a 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.5",
      "--seed", sender.seed!,
      "--no-wait",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--destination-tag sets DestinationTag on the submitted tx", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.5",
      "--seed", sender.seed!,
      "--destination-tag", "12345",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; destinationTag: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.destinationTag).toBe(12345);

    const txsResult = runCLI([
      "--node", XRPL_WS,
      "account", "transactions", "--json", "--limit", "5", sender.address,
    ]);
    expect(txsResult.status).toBe(0);
    const txsData = JSON.parse(txsResult.stdout) as { transactions: Array<{ tx_json?: { DestinationTag?: number } }> };
    const recentTx = txsData.transactions.find((t) => t.tx_json?.DestinationTag === 12345);
    expect(recentTx).toBeDefined();
  }, 90_000);

  it.concurrent("--memo attaches a Memos entry to the tx", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.5",
      "--seed", sender.seed!,
      "--memo", "hello",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; memos: unknown[] };
    expect(out.result).toBe("tesSUCCESS");
    expect(Array.isArray(out.memos)).toBe(true);
    expect(out.memos.length).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("--memo-type and --memo-format are included in dry-run tx Memos", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);
    const memoTypeHex = Buffer.from("text/plain").toString("hex").toUpperCase();
    const memoFormatHex = Buffer.from("text/plain").toString("hex").toUpperCase();

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.1",
      "--seed", sender.seed!,
      "--memo", "hello",
      "--memo-type", memoTypeHex,
      "--memo-format", memoFormatHex,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx: { Memos?: Array<{ Memo: { MemoData?: string; MemoType?: string; MemoFormat?: string } }> };
      tx_blob: string;
    };
    expect(Array.isArray(out.tx.Memos)).toBe(true);
    expect(typeof out.tx.Memos![0].Memo.MemoType).toBe("string");
    expect(out.tx.Memos![0].Memo.MemoType!.length).toBeGreaterThan(0);
    expect(typeof out.tx.Memos![0].Memo.MemoFormat).toBe("string");
    expect(out.tx.Memos![0].Memo.MemoFormat!.length).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("--mnemonic key material sends successfully", async () => {
    const testMnemonic = generateMnemonic(wordlist);
    const mnemonicWallet = Wallet.fromMnemonic(testMnemonic, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
    const [receiver] = await createFunded(client, master, 1, 3);
    await fundAddress(client, master, mnemonicWallet.address, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.5",
      "--mnemonic", testMnemonic,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--account + --keystore + --password key material sends successfully", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        sender.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `stdout: ${importResult.stdout} stderr: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", XRPL_WS,
        "payment",
        "--to", receiver.address,
        "--amount", "0.5",
        "--account", sender.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);

  it.concurrent("--no-ripple-direct sets tfNoRippleDirect bit in dry-run tx Flags", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.1",
      "--seed", sender.seed!,
      "--no-ripple-direct",
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { Flags?: number } };
    expect(out.tx.Flags).toBeDefined();
    // tfNoRippleDirect = 0x00010000 = 65536
    expect((out.tx.Flags! & 0x00010000)).not.toBe(0);
  }, 90_000);

  it.concurrent("--limit-quality sets tfLimitQuality bit in dry-run tx Flags", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.1",
      "--seed", sender.seed!,
      "--limit-quality",
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { Flags?: number } };
    expect(out.tx.Flags).toBeDefined();
    // tfLimitQuality = 0x00040000 = 262144
    expect((out.tx.Flags! & 0x00040000)).not.toBe(0);
  }, 90_000);

  it.concurrent("--amount with invalid format exits 1 and stderr contains 'invalid amount'", () => {
    // Validation test — uses static values, no network call
    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
      "--amount", "notanamount!!",
      "--seed", "snoPBrXtMeMyMHUVTgbuqAfg1SUTb",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid amount");
  });
});
