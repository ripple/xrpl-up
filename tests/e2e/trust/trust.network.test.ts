import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Client, Wallet, AccountSetAsfFlags } from "xrpl";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
  fundAddress,
} from "../helpers/fund";

// 13 tests concurrent × 2 wallets = 26 wallets + 1 mnemonic fundAddress = 27 tickets; +3 buffer = 30
// Budget: 30 × 0.2 + 27 × 3 XRP = 6 + 81 = 87 ≤ 99 ✓
const TICKET_COUNT = 30;

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

describe("trust set core", () => {
  it.concurrent("creates a USD trust line and prints tesSUCCESS", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "USD",
      "--issuer", issuer.address,
      "--limit", "1000",
      "--seed", trustor.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI(["--node", XRPL_WS, "account", "trust-lines", "--json", trustor.address]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ account: string; currency: string }>;
    const usdLine = lines.find((l) => l.currency === "USD" && l.account === issuer.address);
    expect(usdLine).toBeDefined();
  }, 90_000);

  it.concurrent("alias 's' works", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "s",
      "--currency", "EUR",
      "--issuer", issuer.address,
      "--limit", "500",
      "--seed", trustor.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI(["--node", XRPL_WS, "account", "trust-lines", "--json", trustor.address]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ account: string; currency: string }>;
    const eurLine = lines.find((l) => l.currency === "EUR" && l.account === issuer.address);
    expect(eurLine).toBeDefined();
  }, 90_000);

  it.concurrent("--dry-run outputs JSON with TransactionType TrustSet and does not submit", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const linesBefore = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesBefore.status).toBe(0);
    const countBefore = (JSON.parse(linesBefore.stdout) as unknown[]).length;

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "XYZ",
      "--issuer", issuer.address,
      "--limit", "100",
      "--seed", trustor.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { tx_blob: string; tx: { TransactionType: string } };
    expect(out.tx.TransactionType).toBe("TrustSet");
    expect(typeof out.tx_blob).toBe("string");

    const linesAfter = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesAfter.status).toBe(0);
    expect((JSON.parse(linesAfter.stdout) as unknown[]).length).toBe(countBefore);
  }, 90_000);

  it.concurrent("--no-wait exits 0 and stdout contains a 64-char hex hash", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "GBP",
      "--issuer", issuer.address,
      "--limit", "200",
      "--seed", trustor.seed!,
      "--no-wait",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--json outputs hash, result, fee, ledger", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "CAD",
      "--issuer", issuer.address,
      "--limit", "300",
      "--seed", trustor.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string; fee: string; ledger: number };
    expect(out.result).toBe("tesSUCCESS");
    expect(typeof out.hash).toBe("string");
    expect(typeof out.fee).toBe("string");
    expect(typeof out.ledger).toBe("number");
  }, 90_000);

  it.concurrent("--no-ripple sets no_ripple: true on trust line", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "MXN",
      "--issuer", issuer.address,
      "--limit", "1000",
      "--no-ripple",
      "--seed", trustor.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ currency: string; no_ripple?: boolean }>;
    const mxnLine = lines.find((l) => l.currency === "MXN");
    expect(mxnLine).toBeDefined();
    expect(mxnLine?.no_ripple).toBe(true);
  }, 90_000);

  it.concurrent("--account + --keystore + --password signs and submits trust set", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);
    const tmpDir = mkdtempSync(resolve(tmpdir(), "xrpl-test-keystore-"));
    try {
      const importResult = runCLI([
        "wallet", "import",
        trustor.seed!,
        "--password", "pw123",
        "--keystore", tmpDir,
      ]);
      expect(importResult.status, `stdout: ${importResult.stdout} stderr: ${importResult.stderr}`).toBe(0);

      const result = runCLI([
        "--node", XRPL_WS,
        "trust", "set",
        "--currency", "CNY",
        "--issuer", issuer.address,
        "--limit", "1000",
        "--account", trustor.address,
        "--keystore", tmpDir,
        "--password", "pw123",
      ]);
      expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("tesSUCCESS");

      const linesResult = runCLI(["--node", XRPL_WS, "account", "trust-lines", "--json", trustor.address]);
      expect(linesResult.status).toBe(0);
      const lines = JSON.parse(linesResult.stdout) as Array<{ account: string; currency: string }>;
      const cnyLine = lines.find((l) => l.currency === "CNY" && l.account === issuer.address);
      expect(cnyLine).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 90_000);

  it.concurrent("--clear-no-ripple clears the NoRipple flag on an existing trust line", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const setResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "SGD",
      "--issuer", issuer.address,
      "--limit", "5000",
      "--no-ripple",
      "--seed", trustor.seed!,
    ]);
    expect(setResult.status, `stdout: ${setResult.stdout} stderr: ${setResult.stderr}`).toBe(0);

    const clearResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "SGD",
      "--issuer", issuer.address,
      "--limit", "5000",
      "--clear-no-ripple",
      "--seed", trustor.seed!,
    ]);
    expect(clearResult.status, `stdout: ${clearResult.stdout} stderr: ${clearResult.stderr}`).toBe(0);
    expect(clearResult.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ currency: string; no_ripple?: boolean }>;
    const line = lines.find((l) => l.currency === "SGD");
    expect(line).toBeDefined();
    expect(line?.no_ripple).toBeFalsy();
  }, 90_000);

  it.concurrent("--mnemonic key material creates a trust line", async () => {
    const testMnemonic = generateMnemonic(wordlist);
    const mnemonicWallet = Wallet.fromMnemonic(testMnemonic, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
    const [issuer] = await createFunded(client, master, 1, 3);
    await fundAddress(client, master, mnemonicWallet.address, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "MNE",
      "--issuer", issuer.address,
      "--limit", "100",
      "--mnemonic", testMnemonic,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI(["--node", XRPL_WS, "account", "trust-lines", "--json", mnemonicWallet.address]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ account: string; currency: string }>;
    const mneLine = lines.find((l) => l.currency === "MNE" && l.account === issuer.address);
    expect(mneLine).toBeDefined();
  }, 90_000);

  it.concurrent("--quality-in and --quality-out set quality values on trust line", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const result = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "JPY",
      "--issuer", issuer.address,
      "--limit", "10000",
      "--quality-in", "950000000",
      "--quality-out", "950000000",
      "--seed", trustor.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ currency: string; quality_in?: number; quality_out?: number }>;
    const jpyLine = lines.find((l) => l.currency === "JPY");
    expect(jpyLine).toBeDefined();
    expect(jpyLine?.quality_in).toBe(950000000);
    expect(jpyLine?.quality_out).toBe(950000000);
  }, 90_000);
});

