"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelCommand = void 0;
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
function xrplEpochFromIso(iso) {
    const ms = new Date(iso).getTime();
    if (isNaN(ms)) {
        throw new Error(`Invalid ISO 8601 date: "${iso}"`);
    }
    return Math.floor(ms / 1000) - 946684800;
}
const channelCreateCommand = new commander_1.Command("create")
    .description("Open a new payment channel")
    .requiredOption("--to <address-or-alias>", "Destination address or alias")
    .requiredOption("--amount <xrp>", "Amount of XRP to lock in the channel (decimal, e.g. 10)")
    .requiredOption("--settle-delay <seconds>", "Seconds the source must wait before closing with unclaimed funds")
    .option("--public-key <hex>", "33-byte secp256k1/Ed25519 public key hex (derived from key material if omitted)")
    .option("--cancel-after <iso8601>", "Expiry time in ISO 8601 format (converted to XRPL epoch)")
    .option("--destination-tag <n>", "Destination tag (unsigned 32-bit integer)")
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
    // Parse amount (XRP only)
    let drops;
    try {
        const parsed = (0, amount_1.parseAmount)(options.amount);
        if (parsed.type !== "xrp") {
            process.stderr.write("Error: --amount must be an XRP amount (e.g. 10 or 10000000drops)\n");
            process.exit(1);
        }
        drops = parsed.drops;
    }
    catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
    }
    // Parse settle-delay
    const settleDelay = parseInt(options.settleDelay, 10);
    if (!Number.isInteger(settleDelay) || settleDelay < 0) {
        process.stderr.write("Error: --settle-delay must be a non-negative integer\n");
        process.exit(1);
    }
    // Parse cancel-after
    let cancelAfter;
    if (options.cancelAfter !== undefined) {
        try {
            cancelAfter = xrplEpochFromIso(options.cancelAfter);
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Parse destination-tag
    let destTag;
    if (options.destinationTag !== undefined) {
        const tagNum = Number(options.destinationTag);
        if (!Number.isInteger(tagNum) || tagNum < 0 || tagNum > 4294967295) {
            process.stderr.write("Error: --destination-tag must be an integer between 0 and 4294967295\n");
            process.exit(1);
        }
        destTag = tagNum;
    }
    // Resolve wallet
    const signerWallet = await resolveWallet(options);
    // Resolve destination
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const destination = (0, keystore_1.resolveAccount)(options.to, keystoreDir);
    // Determine public key
    const publicKey = options.publicKey ?? signerWallet.publicKey;
    // Build transaction
    const tx = {
        TransactionType: "PaymentChannelCreate",
        Account: signerWallet.address,
        Amount: drops,
        Destination: destination,
        SettleDelay: settleDelay,
        PublicKey: publicKey,
        ...(cancelAfter !== undefined ? { CancelAfter: cancelAfter } : {}),
        ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
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
        const meta = txResult.meta;
        const resultCode = (meta && typeof meta !== "string" ? meta.TransactionResult : undefined) ?? "unknown";
        const hash = txResult.hash ?? signed.hash;
        const feeDrops = txResult.tx_json?.Fee ?? "0";
        const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
        const ledger = txResult.ledger_index;
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
            }
            process.exit(1);
        }
        // Extract channel ID from metadata using xrpl.js isCreatedNode helper
        let channelId = null;
        if (meta && typeof meta !== "string") {
            const channelNode = meta.AffectedNodes?.find((n) => (0, xrpl_1.isCreatedNode)(n) && n.CreatedNode.LedgerEntryType === "PayChannel");
            if (channelNode && (0, xrpl_1.isCreatedNode)(channelNode)) {
                channelId = channelNode.CreatedNode.LedgerIndex;
            }
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, channelId }));
        }
        else {
            console.log(`Transaction: ${hash}`);
            console.log(`Result:      ${resultCode}`);
            console.log(`Fee:         ${feeXrp} XRP`);
            console.log(`Ledger:      ${ledger}`);
            if (channelId)
                console.log(`Channel ID:  ${channelId}`);
        }
    });
});
const channelFundCommand = new commander_1.Command("fund")
    .description("Add XRP to an existing payment channel")
    .requiredOption("--channel <hex>", "64-character payment channel ID")
    .requiredOption("--amount <xrp>", "Amount of XRP to add to the channel (decimal, e.g. 5)")
    .option("--expiration <iso8601>", "New expiration time in ISO 8601 format (converted to XRPL epoch)")
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
    // Validate channel ID format
    if (!/^[0-9A-Fa-f]{64}$/.test(options.channel)) {
        process.stderr.write("Error: --channel must be a 64-character hex string\n");
        process.exit(1);
    }
    // Parse amount (XRP only)
    let drops;
    try {
        const parsed = (0, amount_1.parseAmount)(options.amount);
        if (parsed.type !== "xrp") {
            process.stderr.write("Error: --amount must be an XRP amount (e.g. 5 or 5000000drops)\n");
            process.exit(1);
        }
        drops = parsed.drops;
    }
    catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
    }
    // Parse expiration
    let expiration;
    if (options.expiration !== undefined) {
        try {
            expiration = xrplEpochFromIso(options.expiration);
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Resolve wallet
    const signerWallet = await resolveWallet(options);
    // Build transaction
    const tx = {
        TransactionType: "PaymentChannelFund",
        Account: signerWallet.address,
        Channel: options.channel.toUpperCase(),
        Amount: drops,
        ...(expiration !== undefined ? { Expiration: expiration } : {}),
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
        const meta = txResult.meta;
        const resultCode = (meta && typeof meta !== "string" ? meta.TransactionResult : undefined) ?? "unknown";
        const hash = txResult.hash ?? signed.hash;
        const feeDrops = txResult.tx_json?.Fee ?? "0";
        const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
        const ledger = txResult.ledger_index;
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
const channelSignCommand = new commander_1.Command("sign")
    .description("Sign an off-chain payment channel claim (offline)")
    .requiredOption("--channel <hex>", "64-character payment channel ID")
    .requiredOption("--amount <xrp>", "Amount of XRP to authorize (decimal, e.g. 5)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--json", "Output as JSON", false)
    .action(async (options) => {
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
    // Validate channel ID format
    if (!/^[0-9A-Fa-f]{64}$/.test(options.channel)) {
        process.stderr.write("Error: --channel must be a 64-character hex string\n");
        process.exit(1);
    }
    // Validate amount is a non-negative decimal
    const amountNum = Number(options.amount);
    if (isNaN(amountNum) || amountNum < 0 || options.amount.trim() === "") {
        process.stderr.write("Error: --amount must be a non-negative XRP decimal (e.g. 5)\n");
        process.exit(1);
    }
    // Resolve wallet to get private key
    const signerWallet = await resolveWallet(options);
    const signature = (0, xrpl_1.signPaymentChannelClaim)(options.channel.toUpperCase(), options.amount, signerWallet.privateKey);
    if (options.json) {
        console.log(JSON.stringify({ signature }));
    }
    else {
        console.log(signature);
    }
});
const channelVerifyCommand = new commander_1.Command("verify")
    .description("Verify an off-chain payment channel claim signature (offline)")
    .requiredOption("--channel <hex>", "64-character payment channel ID")
    .requiredOption("--amount <xrp>", "Amount of XRP in the claim (decimal, e.g. 5)")
    .requiredOption("--signature <hex>", "Hex-encoded signature to verify")
    .requiredOption("--public-key <hex>", "Hex-encoded public key of the signer")
    .option("--json", "Output as JSON", false)
    .action((options) => {
    // Validate channel ID format
    if (!/^[0-9A-Fa-f]{64}$/.test(options.channel)) {
        process.stderr.write("Error: --channel must be a 64-character hex string\n");
        process.exit(1);
    }
    // Validate amount
    const amountNum = Number(options.amount);
    if (isNaN(amountNum) || amountNum < 0 || options.amount.trim() === "") {
        process.stderr.write("Error: --amount must be a non-negative XRP decimal (e.g. 5)\n");
        process.exit(1);
    }
    let valid;
    try {
        valid = (0, xrpl_1.verifyPaymentChannelClaim)(options.channel.toUpperCase(), options.amount, options.signature, options.publicKey);
    }
    catch {
        // Invalid signature encoding — treat as invalid
        valid = false;
    }
    if (options.json) {
        console.log(JSON.stringify({ valid }));
    }
    else {
        console.log(valid ? "valid" : "invalid");
    }
});
const channelClaimCommand = new commander_1.Command("claim")
    .description("Redeem a signed payment channel claim or close a channel")
    .requiredOption("--channel <hex>", "64-character payment channel ID")
    .option("--amount <xrp>", "Amount of XRP authorized by the signature (decimal, converted to drops)")
    .option("--balance <xrp>", "Total XRP delivered by this claim (decimal, converted to drops)")
    .option("--signature <hex>", "Hex-encoded claim signature")
    .option("--public-key <hex>", "Hex-encoded public key of the channel source")
    .option("--close", "Request channel closure (sets tfClose flag)", false)
    .option("--renew", "Clear channel expiration (sets tfRenew flag, source only)", false)
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
    // Validate channel ID format
    if (!/^[0-9A-Fa-f]{64}$/.test(options.channel)) {
        process.stderr.write("Error: --channel must be a 64-character hex string\n");
        process.exit(1);
    }
    // Validate signature requires public-key, amount, and balance
    if (options.signature !== undefined) {
        if (options.publicKey === undefined) {
            process.stderr.write("Error: --signature requires --public-key\n");
            process.exit(1);
        }
        if (options.amount === undefined) {
            process.stderr.write("Error: --signature requires --amount\n");
            process.exit(1);
        }
        if (options.balance === undefined) {
            process.stderr.write("Error: --signature requires --balance\n");
            process.exit(1);
        }
    }
    // Parse amount (XRP only)
    let amountDrops;
    if (options.amount !== undefined) {
        try {
            const parsed = (0, amount_1.parseAmount)(options.amount);
            if (parsed.type !== "xrp") {
                process.stderr.write("Error: --amount must be an XRP amount (e.g. 5 or 5000000drops)\n");
                process.exit(1);
            }
            amountDrops = parsed.drops;
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Parse balance (XRP only)
    let balanceDrops;
    if (options.balance !== undefined) {
        try {
            const parsed = (0, amount_1.parseAmount)(options.balance);
            if (parsed.type !== "xrp") {
                process.stderr.write("Error: --balance must be an XRP amount (e.g. 5 or 5000000drops)\n");
                process.exit(1);
            }
            balanceDrops = parsed.drops;
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }
    // Build flags
    const tfClose = 0x00020000;
    const tfRenew = 0x00010000;
    let flags = 0;
    if (options.close)
        flags |= tfClose;
    if (options.renew)
        flags |= tfRenew;
    // Resolve wallet
    const signerWallet = await resolveWallet(options);
    // Build transaction
    const tx = {
        TransactionType: "PaymentChannelClaim",
        Account: signerWallet.address,
        Channel: options.channel.toUpperCase(),
        ...(amountDrops !== undefined ? { Amount: amountDrops } : {}),
        ...(balanceDrops !== undefined ? { Balance: balanceDrops } : {}),
        ...(options.signature !== undefined ? { Signature: options.signature.toUpperCase() } : {}),
        ...(options.publicKey !== undefined ? { PublicKey: options.publicKey.toUpperCase() } : {}),
        ...(flags !== 0 ? { Flags: flags } : {}),
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
        const meta = txResult.meta;
        const resultCode = (meta && typeof meta !== "string" ? meta.TransactionResult : undefined) ?? "unknown";
        const hash = txResult.hash ?? signed.hash;
        const feeDrops = txResult.tx_json?.Fee ?? "0";
        const feeXrp = (Number(feeDrops) / 1_000_000).toFixed(6);
        const ledger = txResult.ledger_index;
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
function xrplEpochToIso(epoch) {
    return new Date((epoch + 946684800) * 1000).toISOString();
}
const channelListCommand = new commander_1.Command("list")
    .description("List open payment channels for an account")
    .argument("<address>", "Account address to query channels for")
    .option("--destination <address>", "Filter channels by destination account")
    .option("--json", "Output as JSON array", false)
    .action(async (address, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const allChannels = [];
        let marker = undefined;
        do {
            // Build request with optional fields
            const req = { command: "account_channels", account: address, limit: 400 };
            if (options.destination)
                req.destination_account = options.destination;
            if (marker !== undefined)
                req.marker = marker;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await client.request(req);
            const result = res.result;
            allChannels.push(...result.channels);
            marker = result.marker;
        } while (marker !== undefined);
        if (options.json) {
            console.log(JSON.stringify(allChannels));
            return;
        }
        if (allChannels.length === 0) {
            console.log("No channels found.");
            return;
        }
        for (const ch of allChannels) {
            const amountXrp = (Number(ch.amount) / 1_000_000).toFixed(6);
            const balanceXrp = (Number(ch.balance) / 1_000_000).toFixed(6);
            const expiration = ch.expiration !== undefined ? xrplEpochToIso(ch.expiration) : "none";
            const cancelAfter = ch.cancel_after !== undefined ? xrplEpochToIso(ch.cancel_after) : "none";
            console.log(`Channel ID:   ${ch.channel_id}`);
            console.log(`Amount:       ${amountXrp} XRP`);
            console.log(`Balance:      ${balanceXrp} XRP`);
            console.log(`Destination:  ${ch.destination_account}`);
            console.log(`Settle Delay: ${ch.settle_delay} seconds`);
            console.log(`Expiration:   ${expiration}`);
            console.log(`Cancel After: ${cancelAfter}`);
            console.log(`Public Key:   ${ch.public_key_hex ?? ch.public_key ?? "none"}`);
            console.log("---");
        }
    });
});
exports.channelCommand = new commander_1.Command("channel")
    .description("Manage XRPL payment channels")
    .addCommand(channelCreateCommand)
    .addCommand(channelFundCommand)
    .addCommand(channelSignCommand)
    .addCommand(channelVerifyCommand)
    .addCommand(channelClaimCommand)
    .addCommand(channelListCommand);
