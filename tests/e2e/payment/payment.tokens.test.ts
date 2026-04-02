import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet, xrpToDrops, decodeAccountID } from "xrpl";
import type { TrustSet, MPTokenIssuanceCreate, MPTokenAuthorize } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 5 tests × 2 wallets each = 10 tickets (all run concurrently); +2 buffer = 12
// Budget: 12 × 0.2 + 10 × 3 XRP = 2.4 + 30 = 32.4 ≤ 99 ✓
const TICKET_COUNT = 12;

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

describe("payment tokens", () => {
  it.concurrent("sends IOU payment (direct issuance) and verifies trust-line balance", async () => {
    const [iouIssuer, iouReceiver] = await createFunded(client, master, 2, 3);

    // Receiver sets up trust line to issuer
    const trustTx: TrustSet = await client.autofill({
      TransactionType: "TrustSet",
      Account: iouReceiver.address,
      LimitAmount: { currency: "USD", issuer: iouIssuer.address, value: "10000" },
    });
    await client.submitAndWait(iouReceiver.sign(trustTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", iouReceiver.address,
      "--amount", `10/USD/${iouIssuer.address}`,
      "--seed", iouIssuer.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const tlResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", iouReceiver.address,
    ]);
    expect(tlResult.status, `stdout: ${tlResult.stdout} stderr: ${tlResult.stderr}`).toBe(0);
    const lines = JSON.parse(tlResult.stdout) as Array<{
      account: string;
      currency: string;
      balance: string;
    }>;
    const usdLine = lines.find(
      (l) => l.currency === "USD" && l.account === iouIssuer.address
    );
    expect(usdLine).toBeDefined();
    expect(Number(usdLine!.balance)).toBe(10);
  }, 90_000);

  it.concurrent("sends MPT payment from issuer to receiver and gets tesSUCCESS", async () => {
    const [mptIssuer, mptReceiver] = await createFunded(client, master, 2, 3);

    // Create MPToken issuance
    const createTx: MPTokenIssuanceCreate = await client.autofill({
      TransactionType: "MPTokenIssuanceCreate",
      Account: mptIssuer.address,
      Flags: 32, // tfMPTCanTransfer
      MaximumAmount: "1000000000",
    });
    const createResult = await client.submitAndWait(mptIssuer.sign(createTx).tx_blob);

    const txJson = createResult.result.tx_json as { Sequence: number; Account: string };
    const seqBuf = Buffer.alloc(4);
    seqBuf.writeUInt32BE(txJson.Sequence, 0);
    const mptIssuanceId = Buffer.concat([seqBuf, Buffer.from(decodeAccountID(txJson.Account))]).toString("hex").toUpperCase();

    // Receiver authorizes the MPToken
    const authTx: MPTokenAuthorize = await client.autofill({
      TransactionType: "MPTokenAuthorize",
      Account: mptReceiver.address,
      MPTokenIssuanceID: mptIssuanceId,
    });
    await client.submitAndWait(mptReceiver.sign(authTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", mptReceiver.address,
      "--amount", `100/${mptIssuanceId}`,
      "--seed", mptIssuer.seed!,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--paths '[]' (empty array) is accepted without error", async () => {
    const [sender, receiver] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", receiver.address,
      "--amount", "0.5",
      "--seed", sender.seed!,
      "--paths", "[]",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 60_000);

  it.concurrent("--partial --json output includes deliveredAmount (IOU partial payment)", async () => {
    const [flagIssuer, flagHolder] = await createFunded(client, master, 2, 3);

    const trustTx: TrustSet = await client.autofill({
      TransactionType: "TrustSet",
      Account: flagHolder.address,
      LimitAmount: { currency: "USD", issuer: flagIssuer.address, value: "10000" },
    });
    await client.submitAndWait(flagHolder.sign(trustTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", flagHolder.address,
      "--amount", `1/USD/${flagIssuer.address}`,
      "--send-max", `2/USD/${flagIssuer.address}`,
      "--seed", flagIssuer.seed!,
      "--partial",
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; deliveredAmount: unknown };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.deliveredAmount).toBeDefined();
  }, 90_000);

  it.concurrent("--partial --deliver-min --send-max IOU payment asserts deliveredAmount >= deliver-min", async () => {
    const [flagIssuer, flagHolder] = await createFunded(client, master, 2, 3);

    const trustTx: TrustSet = await client.autofill({
      TransactionType: "TrustSet",
      Account: flagHolder.address,
      LimitAmount: { currency: "USD", issuer: flagIssuer.address, value: "10000" },
    });
    await client.submitAndWait(flagHolder.sign(trustTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "payment",
      "--to", flagHolder.address,
      "--amount", `2/USD/${flagIssuer.address}`,
      "--send-max", `2/USD/${flagIssuer.address}`,
      "--deliver-min", `1/USD/${flagIssuer.address}`,
      "--partial",
      "--seed", flagIssuer.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hash: string;
      result: string;
      deliveredAmount: string | { value: string; currency: string; issuer: string };
    };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.deliveredAmount).toBeDefined();
    const deliveredValue =
      typeof out.deliveredAmount === "string"
        ? Number(out.deliveredAmount)
        : Number((out.deliveredAmount as { value: string }).value);
    expect(deliveredValue).toBeGreaterThan(0);
    expect(deliveredValue).toBeGreaterThanOrEqual(1);
  }, 90_000);
});
