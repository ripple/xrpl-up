import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 4 tests: 3 need a funded wallet (1 wallet each), 1 uses a fresh unfunded address
// Total wallets: 3; +3 buffer = 6 tickets
// Budget: 6 × 0.2 + 3 × 3 = 1.2 + 9 = 10.2 ≤ 99 ✓
const TICKET_COUNT = 6;

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

describe("did get", () => {
  it.concurrent("returns decoded URI and raw hex data", async () => {
    const [owner] = await createFunded(client, master, 1, 3);

    // Set up a DID with URI and Data
    const setupResult = runCLI([
      "--node", XRPL_WS,
      "did", "set",
      "--uri", "https://example.com/did/get-test",
      "--data", "attestation-payload",
      "--seed", owner.seed!,
    ]);
    expect(setupResult.status, `setup: ${setupResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", XRPL_WS,
      "did", "get",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    // URI decoded from hex to UTF-8
    expect(result.stdout).toContain("https://example.com/did/get-test");
    // Data shown as raw hex
    const expectedDataHex = Buffer.from("attestation-payload").toString("hex");
    expect(result.stdout.toLowerCase()).toContain(expectedDataHex.toLowerCase());
  }, 90_000);

  it.concurrent("--json outputs raw ledger entry JSON", async () => {
    const [owner] = await createFunded(client, master, 1, 3);

    // Set up a DID
    const setupResult = runCLI([
      "--node", XRPL_WS,
      "did", "set",
      "--uri", "https://example.com/did/json-test",
      "--seed", owner.seed!,
    ]);
    expect(setupResult.status, `setup: ${setupResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", XRPL_WS,
      "did", "get",
      owner.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { LedgerEntryType?: string; URI?: string; Data?: string };
    expect(out.LedgerEntryType).toBe("DID");
    expect(typeof out.URI).toBe("string");
  }, 90_000);

  it.concurrent("returns not-found message for address with no DID", async () => {
    // Use a fresh wallet that has no DID — no funding needed, just need an address
    const fresh = Wallet.generate();
    const result = runCLI([
      "--node", XRPL_WS,
      "did", "get",
      fresh.address,
    ]);
    // Either 0 exit with "No DID found" or 1 with account not found error
    if (result.status === 0) {
      expect(result.stdout).toContain("No DID found");
    } else {
      expect(result.stderr).toMatch(/error/i);
    }
  }, 30_000);

  it.concurrent("--node option is accepted on did get", async () => {
    const [owner] = await createFunded(client, master, 1, 3);

    // Set up a DID
    const setupResult = runCLI([
      "--node", XRPL_WS,
      "did", "set",
      "--uri", "https://example.com/did/node-test",
      "--seed", owner.seed!,
    ]);
    expect(setupResult.status, `setup: ${setupResult.stderr}`).toBe(0);

    const result = runCLI([
      "--node", "wss://s.altnet.rippletest.net:51233",
      "did", "get",
      owner.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("https://example.com/did/node-test");
  }, 90_000);
});
