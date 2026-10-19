"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const ripple_keypairs_1 = require("ripple-keypairs");
const xrpl_1 = require("xrpl");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
function toAlgorithm(keyType) {
    return (keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519");
}
function getKeystoreDir(options) {
    if (options.keystore) {
        return (0, path_1.resolve)(options.keystore);
    }
    const envDir = process.env["XRPL_KEYSTORE"];
    if (envDir) {
        return (0, path_1.resolve)(envDir);
    }
    return (0, path_1.join)((0, os_1.homedir)(), ".xrpl", "keystore");
}
function detectMaterialType(material) {
    if (material.trim().split(/\s+/).length > 1)
        return "mnemonic";
    if (/^s[a-zA-Z0-9]{20,}$/.test(material))
        return "seed";
    return "privateKey";
}
function walletFromSeed(seed) {
    const { publicKey, privateKey } = (0, ripple_keypairs_1.deriveKeypair)(seed);
    return new xrpl_1.Wallet(publicKey, privateKey);
}
function walletFromMnemonic(mnemonic, keyType, derivationPath) {
    return xrpl_1.Wallet.fromMnemonic(mnemonic, {
        mnemonicEncoding: "bip39",
        derivationPath: derivationPath ?? DEFAULT_DERIVATION_PATH,
        algorithm: toAlgorithm(keyType),
    });
}
function walletFromPrivateKey(privateKey, keyType) {
    // Derive public key from private key using xrpl's Wallet approach
    // We use deriveKeypair trick via a seed - but for raw private keys we need @noble/curves
    // Import dynamically to avoid circular issues; these are transitive deps
    // We reconstruct the wallet by signing a dummy and checking — but the cleaner way is:
    // xrpl.Wallet can be constructed with (publicKey, privateKey)
    // We must derive the public key first
    let publicKey;
    if (keyType === "ed25519") {
        // Use @noble/curves/ed25519 to derive public key
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ed25519: noble } = require("@noble/curves/ed25519.js");
        const rawPriv = Buffer.from(privateKey.toUpperCase().startsWith("ED") ? privateKey.slice(2) : privateKey, "hex");
        const pubBytes = noble.getPublicKey(rawPriv);
        publicKey = "ED" + Buffer.from(pubBytes).toString("hex").toUpperCase();
    }
    else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { secp256k1: noble } = require("@noble/curves/secp256k1.js");
        const rawPriv = Buffer.from(privateKey.toUpperCase().startsWith("00") ? privateKey.slice(2) : privateKey, "hex");
        const pubBytes = noble.getPublicKey(rawPriv, true);
        publicKey = Buffer.from(pubBytes).toString("hex").toUpperCase();
    }
    return new xrpl_1.Wallet(publicKey, privateKey);
}
exports.signCommand = new commander_1.Command("sign")
    .alias("s")
    .description("Sign a message or XRPL transaction")
    .option("--message <string>", "UTF-8 message to sign (use --from-hex for hex-encoded)")
    .option("--from-hex", "Treat --message value as already hex-encoded", false)
    .option("--tx <json-or-path>", "Transaction JSON (inline or file path) to sign")
    .option("--seed <seed>", "Family seed for signing (insecure, prefer $WALLET_SEED env var)")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing (insecure, prefer $WALLET_MNEMONIC env var)")
    .option("--account <address>", "Account address to load from keystore (requires --password or $WALLET_PASSWORD)")
    .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519 (used with --seed or --mnemonic)")
    .option("--password <password>", "Keystore decryption password (insecure, prefer $WALLET_PASSWORD env var or interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--json", "Output as JSON", false)
    .action(async (options) => {
    if (!options.message && !options.tx) {
        process.stderr.write("Error: provide either --message or --tx\n");
        process.exit(1);
    }
    const keyMaterialCount = [
        options.seed ?? process.env["WALLET_SEED"],
        options.mnemonic ?? process.env["WALLET_MNEMONIC"],
        options.account,
    ].filter(Boolean).length;
    if (keyMaterialCount === 0) {
        process.stderr.write("Error: provide key material via --seed, --mnemonic, --account, $WALLET_SEED, or $WALLET_MNEMONIC\n");
        process.exit(1);
    }
    if (keyMaterialCount > 1) {
        process.stderr.write("Error: provide only one of --seed, --mnemonic, or --account (including env vars)\n");
        process.exit(1);
    }
    let signerWallet;
    const effectiveSeed = options.seed ?? process.env["WALLET_SEED"];
    const effectiveMnemonic = options.mnemonic ?? process.env["WALLET_MNEMONIC"];
    if (effectiveSeed) {
        if (options.seed)
            process.stderr.write("Warning: passing seed via flag is insecure. Use $WALLET_SEED env var instead.\n");
        signerWallet = walletFromSeed(effectiveSeed);
    }
    else if (effectiveMnemonic) {
        if (options.mnemonic)
            process.stderr.write("Warning: passing mnemonic via flag is insecure. Use $WALLET_MNEMONIC env var instead.\n");
        const keyType = options.keyType ?? "ed25519";
        signerWallet = walletFromMnemonic(effectiveMnemonic, keyType);
    }
    else {
        // --account: load from keystore
        const keystoreDir = getKeystoreDir(options);
        const filePath = (0, path_1.join)(keystoreDir, `${options.account}.json`);
        if (!(0, fs_1.existsSync)(filePath)) {
            process.stderr.write(`Error: keystore file not found for account ${options.account}\n`);
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
        const password = await (0, prompt_1.resolveSecret)(options.password, "WALLET_PASSWORD", "Password: ");
        let material;
        try {
            material = (0, keystore_1.decryptKeystore)(keystoreData, password);
        }
        catch {
            process.stderr.write("Error: wrong password or corrupt keystore\n");
            process.exit(1);
        }
        const materialType = detectMaterialType(material);
        const storedKeyType = keystoreData.keyType;
        if (materialType === "seed") {
            signerWallet = walletFromSeed(material);
        }
        else if (materialType === "mnemonic") {
            signerWallet = walletFromMnemonic(material, storedKeyType);
        }
        else {
            signerWallet = walletFromPrivateKey(material, storedKeyType);
        }
    }
    if (options.message !== undefined) {
        const messageHex = options.fromHex
            ? options.message
            : Buffer.from(options.message, "utf-8").toString("hex").toUpperCase();
        const signature = (0, ripple_keypairs_1.sign)(messageHex, signerWallet.privateKey);
        if (options.json) {
            console.log(JSON.stringify({ signature }));
        }
        else {
            console.log(signature);
        }
    }
    else {
        // --tx mode
        let txJson;
        try {
            txJson = JSON.parse(options.tx);
        }
        catch {
            // Try as file path
            const filePath = (0, path_1.resolve)(options.tx);
            if (!(0, fs_1.existsSync)(filePath)) {
                process.stderr.write(`Error: could not parse as JSON and file not found: ${options.tx}\n`);
                process.exit(1);
            }
            try {
                txJson = JSON.parse((0, fs_1.readFileSync)(filePath, "utf-8"));
            }
            catch {
                process.stderr.write(`Error: failed to parse transaction JSON from file: ${options.tx}\n`);
                process.exit(1);
            }
        }
        const signed = signerWallet.sign(txJson);
        if (options.json) {
            console.log(JSON.stringify({ tx_blob: signed.tx_blob, hash: signed.hash }));
        }
        else {
            console.log(`tx_blob: ${signed.tx_blob}`);
            console.log(`hash: ${signed.hash}`);
        }
    }
});
