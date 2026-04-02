import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet, xrpToDrops } from "xrpl";
import type { TrustSet, OfferCreate as XrplOfferCreate } from "xrpl";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
  fundAddress,
  resilientRequest,
} from "../helpers/fund";

// 16 tests concurrent × 2 wallets each = 32 tickets; 32 × 0.2 + 32 × 2 = 70.4 ≤ 99 ✓
const TICKET_COUNT = 32;

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

/** Set up a fresh maker+issuer pair with a USD trust line from maker to issuer. */
async function setupMakerIssuer(): Promise<{ maker: Wallet; issuer: Wallet }> {
  const [maker, issuer] = await createFunded(client, master, 2, 2);
  const trustTx: TrustSet = await client.autofill({
    TransactionType: "TrustSet",
    Account: maker.address,
    LimitAmount: { currency: "USD", issuer: issuer.address, value: "100000" },
  });
  await client.submitAndWait(maker.sign(trustTx).tx_blob);
  return { maker, issuer };
}

describe("offer core", () => {
  it.concurrent("offer create XRP→IOU: offer appears in account_offers and order book", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Sequence:");

    const match = result.stdout.match(/Sequence: (\d+)/);
    expect(match).not.toBeNull();
    const seq = parseInt(match![1], 10);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const offers = JSON.parse(offersResult.stdout) as Array<{
      seq: number;
      taker_pays: { currency: string; issuer: string; value: string } | string;
      taker_gets: string;
    }>;
    const offer = offers.find((o) => o.seq === seq);
    expect(offer).toBeDefined();
    expect(offer!.taker_pays).toMatchObject({ currency: "USD", issuer: issuer.address, value: "1" });
    expect(offer!.taker_gets).toBe("10000000");

    const bookResult = await resilientRequest(client, {
      command: "book_offers",
      taker_pays: { currency: "USD", issuer: issuer.address },
      taker_gets: { currency: "XRP" },
    } as Parameters<typeof client.request>[0]);
    const bookOffers = (bookResult.result as { offers: unknown[] }).offers;
    expect(bookOffers.length).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("offer cancel: cancels offer and removes from account_offers", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const createTx: XrplOfferCreate = await client.autofill({
      TransactionType: "OfferCreate",
      Account: maker.address,
      TakerPays: { currency: "USD", issuer: issuer.address, value: "2" },
      TakerGets: xrpToDrops(20),
    });
    const createResult = await client.submitAndWait(maker.sign(createTx).tx_blob);
    const seq = (createResult.result.tx_json as { Sequence?: number }).Sequence!;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "cancel",
      "--sequence", String(seq),
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const offers = JSON.parse(offersResult.stdout) as Array<{ seq: number }>;
    expect(offers.find((o) => o.seq === seq)).toBeUndefined();
  }, 90_000);

  it.concurrent("offer cancel --json: output has hash and tesSUCCESS result", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const createTx: XrplOfferCreate = await client.autofill({
      TransactionType: "OfferCreate",
      Account: maker.address,
      TakerPays: { currency: "USD", issuer: issuer.address, value: "5" },
      TakerGets: xrpToDrops(50),
    });
    const createResult = await client.submitAndWait(maker.sign(createTx).tx_blob);
    const seq = (createResult.result.tx_json as { Sequence?: number }).Sequence!;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "cancel",
      "--sequence", String(seq),
      "--json",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string };
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(out.result).toBe("tesSUCCESS");
  }, 90_000);

  it.concurrent("offer cancel --dry-run: outputs OfferCancel tx JSON without cancelling", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const createTx: XrplOfferCreate = await client.autofill({
      TransactionType: "OfferCreate",
      Account: maker.address,
      TakerPays: { currency: "USD", issuer: issuer.address, value: "5" },
      TakerGets: xrpToDrops(50),
    });
    const createResult = await client.submitAndWait(maker.sign(createTx).tx_blob);
    const seq = (createResult.result.tx_json as { Sequence?: number }).Sequence!;

    const countBefore = (
      JSON.parse(
        runCLI(["--node", XRPL_WS, "account", "offers", "--json", maker.address]).stdout
      ) as unknown[]
    ).length;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "cancel",
      "--sequence", String(seq),
      "--dry-run",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("OfferCancel");
    expect(typeof out.tx_blob).toBe("string");

    const countAfter = (
      JSON.parse(
        runCLI(["--node", XRPL_WS, "account", "offers", "--json", maker.address]).stdout
      ) as unknown[]
    ).length;
    expect(countAfter).toBe(countBefore);
  }, 90_000);

  it.concurrent("offer cancel --no-wait: exits 0 and stdout is 64-char hex", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const createTx: XrplOfferCreate = await client.autofill({
      TransactionType: "OfferCreate",
      Account: maker.address,
      TakerPays: { currency: "USD", issuer: issuer.address, value: "5" },
      TakerGets: xrpToDrops(50),
    });
    const createResult = await client.submitAndWait(maker.sign(createTx).tx_blob);
    const seq = (createResult.result.tx_json as { Sequence?: number }).Sequence!;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "cancel",
      "--sequence", String(seq),
      "--no-wait",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim()).toMatch(/^[0-9A-Fa-f]{64}$/);
  }, 90_000);

  it.concurrent("--json output: hash, result tesSUCCESS, offerSequence > 0", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--json",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; offerSequence: number };
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(out.result).toBe("tesSUCCESS");
    expect(out.offerSequence).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("--dry-run: outputs OfferCreate tx JSON without submitting", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const countBefore = (
      JSON.parse(
        runCLI(["--node", XRPL_WS, "account", "offers", "--json", maker.address]).stdout
      ) as unknown[]
    ).length;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--dry-run",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("OfferCreate");
    expect(typeof out.tx_blob).toBe("string");

    const countAfter = (
      JSON.parse(
        runCLI(["--node", XRPL_WS, "account", "offers", "--json", maker.address]).stdout
      ) as unknown[]
    ).length;
    expect(countAfter).toBe(countBefore);
  }, 90_000);

  it.concurrent("--no-wait: exits 0 and stdout is a 64-char hex hash", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--no-wait",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim()).toMatch(/^[0-9A-Fa-f]{64}$/);
  }, 90_000);

  it.concurrent("--sell flag: offer create with --sell appears in account_offers", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--sell",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Sequence:");

    const match = result.stdout.match(/Sequence: (\d+)/);
    expect(match).not.toBeNull();
    const seq = parseInt(match![1], 10);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const offers = JSON.parse(offersResult.stdout) as Array<{ seq: number }>;
    expect(offers.find((o) => o.seq === seq)).toBeDefined();
  }, 90_000);
});

