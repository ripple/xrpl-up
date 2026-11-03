"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ammCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
const ripple_keypairs_1 = require("ripple-keypairs");
const client_1 = require("../utils/client");
const node_1 = require("../utils/node");
const keystore_1 = require("../utils/keystore");
const prompt_1 = require("../utils/prompt");
function parseAssetSpec(spec) {
    if (spec.toUpperCase() === "XRP") {
        return { currency: "XRP" };
    }
    const slashIdx = spec.indexOf("/");
    if (slashIdx === -1) {
        throw new Error(`Invalid asset spec "${spec}" — use "XRP" or "CURRENCY/issuer" (e.g. "USD/rIssuer")`);
    }
    const currency = spec.slice(0, slashIdx).toUpperCase();
    const issuer = spec.slice(slashIdx + 1);
    if (!currency || !issuer || !issuer.startsWith("r")) {
        throw new Error(`Invalid asset spec "${spec}" — use "XRP" or "CURRENCY/issuer" (e.g. "USD/rIssuer")`);
    }
    return { currency, issuer };
}
function assetSpecToXrplCurrency(spec) {
    if (spec.currency === "XRP") {
        return { currency: "XRP" };
    }
    return { currency: spec.currency, issuer: spec.issuer };
}
/**
 * Build an xrpl Amount from an asset spec and a plain number string.
 * XRP: amount is decimal XRP (e.g. "100"), matching every other command
 * (payment, trust, channel, escrow, ...). Append "drops" for exact drops
 * (e.g. "100drops"), matching parseAmount() in utils/amount.ts.
 * IOU: amount is decimal value string.
 */
