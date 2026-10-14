"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrustSetFlags = exports.trustCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
Object.defineProperty(exports, "TrustSetFlags", { enumerable: true, get: function () { return xrpl_1.TrustSetFlags; } });
const ripple_keypairs_1 = require("ripple-keypairs");
const client_1 = require("../utils/client");
const node_1 = require("../utils/node");
const keystore_1 = require("../utils/keystore");
const prompt_1 = require("../utils/prompt");
function walletFromSeed(seed) {
    const { publicKey, privateKey } = (0, ripple_keypairs_1.deriveKeypair)(seed);
    return new xrpl_1.Wallet(publicKey, privateKey);
}
function validateCurrency(currency) {
    const upper = currency.toUpperCase();
    // 3-char ASCII (uppercase letters/digits)
    if (/^[A-Z0-9]{3}$/.test(upper)) {
        return upper;
    }
    // 40-char hex
    if (/^[0-9A-Fa-f]{40}$/.test(currency)) {
        return currency.toUpperCase();
    }
    throw new Error(`Invalid currency '${currency}': must be a 3-character ASCII code (e.g. USD) or 40-character hex string`);
}
const trustSetCommand = new commander_1.Command("set")
    .alias("s")
    .description("Create or update a trust line")
    .requiredOption("--currency <code>", "Currency code (3-char ASCII or 40-char hex)")
    .requiredOption("--issuer <address-or-alias>", "Issuer address or alias")
    .requiredOption("--limit <value>", "Trust line limit (0 removes the trust line)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation", false)
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .option("--no-ripple", "Set NoRipple flag on trust line")
    .option("--clear-no-ripple", "Clear NoRipple flag on trust line", false)
    .option("--freeze", "Freeze the trust line", false)
    .option("--unfreeze", "Unfreeze the trust line", false)
    .option("--auth", "Authorize the trust line", false)
    .option("--quality-in <n>", "Set QualityIn (unsigned integer)")
    .option("--quality-out <n>", "Set QualityOut (unsigned integer)")
    .action(async (options, cmd) => {
    // Validate currency
    let currency;
    try {
        currency = validateCurrency(options.currency);
    }
    catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
    }
    // Validate flag combinations
    // Commander converts --no-ripple to options.ripple = false
    const noRipple = options.ripple === false;
    if (noRipple && options.clearNoRipple) {
        process.stderr.write("Error: --no-ripple and --clear-no-ripple are mutually exclusive\n");
        process.exit(1);
    }
    if (options.freeze && options.unfreeze) {
        process.stderr.write("Error: --freeze and --unfreeze are mutually exclusive\n");
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
    // Resolve issuer
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const issuer = (0, keystore_1.resolveAccount)(options.issuer, keystoreDir);
    // Build TrustSet transaction
    const tx = {
        TransactionType: "TrustSet",
        Account: signerWallet.address,
        LimitAmount: {
            currency: currency,
            issuer,
            value: options.limit,
        },
    };
    // Apply flags via bitwise OR
    let flags = 0;
    if (noRipple)
        flags |= xrpl_1.TrustSetFlags.tfSetNoRipple;
    if (options.clearNoRipple)
        flags |= xrpl_1.TrustSetFlags.tfClearNoRipple;
    if (options.freeze)
        flags |= xrpl_1.TrustSetFlags.tfSetFreeze;
    if (options.unfreeze)
        flags |= xrpl_1.TrustSetFlags.tfClearFreeze;
    if (options.auth)
        flags |= xrpl_1.TrustSetFlags.tfSetfAuth;
    if (flags !== 0)
        tx.Flags = flags;
    // Apply quality fields
    if (options.qualityIn !== undefined)
        tx.QualityIn = parseInt(options.qualityIn, 10);
    if (options.qualityOut !== undefined)
        tx.QualityOut = parseInt(options.qualityOut, 10);
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const filled = await client.autofill(tx);
        if (options.dryRun) {
            const signed = signerWallet.sign(filled);
            console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
            return;
        }
        const signed = signerWallet.sign(filled);
        if (options.noWait) {
            await client.submit(signed.tx_blob);
            if (options.json) {
                console.log(JSON.stringify({ hash: signed.hash }));
            }
            else {
                console.log(`Transaction: ${signed.hash}`);
            }
            return;
        }
        // submitAndWait
        let response;
        try {
            response = await client.submitAndWait(signed.tx_blob);
        }
        catch (e) {
            const err = e;
            if (err.constructor.name === "TimeoutError" || err.message?.includes("LastLedgerSequence")) {
                process.stderr.write("Error: transaction expired (LastLedgerSequence exceeded)\n");
                process.exit(1);
            }
            throw e;
        }
        const txResult = response.result;
        const resultCode = txResult.meta?.TransactionResult ?? "unknown";
        const hash = txResult.hash ?? signed.hash;
        const feeDrops = txResult.tx_json?.Fee ?? "0";
        const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
        const ledger = txResult.ledger_index;
        // Exit 1 on tec/tef/tem codes
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
            }
            process.exit(1);
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
        }
        else {
            console.log(`Transaction: ${hash}`);
            console.log(`Result:      ${resultCode}`);
            console.log(`Fee:         ${feeXrp} XRP`);
            console.log(`Ledger:      ${ledger}`);
        }
    });
});
exports.trustCommand = new commander_1.Command("trust")
    .description("Manage XRPL trust lines")
    .addCommand(trustSetCommand);
