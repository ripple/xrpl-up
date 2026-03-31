import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet, decodeAccountID } from "xrpl";
import type { MPTokenIssuanceCreate, MPTokenAuthorize } from "xrpl";
import { MPTokenIssuanceCreateFlags } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 7 tests and their wallet needs:
//   1. holder opts in                          → 1 issuer + 1 holder = 2
//   2. holder opts out                         → 1 issuer + 1 holder = 2
//   3. issuer authorizes holder (require-auth) → 1 issuer + 1 holder = 2
//   4. issuer revokes holder (require-auth)    → 1 issuer + 1 holder = 2
//   5. --json opt-in                           → 1 issuer + 1 holder = 2
//   6. --dry-run                               → 1 issuer + 1 holder = 2
//   7. --no-wait opt-in                        → 1 issuer + 1 holder = 2
// Total wallets: 14; +6 buffer = 20 tickets
// Budget: 20 × 0.2 + 14 × 3 = 4 + 42 = 46 ≤ 99 ✓
const TICKET_COUNT = 20;

let client: Client;
let master: Wallet;

beforeAll(async () => {
  client = new Client(XRPL_WS);
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

describe("mptoken authorize", () => {
  it.concurrent("holder opts in to an issuance via CLI", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer);
    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--seed", holder.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("holder opts out of an issuance via CLI (--unauthorize, balance is zero)", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer);
    // Pre-opt-in holder so they can opt out
    const optInTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: holder.address,
      MPTokenIssuanceID: issuanceId,
    });
    await client.submitAndWait(holder.sign(optInTx).tx_blob);

    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--unauthorize",
      "--seed", holder.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("issuer authorizes holder on require-auth issuance via CLI (--holder)", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer, MPTokenIssuanceCreateFlags.tfMPTRequireAuth);
    // Holder opts in first (required before issuer can authorize on require-auth)
    const optInTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: holder.address,
      MPTokenIssuanceID: issuanceId,
    });
    await client.submitAndWait(holder.sign(optInTx).tx_blob);

    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--holder", holder.address,
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("issuer revokes holder authorization on require-auth issuance (--holder --unauthorize)", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer, MPTokenIssuanceCreateFlags.tfMPTRequireAuth);
    // Holder opts in
    const optInTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: holder.address,
      MPTokenIssuanceID: issuanceId,
    });
    await client.submitAndWait(holder.sign(optInTx).tx_blob);
    // Issuer authorizes holder
    const authTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: issuer.address,
      MPTokenIssuanceID: issuanceId,
      Holder: holder.address,
    });
    await client.submitAndWait(issuer.sign(authTx).tx_blob);

    // Now revoke via CLI
    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--holder", holder.address,
      "--unauthorize",
      "--seed", issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer);
    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--seed", holder.seed!,
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

  it.concurrent("--dry-run outputs tx_blob and TransactionType MPTokenAuthorize without submitting", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer);
    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--seed", holder.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx.TransactionType).toBe("MPTokenAuthorize");
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting and outputs Transaction hash", async () => {
    const [issuer, holder] = await createFunded(client, master, 2, 3);
    const issuanceId = await createIssuance(issuer);
    const result = runCLI([
      "--node", "testnet",
      "mptoken", "authorize", issuanceId,
      "--seed", holder.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Transaction:");
  }, 90_000);
});
