import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../../helpers/cli";
import { Client, Wallet } from "xrpl";
import {
  XRPL_WS,
  fundMaster,
  initTicketPool,
  createFunded,
  resilientRequest,
} from "../helpers/fund";

// Dummy channel ID for dry-run tests (valid 64-hex-char format)
const DUMMY_CHANNEL = "A".repeat(64);

// 22 tests × 2 wallets = 44 wallets; +4 buffer = 48 tickets
// Budget: 48 × 0.2 + 44 × 2 XRP = 9.6 + 88 = 97.6 ≤ 99 ✓
const TICKET_COUNT = 48;
// 2 XRP per wallet: 1 XRP base reserve + 1 XRP for channel ops.
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

/**
 * Create fresh source + destination wallets AND a payment channel from source
 * to destination. Uses --amount 0.5 (fits in 2 XRP: 1 reserve + 0.5 channel + 0.2 owner reserve + fees).
 */
async function setupChannel(
  settleDelay = 60,
): Promise<{ source: Wallet; destination: Wallet; channelId: string }> {
  const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
  const result = runCLI([
    "--node", "testnet",
    "channel", "create",
    "--to", destination.address,
    "--amount", "0.5",
    "--settle-delay", String(settleDelay),
    "--seed", source.seed!,
    "--json",
  ]);
  if (result.status !== 0) {
    throw new Error(`channel create failed: ${result.stderr}`);
  }
  const { channelId } = JSON.parse(result.stdout) as { channelId: string };
  return { source, destination, channelId };
}

