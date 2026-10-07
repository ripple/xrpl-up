"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vaultCommand = void 0;
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
/** Parse an asset string ("0" for XRP, "0/USD/rIssuer" for IOU, "0/<48hex>" for MPT) into a Currency. */
function parseAssetCurrency(input) {
    const parsed = (0, amount_1.parseAmount)(input);
    switch (parsed.type) {
        case "xrp":
            return { currency: "XRP" };
        case "iou":
            return { currency: parsed.currency, issuer: parsed.issuer };
        case "mpt":
            return { mpt_issuance_id: parsed.mpt_issuance_id };
    }
}
const tfVaultPrivate = 65536;
const tfVaultShareNonTransferable = 131072;
const vaultCreateCommand = new commander_1.Command("create")
    .alias("c")
    .description("Create a single-asset vault on the XRP Ledger")
    .requiredOption("--asset <asset>", 'Asset type: "0" for XRP, "0/USD/rIssuer" for IOU, "0/<48-char-hex>" for MPT')
    .option("--assets-maximum <n>", "Maximum total assets the vault can hold (UInt64 string)")
    .option("--data <hex>", "Arbitrary metadata hex blob (max 256 bytes)")
    .option("--mpt-metadata <hex>", "MPTokenMetadata for vault shares (max 1024 bytes)")
    .option("--domain-id <hash>", "64-char hex DomainID for a private vault")
    .option("--private", "Set tfVaultPrivate flag (requires --domain-id)", false)
    .option("--non-transferable", "Set tfVaultShareNonTransferable flag", false)
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // --private requires --domain-id
    if (options.private && !options.domainId) {
        process.stderr.write("Error: --private requires --domain-id\n");
        process.exit(1);
    }
    // Validate --domain-id format (64-char hex)
    if (options.domainId !== undefined) {
        if (!/^[0-9A-Fa-f]{64}$/.test(options.domainId)) {
            process.stderr.write("Error: --domain-id must be a 64-character hex string\n");
            process.exit(1);
        }
    }
    // Validate --data hex
    if (options.data !== undefined) {
        if (!/^[0-9A-Fa-f]*$/.test(options.data) || options.data.length > 512) {
            process.stderr.write("Error: --data must be a hex string of at most 256 bytes (512 hex chars)\n");
            process.exit(1);
        }
    }
    // Validate --mpt-metadata hex
    if (options.mptMetadata !== undefined) {
        if (!/^[0-9A-Fa-f]*$/.test(options.mptMetadata) || options.mptMetadata.length > 2048) {
            process.stderr.write("Error: --mpt-metadata must be a hex string of at most 1024 bytes (2048 hex chars)\n");
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
    // Parse asset
    let asset;
    try {
        asset = parseAssetCurrency(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    // Build flags
    let flags = 0;
    if (options.private)
        flags |= tfVaultPrivate;
    if (options.nonTransferable)
        flags |= tfVaultShareNonTransferable;
    const signerWallet = await resolveWallet(options);
    const tx = {
        TransactionType: "VaultCreate",
        Account: signerWallet.address,
        Asset: asset,
        ...(flags !== 0 ? { Flags: flags } : {}),
        ...(options.assetsMaximum !== undefined ? { AssetsMaximum: options.assetsMaximum } : {}),
        ...(options.data !== undefined ? { Data: options.data.toUpperCase() } : {}),
        ...(options.mptMetadata !== undefined ? { MPTokenMetadata: options.mptMetadata.toUpperCase() } : {}),
        ...(options.domainId !== undefined ? { DomainID: options.domainId.toUpperCase() } : {}),
    };
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const filled = await client.autofill(tx);
        // VaultCreate requires elevated fee of 200000 drops (0.2 XRP)
        const minFee = 200000;
        if (Number(filled.Fee ?? "0") < minFee) {
            filled.Fee = String(minFee);
        }
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
        // Extract VaultID from CreatedNode where LedgerEntryType === 'Vault'
        const vaultNode = txResult.meta?.AffectedNodes?.find((n) => n.CreatedNode?.LedgerEntryType === "Vault");
        const vaultId = vaultNode?.CreatedNode?.LedgerIndex ?? "";
        if (options.json) {
            console.log(JSON.stringify({ result: "success", vaultId, tx: hash }));
        }
        else {
            console.log(`Vault ID: ${vaultId}`);
            console.log(`Tx:       ${hash}`);
            console.log(`Result:   ${resultCode}`);
            console.log(`Fee:      ${feeXrp} XRP`);
            console.log(`Ledger:   ${ledger}`);
        }
    });
});
const vaultSetCommand = new commander_1.Command("set")
    .alias("s")
    .description("Update metadata, asset cap, or domain of a vault you own")
    .requiredOption("--vault-id <hash>", "64-char hex VaultID to update")
    .option("--data <hex>", "Updated metadata hex blob (max 256 bytes)")
    .option("--assets-maximum <n>", "Updated maximum total assets cap (UInt64 string)")
    .option("--domain-id <hash>", "Updated 64-char hex DomainID")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate --vault-id
    if (!/^[0-9A-Fa-f]{64}$/.test(options.vaultId)) {
        process.stderr.write("Error: --vault-id must be a 64-character hex string\n");
        process.exit(1);
    }
    // At least one update field must be provided
    if (options.data === undefined && options.assetsMaximum === undefined && options.domainId === undefined) {
        process.stderr.write("Error: provide at least one of --data, --assets-maximum, or --domain-id\n");
        process.exit(1);
    }
    // Validate --data hex
    if (options.data !== undefined) {
        if (!/^[0-9A-Fa-f]*$/.test(options.data) || options.data.length > 512) {
            process.stderr.write("Error: --data must be a hex string of at most 256 bytes (512 hex chars)\n");
            process.exit(1);
        }
    }
    // Validate --domain-id
    if (options.domainId !== undefined) {
        if (!/^[0-9A-Fa-f]{64}$/.test(options.domainId)) {
            process.stderr.write("Error: --domain-id must be a 64-character hex string\n");
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
    const signerWallet = await resolveWallet(options);
    const tx = {
        TransactionType: "VaultSet",
        Account: signerWallet.address,
        VaultID: options.vaultId.toUpperCase(),
        ...(options.data !== undefined ? { Data: options.data.toUpperCase() } : {}),
        ...(options.assetsMaximum !== undefined ? { AssetsMaximum: options.assetsMaximum } : {}),
        ...(options.domainId !== undefined ? { DomainID: options.domainId.toUpperCase() } : {}),
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
            console.log(JSON.stringify({ result: "success", vaultId: options.vaultId.toUpperCase(), tx: hash }));
        }
        else {
            console.log(`Vault ID: ${options.vaultId.toUpperCase()}`);
            console.log(`Tx:       ${hash}`);
            console.log(`Result:   ${resultCode}`);
            console.log(`Fee:      ${feeXrp} XRP`);
            console.log(`Ledger:   ${ledger}`);
        }
    });
});
const vaultDepositCommand = new commander_1.Command("deposit")
    .alias("d")
    .description("Deposit assets into a vault and receive vault shares")
    .requiredOption("--vault-id <hash>", "64-char hex VaultID to deposit into")
    .requiredOption("--amount <amount>", 'Amount to deposit: "10" for XRP, "10/USD/rIssuer" for IOU, "10/<48hex>" for MPT')
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate --vault-id
    if (!/^[0-9A-Fa-f]{64}$/.test(options.vaultId)) {
        process.stderr.write("Error: --vault-id must be a 64-character hex string\n");
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
    // Parse amount
    let xrplAmount;
    try {
        const parsed = (0, amount_1.parseAmount)(options.amount);
        switch (parsed.type) {
            case "xrp":
                xrplAmount = parsed.drops;
                break;
            case "iou":
                xrplAmount = { value: parsed.value, currency: parsed.currency, issuer: parsed.issuer };
                break;
            case "mpt":
                xrplAmount = { value: parsed.value, mpt_issuance_id: parsed.mpt_issuance_id };
                break;
        }
    }
    catch (e) {
        process.stderr.write(`Error: --amount: ${e.message}\n`);
        process.exit(1);
    }
    const signerWallet = await resolveWallet(options);
    const tx = {
        TransactionType: "VaultDeposit",
        Account: signerWallet.address,
        VaultID: options.vaultId.toUpperCase(),
        Amount: xrplAmount,
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
            console.log(JSON.stringify({ result: "success", vaultId: options.vaultId.toUpperCase(), tx: hash }));
        }
        else {
            console.log(`Vault ID: ${options.vaultId.toUpperCase()}`);
            console.log(`Tx:       ${hash}`);
            console.log(`Result:   ${resultCode}`);
            console.log(`Fee:      ${feeXrp} XRP`);
            console.log(`Ledger:   ${ledger}`);
        }
    });
});
const vaultWithdrawCommand = new commander_1.Command("withdraw")
    .alias("w")
    .description("Withdraw assets from a vault by redeeming vault shares")
    .requiredOption("--vault-id <hash>", "64-char hex VaultID to withdraw from")
    .requiredOption("--amount <amount>", 'Amount to withdraw: "10" for XRP, "10/USD/rIssuer" for IOU, "10/<48hex>" for MPT')
    .option("--destination <address>", "Send redeemed assets to a different account")
    .option("--destination-tag <n>", "Destination tag (requires --destination)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate --vault-id
    if (!/^[0-9A-Fa-f]{64}$/.test(options.vaultId)) {
        process.stderr.write("Error: --vault-id must be a 64-character hex string\n");
        process.exit(1);
    }
    // --destination-tag requires --destination
    if (options.destinationTag !== undefined && options.destination === undefined) {
        process.stderr.write("Error: --destination-tag requires --destination\n");
        process.exit(1);
    }
    // Validate --destination if provided
    if (options.destination !== undefined && !(0, xrpl_1.isValidAddress)(options.destination)) {
        process.stderr.write("Error: --destination must be a valid XRPL address\n");
        process.exit(1);
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
    // Parse amount
    let xrplAmount;
    try {
        const parsed = (0, amount_1.parseAmount)(options.amount);
        switch (parsed.type) {
            case "xrp":
                xrplAmount = parsed.drops;
                break;
            case "iou":
                xrplAmount = { value: parsed.value, currency: parsed.currency, issuer: parsed.issuer };
                break;
            case "mpt":
                xrplAmount = { value: parsed.value, mpt_issuance_id: parsed.mpt_issuance_id };
                break;
        }
    }
    catch (e) {
        process.stderr.write(`Error: --amount: ${e.message}\n`);
        process.exit(1);
    }
    const signerWallet = await resolveWallet(options);
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const tx = {
        TransactionType: "VaultWithdraw",
        Account: signerWallet.address,
        VaultID: options.vaultId.toUpperCase(),
        Amount: xrplAmount,
        ...(options.destination !== undefined
            ? { Destination: (0, keystore_1.resolveAccount)(options.destination, keystoreDir) }
            : {}),
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
            console.log(JSON.stringify({ result: "success", vaultId: options.vaultId.toUpperCase(), tx: hash }));
        }
        else {
            console.log(`Vault ID: ${options.vaultId.toUpperCase()}`);
            console.log(`Tx:       ${hash}`);
            console.log(`Result:   ${resultCode}`);
            console.log(`Fee:      ${feeXrp} XRP`);
            console.log(`Ledger:   ${ledger}`);
        }
    });
});
const vaultDeleteCommand = new commander_1.Command("delete")
    .alias("del")
    .description("Delete an empty vault you own and reclaim the reserve")
    .requiredOption("--vault-id <hash>", "64-char hex VaultID to delete")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate --vault-id
    if (!/^[0-9A-Fa-f]{64}$/.test(options.vaultId)) {
        process.stderr.write("Error: --vault-id must be a 64-character hex string\n");
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
        TransactionType: "VaultDelete",
        Account: signerWallet.address,
        VaultID: options.vaultId.toUpperCase(),
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
            console.log(JSON.stringify({ result: "success", vaultId: options.vaultId.toUpperCase(), tx: hash }));
        }
        else {
            console.log(`Deleted vault: ${options.vaultId.toUpperCase()}`);
            console.log(`Tx:            ${hash}`);
            console.log(`Result:        ${resultCode}`);
            console.log(`Fee:           ${feeXrp} XRP`);
            console.log(`Ledger:        ${ledger}`);
        }
    });
});
const vaultClawbackCommand = new commander_1.Command("clawback")
    .alias("cb")
    .description("Claw back assets from a vault holder (token/MPT issuer only; cannot claw back XRP)")
    .requiredOption("--vault-id <hash>", "64-char hex VaultID")
    .requiredOption("--holder <address>", "Address of the account whose shares to claw back")
    .option("--amount <amount>", "Amount to claw back (omit to claw back all); IOU or MPT only")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate --vault-id
    if (!/^[0-9A-Fa-f]{64}$/.test(options.vaultId)) {
        process.stderr.write("Error: --vault-id must be a 64-character hex string\n");
        process.exit(1);
    }
    // Validate --holder
    if (!(0, xrpl_1.isValidAddress)(options.holder)) {
        process.stderr.write("Error: --holder must be a valid XRPL address\n");
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
    // Parse optional --amount (IOU or MPT only)
    let clawbackAmount;
    if (options.amount !== undefined) {
        try {
            const parsed = (0, amount_1.parseAmount)(options.amount);
            if (parsed.type === "xrp") {
                process.stderr.write("Error: VaultClawback cannot claw back XRP\n");
                process.exit(1);
            }
            if (parsed.type === "iou") {
                clawbackAmount = { value: parsed.value, currency: parsed.currency, issuer: parsed.issuer };
            }
            else {
                clawbackAmount = { value: parsed.value, mpt_issuance_id: parsed.mpt_issuance_id };
            }
        }
        catch (e) {
            process.stderr.write(`Error: --amount: ${e.message}\n`);
            process.exit(1);
        }
    }
    const signerWallet = await resolveWallet(options);
    const tx = {
        TransactionType: "VaultClawback",
        Account: signerWallet.address,
        VaultID: options.vaultId.toUpperCase(),
        Holder: options.holder,
        ...(clawbackAmount !== undefined ? { Amount: clawbackAmount } : {}),
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
            console.log(JSON.stringify({ result: "success", vaultId: options.vaultId.toUpperCase(), holder: options.holder, tx: hash }));
        }
        else {
            console.log(`Vault ID: ${options.vaultId.toUpperCase()}`);
            console.log(`Holder:   ${options.holder}`);
            console.log(`Tx:       ${hash}`);
            console.log(`Result:   ${resultCode}`);
            console.log(`Fee:      ${feeXrp} XRP`);
            console.log(`Ledger:   ${ledger}`);
        }
    });
});
// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
exports.vaultCommand = new commander_1.Command("vault")
    .description("Manage single-asset vaults on the XRP Ledger (devnet: SingleAssetVault amendment)")
    .addCommand(vaultCreateCommand)
    .addCommand(vaultSetCommand)
    .addCommand(vaultDepositCommand)
    .addCommand(vaultWithdrawCommand)
    .addCommand(vaultDeleteCommand)
    .addCommand(vaultClawbackCommand);
