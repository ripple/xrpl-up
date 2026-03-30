import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, isValidAddress } from "xrpl";
import type { SignerListSet } from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import { decryptKeystore, getKeystoreDir, resolveAccount, type KeystoreFile } from "../utils/keystore";
import { promptPassword } from "../utils/prompt";

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

interface ParsedSigner {
  address: string;
  weight: number;
}

interface MultisigSetOptions {
  quorum: string;
  signer: string[];
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const multisigSetCommand = new Command("set")
  .description("Configure a multi-signature signer list on an account")
  .requiredOption("--quorum <n>", "Required signature weight threshold (must be > 0; use 'multisig delete' to remove)")
  .option(
    "--signer <address:weight>",
    "Signer entry (repeatable); e.g. --signer rAlice...:3 --signer rBob...:2",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[]
  )
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: MultisigSetOptions, cmd: Command) => {
    // Validate --quorum
    const quorum = parseInt(options.quorum, 10);
    if (isNaN(quorum) || String(quorum) !== options.quorum.trim()) {
      process.stderr.write("Error: --quorum must be a positive integer\n");
      process.exit(1);
    }
    if (quorum === 0) {
      process.stderr.write("Error: --quorum cannot be 0; use 'multisig delete' to remove a signer list\n");
      process.exit(1);
    }
    if (quorum < 0) {
      process.stderr.write("Error: --quorum must be a positive integer\n");
      process.exit(1);
    }

    // Validate at least one --signer provided
    if (!options.signer || options.signer.length === 0) {
      process.stderr.write("Error: at least one --signer is required\n");
      process.exit(1);
    }

    // Validate max 32 signers before parsing (early exit with clear message)
    if (options.signer.length > 32) {
      process.stderr.write("Error: a signer list can have at most 32 signers\n");
      process.exit(1);
    }

    // Parse and validate signers
    const parsedSigners: ParsedSigner[] = [];
    for (const signerStr of options.signer) {
      const lastColon = signerStr.lastIndexOf(":");
      if (lastColon === -1) {
        process.stderr.write(`Error: invalid --signer format '${signerStr}'; expected address:weight\n`);
        process.exit(1);
      }
      const address = signerStr.slice(0, lastColon);
      const weightStr = signerStr.slice(lastColon + 1);
      const weight = parseInt(weightStr, 10);
      if (isNaN(weight) || weight <= 0 || String(weight) !== weightStr) {
        process.stderr.write(
          `Error: invalid weight '${weightStr}' in --signer '${signerStr}'; must be a positive integer\n`
        );
        process.exit(1);
      }
      if (!isValidAddress(address)) {
        process.stderr.write(`Error: invalid address '${address}' in --signer '${signerStr}'\n`);
        process.exit(1);
      }
      parsedSigners.push({ address, weight });
    }

    // Validate no duplicate addresses
    const signerAddresses = parsedSigners.map((s) => s.address);
    const uniqueAddresses = new Set(signerAddresses);
    if (uniqueAddresses.size !== signerAddresses.length) {
      process.stderr.write("Error: duplicate signer address detected\n");
      process.exit(1);
    }

    // Validate quorum <= sum of weights
    const totalWeight = parsedSigners.reduce((sum, s) => sum + s.weight, 0);
    if (quorum > totalWeight) {
      process.stderr.write(
        `Error: --quorum (${quorum}) exceeds sum of signer weights (${totalWeight})\n`
      );
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

    // Build SignerListSet transaction
    const tx: SignerListSet = {
      TransactionType: "SignerListSet",
      Account: signerWallet.address,
      SignerQuorum: quorum,
      SignerEntries: parsedSigners.map((s) => ({
        SignerEntry: {
          Account: s.address,
          SignerWeight: s.weight,
        },
      })),
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
        meta?: { TransactionResult?: string };
        tx_json?: { Fee?: string };
      };

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
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
      }
    });
  });

interface MultisigDeleteOptions {
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const multisigDeleteCommand = new Command("delete")
  .description("Remove the multi-signature signer list from an account")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias to load from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: MultisigDeleteOptions, cmd: Command) => {
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

    // Build SignerListSet with SignerQuorum=0 and no SignerEntries (deletion)
    const tx: SignerListSet = {
      TransactionType: "SignerListSet",
      Account: signerWallet.address,
      SignerQuorum: 0,
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
        meta?: { TransactionResult?: string };
        tx_json?: { Fee?: string };
      };

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
      } else {
        console.log(`Transaction: ${hash}`);
        console.log(`Result:      ${resultCode}`);
        console.log(`Fee:         ${feeXrp} XRP`);
        console.log(`Ledger:      ${ledger}`);
      }
    });
  });

interface SignerEntryLedger {
  SignerEntry: {
    Account: string;
    SignerWeight: number;
    WalletLocator?: string;
  };
}

interface SignerListLedger {
  LedgerEntryType: string;
  SignerQuorum: number;
  SignerEntries?: SignerEntryLedger[];
}

interface MultisigListOptions {
  json: boolean;
}

const multisigListCommand = new Command("list")
  .description("Show the current signer list for an account")
  .argument("<address>", "Account address to query")
  .option("--json", "Output as JSON", false)
  .action(async (address: string, options: MultisigListOptions, cmd: Command) => {
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const res = await client.request({
        command: "account_objects",
        account: address,
        type: "signer_list",
        ledger_index: "validated",
      });

      const signerLists = res.result.account_objects as unknown as SignerListLedger[];

      if (options.json) {
        console.log(JSON.stringify(signerLists));
        return;
      }

      if (signerLists.length === 0) {
        console.log("No signer list configured.");
        return;
      }

      const list = signerLists[0];
      console.log(`Quorum: ${list.SignerQuorum}`);
      for (const entry of list.SignerEntries ?? []) {
        console.log(`${entry.SignerEntry.Account} (weight: ${entry.SignerEntry.SignerWeight})`);
      }
    });
  });

export const multisigCommand = new Command("multisig")
  .description("Manage XRPL multi-signature signer lists")
  .addCommand(multisigSetCommand)
  .addCommand(multisigDeleteCommand)
  .addCommand(multisigListCommand);
