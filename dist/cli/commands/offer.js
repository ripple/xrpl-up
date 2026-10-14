"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offerCommand = void 0;
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
async function resolveWallet(options) {
    if (options.seed) {
        return walletFromSeed(options.seed);
    }
    if (options.mnemonic) {
        return xrpl_1.Wallet.fromMnemonic(options.mnemonic, {
            mnemonicEncoding: "bip39",
            derivationPath: "m/44'/144'/0'/0/0",
        });
    }
    // --account path
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
        return xrpl_1.Wallet.fromMnemonic(material, {
            mnemonicEncoding: "bip39",
            derivationPath: "m/44'/144'/0'/0/0",
        });
    }
    return walletFromSeed(material);
}
const offerCreateCommand = new commander_1.Command("create")
    .alias("c")
    .description("Create a DEX offer on the XRP Ledger")
    .requiredOption("--taker-pays <amount>", "Amount the taker pays (e.g. 1.5 for XRP, 10/USD/rIssuer for IOU)")
    .requiredOption("--taker-gets <amount>", "Amount the taker gets (e.g. 1.5 for XRP, 10/USD/rIssuer for IOU)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--sell", "Set tfSell flag — offer consumes funds in order of taker_pays", false)
    .option("--passive", "Set tfPassive flag — offer does not consume matching offers", false)
    .option("--immediate-or-cancel", "Set tfImmediateOrCancel — fill as much as possible, cancel remainder", false)
    .option("--fill-or-kill", "Set tfFillOrKill — fill completely or cancel entire offer", false)
    .option("--expiration <iso>", "Offer expiration as ISO 8601 string (e.g. 2030-01-01T00:00:00Z)")
    .option("--replace <sequence>", "Cancel offer with this sequence and replace it atomically (OfferSequence field)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate mutually exclusive flags
    if (options.immediateOrCancel && options.fillOrKill) {
        process.stderr.write("Error: --immediate-or-cancel and --fill-or-kill are mutually exclusive\n");
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
    const signerWallet = await resolveWallet(options);
    // Parse taker-pays
    let xrplTakerPays;
    try {
        xrplTakerPays = (0, amount_1.toXrplAmount)((0, amount_1.parseAmount)(options.takerPays));
    }
    catch (e) {
        process.stderr.write(`Error: --taker-pays: ${e.message}\n`);
        process.exit(1);
    }
    // Parse taker-gets
    let xrplTakerGets;
    try {
        xrplTakerGets = (0, amount_1.toXrplAmount)((0, amount_1.parseAmount)(options.takerGets));
    }
    catch (e) {
        process.stderr.write(`Error: --taker-gets: ${e.message}\n`);
        process.exit(1);
    }
    // Build flags
    let flags = 0;
    if (options.sell)
        flags |= xrpl_1.OfferCreateFlags.tfSell;
    if (options.passive)
        flags |= xrpl_1.OfferCreateFlags.tfPassive;
    if (options.immediateOrCancel)
        flags |= xrpl_1.OfferCreateFlags.tfImmediateOrCancel;
    if (options.fillOrKill)
        flags |= xrpl_1.OfferCreateFlags.tfFillOrKill;
    // Build transaction
    const tx = {
        TransactionType: "OfferCreate",
        Account: signerWallet.address,
        TakerPays: xrplTakerPays,
        TakerGets: xrplTakerGets,
        ...(flags !== 0 ? { Flags: flags } : {}),
    };
    // Apply --expiration
    // isoTimeToRippleTime() never throws on an invalid date (Invalid Date's
    // .getTime() is NaN, which just propagates) — check explicitly.
    if (options.expiration !== undefined) {
        try {
            const expiration = (0, xrpl_1.isoTimeToRippleTime)(options.expiration);
            if (isNaN(expiration))
                throw new Error(`invalid date "${options.expiration}"`);
            tx.Expiration = expiration;
        }
        catch (e) {
            process.stderr.write(`Error: --expiration: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Apply --replace (OfferSequence)
    if (options.replace !== undefined) {
        const seq = parseInt(options.replace, 10);
        if (!Number.isInteger(seq) || seq < 0) {
            process.stderr.write("Error: --replace must be a non-negative integer\n");
            process.exit(1);
        }
        tx.OfferSequence = seq;
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
                console.log(signed.hash);
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
        const offerSequence = txResult.tx_json?.Sequence ?? filled.Sequence ?? 0;
        // tecKILLED is expected for IOC/FOK offers that cannot be filled — treat as success
        const isKilled = resultCode === "tecKILLED";
        if (/^te[cfm]/i.test(resultCode) && !isKilled) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode, offerSequence }));
            }
            process.exit(1);
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, offerSequence }));
        }
        else if (isKilled) {
            console.log(`Offer killed (IOC/FOK condition not met). Sequence: ${offerSequence}`);
        }
        else {
            console.log(`Offer created. Sequence: ${offerSequence}`);
        }
    });
});
const offerCancelCommand = new commander_1.Command("cancel")
    .alias("x")
    .description("Cancel an existing DEX offer on the XRP Ledger")
    .requiredOption("--sequence <n>", "Sequence number of the offer to cancel")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
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
    const seq = parseInt(options.sequence, 10);
    if (!Number.isInteger(seq) || seq < 0) {
        process.stderr.write("Error: --sequence must be a non-negative integer\n");
        process.exit(1);
    }
    const signerWallet = await resolveWallet(options);
    const tx = {
        TransactionType: "OfferCancel",
        Account: signerWallet.address,
        OfferSequence: seq,
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
        if (!options.wait) {
            await client.submit(signed.tx_blob);
            if (options.json) {
                console.log(JSON.stringify({ hash: signed.hash }));
            }
            else {
                console.log(signed.hash);
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
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode }));
            }
            process.exit(1);
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode }));
        }
        else {
            console.log(`Offer cancelled. Hash: ${hash}`);
        }
    });
});
exports.offerCommand = new commander_1.Command("offer")
    .description("Manage DEX offers on the XRP Ledger")
    .addCommand(offerCreateCommand)
    .addCommand(offerCancelCommand);
