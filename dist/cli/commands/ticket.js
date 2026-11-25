"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const xrpl_1 = require("xrpl");
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
function extractTicketSequences(affectedNodes) {
    const sequences = [];
    for (const node of affectedNodes) {
        if ("CreatedNode" in node &&
            node.CreatedNode.LedgerEntryType === "Ticket" &&
            node.CreatedNode.NewFields !== undefined) {
            const seq = node.CreatedNode.NewFields.TicketSequence;
            if (typeof seq === "number") {
                sequences.push(seq);
            }
        }
    }
    return sequences.sort((a, b) => a - b);
}
const ticketCreateCommand = new commander_1.Command("create")
    .alias("c")
    .description("Reserve ticket sequence numbers on an XRPL account")
    .requiredOption("--count <n>", "Number of tickets to create (1-250)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Validate --count
    const countNum = Number(options.count);
    if (!Number.isInteger(countNum) || countNum < 1 || countNum > 250) {
        process.stderr.write("Error: --count must be an integer between 1 and 250\n");
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
        TransactionType: "TicketCreate",
        Account: signerWallet.address,
        TicketCount: countNum,
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
        const sequence = txResult.tx_json?.Sequence;
        const affectedNodes = (txResult.meta?.AffectedNodes ?? []);
        const sequences = extractTicketSequences(affectedNodes);
        if (/^te[cfm]/i.test(resultCode)) {
            process.stderr.write(`Error: transaction failed with ${resultCode}\n`);
            if (options.json) {
                console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger }));
            }
            process.exit(1);
        }
        if (options.json) {
            console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, sequence, sequences }));
        }
        else {
            console.log(`Transaction: ${hash}`);
            console.log(`Result:      ${resultCode}`);
            console.log(`Fee:         ${feeXrp} XRP`);
            console.log(`Ledger:      ${ledger}`);
            console.log(`Sequence:    ${sequence}`);
            if (sequences.length > 0) {
                console.log(`Tickets:     ${sequences.join(", ")}`);
            }
        }
    });
});
const ticketListCommand = new commander_1.Command("list")
    .alias("ls")
    .description("List ticket sequence numbers for an account")
    .argument("<address>", "Account address to query")
    .option("--json", "Output as JSON array", false)
    .action(async (address, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        const tickets = [];
        let marker = undefined;
        do {
            const response = await client.request({
                command: "account_objects",
                account: address,
                type: "ticket",
                limit: 400,
                ...(marker !== undefined ? { marker } : {}),
            });
            const page = response.result.account_objects;
            tickets.push(...page);
            marker = response.result.marker;
        } while (marker !== undefined);
        if (options.json) {
            console.log(JSON.stringify(tickets.map((t) => ({ sequence: t.TicketSequence }))));
            return;
        }
        if (tickets.length === 0) {
            console.log("No tickets.");
            return;
        }
        for (const t of tickets) {
            console.log(`Ticket sequence: ${t.TicketSequence}`);
        }
    });
});
// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------
exports.ticketCommand = new commander_1.Command("ticket")
    .description("Manage XRPL Tickets")
    .addCommand(ticketCreateCommand)
    .addCommand(ticketListCommand);
