import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";



describe("wallet private-key", () => {
  it.concurrent("derives private key from seed as non-empty hex string", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    expect(newResult.status).toBe(0);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "private-key", "--seed", seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { privateKey: string; keyType: string };
    expect(data.privateKey).toBeTruthy();
    expect(data.privateKey.length).toBeGreaterThan(0);
    expect(data.keyType).toBe("ed25519");
  });

  it.concurrent("private key from seed matches wallet new output", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    expect(newResult.status).toBe(0);
    const wallet = JSON.parse(newResult.stdout) as {
      seed: string;
      privateKey: string;
    };

    const result = runCLI(["wallet", "private-key", "--seed", wallet.seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { privateKey: string };
    expect(data.privateKey).toBe(wallet.privateKey);
  });

  it.concurrent("derives secp256k1 private key from seed", () => {
    const newResult = runCLI(["wallet", "new", "--key-type", "secp256k1", "--json", "--show-secret"]);
    expect(newResult.status).toBe(0);
    const wallet = JSON.parse(newResult.stdout) as {
      seed: string;
      privateKey: string;
      keyType: string;
    };
    expect(wallet.keyType).toBe("secp256k1");

    const result = runCLI(["wallet", "private-key", "--seed", wallet.seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { privateKey: string; keyType: string };
    expect(data.privateKey).toBe(wallet.privateKey);
    expect(data.keyType).toBe("secp256k1");
  });

  it.concurrent("derives private key from mnemonic", () => {
    const mnemonicResult = runCLI(["wallet", "new-mnemonic", "--json", "--show-secret"]);
    expect(mnemonicResult.status).toBe(0);
    const mnemonicWallet = JSON.parse(mnemonicResult.stdout) as {
      mnemonic: string;
      privateKey: string;
    };

    const result = runCLI([
      "wallet",
      "private-key",
      "--mnemonic",
      mnemonicWallet.mnemonic,
      "--json",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { privateKey: string };
    expect(data.privateKey).toBe(mnemonicWallet.privateKey);
  });

  it.concurrent("alias 'pk' works", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    expect(newResult.status).toBe(0);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "pk", "--seed", seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { privateKey: string };
    expect(data.privateKey).toBeTruthy();
  });

  it.concurrent("exits 1 with error when no key material is provided", () => {
    const result = runCLI(["wallet", "private-key"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Error/);
  });

  it.concurrent("exits 1 when both --seed and --mnemonic are provided", () => {
    const result = runCLI([
      "wallet",
      "private-key",
      "--seed",
      "sSomeInvalidSeed",
      "--mnemonic",
      "word ".repeat(12).trim(),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Error/);
  });

  it.concurrent("prints private key in non-json mode", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    expect(newResult.status).toBe(0);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "private-key", "--seed", seed]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Private Key:/);
    expect(result.stdout).toMatch(/Key Type:/);
  });
});
