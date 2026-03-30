import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";



describe("wallet verify", () => {
  it.concurrent("verifies a message signature with matching public key → exit 0 and output contains 'Valid'", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, publicKey } = JSON.parse(wallet.stdout) as {
      seed: string;
      publicKey: string;
    };

    const signResult = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);
    expect(signResult.status).toBe(0);
    const signature = signResult.stdout.trim();

    const result = runCLI([
      "wallet",
      "verify",
      "--message",
      "hello",
      "--signature",
      signature,
      "--public-key",
      publicKey,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Valid");
  });

  it.concurrent("rejects tampered signature → exit 1 and output contains 'Invalid'", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, publicKey } = JSON.parse(wallet.stdout) as {
      seed: string;
      publicKey: string;
    };

    const signResult = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);
    expect(signResult.status).toBe(0);
    const signature = signResult.stdout.trim();

    // Flip the last two hex chars to tamper with the signature
    const tamperedSig =
      signature.slice(0, -2) + (signature.slice(-2).toUpperCase() === "FF" ? "00" : "FF");

    const result = runCLI([
      "wallet",
      "verify",
      "--message",
      "hello",
      "--signature",
      tamperedSig,
      "--public-key",
      publicKey,
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Invalid");
  });

  it.concurrent("verifies a signed transaction blob → exit 0", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, address } = JSON.parse(wallet.stdout) as {
      seed: string;
      address: string;
    };

    const tx = JSON.stringify({
      TransactionType: "Payment",
      Account: address,
      Amount: "1000000",
      Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
      Fee: "12",
      Sequence: 1,
      LastLedgerSequence: 100000,
    });

    const signResult = runCLI(["wallet", "sign", "--tx", tx, "--seed", seed, "--json"]);
    expect(signResult.status).toBe(0);
    const { tx_blob } = JSON.parse(signResult.stdout) as { tx_blob: string; hash: string };

    const result = runCLI(["wallet", "verify", "--tx", tx_blob]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Valid");
  });

  it.concurrent("--from-hex flag: verifies hex-encoded message", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, publicKey } = JSON.parse(wallet.stdout) as {
      seed: string;
      publicKey: string;
    };

    const hexMessage = Buffer.from("hello", "utf-8").toString("hex").toUpperCase();

    const signResult = runCLI([
      "wallet",
      "sign",
      "--message",
      hexMessage,
      "--from-hex",
      "--seed",
      seed,
    ]);
    expect(signResult.status).toBe(0);
    const signature = signResult.stdout.trim();

    const result = runCLI([
      "wallet",
      "verify",
      "--message",
      hexMessage,
      "--from-hex",
      "--signature",
      signature,
      "--public-key",
      publicKey,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Valid");
  });

  it.concurrent("--json outputs {valid: true} for valid signature", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, publicKey } = JSON.parse(wallet.stdout) as {
      seed: string;
      publicKey: string;
    };

    const signResult = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);
    const signature = signResult.stdout.trim();

    const result = runCLI([
      "wallet",
      "verify",
      "--message",
      "hello",
      "--signature",
      signature,
      "--public-key",
      publicKey,
      "--json",
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { valid: boolean };
    expect(parsed.valid).toBe(true);
  });

  it.concurrent("--json outputs {valid: false} for invalid signature and exits 1", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, publicKey } = JSON.parse(wallet.stdout) as {
      seed: string;
      publicKey: string;
    };

    const signResult = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);
    const signature = signResult.stdout.trim();
    const tamperedSig =
      signature.slice(0, -2) + (signature.slice(-2).toUpperCase() === "FF" ? "00" : "FF");

    const result = runCLI([
      "wallet",
      "verify",
      "--message",
      "hello",
      "--signature",
      tamperedSig,
      "--public-key",
      publicKey,
      "--json",
    ]);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { valid: boolean };
    expect(parsed.valid).toBe(false);
  });

  it.concurrent("exits 1 when neither --message nor --tx is provided", () => {
    const result = runCLI(["wallet", "verify"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it.concurrent("alias 'v' works", () => {
    const wallet = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed, publicKey } = JSON.parse(wallet.stdout) as {
      seed: string;
      publicKey: string;
    };

    const signResult = runCLI(["wallet", "sign", "--message", "hello", "--seed", seed]);
    const signature = signResult.stdout.trim();

    const result = runCLI([
      "wallet",
      "v",
      "--message",
      "hello",
      "--signature",
      signature,
      "--public-key",
      publicKey,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Valid");
  });
});
