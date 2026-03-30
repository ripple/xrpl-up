import { Command } from "commander";
import { verify as rippleVerify } from "ripple-keypairs";
import { decode, encodeForSigning, verifySignature } from "xrpl";

interface VerifyOptions {
  message?: string;
  fromHex: boolean;
  signature?: string;
  publicKey?: string;
  tx?: string;
  json: boolean;
}

export const verifyCommand = new Command("verify")
  .alias("v")
  .description("Verify a message or transaction signature")
  .option("--message <msg>", "Message to verify (UTF-8 string, or hex if --from-hex)")
  .option("--from-hex", "Treat --message value as hex-encoded", false)
  .option("--signature <hex>", "Signature hex string (used with --message)")
  .option("--public-key <hex>", "Signer public key hex (used with --message)")
  .option("--tx <tx_blob_hex>", "Signed transaction blob hex to verify")
  .option("--json", "Output as JSON {valid: boolean}", false)
  .action((options: VerifyOptions) => {
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

    let valid: boolean;

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
        ? options.message!
        : Buffer.from(options.message!, "utf-8").toString("hex").toUpperCase();

      try {
        valid = rippleVerify(messageHex, options.signature, options.publicKey);
      } catch {
        valid = false;
      }
    } else {
      // --tx mode: verify the signed transaction blob
      try {
        valid = verifySignature(options.tx!);
      } catch {
        valid = false;
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ valid }));
    } else if (valid) {
      console.log("✓ Valid signature");
    } else {
      console.log("✗ Invalid signature");
    }

    if (!valid) {
      process.exit(1);
    }
  });
