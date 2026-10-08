"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentCommand = void 0;
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
exports.paymentCommand = new commander_1.Command("payment")
    .alias("send")
    .description("Send a Payment transaction on the XRP Ledger")
    .requiredOption("--to <address-or-alias>", "Destination address or alias")
    .requiredOption("--amount <amount>", "Amount to send (e.g. 1.5 for XRP, 10/USD/rIssuer for IOU, 100/<48-hex> for MPT)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--destination-tag <n>", "Destination tag (unsigned 32-bit integer)")
    .option("--memo <text>", "Memo text to attach (repeatable)", (val, prev) => [...(prev ?? []), val], [])
    .option("--memo-type <hex>", "MemoType hex for the last memo")
    .option("--memo-format <hex>", "MemoFormat hex for the last memo")
    .option("--send-max <amount>", "SendMax field; supports XRP, IOU, and MPT amounts")
    .option("--deliver-min <amount>", "DeliverMin field; automatically adds tfPartialPayment flag")
    .option("--paths <json-or-file>", "Payment paths as JSON array or path to a .json file")
    .option("--partial", "Set tfPartialPayment flag", false)
    .option("--no-ripple-direct", "Set tfNoRippleDirect flag (value 0x00010000)")
    .option("--limit-quality", "Set tfLimitQuality flag (value 0x00080000)", false)
    .option("--no-wait", "Submit without waiting for validation", false)
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
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
    // Parse amount
    let xrplAmount;
    try {
        xrplAmount = (0, amount_1.toXrplAmount)((0, amount_1.parseAmount)(options.amount));
    }
    catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
    }
    // Parse --send-max
    let xrplSendMax;
    if (options.sendMax !== undefined) {
        try {
            xrplSendMax = (0, amount_1.toXrplAmount)((0, amount_1.parseAmount)(options.sendMax));
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Parse --deliver-min
    let xrplDeliverMin;
    if (options.deliverMin !== undefined) {
        try {
            xrplDeliverMin = (0, amount_1.toXrplAmount)((0, amount_1.parseAmount)(options.deliverMin));
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Parse --paths
    let xrplPaths;
    if (options.paths !== undefined) {
        try {
            const raw = options.paths.endsWith(".json")
                ? (0, fs_1.readFileSync)(options.paths, "utf-8")
                : options.paths;
            xrplPaths = JSON.parse(raw);
        }
        catch (e) {
            process.stderr.write(`Error: failed to parse --paths: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Resolve destination
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const destination = (0, keystore_1.resolveAccount)(options.to, keystoreDir);
    // Validate destination tag
    let destTag;
    if (options.destinationTag !== undefined) {
        const tagNum = Number(options.destinationTag);
        if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
            process.stderr.write(`Error: --destination-tag must be an integer between 0 and 4294967295\n`);
            process.exit(1);
        }
        destTag = tagNum;
    }
    // Build memos
    let memos;
    if (options.memo && options.memo.length > 0) {
        memos = options.memo.map((text, idx) => {
            const memoData = Buffer.from(text, "utf8").toString("hex").toUpperCase();
            const memo = { MemoData: memoData };
            if (idx === options.memo.length - 1) {
                if (options.memoType)
                    memo.MemoType = options.memoType;
                if (options.memoFormat)
                    memo.MemoFormat = options.memoFormat;
            }
            return { Memo: memo };
        });
    }
    // Compute combined payment flags
    let combinedFlags = 0;
    if (options.partial || xrplDeliverMin !== undefined)
        combinedFlags |= xrpl_1.PaymentFlags.tfPartialPayment;
    if (!options.rippleDirect)
        combinedFlags |= xrpl_1.PaymentFlags.tfNoRippleDirect;
    if (options.limitQuality)
        combinedFlags |= xrpl_1.PaymentFlags.tfLimitQuality;
    // Build the Payment transaction
    const tx = {
        TransactionType: "Payment",
        Account: signerWallet.address,
        Destination: destination,
        Amount: xrplAmount,
        ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
        ...(memos ? { Memos: memos } : {}),
        ...(xrplSendMax !== undefined ? { SendMax: xrplSendMax } : {}),
        ...(xrplDeliverMin !== undefined ? { DeliverMin: xrplDeliverMin } : {}),
        ...(combinedFlags !== 0 ? { Flags: combinedFlags } : {}),
        ...(xrplPaths !== undefined && xrplPaths.length > 0 ? { Paths: xrplPaths } : {}),
    };
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
                const failOut = { hash, result: resultCode, fee: feeXrp, ledger };
                if (destTag !== undefined)
                    failOut.destinationTag = destTag;
                if (memos)
                    failOut.memos = memos;
                console.log(JSON.stringify(failOut));
            }
            process.exit(1);
        }
        if (options.json) {
            const out = { hash, result: resultCode, fee: feeXrp, ledger };
            if (destTag !== undefined)
                out.destinationTag = destTag;
            if (memos)
                out.memos = memos;
            if (options.partial && txResult.meta?.delivered_amount !== undefined) {
                out.deliveredAmount = txResult.meta.delivered_amount;
            }
            console.log(JSON.stringify(out));
        }
        else {
            console.log(`Transaction: ${hash}`);
            console.log(`Result:      ${resultCode}`);
            console.log(`Fee:         ${feeXrp} XRP`);
            console.log(`Ledger:      ${ledger}`);
            if (destTag !== undefined)
                console.log(`Destination Tag: ${destTag}`);
        }
    });
});