describe("offer flags", () => {
  it.concurrent("--passive flag: offer appears in account_offers", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--passive",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Sequence:");

    const match = result.stdout.match(/Sequence: (\d+)/);
    expect(match).not.toBeNull();
    const seq = parseInt(match![1], 10);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const offers = JSON.parse(offersResult.stdout) as Array<{ seq: number }>;
    expect(offers.find((o) => o.seq === seq)).toBeDefined();
  }, 90_000);

  it.concurrent("--replace flag: replaces original offer and new offer is present", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const createTx: XrplOfferCreate = await client.autofill({
      TransactionType: "OfferCreate",
      Account: maker.address,
      TakerPays: { currency: "USD", issuer: issuer.address, value: "3" },
      TakerGets: xrpToDrops(30),
    });
    const createResult = await client.submitAndWait(maker.sign(createTx).tx_blob);
    const origSeq = (createResult.result.tx_json as { Sequence?: number }).Sequence!;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `2/USD/${issuer.address}`,
      "--taker-gets", "20",
      "--replace", String(origSeq),
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    const match = result.stdout.match(/Sequence: (\d+)/);
    expect(match).not.toBeNull();
    const newSeq = parseInt(match![1], 10);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const offers = JSON.parse(offersResult.stdout) as Array<{ seq: number }>;
    expect(offers.find((o) => o.seq === origSeq)).toBeUndefined();
    expect(offers.find((o) => o.seq === newSeq)).toBeDefined();
  }, 90_000);

  it.concurrent("--expiration flag: offer entry has a positive expiration number", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--expiration", "2030-01-01T00:00:00Z",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    const match = result.stdout.match(/Sequence: (\d+)/);
    expect(match).not.toBeNull();
    const seq = parseInt(match![1], 10);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const offers = JSON.parse(offersResult.stdout) as Array<{ seq: number; expiration?: number }>;
    const offer = offers.find((o) => o.seq === seq);
    expect(offer).toBeDefined();
    expect(typeof offer!.expiration).toBe("number");
    expect(offer!.expiration).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("--immediate-or-cancel flag: exits 0 (offer may be consumed or cancelled)", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const countBefore = (
      JSON.parse(
        runCLI(["--node", XRPL_WS, "account", "offers", "--json", maker.address]).stdout
      ) as unknown[]
    ).length;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--immediate-or-cancel",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const countAfter = (JSON.parse(offersResult.stdout) as unknown[]).length;
    expect(countAfter).toBeLessThanOrEqual(countBefore);
  }, 90_000);

  it.concurrent("--fill-or-kill flag: exits 0 (tecKILLED is non-fatal) and offer is not placed", async () => {
    const { maker, issuer } = await setupMakerIssuer();

    const countBefore = (
      JSON.parse(
        runCLI(["--node", XRPL_WS, "account", "offers", "--json", maker.address]).stdout
      ) as unknown[]
    ).length;

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--fill-or-kill",
      "--seed", maker.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);

    const offersResult = runCLI([
      "--node", XRPL_WS,
      "account", "offers", "--json", maker.address,
    ]);
    expect(offersResult.status).toBe(0);
    const countAfter = (JSON.parse(offersResult.stdout) as unknown[]).length;
    expect(countAfter).toBeLessThanOrEqual(countBefore);
  }, 90_000);

  it.concurrent("--mnemonic key material: creates offer successfully", async () => {
    const testMnemonic = generateMnemonic(wordlist);
    const mnemonicWallet = Wallet.fromMnemonic(testMnemonic, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
    const [issuer] = await createFunded(client, master, 1, 2);
    await fundAddress(client, master, mnemonicWallet.address, 2);

    // Set up trust line from mnemonicWallet to issuer
    const trustTx: TrustSet = await client.autofill({
      TransactionType: "TrustSet",
      Account: mnemonicWallet.address,
      LimitAmount: { currency: "USD", issuer: issuer.address, value: "100000" },
    });
    await client.submitAndWait(mnemonicWallet.sign(trustTx).tx_blob);

    const result = runCLI([
      "--node", XRPL_WS,
      "offer", "create",
      "--taker-pays", `1/USD/${issuer.address}`,
      "--taker-gets", "10",
      "--mnemonic", testMnemonic,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Sequence:");
  }, 90_000);

  it.concurrent("--account + --keystore + --password: creates offer successfully", async () => {
    const { maker, issuer } = await setupMakerIssuer();
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        maker.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `stdout: ${importResult.stdout} stderr: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", XRPL_WS,
        "offer", "create",
        "--taker-pays", `1/USD/${issuer.address}`,
        "--taker-gets", "10",
        "--account", maker.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("Sequence:");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});
