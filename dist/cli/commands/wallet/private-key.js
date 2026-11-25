"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.privateKeyCommand = void 0;
const commander_1 = require("commander");
const xrpl_1 = require("xrpl");
const ripple_keypairs_1 = require("ripple-keypairs");
const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
function toAlgorithm(keyType) {
    const value = keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519";
    return value;
}
exports.privateKeyCommand = new commander_1.Command("private-key")
    .alias("pk")
    .description("Derive private key from seed or mnemonic")
    .option("--seed <seed>", "Family seed (insecure, prefer $WALLET_SEED env var)")
    .option("--mnemonic <phrase>", "BIP39 mnemonic phrase (insecure, prefer $WALLET_MNEMONIC env var)")
    .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519")
    .option("--derivation-path <path>", "BIP44 derivation path (used with --mnemonic)", DEFAULT_DERIVATION_PATH)
    .option("--json", "Output as JSON", false)
    .action((options) => {
    const effectiveSeed = options.seed ?? process.env["WALLET_SEED"];
    const effectiveMnemonic = options.mnemonic ?? process.env["WALLET_MNEMONIC"];
    const provided = [effectiveSeed, effectiveMnemonic].filter(Boolean);
    if (provided.length === 0) {
        process.stderr.write("Error: one of --seed, --mnemonic, $WALLET_SEED, or $WALLET_MNEMONIC is required\n");
        process.exit(1);
    }
    if (provided.length > 1) {
        process.stderr.write("Error: only one of --seed or --mnemonic may be provided (including env vars)\n");
        process.exit(1);
    }
    if (options.seed)
        process.stderr.write("Warning: passing seed via flag is insecure. Use $WALLET_SEED env var instead.\n");
    if (options.mnemonic)
        process.stderr.write("Warning: passing mnemonic via flag is insecure. Use $WALLET_MNEMONIC env var instead.\n");
    let privateKey;
    let keyType;
    if (effectiveSeed !== undefined) {
        const keypair = (0, ripple_keypairs_1.deriveKeypair)(effectiveSeed);
        privateKey = keypair.privateKey;
        keyType =
            options.keyType ??
                (privateKey.toUpperCase().startsWith("ED") ? "ed25519" : "secp256k1");
    }
    else {
        // mnemonic path
        keyType = options.keyType ?? "ed25519";
        const wallet = xrpl_1.Wallet.fromMnemonic(effectiveMnemonic, {
            mnemonicEncoding: "bip39",
            derivationPath: options.derivationPath,
            algorithm: toAlgorithm(keyType),
        });
        privateKey = wallet.privateKey;
    }
    if (options.json) {
        console.log(JSON.stringify({ privateKey, keyType }));
    }
    else {
        console.log(`Private Key: ${privateKey}`);
        console.log(`Key Type:    ${keyType}`);
    }
});