describe("trust set issuer-side flags", () => {
  it.concurrent("--freeze freezes a trust line (freeze_peer: true on trustor side)", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    const createResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "FRZ",
      "--issuer", issuer.address,
      "--limit", "1000",
      "--seed", trustor.seed!,
    ]);
    expect(createResult.status, `stdout: ${createResult.stdout} stderr: ${createResult.stderr}`).toBe(0);

    const freezeResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "FRZ",
      "--issuer", trustor.address,
      "--limit", "0",
      "--freeze",
      "--seed", issuer.seed!,
    ]);
    expect(freezeResult.status, `stdout: ${freezeResult.stdout} stderr: ${freezeResult.stderr}`).toBe(0);
    expect(freezeResult.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ currency: string; freeze_peer?: boolean }>;
    const frzLine = lines.find((l) => l.currency === "FRZ");
    expect(frzLine).toBeDefined();
    expect(frzLine?.freeze_peer).toBe(true);
  }, 90_000);

  it.concurrent("--unfreeze clears the freeze on a trust line", async () => {
    const [trustor, issuer] = await createFunded(client, master, 2, 3);

    // Set up: create trust line and freeze it
    const createResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "UFZ",
      "--issuer", issuer.address,
      "--limit", "1000",
      "--seed", trustor.seed!,
    ]);
    expect(createResult.status, `stdout: ${createResult.stdout} stderr: ${createResult.stderr}`).toBe(0);

    const freezeResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "UFZ",
      "--issuer", trustor.address,
      "--limit", "0",
      "--freeze",
      "--seed", issuer.seed!,
    ]);
    expect(freezeResult.status, `stdout: ${freezeResult.stdout} stderr: ${freezeResult.stderr}`).toBe(0);

    // Now unfreeze
    const unfreezeResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "UFZ",
      "--issuer", trustor.address,
      "--limit", "0",
      "--unfreeze",
      "--seed", issuer.seed!,
    ]);
    expect(unfreezeResult.status, `stdout: ${unfreezeResult.stdout} stderr: ${unfreezeResult.stderr}`).toBe(0);
    expect(unfreezeResult.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ currency: string; freeze_peer?: boolean }>;
    const ufzLine = lines.find((l) => l.currency === "UFZ");
    expect(ufzLine).toBeDefined();
    expect(ufzLine?.freeze_peer).toBeFalsy();
  }, 90_000);

  it.concurrent("--auth authorizes a trust line (peer_authorized: true on trustor side)", async () => {
    const [trustor, authIssuer] = await createFunded(client, master, 2, 3);

    // Enable RequireAuth on authIssuer
    const setFlagTx = await client.autofill({
      TransactionType: "AccountSet",
      Account: authIssuer.address,
      SetFlag: AccountSetAsfFlags.asfRequireAuth,
    });
    await client.submitAndWait(authIssuer.sign(setFlagTx).tx_blob);

    // Trustor creates trust line to authIssuer
    const createResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "AUT",
      "--issuer", authIssuer.address,
      "--limit", "100",
      "--seed", trustor.seed!,
    ]);
    expect(createResult.status, `stdout: ${createResult.stdout} stderr: ${createResult.stderr}`).toBe(0);

    // authIssuer authorizes the trust line
    const authResult = runCLI([
      "--node", XRPL_WS,
      "trust", "set",
      "--currency", "AUT",
      "--issuer", trustor.address,
      "--limit", "0",
      "--auth",
      "--seed", authIssuer.seed!,
    ]);
    expect(authResult.status, `stdout: ${authResult.stdout} stderr: ${authResult.stderr}`).toBe(0);
    expect(authResult.stdout).toContain("tesSUCCESS");

    const linesResult = runCLI([
      "--node", XRPL_WS,
      "account", "trust-lines", "--json", trustor.address,
    ]);
    expect(linesResult.status).toBe(0);
    const lines = JSON.parse(linesResult.stdout) as Array<{ currency: string; peer_authorized?: boolean }>;
    const autLine = lines.find((l) => l.currency === "AUT");
    expect(autLine).toBeDefined();
    expect(autLine?.peer_authorized).toBe(true);
  }, 90_000);
});
