"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clawbackCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
const ripple_keypairs_1 = require("ripple-keypairs");
const client_1 = require("../utils/client");
const node_1 = require("../utils/node");
const keystore_1 = require("../utils/keystore");
const prompt_1 = require("../utils/prompt");
const amount_1 = require("../utils/amount");
function walletFromSeed(seed) {
    const { publicKey, privateKey } = (0, ripple_keypairs_1.deriveKeypair)(seed);
    return new xrpl_1.Wallet(publicKey, privateKey);
}
exports.clawbackCommand = new commander_1.Command("clawback")
    .description("Claw back issued tokens (IOU or MPT) from a holder account")
    .requiredOption("--amount <amount>", "For IOU tokens: value/CURRENCY/holder-address (holder-address is the account to claw back from, not the token issuer). For MPT tokens: value/MPT_ISSUANCE_ID")
    .option("--holder <address>", "Holder address to claw back from (required for MPT mode only)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Parse amount
    let parsed;
    try {
        parsed = (0, amount_1.parseAmount)(options.amount);
    }
    catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
    }
    // Reject XRP amounts
    if (parsed.type === "xrp") {
        process.stderr.write("Error: clawback requires an IOU or MPT amount, not XRP\n");
        process.exit(1);
    }
    // Reject zero amounts
    if (Number(parsed.value) === 0) {
        process.stderr.write("Error: amount value must not be zero\n");
        process.exit(1);
    }
    // Mode detection: --holder present = MPT mode; absent = IOU mode
    if (options.holder !== undefined) {
        // MPT mode: amount must be MPT format (2-part)
        if (parsed.type === "iou") {
            process.stderr.write("Error: --holder is only valid for MPT mode. For IOU clawback, use value/CURRENCY/holder-address format without --holder\n");
            process.exit(1);
        }
    }
    else {
        // IOU mode: amount must be IOU format (3-part)
        if (parsed.type === "mpt") {
            process.stderr.write("Error: MPT clawback requires --holder <address> to specify the token holder\n");
            process.exit(1);
        }
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
    // Build the Clawback transaction
    let tx;
    if (parsed.type === "iou") {
        // IOU wire format: issuer sub-field holds the HOLDER address
        tx = {
            TransactionType: "Clawback",
            Account: signerWallet.address,
            Amount: {
                value: parsed.value,
                currency: parsed.currency,
                issuer: parsed.issuer, // parsed.issuer = holder address from CLI input
            },
        };
    }
    else {
        // MPT wire format: Amount has mpt_issuance_id; Holder field has the holder address
        tx = {
            TransactionType: "Clawback",
            Account: signerWallet.address,
            Amount: {
                value: parsed.value,
                mpt_issuance_id: parsed.mpt_issuance_id,
            },
            Holder: options.holder,
        };
    }
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const filled = await client.autofill(tx);
        if (options.dryRun) {
            const signed = signerWallet.sign(filled);
            console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
            return;
        }
        const signed = signerWallet.sign(filled);
        if (!options.wait) {
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
