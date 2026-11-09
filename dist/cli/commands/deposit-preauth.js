"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.depositPreauthCommand = void 0;
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
const depositPreauthSetCommand = new commander_1.Command("set")
    .description("Grant or revoke deposit preauthorization for an account or credential")
    .option("--authorize <address>", "Preauthorize an account to send payments")
    .option("--unauthorize <address>", "Revoke preauthorization from an account")
    .option("--authorize-credential <issuer>", "Preauthorize a credential (by issuer address)")
    .option("--unauthorize-credential <issuer>", "Revoke credential-based preauthorization (by issuer address)")
    .option("--credential-type <string>", "Credential type as plain string (auto hex-encoded, max 64 bytes)")
    .option("--credential-type-hex <hex>", "Credential type as raw hex (2-128 hex chars)")
    .option("--seed <seed>", "Family seed for signing")
    .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
    .option("--account <address-or-alias>", "Account address or alias to load from keystore")
    .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--no-wait", "Submit without waiting for validation")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print signed tx without submitting", false)
    .action(async (options, cmd) => {
    // Count how many main action flags are provided
    const mainFlags = [
        options.authorize,
        options.unauthorize,
        options.authorizeCredential,
        options.unauthorizeCredential,
    ];
    const mainCount = mainFlags.filter((f) => f !== undefined).length;
    if (mainCount === 0) {
        process.stderr.write("Error: provide exactly one of --authorize, --unauthorize, --authorize-credential, or --unauthorize-credential\n");
        process.exit(1);
    }
    if (mainCount > 1) {
        process.stderr.write("Error: --authorize, --unauthorize, --authorize-credential, and --unauthorize-credential are mutually exclusive\n");
        process.exit(1);
    }
    // Validate credential-type flags
    if (options.credentialType !== undefined && options.credentialTypeHex !== undefined) {
        process.stderr.write("Error: --credential-type and --credential-type-hex are mutually exclusive\n");
        process.exit(1);
    }
    const isCredentialAction = options.authorizeCredential !== undefined || options.unauthorizeCredential !== undefined;
    const hasCredentialType = options.credentialType !== undefined || options.credentialTypeHex !== undefined;
    if (isCredentialAction && !hasCredentialType) {
        process.stderr.write("Error: --authorize-credential and --unauthorize-credential require --credential-type or --credential-type-hex\n");
        process.exit(1);
    }
    if (!isCredentialAction && hasCredentialType) {
        process.stderr.write("Error: --credential-type and --credential-type-hex can only be used with --authorize-credential or --unauthorize-credential\n");
        process.exit(1);
    }
    // Resolve credential type hex if needed
    let credentialTypeHex;
    if (isCredentialAction) {
        if (options.credentialType !== undefined) {
            const encoded = (0, xrpl_1.convertStringToHex)(options.credentialType);
            const byteLen = encoded.length / 2;
            if (byteLen > 64) {
                process.stderr.write(`Error: --credential-type encodes to ${byteLen} bytes, max is 64\n`);
                process.exit(1);
            }
            if (byteLen < 1) {
                process.stderr.write("Error: --credential-type must not be empty\n");
                process.exit(1);
            }
            credentialTypeHex = encoded;
        }
        else {
            const hex = options.credentialTypeHex;
            if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length < 2 || hex.length > 128) {
                process.stderr.write("Error: --credential-type-hex must be 2-128 hex characters\n");
                process.exit(1);
            }
            credentialTypeHex = hex.toUpperCase();
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
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    // Build the DepositPreauth transaction
    const tx = {
        TransactionType: "DepositPreauth",
        Account: signerWallet.address,
    };
    if (options.authorize !== undefined) {
        tx.Authorize = (0, keystore_1.resolveAccount)(options.authorize, keystoreDir);
    }
    else if (options.unauthorize !== undefined) {
        tx.Unauthorize = (0, keystore_1.resolveAccount)(options.unauthorize, keystoreDir);
    }
    else if (options.authorizeCredential !== undefined) {
        const issuer = (0, keystore_1.resolveAccount)(options.authorizeCredential, keystoreDir);
        const credential = {
            Credential: {
                Issuer: issuer,
                CredentialType: credentialTypeHex,
            },
        };
        tx.AuthorizeCredentials = [credential];
    }
    else if (options.unauthorizeCredential !== undefined) {
        const issuer = (0, keystore_1.resolveAccount)(options.unauthorizeCredential, keystoreDir);
        const credential = {
            Credential: {
                Issuer: issuer,
                CredentialType: credentialTypeHex,
            },
        };
        tx.UnauthorizeCredentials = [credential];
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
const depositPreauthListCommand = new commander_1.Command("list")
    .description("List deposit preauthorizations for an account")
    .argument("<address>", "Account address to query")
    .option("--json", "Output as JSON", false)
    .action(async (address, options, cmd) => {
    const url = (0, node_1.getNodeUrl)(cmd);
    await (0, client_1.withClient)(url, async (client) => {
        // Paginate through all deposit_preauth objects
        const entries = [];
        let marker = undefined;
        do {
            const res = await client.request({
                command: "account_objects",
                account: address,
                type: "deposit_preauth",
                limit: 400,
                ...(marker !== undefined ? { marker } : {}),
            });
            const result = res.result;
            entries.push(...result.account_objects);
            marker = result.marker;
        } while (marker !== undefined);
        if (options.json) {
            console.log(JSON.stringify(entries));
            return;
        }
        if (entries.length === 0) {
            console.log("No deposit preauthorizations.");
            return;
        }
        for (const entry of entries) {
            if (entry.Authorize !== undefined) {
                console.log(`Account: ${entry.Authorize}`);
            }
            else if (entry.AuthorizeCredentials !== undefined && entry.AuthorizeCredentials.length > 0) {
                const cred = entry.AuthorizeCredentials[0].Credential;
                let credTypeStr;
                try {
                    credTypeStr = (0, xrpl_1.convertHexToString)(cred.CredentialType);
                }
                catch {
                    credTypeStr = cred.CredentialType;
                }
                console.log(`Credential: ${cred.Issuer} / ${credTypeStr}`);
            }
        }
    });
});
exports.depositPreauthCommand = new commander_1.Command("deposit-preauth")
    .description("Manage deposit preauthorizations on XRPL accounts")
    .addCommand(depositPreauthSetCommand)
    .addCommand(depositPreauthListCommand);
