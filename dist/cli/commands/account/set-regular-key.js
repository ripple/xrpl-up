"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRegularKeyCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
const ripple_keypairs_1 = require("ripple-keypairs");
const client_1 = require("../../utils/client");
const node_1 = require("../../utils/node");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
function walletFromSeed(seed) {
    const { publicKey, privateKey } = (0, ripple_keypairs_1.deriveKeypair)(seed);
    return new xrpl_1.Wallet(publicKey, privateKey);
}
exports.setRegularKeyCommand = new commander_1.Command("set-regular-key")
    .description("Assign or remove the regular signing key on an account (SetRegularKey)")
    .option("--key <address>", "Base58 address of the new regular key to assign")
    .option("--remove", "Remove the existing regular key (omits RegularKey field from tx)", false)
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print unsigned tx JSON without submitting", false)
    .option("--no-wait", "Submit without waiting for validation")
    .action(async (options, cmd) => {
    // Validate --key and --remove are mutually exclusive
    if (options.key !== undefined && options.remove) {
        process.stderr.write("Error: --key and --remove are mutually exclusive\n");
        process.exit(1);
    }
    // Validate at least one of --key or --remove is provided
    if (options.key === undefined && !options.remove) {
        process.stderr.write("Error: provide either --key <address> or --remove\n");
        process.exit(1);
    }
    // Validate key material
    const keyMaterialCount = [options.seed, options.mnemonic, options.account].filter(Boolean).length;
    if (keyMaterialCount === 0) {
        process.stderr.write("Error: provide key material via --seed, --mnemonic, or --account\n");
        process.exit(1);
    }
    if (keyMaterialCount > 1) {
        process.stderr.write("Error: provide only one of --seed, --mnemonic, or --account\n");
        process.exit(1);
    }
    // Resolve wallet
    let signerWallet;
    if (options.seed) {
        signerWallet = walletFromSeed(options.seed);
    }
    else if (options.mnemonic) {
        signerWallet = xrpl_1.Wallet.fromMnemonic(options.mnemonic, {
            mnemonicEncoding: "bip39",
            derivationPath: "m/44'/144'/0'/0/0",
        });
    }
    else {
        // --account: load from keystore
        const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
        const address = (0, keystore_1.resolveAccount)(options.account, keystoreDir);
        const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
        if (!(0, fs_1.existsSync)(filePath)) {
            process.stderr.write(`Error: keystore file not found for account ${address}\n`);
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
        let material;
        try {
            material = (0, keystore_1.decryptKeystore)(keystoreData, password);
        }
        catch {
            process.stderr.write("Error: wrong password or corrupt keystore\n");
            process.exit(1);
        }
        if (material.trim().split(/\s+/).length > 1) {
            signerWallet = xrpl_1.Wallet.fromMnemonic(material, {
                mnemonicEncoding: "bip39",
                derivationPath: "m/44'/144'/0'/0/0",
            });
        }
        else {
            signerWallet = walletFromSeed(material);
        }
    }
    // Build the SetRegularKey transaction
    // If --key is provided, include RegularKey field; if --remove, omit it entirely
    const tx = {
        TransactionType: "SetRegularKey",
        Account: signerWallet.address,
        ...(options.key !== undefined ? { RegularKey: options.key } : {}),
    };
    if (options.dryRun) {
        console.log(JSON.stringify(tx, null, 2));
        return;
    }
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const filled = await client.autofill(tx);
        const signed = signerWallet.sign(filled);
        if (!options.wait) {
            await client.submit(signed.tx_blob);
            if (options.json) {
                console.log(JSON.stringify({ hash: signed.hash }));
            }
            else {
                console.log(`Transaction submitted: ${signed.hash}`);
            }
            return;
        }
        const response = await client.submitAndWait(signed.tx_blob);
        const txResult = response.result;
        const resultCode = txResult.meta?.TransactionResult ?? "unknown";
        const hash = txResult.hash ?? signed.hash;
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            process.exit(1);
        }
        if (options.json) {
            console.log(JSON.stringify({
                hash,
                result: resultCode,
                tx_blob: signed.tx_blob,
            }));
        }
        else {
            console.log(`Transaction submitted: ${hash}`);
        }
    });
});
