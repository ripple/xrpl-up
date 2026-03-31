import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isCreatedNode, signPaymentChannelClaim, verifyPaymentChannelClaim } from "xrpl";
import type { PaymentChannelCreate, PaymentChannelFund, PaymentChannelClaim, TransactionMetadataBase } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";
import { parseAmount } from "../utils/amount";

function walletFromSeed(seed: string): Wallet {
  const { publicKey, privateKey } = deriveKeypair(seed);
  return new Wallet(publicKey, privateKey);
}

async function resolveWallet(options: {
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
}): Promise<Wallet> {
  if (options.seed) {
    return walletFromSeed(options.seed);
  }
  if (options.mnemonic) {
    return Wallet.fromMnemonic(options.mnemonic, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
  }

  // --account path
  const keystoreDir = getKeystoreDir(options);
  const address = resolveAccount(options.account!, keystoreDir);
  const filePath = join(keystoreDir, `${address}.json`);

  if (!existsSync(filePath)) {
    process.stderr.write(`Error: keystore file not found for account ${address}\n`);
    process.exit(1);
  }

  let keystoreData: KeystoreFile;
  try {
    keystoreData = JSON.parse(readFileSync(filePath, "utf-8")) as KeystoreFile;
  } catch {
    process.stderr.write("Error: failed to read or parse keystore file\n");
    process.exit(1);
  }

  let password: string;
  if (options.password !== undefined) {
    process.stderr.write("Warning: passing passwords via flag is insecure\n");
    password = options.password;
  } else {
    password = await promptPassword();
  }

  let material: string;
  try {
    material = decryptKeystore(keystoreData!, password);
  } catch {
    process.stderr.write("Error: wrong password or corrupt keystore\n");
    process.exit(1);
  }

  if (material!.trim().split(/\s+/).length > 1) {
    return Wallet.fromMnemonic(material!, {
      mnemonicEncoding: "bip39",
      derivationPath: "m/44'/144'/0'/0/0",
    });
  }
  return walletFromSeed(material!);
}

function xrplEpochFromIso(iso: string): number {
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) {
    throw new Error(`Invalid ISO 8601 date: "${iso}"`);
  }
  return Math.floor(ms / 1000) - 946684800;
}

