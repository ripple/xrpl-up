"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCommand = void 0;
const commander_1 = require("commander");
const ripple_keypairs_1 = require("ripple-keypairs");
const xrpl_1 = require("xrpl");
exports.verifyCommand = new commander_1.Command("verify")
    .alias("v")
    .description("Verify a message or transaction signature")
    .option("--message <msg>", "Message to verify (UTF-8 string, or hex if --from-hex)")
    .option("--from-hex", "Treat --message value as hex-encoded", false)
    .option("--signature <hex>", "Signature hex string (used with --message)")
    .option("--public-key <hex>", "Signer public key hex (used with --message)")
    .option("--tx <tx_blob_hex>", "Signed transaction blob hex to verify")
    .option("--json", "Output as JSON {valid: boolean}", false)
    .action((options) => {
    const hasMessage = options.message !== undefined;
    const hasTx = options.tx !== undefined;
    if (!hasMessage && !hasTx) {
        process.stderr.write("Error: provide either --message (with --signature and --public-key) or --tx\n");
        process.exit(1);
    }
    if (hasMessage && hasTx) {
        process.stderr.write("Error: provide only one of --message or --tx\n");
        process.exit(1);
    }
    let valid;
    if (hasMessage) {
        if (!options.signature) {
            process.stderr.write("Error: --signature is required with --message\n");
            process.exit(1);
        }
        if (!options.publicKey) {
            process.stderr.write("Error: --public-key is required with --message\n");
            process.exit(1);
        }
        const messageHex = options.fromHex
            ? options.message
            : Buffer.from(options.message, "utf-8").toString("hex").toUpperCase();
        try {
            valid = (0, ripple_keypairs_1.verify)(messageHex, options.signature, options.publicKey);
        }
        catch {
            valid = false;
        }
    }
    else {
        // --tx mode: verify the signed transaction blob
        try {
            valid = (0, xrpl_1.verifySignature)(options.tx);
        }
        catch {
            valid = false;
        }
    }
    if (options.json) {
        console.log(JSON.stringify({ valid }));
    }
    else if (valid) {
        console.log("✓ Valid signature");
    }
    else {
        console.log("✗ Invalid signature");
    }
    if (!valid) {
        process.exit(1);
    }
});
