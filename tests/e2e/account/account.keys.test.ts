import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
} from "../helpers/fund";

// 9 tests concurrent × 2 wallets = 18 wallets (1 test is sync, no wallet); +4 buffer = 22
// Budget: 22 × 0.2 + 18 × 2 XRP = 4.4 + 36 = 40.4 ≤ 99 ✓
const TICKET_COUNT = 22;
const FUND_AMOUNT = 2;

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

// ─── account set-regular-key ──────────────────────────────────────────────────

describe("account set-regular-key", () => {
  it.concurrent("sets a regular key and account info shows it", async () => {
    const [accountWallet, regularKeyWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "set-regular-key",
      "--key", regularKeyWallet.address,
      "--seed", accountWallet.seed!,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Transaction submitted:");
    expect(result.stdout).toMatch(/Transaction submitted: [A-F0-9]+/i);

    await new Promise<void>((res) => setTimeout(res, 8_000));

    const infoResult = runCLI([
      "--node", "testnet",
      "account", "info", accountWallet.address,
    ]);
    expect(infoResult.status).toBe(0);
    expect(infoResult.stdout).toContain("Regular Key:");
    expect(infoResult.stdout).toContain(regularKeyWallet.address);
  }, 90_000);

  it.concurrent("removes the regular key and account info no longer shows it", async () => {
    const [accountWallet, regularKeyWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    // Set first
    const setResult = runCLI([
      "--node", "testnet",
      "account", "set-regular-key",
      "--key", regularKeyWallet.address,
      "--seed", accountWallet.seed!,
    ]);
    expect(setResult.status).toBe(0);

    await new Promise<void>((res) => setTimeout(res, 8_000));

    // Remove
    const removeResult = runCLI([
      "--node", "testnet",
      "account", "set-regular-key",
      "--remove",
      "--seed", accountWallet.seed!,
    ]);
    expect(removeResult.status).toBe(0);
    expect(removeResult.stdout).toContain("Transaction submitted:");

    await new Promise<void>((res) => setTimeout(res, 8_000));

    const infoResult = runCLI([
      "--node", "testnet",
      "account", "info", accountWallet.address,
    ]);
    expect(infoResult.status).toBe(0);
    expect(infoResult.stdout).not.toContain("Regular Key:");
  }, 90_000);

  it.concurrent("--json outputs hash, result, tx_blob", async () => {
    const [accountWallet, regularKeyWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "set-regular-key",
      "--key", regularKeyWallet.address,
      "--seed", accountWallet.seed!,
      "--json",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { hash: string; result: string; tx_blob: string };
    expect(typeof data.hash).toBe("string");
    expect(data.hash.length).toBeGreaterThan(0);
    expect(typeof data.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--no-wait submits without waiting for validation", async () => {
    const [accountWallet, regularKeyWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "set-regular-key",
      "--remove",
      "--seed", accountWallet.seed!,
      "--no-wait",
    ]);
    // --remove with --no-wait: removing a non-existent key might fail on-chain
    // but the CLI should exit 0 (it submitted successfully)
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Transaction submitted:");
    void regularKeyWallet; // suppress unused warning
  }, 90_000);

  it.concurrent("--dry-run prints SetRegularKey JSON without submitting", async () => {
    const [accountWallet, regularKeyWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "set-regular-key",
      "--key", regularKeyWallet.address,
      "--seed", accountWallet.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as { TransactionType: string; Account: string; RegularKey: string };
    expect(tx.TransactionType).toBe("SetRegularKey");
    expect(tx.Account).toBe(accountWallet.address);
    expect(tx.RegularKey).toBe(regularKeyWallet.address);
  }, 90_000);
});

// ─── account delete ───────────────────────────────────────────────────────────

describe("account delete", () => {
  it.concurrent("--dry-run prints AccountDelete JSON without submitting (no --confirm required)", async () => {
    const [fundedWallet, destWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "delete",
      "--destination", destWallet.address,
      "--seed", fundedWallet.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as {
      TransactionType: string;
      Account: string;
      Destination: string;
    };
    expect(tx.TransactionType).toBe("AccountDelete");
    expect(tx.Account).toBe(fundedWallet.address);
    expect(tx.Destination).toBe(destWallet.address);
  }, 90_000);

  it.concurrent("--dry-run with --destination-tag includes DestinationTag in JSON", async () => {
    const [fundedWallet, destWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "delete",
      "--destination", destWallet.address,
      "--destination-tag", "42",
      "--seed", fundedWallet.seed!,
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const tx = JSON.parse(result.stdout) as { TransactionType: string; DestinationTag?: number };
    expect(tx.TransactionType).toBe("AccountDelete");
    expect(tx.DestinationTag).toBe(42);
  }, 90_000);

  it.concurrent("--no-wait with --confirm submits and returns a 64-char hex hash", async () => {
    const [fundedWallet, destWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    // AccountDelete will likely fail with tecTOO_SOON for fresh accounts
    // but --no-wait just submits and returns hash without waiting for validation.
    const result = runCLI([
      "--node", "testnet",
      "account", "delete",
      "--destination", destWallet.address,
      "--seed", fundedWallet.seed!,
      "--confirm",
      "--no-wait",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);

  it.concurrent("--json with --confirm and --no-wait outputs JSON with hash field", async () => {
    const [fundedWallet, destWallet] = await createFunded(client, master, 2, FUND_AMOUNT);

    const result = runCLI([
      "--node", "testnet",
      "account", "delete",
      "--destination", destWallet.address,
      "--seed", fundedWallet.seed!,
      "--confirm",
      "--no-wait",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string };
    expect(typeof out.hash).toBe("string");
    expect(out.hash).toMatch(/^[0-9A-Fa-f]{64}$/);
  }, 90_000);

  it.concurrent("account info returns actNotFound for a non-existent (unfunded) account", () => {
    const unfundedWallet = Wallet.generate();
    const result = runCLI([
      "--node", "testnet",
      "account", "info", unfundedWallet.address,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("actNotFound");
  });
});
