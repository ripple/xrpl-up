import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 11 tests × 1 wallet each = 11 wallets; +4 buffer = 15 tickets
// Budget: 15 × 0.2 + 11 × 3 = 3 + 33 = 36 ≤ 99 ✓
const TICKET_COUNT = 15;

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

describe("did set", () => {
  it.concurrent("creates DID with --uri succeeds", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/1",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("creates DID with --data succeeds", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--data", "attestation-data",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("updates existing DID URI", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    // First set
    const first = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/first",
      "--seed", owner.seed!,
    ]);
    expect(first.status, `first: ${first.stderr}`).toBe(0);
    // Then update
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/updated",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("clears URI field with --clear-uri", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    // Set both URI and data so the DID is not empty after clearing URI
    const setResult = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/to-clear",
      "--data", "keep-this",
      "--seed", owner.seed!,
    ]);
    expect(setResult.status, `set: ${setResult.stderr}`).toBe(0);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--clear-uri",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--uri '' empty string clears URI (equivalent to --clear-uri)", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    // Set both URI and data so the DID is not empty after clearing URI
    runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/tmp",
      "--data", "keep-this",
      "--seed", owner.seed!,
    ]);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/json",
      "--json",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hash: string;
      result: string;
      fee: string;
      ledger: number;
    };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 90_000);

  it.concurrent("--dry-run prints tx_blob and tx without submitting", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/dry",
      "--dry-run",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; URI?: string };
    };
    expect(out.tx.TransactionType).toBe("DIDSet");
    expect(typeof out.tx_blob).toBe("string");
    // URI should be hex-encoded
    const expectedHex = Buffer.from("https://example.com/did/dry").toString("hex").toUpperCase();
    expect(out.tx.URI?.toUpperCase()).toBe(expectedHex);
  }, 90_000);

  it.concurrent("--no-wait exits 0 with a hash", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri", "https://example.com/did/nowait",
      "--no-wait",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--uri-hex sets URI as raw hex without re-encoding", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const uriHex = Buffer.from("https://example.com/did/hex").toString("hex");
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--uri-hex", uriHex,
      "--dry-run",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { URI?: string } };
    expect(out.tx.URI?.toLowerCase()).toBe(uriHex.toLowerCase());
  }, 90_000);

  it.concurrent("--data-hex sets Data as raw hex without re-encoding", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const dataHex = Buffer.from("some-attestation").toString("hex");
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--data-hex", dataHex,
      "--dry-run",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Data?: string } };
    expect(out.tx.Data?.toLowerCase()).toBe(dataHex.toLowerCase());
  }, 90_000);

  it.concurrent("--did-document sets DIDDocument hex-encoded", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const doc = '{"@context":"https://www.w3.org/ns/did/v1"}';
    const result = runCLI([
      "--node", "testnet",
      "did", "set",
      "--did-document", doc,
      "--dry-run",
      "--seed", owner.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { DIDDocument?: string } };
    const expectedHex = Buffer.from(doc).toString("hex").toUpperCase();
    expect(out.tx.DIDDocument?.toUpperCase()).toBe(expectedHex);
  }, 90_000);

  it.concurrent("--account + --keystore + --password key material succeeds", async () => {
    const [owner] = await createFunded(client, master, 1, 3);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-did-"));
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
        "did", "set",
        "--uri", "https://example.com/did/account",
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
