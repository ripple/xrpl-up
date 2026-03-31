import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";



describe("wallet address", () => {
  it.concurrent("derives address from seed that matches wallet new output", () => {
    // Generate a new wallet and capture its seed + address
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    expect(newResult.status).toBe(0);
    const newWallet = JSON.parse(newResult.stdout) as {
      address: string;
      seed: string;
    };

    // Derive address from the captured seed
    const addrResult = runCLI(["wallet", "address", "--seed", newWallet.seed, "--json"]);
    expect(addrResult.status).toBe(0);
    const derived = JSON.parse(addrResult.stdout) as { address: string };
    expect(derived.address).toBe(newWallet.address);
  });

  it.concurrent("returns address starting with 'r'", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "address", "--seed", seed]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Address:\s+r/);
  });

  it.concurrent("--json outputs address, publicKey, and keyType", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "address", "--seed", seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as {
      address: string;
      publicKey: string;
      keyType: string;
    };
    expect(data.address).toMatch(/^r/);
    expect(data.publicKey).toBeTruthy();
    expect(data.keyType).toBe("ed25519");
  });

  it.concurrent("derives correct address from --private-key", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const wallet = JSON.parse(newResult.stdout) as {
      address: string;
      privateKey: string;
    };

    const result = runCLI(["wallet", "address", "--private-key", wallet.privateKey, "--json"]);
    expect(result.status).toBe(0);
    const derived = JSON.parse(result.stdout) as { address: string };
    expect(derived.address).toBe(wallet.address);
  });

  it.concurrent("exits 1 with error when no key material is provided", () => {
    const result = runCLI(["wallet", "address"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Error/);
  });

  it.concurrent("exits 1 with error when multiple key materials are provided", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI([
      "wallet",
      "address",
      "--seed",
      seed,
      "--mnemonic",
      "word ".repeat(12).trim(),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Error/);
  });

  it.concurrent("alias 'a' works", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "a", "--seed", seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { address: string };
    expect(data.address).toMatch(/^r/);
  });

  it.concurrent("alias 'addr' works", () => {
    const newResult = runCLI(["wallet", "new", "--json", "--show-secret"]);
    const { seed } = JSON.parse(newResult.stdout) as { seed: string };

    const result = runCLI(["wallet", "addr", "--seed", seed, "--json"]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as { address: string };
    expect(data.address).toMatch(/^r/);
  });

  it.concurrent("derives correct address from secp256k1 seed", () => {
    const newResult = runCLI(["wallet", "new", "--key-type", "secp256k1", "--json", "--show-secret"]);
    const wallet = JSON.parse(newResult.stdout) as {
      address: string;
      seed: string;
      keyType: string;
    };
    expect(wallet.keyType).toBe("secp256k1");

    const result = runCLI(["wallet", "address", "--seed", wallet.seed, "--json"]);
    expect(result.status).toBe(0);
    const derived = JSON.parse(result.stdout) as {
      address: string;
      keyType: string;
    };
    expect(derived.address).toBe(wallet.address);
    expect(derived.keyType).toBe("secp256k1");
  });
});
