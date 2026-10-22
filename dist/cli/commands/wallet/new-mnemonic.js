"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newMnemonicCommand = void 0;
const commander_1 = require("commander");
const xrpl_1 = require("xrpl");
const bip39_1 = require("@scure/bip39");
const english_js_1 = require("@scure/bip39/wordlists/english.js");
const fs_1 = require("fs");
const path_1 = require("path");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
function toAlgorithm(keyType) {
    const value = keyType === "secp256k1" ? "ecdsa-secp256k1" : "ed25519";
    return value;
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
async function saveToKeystore(address, secret, keyType, options) {
    let password;
    if (options.password !== undefined) {
        process.stderr.write("Warning: passing passwords via flag is insecure\n");
        password = options.password;
    }
    else if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write("Error: --password is required when --save is used in non-interactive mode\n");
        process.exit(1);
    }
    else {
        password = await (0, prompt_1.promptPasswordWithConfirmation)();
    }
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    (0, fs_1.mkdirSync)(keystoreDir, { recursive: true });
    if (options.alias !== undefined) {
        const conflictAddress = checkAliasUniqueness(options.alias, address, keystoreDir);
        if (conflictAddress !== null) {
            process.stderr.write(`Error: alias '${options.alias}' is already used by ${conflictAddress}.\n`);
            process.exit(1);
        }
    }
    const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    const keystoreData = (0, keystore_1.encryptKeystore)(secret, password, keyType, address, options.alias);
    (0, fs_1.writeFileSync)(filePath, JSON.stringify(keystoreData, null, 2), "utf-8");
    return filePath;
}
exports.newMnemonicCommand = new commander_1.Command("new-mnemonic")
    .alias("nm")
    .description("Generate a new BIP39 mnemonic wallet")
    .option("--derivation-path <path>", "BIP44 derivation path", DEFAULT_DERIVATION_PATH)
    .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519", "ed25519")
    .option("--json", "Output as JSON", false)
    .option("--save", "Encrypt and save the wallet to the keystore", false)
    .option("--show-secret", "Show the mnemonic and private key (hidden by default)", false)
    .option("--password <password>", "Encryption password for --save (insecure, prefer interactive prompt)")
    .option("--alias <name>", "Set a human-readable alias when saving to keystore")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .action(async (options) => {
    const mnemonic = (0, bip39_1.generateMnemonic)(english_js_1.wordlist, 128);
    const wallet = xrpl_1.Wallet.fromMnemonic(mnemonic, {
        mnemonicEncoding: "bip39",
        derivationPath: options.derivationPath,
        algorithm: toAlgorithm(options.keyType),
    });
    if (options.json) {
        const output = {
            derivationPath: options.derivationPath,
            address: wallet.address,
            publicKey: wallet.publicKey,
            keyType: options.keyType,
        };
        if (options.showSecret) {
            output.mnemonic = mnemonic;
            output.privateKey = wallet.privateKey;
        }
        if (options.save) {
            const filePath = await saveToKeystore(wallet.address, mnemonic, options.keyType, options);
            output["keystorePath"] = filePath;
        }
        console.log(JSON.stringify(output));
    }
    else {
        if (options.showSecret) {
            console.log(`Mnemonic:         ${mnemonic}`);
        }
        else {
            console.log(`Mnemonic:         [hidden] (use --show-secret to see it)`);
        }
        console.log(`Derivation Path:  ${options.derivationPath}`);
        console.log(`Address:          ${wallet.address}`);
        console.log(`Public Key:       ${wallet.publicKey}`);
        if (options.showSecret) {
            console.log(`Private Key:      ${wallet.privateKey}`);
        }
        else {
            console.log(`Private Key:      [hidden] (use --show-secret to see it)`);
        }
        if (options.save) {
            const filePath = await saveToKeystore(wallet.address, mnemonic, options.keyType, options);
            console.log(`Saved to ${filePath}`);
        }
    }
});
