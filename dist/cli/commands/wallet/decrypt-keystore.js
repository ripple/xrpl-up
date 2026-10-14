"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptKeystoreCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const ripple_keypairs_1 = require("ripple-keypairs");
const xrpl_1 = require("xrpl");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
function toAlgorithm(keyType) {
    return (keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519");
}
function detectStoredMaterialType(material) {
    if (material.trim().split(/\s+/).length > 1) {
        return "mnemonic";
    }
    if (/^s[a-zA-Z0-9]{20,}$/.test(material)) {
        return "seed";
    }
    return "privateKey";
}
function derivePrivateKeyFromMaterial(material, keyType) {
    const materialType = detectStoredMaterialType(material);
    if (materialType === "seed") {
        return (0, ripple_keypairs_1.deriveKeypair)(material).privateKey;
    }
    else if (materialType === "mnemonic") {
        const wallet = xrpl_1.Wallet.fromMnemonic(material, {
            mnemonicEncoding: "bip39",
            derivationPath: DEFAULT_DERIVATION_PATH,
            algorithm: toAlgorithm(keyType),
        });
        return wallet.privateKey;
    }
    else {
        // raw private key stored directly
        return material;
    }
}
exports.decryptKeystoreCommand = new commander_1.Command("decrypt-keystore")
    .alias("dk")
    .description("Decrypt a keystore file to retrieve the seed or private key")
    .argument("[address]", "XRPL address to look up in keystore (required unless --file is used)")
    .option("--file <path>", "Explicit keystore file path (overrides address lookup)")
    .option("--password <password>", "Decryption password (insecure, prefer interactive prompt)")
    .option("--show-private-key", "Also print the private key hex", false)
    .option("--json", "Output as JSON {address, seed, privateKey, keyType}", false)
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .action(async (address, options) => {
    let filePath;
    if (options.file) {
        filePath = (0, path_1.resolve)(options.file);
    }
    else if (address) {
        const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
        filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    }
    else {
        process.stderr.write("Error: provide an address or --file <path>\n");
        process.exit(1);
    }
    if (!(0, fs_1.existsSync)(filePath)) {
        process.stderr.write(`Error: keystore file not found: ${filePath}\n`);
        process.exit(1);
    }
    let keystoreData;
    try {
        keystoreData = JSON.parse((0, fs_1.readFileSync)(filePath, "utf-8"));
    }
    catch {
        process.stderr.write("Error: failed to read or parse keystore file\n");
        process.exit(1);
    }
    let password;
    if (options.password !== undefined) {
        process.stderr.write("Warning: passing passwords via flag is insecure\n");
        password = options.password;
    }
    else {
        password = await (0, prompt_1.promptPassword)();
    }
    let seed;
    try {
        seed = (0, keystore_1.decryptKeystore)(keystoreData, password);
    }
    catch {
        process.stderr.write("Error: wrong password or corrupt keystore\n");
        process.exit(1);
    }
    const keyType = keystoreData.keyType;
    const resolvedAddress = keystoreData.address;
    if (options.json) {
        const privateKey = derivePrivateKeyFromMaterial(seed, keyType);
        console.log(JSON.stringify({ address: resolvedAddress, seed, privateKey, keyType }));
    }
    else {
        console.log(`Seed: ${seed}`);
        if (options.showPrivateKey) {
            const privateKey = derivePrivateKeyFromMaterial(seed, keyType);
            console.log(`Private Key: ${privateKey}`);
        }
    }
});
