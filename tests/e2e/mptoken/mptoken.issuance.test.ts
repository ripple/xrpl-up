import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet, decodeAccountID } from "xrpl";
import type { MPTokenIssuanceCreate, MPTokenIssuanceSet, MPTokenAuthorize } from "xrpl";
import { MPTokenIssuanceCreateFlags, MPTokenIssuanceSetFlags } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// Tests and their wallet needs:
//   1. creates an issuance with --flags can-lock           → 1 issuer
//   2. locks issuance globally                             → 1 issuer
//   3. unlocks issuance globally                           → 1 issuer
//   4. locks per-holder balance                            → 1 issuer + 1 holder = 2
//   5. unlocks per-holder balance (--json)                 → 1 issuer + 1 holder = 2
//   6. issuance set --dry-run                              → 1 issuer
//   7. issuance set --no-wait                              → 1 issuer
//   8. destroys an issuance                                → 1 issuer
//   9. issuance destroy --json                             → 1 issuer
//  10. issuance destroy --dry-run                          → 1 issuer
//  11. issuance destroy --no-wait                          → 1 issuer
// Total wallets: 11 + 2 (for tests 4+5 extra holder) = 13; +5 buffer = 18 tickets
// Budget: 18 × 0.2 + 13 × 3 = 3.6 + 39 = 42.6 ≤ 99 ✓
const TICKET_COUNT = 18;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS, { timeout: 60_000 });
  await client.connect();
  master = await fundMaster(client);
  await initTicketPool(client, master, TICKET_COUNT);
}, 300_000);

afterAll(async () => {
  await client.disconnect();
});

/**
 * Create an MPTokenIssuance via xrpl.js directly and return its MPTokenIssuanceID.
 * MPTokenIssuanceID = Sequence (4 bytes BE) + AccountID (20 bytes) = 48 hex chars.
 */
async function createIssuance(
  wallet: Wallet,
  flags?: number,
): Promise<string> {
  const tx: MPTokenIssuanceCreate = await client.autofill({
    TransactionType: "MPTokenIssuanceCreate",
    Account: wallet.address,
    ...(flags !== undefined ? { Flags: flags } : {}),
  });
  const result = await client.submitAndWait(wallet.sign(tx).tx_blob);
  const txJson = result.result.tx_json as { Sequence: number; Account: string };
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeUInt32BE(txJson.Sequence, 0);
  return Buffer.concat([seqBuf, Buffer.from(decodeAccountID(txJson.Account))])
    .toString("hex")
    .toUpperCase();
}

