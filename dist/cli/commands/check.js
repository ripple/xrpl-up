"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCommand = void 0;
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
function extractCheckId(affectedNodes) {
    for (const node of affectedNodes) {
        if ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === "Check") {
            return node.CreatedNode.LedgerIndex;
        }
    }
    return undefined;
}
async function submitAndReport(client, wallet, tx, options, extras) {
    const filled = await client.autofill(tx);
    if (options.dryRun) {
        const signed = wallet.sign(filled);
        console.log(JSON.stringify({ tx_blob: signed.tx_blob, tx: filled }));
        return;
    }
    const signed = wallet.sign(filled);
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
    const sequence = txResult.tx_json?.Sequence;
    const extra = extras ? extras(txResult) : {};
    if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, ...extra }));
        }
        process.exit(1);
    }
    if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, sequence, ...extra }));
    }
    else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
        console.log(`Sequence:    ${sequence}`);
        for (const [k, v] of Object.entries(extra)) {
            const label = k.charAt(0).toUpperCase() + k.slice(1);
            console.log(`${(label + ":").padEnd(13)}${String(v)}`);
        }
    }
}
const checkCreateCommand = new commander_1.Command("create")
    .alias("c")
    .description("Create a Check on the XRP Ledger")
    .requiredOption("--to <address>", "Destination address that can cash the Check")
    .requiredOption("--send-max <amount>", "Maximum amount the Check can debit (XRP decimal or value/CURRENCY/issuer)")
    .option("--expiration <iso>", "Check expiration time (ISO 8601)")
    .option("--destination-tag <n>", "Destination tag (unsigned 32-bit integer)")
    .option("--invoice-id <string>", "Invoice identifier (plain string ≤32 bytes, auto hex-encoded to UInt256)")
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
    // Parse --send-max
    let parsedSendMax;
    try {
        parsedSendMax = (0, amount_1.parseAmount)(options.sendMax);
    }
    catch (e) {
        process.stderr.write(`Error: --send-max: ${e.message}\n`);
        process.exit(1);
    }
    // Parse --expiration
    let expiration;
    if (options.expiration !== undefined) {
        const ts = new Date(options.expiration).getTime();
        if (isNaN(ts)) {
            process.stderr.write("Error: --expiration: invalid ISO 8601 date\n");
            process.exit(1);
        }
        expiration = Math.floor(ts / 1000) - 946684800;
    }
    // Parse --destination-tag
    let destTag;
    if (options.destinationTag !== undefined) {
        const tagNum = Number(options.destinationTag);
        if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
            process.stderr.write("Error: --destination-tag must be an integer between 0 and 4294967295\n");
            process.exit(1);
        }
        destTag = tagNum;
    }
    // Parse --invoice-id
    let invoiceId;
    if (options.invoiceId !== undefined) {
        const byteLen = Buffer.byteLength(options.invoiceId, "utf-8");
        if (byteLen > 32) {
            process.stderr.write("Error: --invoice-id must be at most 32 bytes\n");
            process.exit(1);
        }
        // Hex-encode and zero-pad to 64 hex chars (UInt256)
        const hex = (0, xrpl_1.convertStringToHex)(options.invoiceId);
        invoiceId = hex.toUpperCase().padEnd(64, "0");
    }
    const signerWallet = await resolveWallet(options);
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const destination = (0, keystore_1.resolveAccount)(options.to, keystoreDir);
    const tx = {
        TransactionType: "CheckCreate",
        Account: signerWallet.address,
        Destination: destination,
        SendMax: (0, amount_1.toXrplAmount)(parsedSendMax),
        ...(expiration !== undefined ? { Expiration: expiration } : {}),
        ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
        ...(invoiceId !== undefined ? { InvoiceID: invoiceId } : {}),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        await submitAndReport(client, signerWallet, tx, options, (txResult) => {
            const affectedNodes = (txResult.meta?.AffectedNodes ?? []);
            const checkId = extractCheckId(affectedNodes);
            return checkId !== undefined ? { checkId } : {};
        });
    });
});
const checkCashCommand = new commander_1.Command("cash")
    .description("Cash a Check on the XRP Ledger")
    .requiredOption("--check <id>", "64-character Check ID (hex)")
    .option("--amount <amount>", "Exact amount to cash (XRP decimal or value/CURRENCY/issuer)")
    .option("--deliver-min <amount>", "Minimum amount to receive (XRP decimal or value/CURRENCY/issuer)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Exactly one of --amount or --deliver-min required
    const hasAmount = options.amount !== undefined;
    const hasDeliverMin = options.deliverMin !== undefined;
    if (!hasAmount && !hasDeliverMin) {
        process.stderr.write("Error: provide either --amount or --deliver-min\n");
        process.exit(1);
    }
    if (hasAmount && hasDeliverMin) {
        process.stderr.write("Error: --amount and --deliver-min are mutually exclusive\n");
        process.exit(1);
    }
    // Validate Check ID format
    if (!/^[0-9a-fA-F]{64}$/.test(options.check)) {
        process.stderr.write("Error: --check must be a 64-character hex string\n");
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
    // Parse amount fields
    let parsedAmount;
    if (hasAmount) {
        try {
            parsedAmount = (0, amount_1.parseAmount)(options.amount);
        }
        catch (e) {
            process.stderr.write(`Error: --amount: ${e.message}\n`);
            process.exit(1);
        }
    }
    let parsedDeliverMin;
    if (hasDeliverMin) {
        try {
            parsedDeliverMin = (0, amount_1.parseAmount)(options.deliverMin);
        }
        catch (e) {
            process.stderr.write(`Error: --deliver-min: ${e.message}\n`);
            process.exit(1);
        }
    }
    const signerWallet = await resolveWallet(options);
    const tx = {
        TransactionType: "CheckCash",
        Account: signerWallet.address,
        CheckID: options.check.toUpperCase(),
        ...(parsedAmount !== undefined
            ? { Amount: (0, amount_1.toXrplAmount)(parsedAmount) }
            : {}),
        ...(parsedDeliverMin !== undefined
            ? { DeliverMin: (0, amount_1.toXrplAmount)(parsedDeliverMin) }
            : {}),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        await submitAndReport(client, signerWallet, tx, options);
    });
});
const checkCancelCommand = new commander_1.Command("cancel")
    .alias("x")
    .description("Cancel a Check on the XRP Ledger")
    .requiredOption("--check <id>", "64-character Check ID (hex)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate Check ID format
    if (!/^[0-9a-fA-F]{64}$/.test(options.check)) {
        process.stderr.write("Error: --check must be a 64-character hex string\n");
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
    const tx = {
        TransactionType: "CheckCancel",
        Account: signerWallet.address,
        CheckID: options.check.toUpperCase(),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        await submitAndReport(client, signerWallet, tx, options);
    });
});
/** Convert XRPL ripple epoch to ISO 8601 string */
function rippleTimeToIso(epoch) {
    return new Date((epoch + 946684800) * 1000).toISOString();
}
function formatSendMax(sendMax) {
    if (typeof sendMax === "string") {
        const xrp = (Number(sendMax) / 1_000_000).toFixed(6);
        return `${xrp} XRP`;
    }
    return `${sendMax.value}/${sendMax.currency}/${sendMax.issuer}`;
}
const checkListCommand = new commander_1.Command("list")
    .alias("ls")
    .description("List pending checks for an account")
    .argument("<address>", "Account address to query")
    .option("--json", "Output as JSON array", false)
    .action(async (address, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const response = await client.request({
            command: "account_objects",
            account: address,
            type: "check",
            limit: 400,
        });
        const checks = response.result.account_objects;
        const results = checks.map((check) => ({
            checkId: check.index,
            sendMax: formatSendMax(check.SendMax),
            destination: check.Destination,
            expiration: check.Expiration !== undefined ? rippleTimeToIso(check.Expiration) : "none",
            invoiceId: check.InvoiceID ?? "none",
        }));
        if (options.json) {
            console.log(JSON.stringify(results));
            return;
        }
        if (results.length === 0) {
            console.log("No pending checks found.");
            return;
        }
        for (const c of results) {
            console.log(`CheckID:     ${c.checkId}`);
            console.log(`SendMax:     ${c.sendMax}`);
            console.log(`Destination: ${c.destination}`);
            console.log(`Expiration:  ${c.expiration}`);
            console.log(`InvoiceID:   ${c.invoiceId}`);
            console.log("---");
        }
    });
});
// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------
exports.checkCommand = new commander_1.Command("check")
    .description("Manage XRPL Checks")
    .addCommand(checkCreateCommand)
    .addCommand(checkCashCommand)
    .addCommand(checkCancelCommand)
    .addCommand(checkListCommand);