interface ChannelCreateOptions {
  to: string;
  amount: string;
  settleDelay: string;
  publicKey?: string;
  cancelAfter?: string;
  destinationTag?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const channelCreateCommand = new Command("create")
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
  .action(async (options: ChannelCreateOptions, cmd: Command) => {
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
    let drops: string;
    try {
      const parsed = parseAmount(options.amount);
      if (parsed.type !== "xrp") {
        process.stderr.write("Error: --amount must be an XRP amount (e.g. 10 or 10000000drops)\n");
        process.exit(1);
      }
      drops = parsed.drops;
    } catch (e: unknown) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Parse settle-delay
    const settleDelay = parseInt(options.settleDelay, 10);
    if (!Number.isInteger(settleDelay) || settleDelay < 0) {
      process.stderr.write("Error: --settle-delay must be a non-negative integer\n");
      process.exit(1);
    }

    // Parse cancel-after
    let cancelAfter: number | undefined;
    if (options.cancelAfter !== undefined) {
      try {
        cancelAfter = xrplEpochFromIso(options.cancelAfter);
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Parse destination-tag
    let destTag: number | undefined;
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
    const keystoreDir = getKeystoreDir(options);
    const destination = resolveAccount(options.to, keystoreDir);

    // Determine public key
    const publicKey = options.publicKey ?? signerWallet.publicKey;

    // Build transaction
    const tx: PaymentChannelCreate = {
      TransactionType: "PaymentChannelCreate",
      Account: signerWallet.address,
      Amount: drops!,
      Destination: destination,
      SettleDelay: settleDelay,
      PublicKey: publicKey,
      ...(cancelAfter !== undefined ? { CancelAfter: cancelAfter } : {}),
      ...(destTag !== undefined ? { DestinationTag: destTag } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
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
        } else {
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

      let response;
      try {
        response = await client.submitAndWait(signed.tx_blob);
      } catch (e: unknown) {
        const err = e as Error;
        if (err.constructor.name === "TimeoutError" || err.message?.includes("LastLedgerSequence")) {
          process.stderr.write("Error: transaction expired (LastLedgerSequence exceeded)\n");
          process.exit(1);
        }
        throw e;
      }

      const txResult = response.result as {
        hash?: string;
        ledger_index?: number;
        meta?: TransactionMetadataBase | string;
        tx_json?: { Fee?: string };
      };

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
      let channelId: string | null = null;
      if (meta && typeof meta !== "string") {
        const channelNode = meta.AffectedNodes?.find(
          (n) => isCreatedNode(n) && n.CreatedNode.LedgerEntryType === "PayChannel"
        );
        if (channelNode && isCreatedNode(channelNode)) {
          channelId = channelNode.CreatedNode.LedgerIndex;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ hash, result: resultCode, fee: feeXrp, ledger, channelId }));
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
        if (channelId) console.log(`Channel ID:  ${channelId}`);
      }
    });
  });

interface ChannelFundOptions {
  channel: string;
  amount: string;
  expiration?: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const channelFundCommand = new Command("fund")
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
  .action(async (options: ChannelFundOptions, cmd: Command) => {
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
    let drops: string;
    try {
      const parsed = parseAmount(options.amount);
      if (parsed.type !== "xrp") {
        process.stderr.write("Error: --amount must be an XRP amount (e.g. 5 or 5000000drops)\n");
        process.exit(1);
      }
      drops = parsed.drops;
    } catch (e: unknown) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Parse expiration
    let expiration: number | undefined;
    if (options.expiration !== undefined) {
      try {
        expiration = xrplEpochFromIso(options.expiration);
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Resolve wallet
    const signerWallet = await resolveWallet(options);

    // Build transaction
    const tx: PaymentChannelFund = {
      TransactionType: "PaymentChannelFund",
      Account: signerWallet.address,
      Channel: options.channel.toUpperCase(),
      Amount: drops!,
      ...(expiration !== undefined ? { Expiration: expiration } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
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
        } else {
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

      let response;
      try {
        response = await client.submitAndWait(signed.tx_blob);
      } catch (e: unknown) {
        const err = e as Error;
        if (err.constructor.name === "TimeoutError" || err.message?.includes("LastLedgerSequence")) {
          process.stderr.write("Error: transaction expired (LastLedgerSequence exceeded)\n");
          process.exit(1);
        }
        throw e;
      }

      const txResult = response.result as {
        hash?: string;
        ledger_index?: number;
        meta?: TransactionMetadataBase | string;
        tx_json?: { Fee?: string };
      };

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
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
      }
    });
  });

interface ChannelSignOptions {
  channel: string;
  amount: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  json: boolean;
}

const channelSignCommand = new Command("sign")
  .description("Sign an off-chain payment channel claim (offline)")
  .requiredOption("--channel <hex>", "64-character payment channel ID")
  .requiredOption("--amount <xrp>", "Amount of XRP to authorize (decimal, e.g. 5)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--json", "Output as JSON", false)
  .action(async (options: ChannelSignOptions) => {
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

    const signature = signPaymentChannelClaim(
      options.channel.toUpperCase(),
      options.amount,
      signerWallet.privateKey
    );

    if (options.json) {
      console.log(JSON.stringify({ signature }));
    } else {
      console.log(signature);
    }
  });

interface ChannelVerifyOptions {
  channel: string;
  amount: string;
  signature: string;
  publicKey: string;
  json: boolean;
}

const channelVerifyCommand = new Command("verify")
  .description("Verify an off-chain payment channel claim signature (offline)")
  .requiredOption("--channel <hex>", "64-character payment channel ID")
  .requiredOption("--amount <xrp>", "Amount of XRP in the claim (decimal, e.g. 5)")
  .requiredOption("--signature <hex>", "Hex-encoded signature to verify")
  .requiredOption("--public-key <hex>", "Hex-encoded public key of the signer")
  .option("--json", "Output as JSON", false)
  .action((options: ChannelVerifyOptions) => {
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

    let valid: boolean;
    try {
      valid = verifyPaymentChannelClaim(
        options.channel.toUpperCase(),
        options.amount,
        options.signature,
        options.publicKey
      );
    } catch {
      // Invalid signature encoding — treat as invalid
      valid = false;
    }

    if (options.json) {
      console.log(JSON.stringify({ valid }));
    } else {
      console.log(valid ? "valid" : "invalid");
    }
  });

interface ChannelClaimOptions {
  channel: string;
  amount?: string;
  balance?: string;
  signature?: string;
  publicKey?: string;
  close: boolean;
  renew: boolean;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const channelClaimCommand = new Command("claim")
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
  .action(async (options: ChannelClaimOptions, cmd: Command) => {
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
    let amountDrops: string | undefined;
    if (options.amount !== undefined) {
      try {
        const parsed = parseAmount(options.amount);
        if (parsed.type !== "xrp") {
          process.stderr.write("Error: --amount must be an XRP amount (e.g. 5 or 5000000drops)\n");
          process.exit(1);
        }
        amountDrops = parsed.drops;
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Parse balance (XRP only)
    let balanceDrops: string | undefined;
    if (options.balance !== undefined) {
      try {
        const parsed = parseAmount(options.balance);
        if (parsed.type !== "xrp") {
          process.stderr.write("Error: --balance must be an XRP amount (e.g. 5 or 5000000drops)\n");
          process.exit(1);
        }
        balanceDrops = parsed.drops;
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    // Build flags
    const tfClose = 0x00020000;
    const tfRenew = 0x00010000;
    let flags = 0;
    if (options.close) flags |= tfClose;
    if (options.renew) flags |= tfRenew;

    // Resolve wallet
    const signerWallet = await resolveWallet(options);

    // Build transaction
    const tx: PaymentChannelClaim = {
      TransactionType: "PaymentChannelClaim",
      Account: signerWallet.address,
      Channel: options.channel.toUpperCase(),
      ...(amountDrops !== undefined ? { Amount: amountDrops } : {}),
      ...(balanceDrops !== undefined ? { Balance: balanceDrops } : {}),
      ...(options.signature !== undefined ? { Signature: options.signature.toUpperCase() } : {}),
      ...(options.publicKey !== undefined ? { PublicKey: options.publicKey.toUpperCase() } : {}),
      ...(flags !== 0 ? { Flags: flags } : {}),
    };

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
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
        } else {
          console.log(`Transaction: ${signed.hash}`);
        }
        return;
      }

      let response;
      try {
        response = await client.submitAndWait(signed.tx_blob);
      } catch (e: unknown) {
        const err = e as Error;
        if (err.constructor.name === "TimeoutError" || err.message?.includes("LastLedgerSequence")) {
          process.stderr.write("Error: transaction expired (LastLedgerSequence exceeded)\n");
          process.exit(1);
        }
        throw e;
      }

      const txResult = response.result as {
        hash?: string;
        ledger_index?: number;
        meta?: TransactionMetadataBase | string;
        tx_json?: { Fee?: string };
      };

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
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
      }
    });
  });

interface ChannelEntry {
  channel_id: string;
  account: string;
  destination_account: string;
  amount: string;
  balance: string;
  public_key?: string;
  public_key_hex?: string;
  settle_delay: number;
  expiration?: number;
  cancel_after?: number;
  destination_tag?: number;
  source_tag?: number;
}

interface ChannelListOptions {
  destination?: string;
  json: boolean;
}

function xrplEpochToIso(epoch: number): string {
  return new Date((epoch + 946684800) * 1000).toISOString();
}

const channelListCommand = new Command("list")
  .description("List open payment channels for an account")
  .argument("<address>", "Account address to query channels for")
  .option("--destination <address>", "Filter channels by destination account")
  .option("--json", "Output as JSON array", false)
  .action(async (address: string, options: ChannelListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const allChannels: ChannelEntry[] = [];
      let marker: unknown = undefined;

      do {
        // Build request with optional fields
        const req: {
          command: "account_channels";
          account: string;
          destination_account?: string;
          limit: number;
          marker?: unknown;
        } = { command: "account_channels", account: address, limit: 400 };

        if (options.destination) req.destination_account = options.destination;
        if (marker !== undefined) req.marker = marker;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await client.request(req as any);
        const result = res.result as { channels: ChannelEntry[]; marker?: unknown };
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

export const channelCommand = new Command("channel")
  .description("Manage XRPL payment channels")
  .addCommand(channelCreateCommand)
  .addCommand(channelFundCommand)
  .addCommand(channelSignCommand)
  .addCommand(channelVerifyCommand)
  .addCommand(channelClaimCommand)
  .addCommand(channelListCommand);
