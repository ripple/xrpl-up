"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newWalletCommand = void 0;
const commander_1 = require("commander");
const xrpl_1 = require("xrpl");
const fs_1 = require("fs");
const path_1 = require("path");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
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
        process.stderr.write("Warning: passing passwords via flag is insecure. Use $WALLET_PASSWORD env var instead.\n");
        password = options.password;
    }
    else if (process.env["WALLET_PASSWORD"]) {
        password = process.env["WALLET_PASSWORD"];
    }
    else if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write("Error: --password or $WALLET_PASSWORD is required when --save is used in non-interactive mode\n");
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
exports.newWalletCommand = new commander_1.Command("new")
    .alias("n")
    .description("Generate a new random XRPL wallet")
    .option("--key-type <type>", "Key algorithm: secp256k1 or ed25519", "ed25519")
    .option("--json", "Output as JSON", false)
    .option("--save", "Encrypt and save the wallet to the keystore", false)
    .option("--show-secret", "Show the seed and private key (hidden by default)", false)
    .option("--password <password>", "Encryption password for --save (insecure, prefer $WALLET_PASSWORD env var or interactive prompt)")
    .option("--alias <name>", "Set a human-readable alias when saving to keystore")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .action(async (options) => {
    const wallet = xrpl_1.Wallet.generate(toAlgorithm(options.keyType));
    if (options.json) {
        const output = {
            address: wallet.address,
            publicKey: wallet.publicKey,
            keyType: options.keyType,
        };
        if (options.showSecret) {
            output.privateKey = wallet.privateKey;
            output.seed = wallet.seed;
        }
        if (options.save) {
            const filePath = await saveToKeystore(wallet.address, wallet.seed, options.keyType, options);
            output["keystorePath"] = filePath;
        }
        console.log(JSON.stringify(output));
    }
    else {
        console.log(`Address:     ${wallet.address}`);
        console.log(`Public Key:  ${wallet.publicKey}`);
        if (options.showSecret) {
            console.log(`Private Key: ${wallet.privateKey}`);
            console.log(`Seed:        ${wallet.seed}`);
        }
        else {
            console.log(`Private Key: [hidden] (use --show-secret to see it)`);
            console.log(`Seed:        [hidden] (use --show-secret to see it)`);
        }
        if (options.save) {
            const filePath = await saveToKeystore(wallet.address, wallet.seed, options.keyType, options);
            console.log(`Saved to ${filePath}`);
        }
    }
});