// ---------------------------------------------------------------------------
// channel create
// ---------------------------------------------------------------------------
describe("channel create", () => {
  it.concurrent("creates a channel and outputs channel ID", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "60",
      "--seed", source.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
    expect(result.stdout).toMatch(/Channel ID:\s+[0-9A-F]{64}/i);
  }, 90_000);

  it.concurrent("--json outputs channelId in JSON", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "120",
      "--seed", source.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hash: string;
      result: string;
      channelId: string;
    };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.channelId).toMatch(/^[0-9A-F]{64}$/i);
  }, 90_000);

  it.concurrent("--dry-run outputs TransactionType PaymentChannelCreate without submitting", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "60",
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; Amount: string; SettleDelay: number };
    };
    expect(out.tx.TransactionType).toBe("PaymentChannelCreate");
    expect(typeof out.tx_blob).toBe("string");
    expect(out.tx.Amount).toBe("500000");
    expect(out.tx.SettleDelay).toBe(60);
  }, 90_000);

  it.concurrent("--cancel-after sets CancelAfter epoch in dry-run", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const futureDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "60",
      "--cancel-after", futureDate,
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx: { CancelAfter?: number };
    };
    expect(typeof out.tx.CancelAfter).toBe("number");
    expect(out.tx.CancelAfter).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("--destination-tag sets DestinationTag in dry-run", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "60",
      "--destination-tag", "42",
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { DestinationTag?: number } };
    expect(out.tx.DestinationTag).toBe(42);
  }, 90_000);

  it.concurrent("--public-key overrides derived public key in dry-run", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const pubKey = source.publicKey;
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "60",
      "--public-key", pubKey,
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { PublicKey: string } };
    expect(out.tx.PublicKey).toBe(pubKey);
  }, 90_000);

  it.concurrent("--no-wait exits 0 and output contains a 64-char hex hash", async () => {
    const [source, destination] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "create",
      "--to", destination.address,
      "--amount", "0.5",
      "--settle-delay", "60",
      "--seed", source.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// channel fund
// ---------------------------------------------------------------------------
describe("channel fund", () => {
  it.concurrent("funds an existing channel and verifies updated amount via account_channels", async () => {
    const { source, destination, channelId } = await setupChannel();
    const result = runCLI([
      "--node", "testnet",
      "channel", "fund",
      "--channel", channelId,
      "--amount", "0.2",
      "--seed", source.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");

    // Verify updated amount via account_channels RPC (0.5 + 0.2 = 0.7 XRP = 700_000 drops)
    const res = await resilientRequest(client, {
      command: "account_channels",
      account: source.address,
      destination_account: destination.address,
    });
    const channel = res.result.channels.find((c) => c.channel_id === channelId);
    expect(channel).toBeDefined();
    expect(Number(channel!.amount)).toBe(700_000);
  }, 90_000);

  it.concurrent("--json outputs result in JSON", async () => {
    const { source, channelId } = await setupChannel();
    const result = runCLI([
      "--node", "testnet",
      "channel", "fund",
      "--channel", channelId,
      "--amount", "0.2",
      "--seed", source.seed!,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { hash: string; result: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-F]{64}$/i);
  }, 90_000);

  it.concurrent("--dry-run outputs PaymentChannelFund tx without submitting", async () => {
    const [source] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "fund",
      "--channel", DUMMY_CHANNEL,
      "--amount", "0.2",
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; Amount: string; Channel: string };
    };
    expect(out.tx.TransactionType).toBe("PaymentChannelFund");
    expect(out.tx.Amount).toBe("200000");
    expect(out.tx.Channel).toBe(DUMMY_CHANNEL.toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
  }, 90_000);

  it.concurrent("--expiration sets Expiration in dry-run", async () => {
    const [source] = await createFunded(client, master, 2, FUND_AMOUNT);
    const futureDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const result = runCLI([
      "--node", "testnet",
      "channel", "fund",
      "--channel", DUMMY_CHANNEL,
      "--amount", "0.2",
      "--expiration", futureDate,
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as { tx: { Expiration?: number } };
    expect(typeof out.tx.Expiration).toBe("number");
    expect(out.tx.Expiration).toBeGreaterThan(0);
  }, 90_000);

  it.concurrent("--no-wait exits 0 and outputs a 64-char hex hash", async () => {
    const { source, channelId } = await setupChannel();
    const result = runCLI([
      "--node", "testnet",
      "channel", "fund",
      "--channel", channelId,
      "--amount", "0.2",
      "--seed", source.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// channel list
// ---------------------------------------------------------------------------
describe("channel list", () => {
  it.concurrent("lists channels for an account and shows the created channel", async () => {
    const { source, channelId } = await setupChannel();
    const result = runCLI([
      "--node", "testnet",
      "channel", "list",
      source.address,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(channelId);
    expect(result.stdout).toContain("Channel ID:");
    expect(result.stdout).toContain("Amount:");
    expect(result.stdout).toContain("Balance:");
    expect(result.stdout).toContain("Destination:");
    expect(result.stdout).toContain("Settle Delay:");
    expect(result.stdout).toContain("Expiration:");
    expect(result.stdout).toContain("Cancel After:");
    expect(result.stdout).toContain("Public Key:");
  }, 90_000);

  it.concurrent("--json outputs a JSON array containing the channel", async () => {
    const { source, channelId } = await setupChannel();
    const result = runCLI([
      "--node", "testnet",
      "channel", "list",
      source.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const channels = JSON.parse(result.stdout) as Array<{ channel_id: string }>;
    expect(Array.isArray(channels)).toBe(true);
    const found = channels.find((c) => c.channel_id === channelId);
    expect(found).toBeDefined();
  }, 90_000);

  it.concurrent("--destination filter returns channel when destination matches", async () => {
    const { source, destination, channelId } = await setupChannel();
    const result = runCLI([
      "--node", "testnet",
      "channel", "list",
      source.address,
      "--destination", destination.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const channels = JSON.parse(result.stdout) as Array<{ channel_id: string; destination_account: string }>;
    expect(Array.isArray(channels)).toBe(true);
    expect(channels.every((c) => c.destination_account === destination.address)).toBe(true);
    const found = channels.find((c) => c.channel_id === channelId);
    expect(found).toBeDefined();
  }, 90_000);

  it.concurrent("--destination filter with non-matching address returns empty list", async () => {
    const { source } = await setupChannel();
    const unrelated = Wallet.generate();
    const result = runCLI([
      "--node", "testnet",
      "channel", "list",
      source.address,
      "--destination", unrelated.address,
      "--json",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const channels = JSON.parse(result.stdout) as unknown[];
    expect(channels).toHaveLength(0);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// channel claim
// ---------------------------------------------------------------------------
describe("channel claim", () => {
  it.concurrent("destination redeems a signed claim", async () => {
    const { source, destination, channelId } = await setupChannel(60);

    // Source signs a claim for 0.5 XRP (full channel amount)
    const signResult = runCLI([
      "channel", "sign",
      "--channel", channelId,
      "--amount", "0.5",
      "--seed", source.seed!,
    ]);
    expect(signResult.status, `sign stderr: ${signResult.stderr}`).toBe(0);
    const signature = signResult.stdout.trim();

    // Destination redeems the claim
    const claimResult = runCLI([
      "--node", "testnet",
      "channel", "claim",
      "--channel", channelId,
      "--amount", "0.5",
      "--balance", "0.5",
      "--signature", signature,
      "--public-key", source.publicKey,
      "--seed", destination.seed!,
    ]);
    expect(claimResult.status, `stdout: ${claimResult.stdout} stderr: ${claimResult.stderr}`).toBe(0);
    expect(claimResult.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--json outputs result in JSON", async () => {
    const { source, destination, channelId } = await setupChannel(60);

    // Sign a claim for 0.5 XRP
    const signResult = runCLI([
      "channel", "sign",
      "--channel", channelId,
      "--amount", "0.5",
      "--seed", source.seed!,
    ]);
    expect(signResult.status).toBe(0);
    const signature = signResult.stdout.trim();

    const claimResult = runCLI([
      "--node", "testnet",
      "channel", "claim",
      "--channel", channelId,
      "--amount", "0.5",
      "--balance", "0.5",
      "--signature", signature,
      "--public-key", source.publicKey,
      "--seed", destination.seed!,
      "--json",
    ]);
    expect(claimResult.status, `stdout: ${claimResult.stdout} stderr: ${claimResult.stderr}`).toBe(0);
    const out = JSON.parse(claimResult.stdout) as { hash: string; result: string };
    expect(out.result).toBe("tesSUCCESS");
    expect(out.hash).toMatch(/^[0-9A-F]{64}$/i);
  }, 90_000);

  it.concurrent("--dry-run outputs PaymentChannelClaim tx without submitting", async () => {
    const [source] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
      "--close",
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx_blob: string;
      tx: { TransactionType: string; Channel: string; Flags?: number };
    };
    expect(out.tx.TransactionType).toBe("PaymentChannelClaim");
    expect(out.tx.Channel).toBe(DUMMY_CHANNEL.toUpperCase());
    expect(typeof out.tx_blob).toBe("string");
    // --close flag = 0x00020000 = 131072
    expect(out.tx.Flags).toBeDefined();
    expect(Number(out.tx.Flags) & 0x00020000).toBe(0x00020000);
  }, 90_000);

  it.concurrent("--renew flag is set in dry-run", async () => {
    const [source] = await createFunded(client, master, 2, FUND_AMOUNT);
    const result = runCLI([
      "--node", "testnet",
      "channel", "claim",
      "--channel", DUMMY_CHANNEL,
      "--renew",
      "--seed", source.seed!,
      "--dry-run",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    const out = JSON.parse(result.stdout) as {
      tx: { Flags?: number };
    };
    // --renew flag = 0x00010000 = 65536
    expect(out.tx.Flags).toBeDefined();
    expect(Number(out.tx.Flags) & 0x00010000).toBe(0x00010000);
  }, 90_000);

  it.concurrent("source closes a channel with --close flag", async () => {
    // settle-delay 0 allows immediate close by source
    const { source, channelId } = await setupChannel(0);
    const result = runCLI([
      "--node", "testnet",
      "channel", "claim",
      "--channel", channelId,
      "--close",
      "--seed", source.seed!,
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("tesSUCCESS");
  }, 90_000);

  it.concurrent("--no-wait exits 0 and outputs a 64-char hex hash", async () => {
    const { source, channelId } = await setupChannel(60);
    const result = runCLI([
      "--node", "testnet",
      "channel", "claim",
      "--channel", channelId,
      "--close",
      "--seed", source.seed!,
      "--no-wait",
    ]);
    expect(result.status, `stdout: ${result.stdout} stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/[0-9A-Fa-f]{64}/);
  }, 90_000);
});
