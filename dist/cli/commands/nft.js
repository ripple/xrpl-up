"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nftCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
const amount_1 = require("../utils/amount");
const ripple_keypairs_1 = require("ripple-keypairs");
const client_1 = require("../utils/client");
const node_1 = require("../utils/node");
const keystore_1 = require("../utils/keystore");
const prompt_1 = require("../utils/prompt");
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
const nftMintCommand = new commander_1.Command("mint")
    .description("Mint an NFT on the XRP Ledger")
    .requiredOption("--taxon <n>", "NFT taxon (UInt32)")
    .option("--uri <string>", "Metadata URI (plain string, converted to hex)")
    .option("--transfer-fee <bps>", "Secondary sale fee in basis points (0-50000); requires --transferable")
    .option("--burnable", "Allow issuer to burn the NFT (tfBurnable)", false)
    .option("--only-xrp", "Restrict sales to XRP only (tfOnlyXRP)", false)
    .option("--transferable", "Allow peer-to-peer transfers (tfTransferable)", false)
    .option("--mutable", "Allow URI modification via nft modify (tfMutable)", false)
    .option("--issuer <address>", "Issuer address (when minting on behalf of another account)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate taxon
    const taxon = parseInt(options.taxon, 10);
    if (!Number.isInteger(taxon) || taxon < 0 || taxon > 4294967295) {
        process.stderr.write("Error: --taxon must be an integer between 0 and 4294967295\n");
        process.exit(1);
    }
    // Validate transfer-fee
    if (options.transferFee !== undefined) {
        const fee = parseInt(options.transferFee, 10);
        if (!Number.isInteger(fee) || fee < 0 || fee > 50000) {
            process.stderr.write("Error: --transfer-fee must be between 0 and 50000\n");
            process.exit(1);
        }
        if (!options.transferable) {
            process.stderr.write("Error: --transfer-fee requires --transferable\n");
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
    // Build flags
    let flags = 0;
    if (options.burnable)
        flags |= xrpl_1.NFTokenMintFlags.tfBurnable;
    if (options.onlyXrp)
        flags |= xrpl_1.NFTokenMintFlags.tfOnlyXRP;
    if (options.transferable)
        flags |= xrpl_1.NFTokenMintFlags.tfTransferable;
    if (options.mutable)
        flags |= xrpl_1.NFTokenMintFlags.tfMutable;
    // Build transaction
    const tx = {
        TransactionType: "NFTokenMint",
        Account: signerWallet.address,
        NFTokenTaxon: taxon,
        ...(flags !== 0 ? { Flags: flags } : {}),
        ...(options.uri !== undefined ? { URI: (0, xrpl_1.convertStringToHex)(options.uri) } : {}),
        ...(options.transferFee !== undefined ? { TransferFee: parseInt(options.transferFee, 10) } : {}),
        ...(options.issuer !== undefined ? { Issuer: options.issuer } : {}),
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
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
            }
            process.exit(1);
        }
        // Extract NFTokenID
        let nftokenId;
        if (txResult.meta?.nftoken_id) {
            nftokenId = txResult.meta.nftoken_id;
        }
        else {
            try {
                nftokenId = (0, xrpl_1.getNFTokenID)(txResult.meta);
            }
            catch {
                // fallback: scan AffectedNodes
                const affectedNodes = txResult.meta?.AffectedNodes ?? [];
                for (const node of affectedNodes) {
                    if (node.CreatedNode?.LedgerEntryType === "NFTokenPage") {
                        const tokens = node.CreatedNode?.NewFields?.NFTokens ?? [];
                        if (tokens.length > 0) {
                            nftokenId = tokens[tokens.length - 1]?.NFToken?.NFTokenID;
                        }
                    }
                }
            }
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, nftokenId }));
        }
        else {
            console.log(`Transaction: ${hash}`);
            console.log(`Result:      ${resultCode}`);
            console.log(`Fee:         ${feeXrp} XRP`);
            console.log(`Ledger:      ${ledger}`);
            if (nftokenId) {
                console.log(`NFTokenID:   ${nftokenId}`);
            }
        }
    });
});
const nftBurnCommand = new commander_1.Command("burn")
    .description("Burn (destroy) an NFT on the XRP Ledger")
    .requiredOption("--nft <hex>", "64-char NFTokenID to burn")
    .option("--owner <address>", "NFT owner address (when issuer burns a burnable token they don't hold)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate NFTokenID
    if (!/^[0-9A-Fa-f]{64}$/.test(options.nft)) {
        process.stderr.write("Error: --nft must be a 64-character hex NFTokenID\n");
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
        TransactionType: "NFTokenBurn",
        Account: signerWallet.address,
        NFTokenID: options.nft.toUpperCase(),
        ...(options.owner !== undefined ? { Owner: options.owner } : {}),
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
const nftModifyCommand = new commander_1.Command("modify")
    .description("Modify the URI of a mutable NFT on the XRP Ledger")
    .requiredOption("--nft <hex>", "64-char NFTokenID to modify")
    .option("--uri <string>", "New metadata URI (plain string, converted to hex)")
    .option("--clear-uri", "Explicitly clear the existing URI", false)
    .option("--owner <address>", "NFT owner address (if different from signer)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate NFTokenID
    if (!/^[0-9A-Fa-f]{64}$/.test(options.nft)) {
        process.stderr.write("Error: --nft must be a 64-character hex NFTokenID\n");
        process.exit(1);
    }
    // Validate URI vs clear-uri
    if (!options.uri && !options.clearUri) {
        process.stderr.write("Error: provide --uri <string> or --clear-uri\n");
        process.exit(1);
    }
    if (options.uri && options.clearUri) {
        process.stderr.write("Error: --uri and --clear-uri are mutually exclusive\n");
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
        TransactionType: "NFTokenModify",
        Account: signerWallet.address,
        NFTokenID: options.nft.toUpperCase(),
        ...(options.uri !== undefined ? { URI: (0, xrpl_1.convertStringToHex)(options.uri) } : {}),
        ...(options.owner !== undefined ? { Owner: options.owner } : {}),
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
// ---------- nft offer create ----------
const XRPL_EPOCH_OFFSET = 946684800; // seconds from Unix epoch to XRPL epoch (Jan 1, 2000)
const nftOfferCreateCommand = new commander_1.Command("create")
    .description("Create a buy or sell offer for an NFT")
    .requiredOption("--nft <hex>", "64-char NFTokenID")
    .requiredOption("--amount <amount>", "Offer amount (XRP decimal or value/CURRENCY/issuer; '0' valid for XRP sell giveaways)")
    .option("--sell", "Create a sell offer (absence = buy offer)", false)
    .option("--owner <address>", "NFT owner address (required for buy offers)")
    .option("--expiration <ISO8601>", "Offer expiration (ISO 8601 datetime)")
    .option("--destination <address>", "Only this account may accept the offer")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate NFTokenID
    if (!/^[0-9A-Fa-f]{64}$/.test(options.nft)) {
        process.stderr.write("Error: --nft must be a 64-character hex NFTokenID\n");
        process.exit(1);
    }
    // Validate amount
    let parsedAmount;
    try {
        parsedAmount = (0, amount_1.parseAmount)(options.amount);
    }
    catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
    }
    // Buy offer requires --owner
    if (!options.sell && !options.owner) {
        process.stderr.write("Error: --owner is required for buy offers\n");
        process.exit(1);
    }
    // Validate expiration
    let xrplExpiration;
    if (options.expiration !== undefined) {
        const unixMs = Date.parse(options.expiration);
        if (isNaN(unixMs)) {
            process.stderr.write("Error: --expiration must be a valid ISO 8601 date\n");
            process.exit(1);
        }
        xrplExpiration = Math.floor(unixMs / 1000) - XRPL_EPOCH_OFFSET;
        if (xrplExpiration <= 0) {
            process.stderr.write("Error: --expiration must be a future date\n");
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
        TransactionType: "NFTokenCreateOffer",
        Account: signerWallet.address,
        NFTokenID: options.nft.toUpperCase(),
        Amount: (0, amount_1.toXrplAmount)(parsedAmount),
        ...(options.sell ? { Flags: xrpl_1.NFTokenCreateOfferFlags.tfSellNFToken } : {}),
        ...(options.owner !== undefined ? { Owner: options.owner } : {}),
        ...(xrplExpiration !== undefined ? { Expiration: xrplExpiration } : {}),
        ...(options.destination !== undefined ? { Destination: options.destination } : {}),
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
        // Extract NFTokenOfferID from AffectedNodes
        let offerId;
        const affectedNodes = txResult.meta?.AffectedNodes ?? [];
        for (const node of affectedNodes) {
            if (node.CreatedNode?.LedgerEntryType === "NFTokenOffer") {
                offerId = node.CreatedNode.LedgerIndex;
                break;
            }
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, offerId }));
        }
        else {
            console.log(`Transaction: ${hash}`);
            console.log(`Result:      ${resultCode}`);
            console.log(`Fee:         ${feeXrp} XRP`);
            console.log(`Ledger:      ${ledger}`);
            if (offerId) {
                console.log(`OfferID:     ${offerId}`);
            }
        }
    });
});
const nftOfferAcceptCommand = new commander_1.Command("accept")
    .description("Accept a buy or sell NFT offer (direct or brokered mode)")
    .option("--sell-offer <hex>", "Sell offer ID (64-char hex)")
    .option("--buy-offer <hex>", "Buy offer ID (64-char hex)")
    .option("--broker-fee <amount>", "Broker fee (XRP decimal or value/CURRENCY/issuer; only valid with both offers)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate: must have at least one offer
    if (!options.sellOffer && !options.buyOffer) {
        process.stderr.write("Error: provide --sell-offer and/or --buy-offer\n");
        process.exit(1);
    }
    // broker-fee requires both offers
    if (options.brokerFee !== undefined && !(options.sellOffer && options.buyOffer)) {
        process.stderr.write("Error: --broker-fee requires both --sell-offer and --buy-offer\n");
        process.exit(1);
    }
    // Validate offer hex IDs
    if (options.sellOffer && !/^[0-9A-Fa-f]{64}$/.test(options.sellOffer)) {
        process.stderr.write("Error: --sell-offer must be a 64-character hex string\n");
        process.exit(1);
    }
    if (options.buyOffer && !/^[0-9A-Fa-f]{64}$/.test(options.buyOffer)) {
        process.stderr.write("Error: --buy-offer must be a 64-character hex string\n");
        process.exit(1);
    }
    // Parse broker fee
    let parsedBrokerFee;
    if (options.brokerFee !== undefined) {
        try {
            parsedBrokerFee = (0, amount_1.parseAmount)(options.brokerFee);
        }
        catch (e) {
            process.stderr.write(`Error: ${e.message}\n`);
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
        TransactionType: "NFTokenAcceptOffer",
        Account: signerWallet.address,
        ...(options.sellOffer !== undefined ? { NFTokenSellOffer: options.sellOffer.toUpperCase() } : {}),
        ...(options.buyOffer !== undefined ? { NFTokenBuyOffer: options.buyOffer.toUpperCase() } : {}),
        ...(parsedBrokerFee !== undefined ? { NFTokenBrokerFee: (0, amount_1.toXrplAmount)(parsedBrokerFee) } : {}),
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
const nftOfferCancelCommand = new commander_1.Command("cancel")
    .description("Cancel one or more NFT offers")
    .option("--offer <hex>", "NFTokenOffer ID to cancel (repeat for multiple)", (val, prev) => prev.concat([val]), [])
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate: must have at least one offer
    if (!options.offer || options.offer.length === 0) {
        process.stderr.write("Error: provide at least one --offer <hex>\n");
        process.exit(1);
    }
    // Validate each offer ID
    for (const offerId of options.offer) {
        if (!/^[0-9A-Fa-f]{64}$/.test(offerId)) {
            process.stderr.write(`Error: --offer must be a 64-character hex string, got: ${offerId}\n`);
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
        TransactionType: "NFTokenCancelOffer",
        Account: signerWallet.address,
        NFTokenOffers: options.offer.map((id) => id.toUpperCase()),
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
function formatOfferAmount(amount) {
    if (typeof amount === "string") {
        return `${(Number(amount) / 1_000_000).toFixed(6)} XRP`;
    }
    return `${amount.value} ${amount.currency}/${amount.issuer}`;
}
function formatOfferExpiration(exp) {
    if (exp === undefined || exp === null)
        return "none";
    return new Date((exp + XRPL_EPOCH_OFFSET) * 1000).toISOString();
}
const nftOfferListCommand = new commander_1.Command("list")
    .description("List buy and sell offers for an NFT")
    .argument("<nft-id>", "64-char NFTokenID")
    .option("--json", "Output as JSON", false)
    .action(async (nftId, options, cmd) => {
    if (!/^[0-9A-Fa-f]{64}$/.test(nftId)) {
        process.stderr.write("Error: <nft-id> must be a 64-character hex NFTokenID\n");
        process.exit(1);
    }
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const [sellSettled, buySettled] = await Promise.allSettled([
            client.request({ command: "nft_sell_offers", nft_id: nftId.toUpperCase() }),
            client.request({ command: "nft_buy_offers", nft_id: nftId.toUpperCase() }),
        ]);
        const sellOffers = sellSettled.status === "fulfilled"
            ? (sellSettled.value.result.offers ?? [])
            : [];
        const buyOffers = buySettled.status === "fulfilled"
            ? (buySettled.value.result.offers ?? [])
            : [];
        if (options.json) {
            console.log(JSON.stringify({ sellOffers, buyOffers }));
            return;
        }
        // Human-readable output
        console.log("Sell Offers");
        console.log("-----------");
        if (sellOffers.length === 0) {
            console.log("  (none)");
        }
        else {
            for (const offer of sellOffers) {
                console.log(`  ID:          ${offer.nft_offer_index}`);
                console.log(`  Amount:      ${formatOfferAmount(offer.amount)}`);
                console.log(`  Owner:       ${offer.owner}`);
                console.log(`  Expiration:  ${formatOfferExpiration(offer.expiration)}`);
                console.log(`  Destination: ${offer.destination ?? "any"}`);
                console.log("");
            }
        }
        console.log("Buy Offers");
        console.log("----------");
        if (buyOffers.length === 0) {
            console.log("  (none)");
        }
        else {
            for (const offer of buyOffers) {
                console.log(`  ID:          ${offer.nft_offer_index}`);
                console.log(`  Amount:      ${formatOfferAmount(offer.amount)}`);
                console.log(`  Owner:       ${offer.owner}`);
                console.log(`  Expiration:  ${formatOfferExpiration(offer.expiration)}`);
                console.log(`  Destination: ${offer.destination ?? "any"}`);
                console.log("");
            }
        }
    });
});
const nftOfferCommand = new commander_1.Command("offer")
    .description("Manage NFT offers")
    .addCommand(nftOfferCreateCommand)
    .addCommand(nftOfferAcceptCommand)
    .addCommand(nftOfferCancelCommand)
    .addCommand(nftOfferListCommand);
exports.nftCommand = new commander_1.Command("nft")
    .description("Manage NFTs on the XRP Ledger")
    .addCommand(nftMintCommand)
    .addCommand(nftBurnCommand)
    .addCommand(nftModifyCommand)
    .addCommand(nftOfferCommand);
