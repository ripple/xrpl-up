import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";



describe("wallet sign", () => {
  it.concurrent("signs a message with a known seed and returns a non-empty hex signature", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(wallet.stdout) as { seed: string };

    const result = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);

    expect(result.status).toBe(0);
    const signature = result.stdout.trim();
    expect(signature).toBeTruthy();
    expect(/^[0-9A-F]+$/i.test(signature)).toBe(true);
  });

  it.concurrent("produces deterministic signatures for the same message and seed", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(wallet.stdout) as { seed: string };

    const result1 = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);
    const result2 = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);

    expect(result1.status).toBe(0);
    expect(result2.status).toBe(0);
    expect(result1.stdout.trim()).toBe(result2.stdout.trim());
  });

  it.concurrent("--from-hex treats message as hex input", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(wallet.stdout) as { seed: string };

    const hexMessage = Buffer.from("hello", "utf-8").toString("hex").toUpperCase();
    const resultHex = runCLI([
      "wallet",
      "sign",
      "--message",
      hexMessage,
      "--from-hex",
      "--seed",
      seed,
    ]);
    const resultUtf8 = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);

    expect(resultHex.status).toBe(0);
    expect(resultUtf8.status).toBe(0);
    // Both should produce the same signature (same underlying bytes)
    expect(resultHex.stdout.trim()).toBe(resultUtf8.stdout.trim());
  });

  it.concurrent("signs a minimal Payment tx JSON and returns tx_blob starting with '12'", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

    const tx = JSON.stringify({
      TransactionType: "Payment",
      Account: address,
      Amount: "1000000",
      Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
      Fee: "12",
      Sequence: 1,
      LastLedgerSequence: 100000,
    });

    const result = runCLI(["wallet", "sign", "--tx", tx, "--seed", seed]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tx_blob:");
    expect(result.stdout).toContain("hash:");

    const txBlobLine = result.stdout
      .split("\n")
      .find((l) => l.startsWith("tx_blob:"))!;
    const txBlob = txBlobLine.replace("tx_blob:", "").trim();
    expect(txBlob.length).toBeGreaterThan(0);
    expect(txBlob.startsWith("12")).toBe(true);
  });

  it.concurrent("--tx with --json outputs {tx_blob, hash}", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

    const tx = JSON.stringify({
      TransactionType: "Payment",
      Account: address,
      Amount: "1000000",
      Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
      Fee: "12",
      Sequence: 1,
      LastLedgerSequence: 100000,
    });

    const result = runCLI(["wallet", "sign", "--tx", tx, "--seed", seed, "--json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { tx_blob: string; hash: string };
    expect(parsed.tx_blob).toBeTruthy();
    expect(parsed.tx_blob.startsWith("12")).toBe(true);
    expect(parsed.hash).toBeTruthy();
  });

  it.concurrent("signs a tx from a file path", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const txPath = join(tmpDir, "tx.json");
      writeFileSync(
        txPath,
        JSON.stringify({
          TransactionType: "Payment",
          Account: address,
          Amount: "1000000",
          Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
          Fee: "12",
          Sequence: 1,
          LastLedgerSequence: 100000,
        })
      );

      const result = runCLI(["wallet", "sign", "--tx", txPath, "--seed", seed]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("tx_blob:");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("signs using --account from keystore", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xrpl-test-"));
    try {
      const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
      const { seed, address } = JSON.parse(wallet.stdout) as { seed: string; address: string };

      runCLI(["wallet", "import", seed, "--password", "testpassword", "--keystore", tmpDir]);

      const result = runCLI([
        "wallet",
        "sign",
        "--message",
        "hello",
        "--account",
        address,
        "--password",
        "testpassword",
        "--keystore",
        tmpDir,
      ]);

      expect(result.status).toBe(0);
      const signature = result.stdout.trim();
      expect(signature).toBeTruthy();
      expect(/^[0-9A-F]+$/i.test(signature)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.concurrent("exits 1 when neither --message nor --tx is provided", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(wallet.stdout) as { seed: string };

    const result = runCLI(["wallet", "sign", "--seed", seed]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("exits 1 when no key material is provided", () => {
    const result = runCLI(["wallet", "sign", "--message", "hello"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("alias 's' works", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(wallet.stdout) as { seed: string };

    const result = runCLI(["wallet", "s", "--message", "hello", "--seed", seed]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBeTruthy();
  });
});
