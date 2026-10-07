"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mptokenCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
const ripple_keypairs_1 = require("ripple-keypairs");
const client_1 = require("../utils/client");
const node_1 = require("../utils/node");
const keystore_1 = require("../utils/keystore");
const prompt_1 = require("../utils/prompt");
// ---------- shared wallet resolution ----------
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
async function submitTx(client, wallet, tx, options, printExtra) {
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
    if (/^te[cfm]/i.test(resultCode)) {
        process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
        }
        process.exit(1);
    }
    if (options.json) {
        const extra = {};
        if (printExtra) {
            // For JSON mode, we still call printExtra but capture output via a temp object
            // Instead, let callers handle JSON output if they need extra fields
        }
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, ...extra }));
    }
    else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
    }
    if (printExtra) {
        printExtra(txResult);
    }
}
// ---------- flag helpers ----------
const VALID_CREATE_FLAGS = {
    "can-lock": xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanLock,
    "require-auth": xrpl_1.MPTokenIssuanceCreateFlags.tfMPTRequireAuth,
    "can-escrow": xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanEscrow,
    "can-trade": xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanTrade,
    "can-transfer": xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanTransfer,
    "can-clawback": xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanClawback,
};
const LSF_NAMES = [
    [0x00000001, "locked"],
    [xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanLock, "can-lock"],
    [xrpl_1.MPTokenIssuanceCreateFlags.tfMPTRequireAuth, "require-auth"],
    [xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanEscrow, "can-escrow"],
    [xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanTrade, "can-trade"],
    [xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanTransfer, "can-transfer"],
    [xrpl_1.MPTokenIssuanceCreateFlags.tfMPTCanClawback, "can-clawback"],
];
function decodeIssuanceFlags(flags) {
    const active = LSF_NAMES.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
    return active.length > 0 ? active.join(", ") : "none";
}
/** Decode hex to UTF-8 if valid; return raw hex if it contains replacement characters. */
function tryDecodeHex(hex) {
    const decoded = Buffer.from(hex, "hex").toString("utf-8");
    if (decoded.includes("\uFFFD"))
        return hex;
    return decoded;
}
// ---------- key material options (standard) ----------
const KEY_MATERIAL_OPTIONS = [
    ["--seed <seed>", "Family seed for signing"],
    ["--mnemonic <phrase>", "BIP39 mnemonic for signing"],
    ["--account <address-or-alias>", "Account address or alias to load from keystore"],
    ["--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)"],
    ["--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)"],
];
function validateKeyMaterial(options) {
    const count = [options.seed, options.mnemonic, options.account].filter(Boolean).length;
    if (count === 0) {
        process.stderr.write("Error: provide key material via --seed, --mnemonic, or --account\n");
        process.exit(1);
    }
    if (count > 1) {
        process.stderr.write("Error: provide only one of --seed, --mnemonic, or --account\n");
        process.exit(1);
    }
}
const issuanceCreateCommand = new commander_1.Command("create")
    .description("Create a new MPT issuance (MPTokenIssuanceCreate)")
    .option("--asset-scale <n>", "Decimal precision for display (0–255, default 0)")
    .option("--max-amount <string>", "Maximum token supply as base-10 UInt64 string")
    .option("--transfer-fee <n>", "Transfer fee in basis points × 10 (0–50000). Requires can-transfer flag")
    .option("--flags <list>", "Comma-separated flags: can-lock,require-auth,can-escrow,can-trade,can-transfer,can-clawback")
    .option("--metadata <string>", "Metadata as plain string (auto hex-encoded, max 1024 bytes)")
    .option("--metadata-hex <hex>", "Metadata as raw hex")
    .option("--metadata-file <path>", "Path to file whose contents are hex-encoded as metadata")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate metadata mutual exclusion
    const metaCount = [options.metadata, options.metadataHex, options.metadataFile].filter((v) => v !== undefined).length;
    if (metaCount > 1) {
        process.stderr.write("Error: --metadata, --metadata-hex, and --metadata-file are mutually exclusive\n");
        process.exit(1);
    }
    // Validate metadata file exists
    if (options.metadataFile !== undefined && !(0, fs_1.existsSync)(options.metadataFile)) {
        process.stderr.write(`Error: --metadata-file path does not exist: ${options.metadataFile}\n`);
        process.exit(1);
    }
    // Parse flags
    let flagsBitmask = 0;
    const flagNames = new Set();
    if (options.flags !== undefined) {
        const parts = options.flags.split(",").map((f) => f.trim()).filter((f) => f.length > 0);
        for (const part of parts) {
            if (!(part in VALID_CREATE_FLAGS)) {
                process.stderr.write(`Error: unknown flag "${part}". Valid flags: ${Object.keys(VALID_CREATE_FLAGS).join(", ")}\n`);
                process.exit(1);
            }
            flagsBitmask |= VALID_CREATE_FLAGS[part];
            flagNames.add(part);
        }
    }
    // Validate transfer-fee requires can-transfer
    if (options.transferFee !== undefined && !flagNames.has("can-transfer")) {
        process.stderr.write("Error: --transfer-fee requires can-transfer in --flags\n");
        process.exit(1);
    }
    // Validate asset-scale
    let assetScale;
    if (options.assetScale !== undefined) {
        assetScale = parseInt(options.assetScale, 10);
        if (!Number.isInteger(assetScale) || assetScale < 0 || assetScale > 255) {
            process.stderr.write("Error: --asset-scale must be an integer between 0 and 255\n");
            process.exit(1);
        }
    }
    // Validate transfer-fee
    let transferFee;
    if (options.transferFee !== undefined) {
        transferFee = parseInt(options.transferFee, 10);
        if (!Number.isInteger(transferFee) || transferFee < 0 || transferFee > 50000) {
            process.stderr.write("Error: --transfer-fee must be an integer between 0 and 50000\n");
            process.exit(1);
        }
    }
    // Validate max-amount
    if (options.maxAmount !== undefined && !/^\d+$/.test(options.maxAmount)) {
        process.stderr.write("Error: --max-amount must be a positive integer string\n");
        process.exit(1);
    }
    // Resolve metadata hex
    let metadataHex;
    if (options.metadata !== undefined) {
        const encoded = (0, xrpl_1.convertStringToHex)(options.metadata);
        const byteLen = encoded.length / 2;
        if (byteLen > 1024) {
            process.stderr.write(`Error: --metadata encodes to ${byteLen} bytes, max is 1024\n`);
            process.exit(1);
        }
        metadataHex = encoded.toUpperCase();
    }
    else if (options.metadataHex !== undefined) {
        if (!/^[0-9A-Fa-f]+$/.test(options.metadataHex) || options.metadataHex.length % 2 !== 0) {
            process.stderr.write("Error: --metadata-hex must be a valid even-length hex string\n");
            process.exit(1);
        }
        const byteLen = options.metadataHex.length / 2;
        if (byteLen > 1024) {
            process.stderr.write(`Error: --metadata-hex encodes to ${byteLen} bytes, max is 1024\n`);
            process.exit(1);
        }
        metadataHex = options.metadataHex.toUpperCase();
    }
    else if (options.metadataFile !== undefined) {
        const contents = (0, fs_1.readFileSync)(options.metadataFile);
        if (contents.length > 1024) {
            process.stderr.write(`Error: --metadata-file contents are ${contents.length} bytes, max is 1024\n`);
            process.exit(1);
        }
        metadataHex = contents.toString("hex").toUpperCase();
    }
    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);
    const tx = {
        TransactionType: "MPTokenIssuanceCreate",
        Account: wallet.address,
        ...(flagsBitmask !== 0 ? { Flags: flagsBitmask } : {}),
        ...(assetScale !== undefined ? { AssetScale: assetScale } : {}),
        ...(options.maxAmount !== undefined ? { MaximumAmount: options.maxAmount } : {}),
        ...(transferFee !== undefined ? { TransferFee: transferFee } : {}),
        ...(metadataHex !== undefined ? { MPTokenMetadata: metadataHex } : {}),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
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
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
            }
            process.exit(1);
        }
        // Extract MPTokenIssuanceID from metadata
        let issuanceId = txResult.meta?.mpt_issuance_id ?? null;
        // Fallback: extract from AffectedNodes
        if (issuanceId === null) {
            const meta = txResult.meta;
            if (meta && typeof meta !== "string") {
                const node = meta.AffectedNodes?.find((n) => (0, xrpl_1.isCreatedNode)(n) && n.CreatedNode.LedgerEntryType === "MPTokenIssuance");
                if (node && (0, xrpl_1.isCreatedNode)(node)) {
                    issuanceId = node.CreatedNode.LedgerIndex;
                }
            }
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, issuanceId }));
        }
        else {
            console.log(`Transaction:       ${hash}`);
            console.log(`Result:            ${resultCode}`);
            console.log(`Fee:               ${feeXrp} XRP`);
            console.log(`Ledger:            ${ledger}`);
            if (issuanceId) {
                console.log(`MPTokenIssuanceID: ${issuanceId}`);
            }
        }
    });
});
const issuanceDestroyCommand = new commander_1.Command("destroy")
    .description("Destroy an MPT issuance (MPTokenIssuanceDestroy)")
    .argument("<issuance-id>", "MPTokenIssuanceID to destroy")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (issuanceId, options, cmd) => {
    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);
    const tx = {
        TransactionType: "MPTokenIssuanceDestroy",
        Account: wallet.address,
        MPTokenIssuanceID: issuanceId,
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        await submitTx(client, wallet, tx, options);
    });
});
const issuanceSetCommand = new commander_1.Command("set")
    .description("Lock or unlock an MPT issuance (MPTokenIssuanceSet)")
    .argument("<issuance-id>", "MPTokenIssuanceID to modify")
    .option("--lock", "Lock the issuance (or a holder's balance)", false)
    .option("--unlock", "Unlock the issuance (or a holder's balance)", false)
    .option("--holder <address>", "Holder address for per-holder lock/unlock")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (issuanceId, options, cmd) => {
    if (!options.lock && !options.unlock) {
        process.stderr.write("Error: provide --lock or --unlock\n");
        process.exit(1);
    }
    if (options.lock && options.unlock) {
        process.stderr.write("Error: --lock and --unlock are mutually exclusive\n");
        process.exit(1);
    }
    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);
    const tx = {
        TransactionType: "MPTokenIssuanceSet",
        Account: wallet.address,
        MPTokenIssuanceID: issuanceId,
        Flags: options.lock ? xrpl_1.MPTokenIssuanceSetFlags.tfMPTLock : xrpl_1.MPTokenIssuanceSetFlags.tfMPTUnlock,
        ...(options.holder !== undefined ? { Holder: options.holder } : {}),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        await submitTx(client, wallet, tx, options);
    });
});
/** Compute the 24-byte MPTokenIssuanceID = Sequence (4 bytes BE) + AccountID (20 bytes). */
function computeIssuanceId(sequence, issuer) {
    const seqBuf = Buffer.alloc(4);
    seqBuf.writeUInt32BE(sequence, 0);
    return Buffer.concat([seqBuf, Buffer.from((0, xrpl_1.decodeAccountID)(issuer))]).toString("hex").toUpperCase();
}
const issuanceListCommand = new commander_1.Command("list")
    .description("List MPT issuances for an account")
    .argument("<address>", "Account address to query")
    .option("--json", "Output as JSON array", false)
    .action(async (address, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const res = await client.request({
            command: "account_objects",
            account: address,
            type: "mpt_issuance",
            ledger_index: "validated",
        });
        const issuances = res.result.account_objects;
        if (options.json) {
            console.log(JSON.stringify(issuances));
            return;
        }
        if (issuances.length === 0) {
            console.log("No MPT issuances.");
            return;
        }
        for (const iss of issuances) {
            const flags = decodeIssuanceFlags(iss.Flags ?? 0);
            const displayId = iss.Sequence !== undefined
                ? computeIssuanceId(iss.Sequence, iss.Issuer)
                : iss.index;
            const parts = [
                `AssetScale=${iss.AssetScale ?? 0}`,
                `MaximumAmount=${iss.MaximumAmount ?? "(none)"}`,
                `OutstandingAmount=${iss.OutstandingAmount ?? "0"}`,
                `Flags=[${flags}]`,
            ];
            console.log(`${displayId}  ${parts.join("  ")}`);
        }
    });
});
const issuanceGetCommand = new commander_1.Command("get")
    .description("Get MPT issuance details by ID")
    .argument("<issuance-id>", "MPTokenIssuanceID to query")
    .option("--json", "Output raw JSON", false)
    .action(async (issuanceId, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        let result;
        try {
            const response = await client.request({
                command: "ledger_entry",
                mpt_issuance: issuanceId,
                ledger_index: "validated",
            });
            result = response.result;
        }
        catch (e) {
            const err = e;
            process.stderr.write(`Error: ${err.message}\n`);
            process.exit(1);
        }
        if (options.json) {
            console.log(JSON.stringify(result));
            return;
        }
        const entry = (result.node ??
            result);
        const flags = decodeIssuanceFlags(entry.Flags ?? 0);
        const metadata = entry.MPTokenMetadata ? tryDecodeHex(entry.MPTokenMetadata) : "(none)";
        console.log(`MPTokenIssuanceID: ${issuanceId}`);
        console.log(`Issuer:            ${entry.Issuer ?? "(unknown)"}`);
        console.log(`AssetScale:        ${entry.AssetScale ?? 0}`);
        console.log(`MaximumAmount:     ${entry.MaximumAmount ?? "(none)"}`);
        console.log(`OutstandingAmount: ${entry.OutstandingAmount ?? "0"}`);
        console.log(`TransferFee:       ${entry.TransferFee ?? 0}`);
        console.log(`Flags:             ${flags}`);
        console.log(`Metadata:          ${metadata}`);
    });
});
// ---------- issuance sub-group ----------
const issuanceCommand = new commander_1.Command("issuance")
    .description("Manage MPT issuances")
    .addCommand(issuanceCreateCommand)
    .addCommand(issuanceDestroyCommand)
    .addCommand(issuanceSetCommand)
    .addCommand(issuanceListCommand)
    .addCommand(issuanceGetCommand);
const authorizeCommand = new commander_1.Command("authorize")
    .description("Opt in to hold an MPT issuance, or grant/revoke holder authorization (MPTokenAuthorize)")
    .argument("<issuance-id>", "MPTokenIssuanceID")
    .option("--holder <address>", "Holder address (issuer-side: authorize/unauthorize a specific holder)")
    .option("--unauthorize", "Revoke authorization instead of granting", false)
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (issuanceId, options, cmd) => {
    validateKeyMaterial(options);
    const wallet = await resolveWallet(options);
    const tx = {
        TransactionType: "MPTokenAuthorize",
        Account: wallet.address,
        MPTokenIssuanceID: issuanceId,
        ...(options.holder !== undefined ? { Holder: options.holder } : {}),
        ...(options.unauthorize ? { Flags: xrpl_1.MPTokenAuthorizeFlags.tfMPTUnauthorize } : {}),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        await submitTx(client, wallet, tx, options);
    });
});
// ---------- export ----------
exports.mptokenCommand = new commander_1.Command("mptoken")
    .description("Manage Multi-Purpose Tokens (MPT) on the XRP Ledger")
    .addCommand(issuanceCommand)
    .addCommand(authorizeCommand);
