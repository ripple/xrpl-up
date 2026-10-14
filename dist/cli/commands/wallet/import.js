"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const ripple_keypairs_1 = require("ripple-keypairs");
const xrpl_1 = require("xrpl");
const ed25519_js_1 = require("@noble/curves/ed25519.js");
const secp256k1_js_1 = require("@noble/curves/secp256k1.js");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
function toAlgorithm(keyType) {
    return (keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519");
}
function bytesToHex(bytes) {
    return Buffer.from(bytes).toString("hex").toUpperCase();
}
function hexToBytes(hex) {
    return Buffer.from(hex, "hex");
}
function detectKeyMaterialType(input) {
    if (input.trim().split(/\s+/).length > 1) {
        return "mnemonic";
    }
    if (/^s[a-zA-Z0-9]{20,}$/.test(input)) {
        return "seed";
    }
    return "privateKey";
}
function deriveFromSeed(seed) {
    const keypair = (0, ripple_keypairs_1.deriveKeypair)(seed);
    const address = (0, ripple_keypairs_1.deriveAddress)(keypair.publicKey);
    const keyType = keypair.privateKey.toUpperCase().startsWith("ED") ? "ed25519" : "secp256k1";
    return { address, seedToEncrypt: seed, keyType };
}
function deriveFromMnemonic(mnemonic, keyType, derivationPath) {
    const wallet = xrpl_1.Wallet.fromMnemonic(mnemonic, {
        mnemonicEncoding: "bip39",
        derivationPath: derivationPath ?? DEFAULT_DERIVATION_PATH,
        algorithm: toAlgorithm(keyType),
    });
    return { address: wallet.address, seedToEncrypt: mnemonic, keyType };
}
function deriveFromPrivateKey(privateKeyHex, keyTypeOption) {
    let publicKey;
    let keyType;
    if (privateKeyHex.startsWith("ED") || privateKeyHex.startsWith("ed")) {
        const rawPrivKey = hexToBytes(privateKeyHex.slice(2));
        publicKey = "ED" + bytesToHex(ed25519_js_1.ed25519.getPublicKey(rawPrivKey));
        keyType = "ed25519";
    }
    else if (privateKeyHex.startsWith("00")) {
        const rawPrivKey = hexToBytes(privateKeyHex.slice(2));
        publicKey = bytesToHex(secp256k1_js_1.secp256k1.getPublicKey(rawPrivKey, true));
        keyType = "secp256k1";
    }
    else if (keyTypeOption === "ed25519") {
        const rawPrivKey = hexToBytes(privateKeyHex);
        publicKey = "ED" + bytesToHex(ed25519_js_1.ed25519.getPublicKey(rawPrivKey));
        keyType = "ed25519";
    }
    else if (keyTypeOption === "secp256k1") {
        const rawPrivKey = hexToBytes(privateKeyHex);
        publicKey = bytesToHex(secp256k1_js_1.secp256k1.getPublicKey(rawPrivKey, true));
        keyType = "secp256k1";
    }
    else {
        process.stderr.write("Error: --key-type is required when importing a raw hex private key without a recognized prefix\n");
        process.exit(1);
    }
    const address = (0, ripple_keypairs_1.deriveAddress)(publicKey);
    return { address, seedToEncrypt: privateKeyHex, keyType };
}
function checkAliasUniqueness(name, excludeAddress, keystoreDir) {
    let files;
    try {
        files = (0, fs_1.readdirSync)(keystoreDir).filter((f) => f.endsWith(".json"));
    }
    catch {
        return null;
    }
    for (const file of files) {
        try {
            const data = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(keystoreDir, file), "utf-8"));
            if (data.label === name && data.address && data.address !== excludeAddress) {
                return data.address;
            }
        }
        catch {
            // skip unreadable files
        }
    }
    return null;
}
exports.importCommand = new commander_1.Command("import")
    .alias("i")
    .description("Import key material into encrypted keystore")
    .argument("[key-material]", "Seed, mnemonic, or private key to import (use '-' to read from stdin, or set WALLET_KEY env var)")
    .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519 (required for unprefixed hex private keys)")
    .option("--password <password>", "Encryption password (insecure, prefer $WALLET_PASSWORD env var or interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--force", "Overwrite existing keystore entry", false)
    .option("--alias <name>", "Set a human-readable alias for this wallet at import time")
    .action(async (keyMaterial, options) => {
    // Resolve key material: flag → env var → stdin pipe → interactive prompt
    let input;
    if (keyMaterial !== undefined && keyMaterial !== "-") {
        process.stderr.write("Warning: passing key material via argument is insecure. Use $WALLET_KEY env var or '-' to read from stdin.\n");
        input = keyMaterial;
    }
    else if (keyMaterial === "-") {
        input = (0, fs_1.readFileSync)("/dev/stdin", "utf-8").trim();
    }
    else if (process.env["WALLET_KEY"]) {
        input = process.env["WALLET_KEY"];
    }
    else {
        input = await (0, prompt_1.promptPassword)("Key material (seed/mnemonic/private key): ");
    }
    const password = await (0, prompt_1.resolveSecret)(options.password, "WALLET_PASSWORD", "Password: ");
    const keyMaterialType = detectKeyMaterialType(input);
    let address;
    let seedToEncrypt;
    let keyType;
    if (keyMaterialType === "seed") {
        const result = deriveFromSeed(input);
        address = result.address;
        seedToEncrypt = result.seedToEncrypt;
        keyType = result.keyType;
    }
    else if (keyMaterialType === "mnemonic") {
        const result = deriveFromMnemonic(input, options.keyType ?? "ed25519");
        address = result.address;
        seedToEncrypt = result.seedToEncrypt;
        keyType = result.keyType;
    }
    else {
        const result = deriveFromPrivateKey(input, options.keyType);
        address = result.address;
        seedToEncrypt = result.seedToEncrypt;
        keyType = result.keyType;
    }
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    (0, fs_1.mkdirSync)(keystoreDir, { recursive: true });
    const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    if ((0, fs_1.existsSync)(filePath) && !options.force) {
        process.stderr.write(`Error: keystore for ${address} already exists. Use --force to overwrite.\n`);
        process.exit(1);
    }
    if (options.alias !== undefined) {
        const conflictAddress = checkAliasUniqueness(options.alias, address, keystoreDir);
        if (conflictAddress !== null && !options.force) {
            process.stderr.write(`Error: alias '${options.alias}' is already used by ${conflictAddress}. Use --force to overwrite.\n`);
            process.exit(1);
        }
    }
    const keystoreData = (0, keystore_1.encryptKeystore)(seedToEncrypt, password, keyType, address, options.alias);
    (0, fs_1.writeFileSync)(filePath, JSON.stringify(keystoreData, null, 2), "utf-8");
    if (options.alias !== undefined) {
        console.log(`Imported account ${address} (alias: ${options.alias}) to ${filePath}`);
    }
    else {
        console.log(`Imported account ${address} to ${filePath}`);
    }
});