function buildAmmAmount(spec, amountStr) {
    if (spec.currency === "XRP") {
        let drops;
        if (amountStr.endsWith("drops")) {
            const dropsStr = amountStr.slice(0, -5).trim();
            drops = Number(dropsStr);
            if (!/^\d+$/.test(dropsStr) || !Number.isFinite(drops)) {
                throw new Error(`Invalid XRP drop amount "${amountStr}" — expected an integer number of drops`);
            }
        }
        else {
            const xrp = Number(amountStr);
            if (isNaN(xrp) || xrp <= 0 || !Number.isFinite(xrp)) {
                throw new Error(`Invalid XRP amount "${amountStr}" — must be a positive number (e.g. "100", or "100000000drops" for exact drops)`);
            }
            drops = Math.round(xrp * 1_000_000);
        }
        if (drops <= 0) {
            throw new Error(`Invalid XRP amount "${amountStr}" — must be a positive amount`);
        }
        return drops.toString();
    }
    else {
        const value = Number(amountStr);
        if (isNaN(value) || value <= 0) {
            throw new Error(`Invalid IOU amount "${amountStr}" — must be a positive number`);
        }
        return { currency: spec.currency, issuer: spec.issuer, value: amountStr };
    }
}
// ── Wallet resolution ───────────────────────────────────────────────────────
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
const ammCreateCommand = new commander_1.Command("create")
    .description("Create a new AMM liquidity pool")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer" (e.g. "USD/rIssuer")')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--amount <value>", "Amount of first asset (XRP: decimal, IOU: decimal)")
    .requiredOption("--amount2 <value>", "Amount of second asset (XRP: decimal, IOU: decimal)")
    .requiredOption("--trading-fee <n>", "Trading fee in units of 1/100000 (0–1000, where 1000 = 1%)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate trading fee
    const tradingFee = parseInt(options.tradingFee, 10);
    if (isNaN(tradingFee) || tradingFee < 0 || tradingFee > 1000) {
        process.stderr.write("Error: --trading-fee must be an integer between 0 and 1000\n");
        process.exit(1);
    }
    // Parse asset specs
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
    // Validate assets are not the same
    const sameAsset = assetSpec.currency === assetSpec2.currency &&
        (assetSpec.issuer ?? "") === (assetSpec2.issuer ?? "");
    if (sameAsset) {
        process.stderr.write("Error: --asset and --asset2 must be different assets\n");
        process.exit(1);
    }
    // Build amounts
    let xrplAmount;
    let xrplAmount2;
    try {
        xrplAmount = buildAmmAmount(assetSpec, options.amount);
    }
    catch (e) {
        process.stderr.write(`Error: --amount: ${e.message}\n`);
        process.exit(1);
    }
    try {
        xrplAmount2 = buildAmmAmount(assetSpec2, options.amount2);
    }
    catch (e) {
        process.stderr.write(`Error: --amount2: ${e.message}\n`);
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const baseTx = {
            TransactionType: "AMMCreate",
            Account: signerWallet.address,
            Amount: xrplAmount,
            Amount2: xrplAmount2,
            TradingFee: tradingFee,
        };
        const filled = await client.autofill(baseTx);
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
        // Query amm_info to get AMM account and LP token currency
        const ammInfoReq = {
            command: "amm_info",
            asset: assetSpecToXrplCurrency(assetSpec),
            asset2: assetSpecToXrplCurrency(assetSpec2),
        };
        const ammInfoResp = (await client.request(ammInfoReq));
        const ammAccount = ammInfoResp.result.amm.account;
        const lpTokenCurrency = ammInfoResp.result.amm.lp_token.currency;
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, ammAccount, lpTokenCurrency }));
        }
        else {
            console.log(`AMM Account: ${ammAccount}`);
            console.log(`LP Token: ${lpTokenCurrency}`);
        }
    });
});
const ammInfoCommand = new commander_1.Command("info")
    .description("Query AMM pool state via amm_info RPC")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .option("--json", "Output raw amm_info result as JSON", false)
    .action(async (options, cmd) => {
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const ammInfoReq = {
            command: "amm_info",
            asset: assetSpecToXrplCurrency(assetSpec),
            asset2: assetSpecToXrplCurrency(assetSpec2),
        };
        let ammInfoResp;
        try {
            ammInfoResp = (await client.request(ammInfoReq));
        }
        catch (e) {
            process.stderr.write(`Error: AMM not found — ${e.message}\n`);
            process.exit(1);
        }
        const amm = ammInfoResp.result.amm;
        if (options.json) {
            console.log(JSON.stringify(amm));
            return;
        }
        // Human-readable output
        const formatAmount = (a) => {
            if (typeof a === "string") {
                return `${Number(a) / 1_000_000} XRP (${a} drops)`;
            }
            return `${a.value} ${a.currency} (issued by ${a.issuer})`;
        };
        console.log(`AMM Account:    ${amm.account}`);
        console.log(`Asset 1:        ${formatAmount(amm.amount)}`);
        console.log(`Asset 2:        ${formatAmount(amm.amount2)}`);
        console.log(`LP Token:       ${amm.lp_token.value} ${amm.lp_token.currency} (issued by ${amm.lp_token.issuer})`);
        console.log(`Trading Fee:    ${amm.trading_fee} (${amm.trading_fee / 1000}%)`);
        if (amm.auction_slot) {
            console.log(`Auction Slot:   held by ${amm.auction_slot.account} (expires ${amm.auction_slot.expiration})`);
        }
        if (amm.vote_slots && amm.vote_slots.length > 0) {
            console.log(`Vote Slots:     ${amm.vote_slots.length} vote(s)`);
        }
    });
});
// ── shared submit helper ─────────────────────────────────────────────────────
async function submitTx(client, signerWallet, baseTx, options) {
    const filled = await client.autofill(baseTx);
    // autofill uses ledger_index:'current' for sequence, which can be stale on a
    // fresh WebSocket connection routed to a server that hasn't applied the latest
    // validated ledger yet.  Re-fetch from 'validated' (consistent across all nodes).
    const accountInfoResp = await client.request({
        command: "account_info",
        account: signerWallet.address,
        ledger_index: "validated",
    });
    filled.Sequence = accountInfoResp.result.account_data.Sequence;
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
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
    }
}
// ── LP token auto-fetch ──────────────────────────────────────────────────────
async function fetchLpToken(client, assetSpec, assetSpec2) {
    const req = {
        command: "amm_info",
        asset: assetSpecToXrplCurrency(assetSpec),
        asset2: assetSpecToXrplCurrency(assetSpec2),
    };
    const resp = (await client.request(req));
    return {
        currency: resp.result.amm.lp_token.currency,
        issuer: resp.result.amm.lp_token.issuer,
    };
}
const ammDepositCommand = new commander_1.Command("deposit")
    .description("Deposit assets into an AMM pool")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .option("--amount <value>", "Amount of first asset to deposit (XRP: decimal, IOU: decimal)")
    .option("--amount2 <value>", "Amount of second asset to deposit (XRP: decimal, IOU: decimal)")
    .option("--lp-token-out <value>", "LP token amount to receive (auto-fetches currency/issuer)")
    .option("--ePrice <value>", "Maximum effective price per LP token received")
    .option("--for-empty", "Use tfTwoAssetIfEmpty mode (deposit to empty pool)", false)
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
    const { amount, amount2, lpTokenOut, ePrice, forEmpty } = options;
    let mode = null;
    if (lpTokenOut && !amount)
        mode = "tfLPToken";
    else if (amount && lpTokenOut && !amount2)
        mode = "tfOneAssetLPToken";
    else if (amount && ePrice && !amount2 && !lpTokenOut)
        mode = "tfLimitLPToken";
    else if (amount && amount2 && forEmpty)
        mode = "tfTwoAssetIfEmpty";
    else if (amount && amount2 && !forEmpty)
        mode = "tfTwoAsset";
    else if (amount && !amount2 && !lpTokenOut && !ePrice)
        mode = "tfSingleAsset";
    if (!mode) {
        process.stderr.write("Error: invalid flag combination for amm deposit. Valid modes:\n" +
            "  --lp-token-out                         (tfLPToken)\n" +
            "  --amount                               (tfSingleAsset)\n" +
            "  --amount --amount2                     (tfTwoAsset)\n" +
            "  --amount --amount2 --for-empty         (tfTwoAssetIfEmpty)\n" +
            "  --amount --lp-token-out                (tfOneAssetLPToken)\n" +
            "  --amount --ePrice                      (tfLimitLPToken)\n");
        process.exit(1);
    }
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const asset = assetSpecToXrplCurrency(assetSpec);
        const asset2 = assetSpecToXrplCurrency(assetSpec2);
        const baseTx = {
            TransactionType: "AMMDeposit",
            Account: signerWallet.address,
            Asset: asset,
            Asset2: asset2,
            Flags: xrpl_1.AMMDepositFlags[mode],
        };
        // Add amounts based on mode
        if (amount) {
            baseTx.Amount = buildAmmAmount(assetSpec, amount);
        }
        if (amount2) {
            baseTx.Amount2 = buildAmmAmount(assetSpec2, amount2);
        }
        if (ePrice) {
            baseTx.EPrice = buildAmmAmount(assetSpec, ePrice);
        }
        if (lpTokenOut) {
            const lpInfo = await fetchLpToken(client, assetSpec, assetSpec2);
            baseTx.LPTokenOut = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: lpTokenOut };
        }
        await submitTx(client, signerWallet, baseTx, options);
    });
});
const ammWithdrawCommand = new commander_1.Command("withdraw")
    .description("Withdraw assets from an AMM pool")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .option("--lp-token-in <value>", "LP token amount to redeem (auto-fetches currency/issuer)")
    .option("--amount <value>", "Amount of first asset to withdraw (XRP: decimal, IOU: decimal)")
    .option("--amount2 <value>", "Amount of second asset to withdraw (XRP: decimal, IOU: decimal)")
    .option("--ePrice <value>", "Minimum effective price in LP tokens per unit withdrawn")
    .option("--all", "Withdraw all LP tokens (tfWithdrawAll or tfOneAssetWithdrawAll)", false)
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
    const { lpTokenIn, amount, amount2, ePrice, all } = options;
    let mode = null;
    if (lpTokenIn && !amount && !amount2 && !all)
        mode = "tfLPToken";
    else if (all && !amount && !amount2 && !lpTokenIn)
        mode = "tfWithdrawAll";
    else if (all && amount && !amount2 && !lpTokenIn)
        mode = "tfOneAssetWithdrawAll";
    else if (amount && lpTokenIn && !all)
        mode = "tfOneAssetLPToken";
    else if (amount && ePrice && !amount2 && !lpTokenIn && !all)
        mode = "tfLimitLPToken";
    else if (amount && amount2 && !lpTokenIn && !ePrice && !all)
        mode = "tfTwoAsset";
    else if (amount && !amount2 && !lpTokenIn && !ePrice && !all)
        mode = "tfSingleAsset";
    if (!mode) {
        process.stderr.write("Error: invalid flag combination for amm withdraw. Valid modes:\n" +
            "  --lp-token-in                          (tfLPToken)\n" +
            "  --all                                  (tfWithdrawAll)\n" +
            "  --all --amount                         (tfOneAssetWithdrawAll)\n" +
            "  --amount                               (tfSingleAsset)\n" +
            "  --amount --amount2                     (tfTwoAsset)\n" +
            "  --amount --lp-token-in                 (tfOneAssetLPToken)\n" +
            "  --amount --ePrice                      (tfLimitLPToken)\n");
        process.exit(1);
    }
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const asset = assetSpecToXrplCurrency(assetSpec);
        const asset2 = assetSpecToXrplCurrency(assetSpec2);
        const baseTx = {
            TransactionType: "AMMWithdraw",
            Account: signerWallet.address,
            Asset: asset,
            Asset2: asset2,
            Flags: xrpl_1.AMMWithdrawFlags[mode],
        };
        if (amount) {
            baseTx.Amount = buildAmmAmount(assetSpec, amount);
        }
        if (amount2) {
            baseTx.Amount2 = buildAmmAmount(assetSpec2, amount2);
        }
        if (ePrice) {
            baseTx.EPrice = buildAmmAmount(assetSpec, ePrice);
        }
        if (lpTokenIn) {
            const lpInfo = await fetchLpToken(client, assetSpec, assetSpec2);
            baseTx.LPTokenIn = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: lpTokenIn };
        }
        await submitTx(client, signerWallet, baseTx, options);
    });
});
const ammBidCommand = new commander_1.Command("bid")
    .description("Bid on an AMM auction slot to earn a reduced trading fee")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .option("--bid-min <value>", "Minimum LP token amount to bid (auto-fetches currency/issuer)")
    .option("--bid-max <value>", "Maximum LP token amount to bid (auto-fetches currency/issuer)")
    .option("--auth-account <address>", "Address to authorize for discounted trading (repeatable, max 4)", (val, prev) => [...prev, val], [])
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
    if (options.authAccount.length > 4) {
        process.stderr.write("Error: --auth-account can be specified at most 4 times\n");
        process.exit(1);
    }
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const asset = assetSpecToXrplCurrency(assetSpec);
        const asset2 = assetSpecToXrplCurrency(assetSpec2);
        const baseTx = {
            TransactionType: "AMMBid",
            Account: signerWallet.address,
            Asset: asset,
            Asset2: asset2,
        };
        if (options.bidMin || options.bidMax) {
            const lpInfo = await fetchLpToken(client, assetSpec, assetSpec2);
            if (options.bidMin) {
                baseTx.BidMin = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: options.bidMin };
            }
            if (options.bidMax) {
                baseTx.BidMax = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: options.bidMax };
            }
        }
        if (options.authAccount.length > 0) {
            baseTx.AuthAccounts = options.authAccount.map((addr) => ({
                AuthAccount: { Account: addr },
            }));
        }
        await submitTx(client, signerWallet, baseTx, options);
    });
});
const ammVoteCommand = new commander_1.Command("vote")
    .description("Vote on the trading fee for an AMM pool")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--trading-fee <n>", "Desired trading fee in units of 1/100000 (0–1000)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    const tradingFee = parseInt(options.tradingFee, 10);
    if (isNaN(tradingFee) || tradingFee < 0 || tradingFee > 1000) {
        process.stderr.write("Error: --trading-fee must be an integer between 0 and 1000\n");
        process.exit(1);
    }
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const baseTx = {
            TransactionType: "AMMVote",
            Account: signerWallet.address,
            Asset: assetSpecToXrplCurrency(assetSpec),
            Asset2: assetSpecToXrplCurrency(assetSpec2),
            TradingFee: tradingFee,
        };
        await submitTx(client, signerWallet, baseTx, options);
    });
});
const ammDeleteCommand = new commander_1.Command("delete")
    .description("Delete an empty AMM pool (all LP tokens must have been returned first)")
    .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const baseTx = {
            TransactionType: "AMMDelete",
            Account: signerWallet.address,
            Asset: assetSpecToXrplCurrency(assetSpec),
            Asset2: assetSpecToXrplCurrency(assetSpec2),
        };
        await submitTx(client, signerWallet, baseTx, options);
    });
});
const ammClawbackCommand = new commander_1.Command("clawback")
    .description("Claw back IOU assets from an AMM pool (issuer only)")
    .requiredOption("--asset <spec>", 'IOU asset to claw back: "CURRENCY/issuer" (issuer must match signing account)')
    .requiredOption("--asset2 <spec>", 'Other asset in the pool: "XRP" or "CURRENCY/issuer"')
    .requiredOption("--holder <address>", "Account holding the asset to be clawed back")
    .option("--amount <value>", "Maximum amount to claw back (default: all available)")
    .option("--both-assets", "Claw back both assets proportionally (tfClawTwoAssets)", false)
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias from keystore")
    .option("--password <password>", "Keystore decryption password (insecure)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    let assetSpec;
    let assetSpec2;
    try {
        assetSpec = parseAssetSpec(options.asset);
    }
    catch (e) {
        process.stderr.write(`Error: --asset: ${e.message}\n`);
        process.exit(1);
    }
    try {
        assetSpec2 = parseAssetSpec(options.asset2);
    }
    catch (e) {
        process.stderr.write(`Error: --asset2: ${e.message}\n`);
        process.exit(1);
    }
    // AMMClawback Asset must be an IOU, not XRP
    if (assetSpec.currency === "XRP" || !assetSpec.issuer) {
        process.stderr.write("Error: --asset must be an IOU (CURRENCY/issuer), not XRP\n");
        process.exit(1);
    }
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
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const baseTx = {
            TransactionType: "AMMClawback",
            Account: signerWallet.address,
            Asset: { currency: assetSpec.currency, issuer: assetSpec.issuer },
            Asset2: assetSpecToXrplCurrency(assetSpec2),
            Holder: options.holder,
        };
        if (options.amount) {
            const value = Number(options.amount);
            if (isNaN(value) || value <= 0) {
                process.stderr.write(`Error: --amount: must be a positive number\n`);
                process.exit(1);
            }
            baseTx.Amount = {
                currency: assetSpec.currency,
                issuer: assetSpec.issuer,
                value: options.amount,
            };
        }
        if (options.bothAssets) {
            baseTx.Flags = xrpl_1.AMMClawbackFlags.tfClawTwoAssets;
        }
        await submitTx(client, signerWallet, baseTx, options);
    });
});
// ── export ───────────────────────────────────────────────────────────────────
exports.ammCommand = new commander_1.Command("amm")
    .description("Manage AMM liquidity pools on the XRP Ledger")
    .addCommand(ammCreateCommand)
    .addCommand(ammInfoCommand)
    .addCommand(ammDepositCommand)
    .addCommand(ammWithdrawCommand)
    .addCommand(ammBidCommand)
    .addCommand(ammVoteCommand)
    .addCommand(ammDeleteCommand)
    .addCommand(ammClawbackCommand);
