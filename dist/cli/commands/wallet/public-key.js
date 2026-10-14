"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicKeyCommand = void 0;
const commander_1 = require("commander");
const xrpl_1 = require("xrpl");
const ed25519_js_1 = require("@noble/curves/ed25519.js");
const secp256k1_js_1 = require("@noble/curves/secp256k1.js");
const ripple_keypairs_1 = require("ripple-keypairs");
const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
function toAlgorithm(keyType) {
    const value = keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519";
    return value;
}
function bytesToHex(bytes) {
    return Buffer.from(bytes).toString("hex").toUpperCase();
}
function hexToBytes(hex) {
    return Buffer.from(hex, "hex");
}
function derivePublicKeyFromPrivate(privateKeyHex) {
    if (privateKeyHex.startsWith("ED") || privateKeyHex.startsWith("ed")) {
        const rawPrivKey = hexToBytes(privateKeyHex.slice(2));
        const pubKeyBytes = ed25519_js_1.ed25519.getPublicKey(rawPrivKey);
        return { publicKey: "ED" + bytesToHex(pubKeyBytes), keyType: "ed25519" };
    }
    else if (privateKeyHex.startsWith("00")) {
        const rawPrivKey = hexToBytes(privateKeyHex.slice(2));
        const pubKeyBytes = secp256k1_js_1.secp256k1.getPublicKey(rawPrivKey, true);
        return { publicKey: bytesToHex(pubKeyBytes), keyType: "secp256k1" };
    }
    else {
        process.stderr.write("Error: cannot infer key type from private key — use --key-type secp256k1 or --key-type ed25519\n");
        process.exit(1);
    }
}
exports.publicKeyCommand = new commander_1.Command("public-key")
    .alias("pubkey")
    .description("Derive public key from key material")
    .option("--seed <seed>", "Family seed (sXXX...)")
    .option("--mnemonic <phrase>", "BIP39 mnemonic phrase")
    .option("--private-key <hex>", "Raw private key as hex (ED-prefixed for ed25519, 00-prefixed for secp256k1)")
    .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519")
    .option("--derivation-path <path>", "BIP44 derivation path (used with --mnemonic)", DEFAULT_DERIVATION_PATH)
    .option("--json", "Output as JSON", false)
    .action((options) => {
    const provided = [options.seed, options.mnemonic, options.privateKey].filter((v) => v !== undefined);
    if (provided.length === 0) {
        process.stderr.write("Error: one of --seed, --mnemonic, or --private-key is required\n");
        process.exit(1);
    }
    if (provided.length > 1) {
        process.stderr.write("Error: only one of --seed, --mnemonic, or --private-key may be provided\n");
        process.exit(1);
    }
    let publicKey;
    let keyType;
    if (options.seed !== undefined) {
        const keypair = (0, ripple_keypairs_1.deriveKeypair)(options.seed);
        publicKey = keypair.publicKey;
        keyType =
            options.keyType ??
                (keypair.privateKey.toUpperCase().startsWith("ED") ? "ed25519" : "secp256k1");
    }
    else if (options.mnemonic !== undefined) {
        keyType = options.keyType ?? "ed25519";
        const wallet = xrpl_1.Wallet.fromMnemonic(options.mnemonic, {
            mnemonicEncoding: "bip39",
            derivationPath: options.derivationPath,
            algorithm: toAlgorithm(keyType),
        });
        publicKey = wallet.publicKey;
    }
    else {
        // --private-key path
        const derived = derivePublicKeyFromPrivate(options.privateKey);
        publicKey = derived.publicKey;
        keyType = options.keyType ?? derived.keyType;
    }
    if (options.json) {
        console.log(JSON.stringify({ publicKey, keyType }));
    }
    else {
        console.log(`Public Key: ${publicKey}`);
        console.log(`Key Type:   ${keyType}`);
    }
});
