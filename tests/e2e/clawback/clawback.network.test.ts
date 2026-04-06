import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet, xrpToDrops, decodeAccountID } from "xrpl";
import type {
  AccountSet,
  TrustSet,
  MPTokenIssuanceCreate,
  MPTokenAuthorize,
  Payment as XrplPayment,
} from "xrpl";
import { AccountSetAsfFlags, MPTokenIssuanceCreateFlags } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// Dummy MPT issuance ID for --dry-run (4-byte seq + 20-byte account = 48 hex chars)
const DUMMY_MPT_ID = "00000001AABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD";

// 7 tests concurrent: IOU(4): 3×2+1×1=7 wallets; MPT(3): 2×2+1×1=5 wallets; total 12 wallets
// Budget: 14 × 0.2 + 12 × 5 XRP = 2.8 + 60 = 62.8 ≤ 99 ✓
const TICKET_COUNT = 14;
// 5 XRP per wallet: covers base reserve (1) + trust line / MPT auth reserves (0.2 each) + fees.
const FUND_AMOUNT = 5;
const IOU_CURRENCY = "CBK";

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

/**
 * Set up IOU clawback state for one test:
 *   1. Enable AllowTrustLineClawback on issuer
 *   2. Holder creates trust line to issuer
 *   3. Issuer sends `amount` tokens to holder
 * Returns fresh [issuer, holder] wallets.
 */
async function setupIouClawback(
  tokenAmount = "100",
): Promise<[Wallet, Wallet]> {
  const [issuer, holder] = await createFunded(client, master, 2, FUND_AMOUNT);

  // Enable clawback on issuer
  const setTx: AccountSet = await client.autofill({
    TransactionType: "AccountSet",
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfAllowTrustLineClawback,
  });
  await client.submitAndWait(issuer.sign(setTx).tx_blob);

  // Holder creates trust line to issuer
  const trustTx: TrustSet = await client.autofill({
    TransactionType: "TrustSet",
    Account: holder.address,
    LimitAmount: {
      currency: IOU_CURRENCY,
      issuer: issuer.address,
      value: "10000",
    },
  });
  await client.submitAndWait(holder.sign(trustTx).tx_blob);

  // Issuer sends tokens to holder
  const issueTx: XrplPayment = await client.autofill({
    TransactionType: "Payment",
    Account: issuer.address,
    Destination: holder.address,
    Amount: {
      currency: IOU_CURRENCY,
      issuer: issuer.address,
      value: tokenAmount,
    },
  });
  await client.submitAndWait(issuer.sign(issueTx).tx_blob);

  return [issuer, holder];
}

/**
 * Set up MPT clawback state for one test:
 *   1. Create MPT issuance with CanTransfer + CanClawback flags
 *   2. Holder opts in (MPTokenAuthorize)
 *   3. Issuer sends `amount` MPT to holder
 * Returns [issuer, holder, mptIssuanceId].
 */
async function setupMptClawback(
  tokenAmount = "100",
): Promise<[Wallet, Wallet, string]> {
  const [issuer, holder] = await createFunded(client, master, 2, FUND_AMOUNT);

  // Create MPT issuance
  const createTx: MPTokenIssuanceCreate = await client.autofill({
    TransactionType: "MPTokenIssuanceCreate",
    Account: issuer.address,
    Flags:
      MPTokenIssuanceCreateFlags.tfMPTCanTransfer |
      MPTokenIssuanceCreateFlags.tfMPTCanClawback,
    MaximumAmount: "1000000000",
  });
  const createResult = await client.submitAndWait(issuer.sign(createTx).tx_blob);

  const txJson = createResult.result.tx_json as {
    Sequence: number;
    Account: string;
  };
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeUInt32BE(txJson.Sequence, 0);
  const mptIssuanceId = Buffer.concat([
    seqBuf,
    Buffer.from(decodeAccountID(txJson.Account)),
  ])
    .toString("hex")
    .toUpperCase();

  // Holder opts in
  const authTx: MPTokenAuthorize = await client.autofill({
    TransactionType: "MPTokenAuthorize",
    Account: holder.address,
    MPTokenIssuanceID: mptIssuanceId,
  });
  await client.submitAndWait(holder.sign(authTx).tx_blob);

  // Issuer sends MPT to holder
  const sendTx: XrplPayment = await client.autofill({
    TransactionType: "Payment",
    Account: issuer.address,
    Destination: holder.address,
    Amount: { value: tokenAmount, mpt_issuance_id: mptIssuanceId },
  });
  await client.submitAndWait(issuer.sign(sendTx).tx_blob);

  return [issuer, holder, mptIssuanceId];
}

// ---------------------------------------------------------------------------
// clawback IOU
// ---------------------------------------------------------------------------
describe("clawback IOU", () => {
  it.concurrent("claws back IOU tokens from holder and gets tesSUCCESS", async () => {
    const [issuer, holder] = await setupIouClawback("100");
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `50/${IOU_CURRENCY}/${holder.address}`,
      "--seed",
      issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("--json outputs JSON with hash and result", async () => {
    const [issuer, holder] = await setupIouClawback("100");
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `10/${IOU_CURRENCY}/${holder.address}`,
      "--seed",
      issuer.seed!,
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
    expect(out.hash).toBeDefined();
  }, 120_000);

  it.concurrent("--dry-run prints tx_blob without submitting", async () => {
    const [issuer] = await createFunded(client, master, 1, FUND_AMOUNT);
    const holderAddr = Wallet.generate().address;
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `5/${IOU_CURRENCY}/${holderAddr}`,
      "--seed",
      issuer.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string };
    };
    expect(out.tx_blob).toBeDefined();
    expect(out.tx.TransactionType).toBe("Clawback");
  }, 60_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [issuer, holder] = await setupIouClawback("100");
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `1/${IOU_CURRENCY}/${holder.address}`,
      "--seed",
      issuer.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Transaction:/);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// clawback MPT
// ---------------------------------------------------------------------------
describe("clawback MPT", () => {
  it.concurrent("claws back MPT tokens from holder and gets tesSUCCESS", async () => {
    const [issuer, holder, mptIssuanceId] = await setupMptClawback("100");
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `50/${mptIssuanceId}`,
      "--holder",
      holder.address,
      "--seed",
      issuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 120_000);

  it.concurrent("--json outputs JSON with hash and result", async () => {
    const [issuer, holder, mptIssuanceId] = await setupMptClawback("100");
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `10/${mptIssuanceId}`,
      "--holder",
      holder.address,
      "--seed",
      issuer.seed!,
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
    expect(out.hash).toBeDefined();
  }, 120_000);

  it.concurrent("--dry-run prints tx_blob without submitting", async () => {
    const [issuer] = await createFunded(client, master, 1, FUND_AMOUNT);
    const holderAddr = Wallet.generate().address;
    const result = runCLI([
      "--node",
      "testnet",
      "clawback",
      "--amount",
      `5/${DUMMY_MPT_ID}`,
      "--holder",
      holderAddr,
      "--seed",
      issuer.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; Holder: string };
    };
    expect(out.tx_blob).toBeDefined();
    expect(out.tx.TransactionType).toBe("Clawback");
    expect(out.tx.Holder).toBe(holderAddr);
  }, 60_000);
});