describe("mptoken issuance destroy and set", () => {
  it.concurrent("creates an issuance with --flags can-lock via CLI", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--flags", "can-lock",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    const idMatch = result.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID in output").toBeTruthy();
  }, 120_000);

  it.concurrent("locks issuance globally via issuance set --lock", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const issuanceId = await createIssuance(issuer, MPTokenIssuanceCreateFlags.tfMPTCanLock);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "set", issuanceId,
      "--lock",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("unlocks issuance globally via issuance set --unlock", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const issuanceId = await createIssuance(issuer, MPTokenIssuanceCreateFlags.tfMPTCanLock);
    // Lock first, then unlock
    const lockTx: MPTokenIssuanceSet = await client.autofill({
      TransactionType: "MPTokenIssuanceSet",
      Account: issuer.address,
      MPTokenIssuanceID: issuanceId,
      Flags: MPTokenIssuanceSetFlags.tfMPTLock,
    });
    await client.submitAndWait(issuer.sign(lockTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "set", issuanceId,
      "--unlock",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("locks per-holder balance via issuance set --lock --holder", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(
      issuer,
      MPTokenIssuanceCreateFlags.tfMPTCanLock | MPTokenIssuanceCreateFlags.tfMPTCanTransfer,
    );
    // Holder opts in
    const authTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: holder.address,
      MPTokenIssuanceID: issuanceId,
    });
    await client.submitAndWait(holder.sign(authTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "set", issuanceId,
      "--lock", "--holder", holder.address,
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("unlocks per-holder balance via issuance set --unlock --holder (--json)", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(
      issuer,
      MPTokenIssuanceCreateFlags.tfMPTCanLock | MPTokenIssuanceCreateFlags.tfMPTCanTransfer,
    );
    // Holder opts in
    const authTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: holder.address,
      MPTokenIssuanceID: issuanceId,
    });
    await client.submitAndWait(holder.sign(authTx).tx_blob);
    // Lock first so unlock has something to do
    const lockTx: MPTokenIssuanceSet = await client.autofill({
      TransactionType: "MPTokenIssuanceSet",
      Account: issuer.address,
      MPTokenIssuanceID: issuanceId,
      Holder: holder.address,
      Flags: MPTokenIssuanceSetFlags.tfMPTLock,
    });
    await client.submitAndWait(issuer.sign(lockTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "set", issuanceId,
      "--unlock", "--holder", holder.address,
      "--seed", issuer.seed!,
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
  }, 120_000);

  it.concurrent("issuance set --dry-run outputs TransactionType MPTokenIssuanceSet without submitting", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const issuanceId = await createIssuance(issuer, MPTokenIssuanceCreateFlags.tfMPTCanLock);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "set", issuanceId,
      "--lock",
      "--seed", issuer.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; Flags: number };
    };
    expect(out.tx.TransactionType).toBe("MPTokenIssuanceSet");
    expect(typeof out.tx_blob).toBe("string");
  }, 120_000);

  it.concurrent("issuance set --no-wait submits without waiting and outputs Transaction hash", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const issuanceId = await createIssuance(issuer, MPTokenIssuanceCreateFlags.tfMPTCanLock);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "set", issuanceId,
      "--lock",
      "--seed", issuer.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 120_000);

  it.concurrent("destroys an issuance via issuance destroy", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    // Create a fresh issuance to destroy (no outstanding MPT, safe to delete)
    const createResult = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `stdout: ${createResult.stdout} stderr: ${createResult.stderr}`).toBe(0);
    const idMatch = createResult.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID").toBeTruthy();
    const destroyIssuanceId = idMatch![1]!;

    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "destroy", destroyIssuanceId,
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("issuance destroy --json outputs hash, result, fee, ledger", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `stdout: ${createResult.stdout} stderr: ${createResult.stderr}`).toBe(0);
    const idMatch = createResult.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID").toBeTruthy();
    const destroyIssuanceId = idMatch![1]!;

    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "destroy", destroyIssuanceId,
      "--seed", issuer.seed!,
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
  }, 120_000);

  it.concurrent("issuance destroy --dry-run outputs TransactionType MPTokenIssuanceDestroy without submitting", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    // Create an issuance to use for dry-run (dry-run doesn't actually destroy)
    const issuanceId = await createIssuance(issuer);
    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "destroy", issuanceId,
      "--seed", issuer.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx.TransactionType).toBe("MPTokenIssuanceDestroy");
    expect(typeof out.tx_blob).toBe("string");
  }, 120_000);

  it.concurrent("issuance destroy --no-wait submits without waiting and outputs Transaction hash", async () => {
    const [issuer] = await createFunded(client, master, 1, 3);
    const createResult = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "create",
      "--seed", issuer.seed!,
    ]);
    expect(createResult.status, `stdout: ${createResult.stdout} stderr: ${createResult.stderr}`).toBe(0);
    const idMatch = createResult.stdout.match(/MPTokenIssuanceID:\s+([0-9A-Fa-f]+)/);
    expect(idMatch, "Expected MPTokenIssuanceID").toBeTruthy();
    const destroyIssuanceId = idMatch![1]!;

    const result = runCLI([
      "--node", XRPL_WS,
      "mptoken", "issuance", "destroy", destroyIssuanceId,
      "--seed", issuer.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 120_000);
});
