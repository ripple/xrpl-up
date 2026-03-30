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

// Dummy check ID for --dry-run tests (autofill does not validate CheckID existence)
const DUMMY_CHECK_ID =
  "49647F0D748DC3FE26BDACBC57F251AADEFFF391403EC9BF87C97F67E9977FB0";

// Budget: 38 tickets × 0.2 = 7.6 XRP; 34 funded wallets × 2 XRP = 68 XRP; total 75.6 ≤ 99 ✓
// CheckCreate requires destination to exist on ledger (tecNO_DST otherwise),
// so submit tests need 2 funded wallets (sender + receiver).
const TICKET_COUNT = 38;
// 2 XRP per wallet: 1 XRP base reserve + enough for check reserve (0.2) + fees.
const FUND_AMOUNT = 2;

let client: Client;
let master: Wallet;

function futureIso(secondsAhead = 300): string {
  return new Date(Date.now() + secondsAhead * 1000).toISOString();
}

/**
 * Create a check via CLI and return its checkId.
 * Uses --json to extract the checkId from the response.
 */
function createCheck(
  senderSeed: string,
  receiverAddress: string,
  sendMax = "1",
): string {
  const result = runCLI([
    "--node",
    "testnet",
    "check",
    "create",
    "--to",
    receiverAddress,
    "--send-max",
    sendMax,
    "--seed",
    senderSeed,
    "--json",
  ]);
  if (result.status !== 0) {
    throw new Error(`check create failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as { checkId: string }).checkId;
}

beforeAll(async () => {
  client = new Client(XRPL_WS);
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 120_000);

afterAll(async () => {
  await client.disconnect();
});

// ---------------------------------------------------------------------------
// check create
// ---------------------------------------------------------------------------
describe("check create", () => {
  it.concurrent("creates an XRP check and prints tesSUCCESS + Check ID", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--seed",
      sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toMatch(/CheckId:\s+[0-9A-Fa-f]{64}/i);
  }, 90_000);

  it.concurrent("--expiration appears in dry-run tx", async () => {
    const [sender] = await createFunded(client, master, 1, FUND_AMOUNT);
    const receiver = Wallet.generate();
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--expiration",
      futureIso(600),
      "--seed",
      sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx: { TransactionType: string; Expiration?: number };
    };
    expect(out.tx.TransactionType).toBe("CheckCreate");
    expect(typeof out.tx.Expiration).toBe("number");
  }, 90_000);

  it.concurrent("--destination-tag appears in dry-run tx", async () => {
    const [sender] = await createFunded(client, master, 1, FUND_AMOUNT);
    const receiver = Wallet.generate();
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--destination-tag",
      "42",
      "--seed",
      sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { DestinationTag?: number } };
    expect(out.tx.DestinationTag).toBe(42);
  }, 90_000);

  it.concurrent("--invoice-id is hex-encoded in dry-run tx", async () => {
    const [sender] = await createFunded(client, master, 1, FUND_AMOUNT);
    const receiver = Wallet.generate();
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--invoice-id",
      "order-123",
      "--seed",
      sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { InvoiceID?: string } };
    expect(typeof out.tx.InvoiceID).toBe("string");
    expect(out.tx.InvoiceID).toHaveLength(64);
    expect(out.tx.InvoiceID!.toLowerCase()).toMatch(/^6f726465722d313233/);
  }, 90_000);

  it.concurrent("--json output includes hash, result, checkId fields", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--seed",
      sender.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hash: string;
      result: string;
      checkId: string;
    };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
    expect(typeof out.checkId).toBe("string");
    expect(out.checkId).toHaveLength(64);
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType CheckCreate and does not submit", async () => {
    const [sender] = await createFunded(client, master, 1, FUND_AMOUNT);
    const receiver = Wallet.generate();
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--seed",
      sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx.TransactionType).toBe("CheckCreate");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait exits 0 and output contains 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "create",
      "--to",
      receiver.address,
      "--send-max",
      "1",
      "--seed",
      sender.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--account + --keystore + --password key material creates successfully", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet",
        "import",
        sender.seed!,
        "--password",
        "pw123",
        "--keystore",
        tmpDir,
      ]);
      expect(
        importResult.status,
        `stdout: ${importResult.stdout} stderr: ${importResult.stderr}`,
      ).toBe(0);

      const result = runCLI([
        "--node",
        "testnet",
        "check",
        "create",
        "--to",
        receiver.address,
        "--send-max",
        "1",
        "--account",
        sender.address,
        "--keystore",
        tmpDir,
        "--password",
        "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// check cash
// ---------------------------------------------------------------------------
describe("check cash", () => {
  it.concurrent("cashes an XRP check with --amount", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cash",
      "--check",
      checkId,
      "--amount",
      "0.5",
      "--seed",
      receiver.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("cashes an XRP check with --deliver-min", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cash",
      "--check",
      checkId,
      "--deliver-min",
      "0.3",
      "--seed",
      receiver.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json output includes hash and result fields", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cash",
      "--check",
      checkId,
      "--amount",
      "0.5",
      "--seed",
      receiver.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
  }, 90_000);

  it.concurrent("--dry-run outputs signed tx with TransactionType CheckCash without submitting", async () => {
    const [receiver] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cash",
      "--check",
      DUMMY_CHECK_ID,
      "--amount",
      "0.5",
      "--seed",
      receiver.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx.TransactionType).toBe("CheckCash");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait exits 0 and outputs a 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cash",
      "--check",
      checkId,
      "--amount",
      "0.5",
      "--seed",
      receiver.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// check cancel
// ---------------------------------------------------------------------------
describe("check cancel", () => {
  it.concurrent("sender cancels own check", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cancel",
      "--check",
      checkId,
      "--seed",
      sender.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json output includes hash and result fields", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cancel",
      "--check",
      checkId,
      "--seed",
      sender.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toHaveLength(64);
  }, 90_000);

  it.concurrent("--dry-run outputs signed tx with TransactionType CheckCancel without submitting", async () => {
    const [sender] = await createFunded(client, master, 1, FUND_AMOUNT);
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cancel",
      "--check",
      DUMMY_CHECK_ID,
      "--seed",
      sender.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx.TransactionType).toBe("CheckCancel");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait exits 0 and outputs a 64-char hex hash", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cancel",
      "--check",
      checkId,
      "--seed",
      sender.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("receiver can cancel a check sent to them", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "cancel",
      "--check",
      checkId,
      "--seed",
      receiver.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);
});

// ---------------------------------------------------------------------------
// check list
// ---------------------------------------------------------------------------
describe("check list", () => {
  it.concurrent("lists checks for an account and includes the created check ID", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "list",
      sender.address,
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(checkId);
    expect(result.stdout).toContain("CheckID:");
    expect(result.stdout).toContain("SendMax:");
    expect(result.stdout).toContain("Destination:");
  }, 90_000);

  it.concurrent("--json outputs a JSON array containing the created check", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, FUND_AMOUNT);
    const checkId = createCheck(sender.seed!, receiver.address, "1");
    const result = runCLI([
      "--node",
      "testnet",
      "check",
      "list",
      sender.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const checks = JSON.parse(result.stdout) as Array<{
      checkId: string;
      sendMax: string;
      destination: string;
    }>;
    expect(Array.isArray(checks)).toBe(true);
    const found = checks.find((c) => c.checkId === checkId);
    expect(found).toBeDefined();
    expect(found!.destination).toBe(receiver.address);
    expect(found!.sendMax).toContain("XRP");
  }, 90_000);
});
