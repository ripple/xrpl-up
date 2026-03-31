import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";



describe("wallet new-mnemonic", () => {
  it.concurrent("generates a 12-word mnemonic and valid address with --json", () => {
    const result = runCLI(["wallet", "new-mnemonic", "--json", "--show-secret"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as {
      mnemonic: string;
      derivationPath: string;
      address: string;
      publicKey: string;
      privateKey: string;
      keyType: string;
    };
    expect(wallet.mnemonic.split(" ")).toHaveLength(12);
    expect(wallet.address).toMatch(/^r/);
    expect(wallet.publicKey).toBeTruthy();
    expect(wallet.privateKey).toBeTruthy();
    expect(wallet.derivationPath).toBe("m/44'/144'/0'/0/0");
    expect(wallet.keyType).toBe("ed25519");
  });

  it.concurrent("uses the default derivation path m/44'/144'/0'/0/0", () => {
    const result = runCLI(["wallet", "new-mnemonic", "--json"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as { derivationPath: string };
    expect(wallet.derivationPath).toBe("m/44'/144'/0'/0/0");
  });

  it.concurrent("respects --derivation-path override", () => {
    const result = runCLI([
      "wallet",
      "new-mnemonic",
      "--derivation-path",
      "m/44'/144'/1'/0/0",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as { derivationPath: string };
    expect(wallet.derivationPath).toBe("m/44'/144'/1'/0/0");
  });

  it.concurrent("supports secp256k1 key type", () => {
    const result = runCLI([
      "wallet",
      "new-mnemonic",
      "--key-type",
      "secp256k1",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as {
      keyType: string;
      address: string;
    };
    expect(wallet.keyType).toBe("secp256k1");
    expect(wallet.address).toMatch(/^r/);
  });

  it.concurrent("prints labelled lines without --json (secrets hidden by default)", () => {
    const result = runCLI(["wallet", "new-mnemonic"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Mnemonic:         [hidden]");
    expect(result.stdout).toMatch(/^Derivation Path:/m);
    expect(result.stdout).toMatch(/^Address:/m);
    expect(result.stdout).toMatch(/^Public Key:/m);
    expect(result.stdout).toContain("Private Key:      [hidden]");
  });

  it.concurrent("alias 'nm' works", () => {
    const result = runCLI(["wallet", "nm", "--json", "--show-secret"]);
    expect(result.status).toBe(0);
    const wallet = JSON.parse(result.stdout) as { mnemonic: string };
    expect(wallet.mnemonic.split(" ")).toHaveLength(12);
  });
});
