import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Wallet, AMMDepositFlags, AMMWithdrawFlags, AMMClawbackFlags } from "xrpl";
import type {
  AMMCreate,
  AMMDeposit,
  AMMWithdraw,
  AMMBid,
  AMMVote,
  AMMDelete,
  AMMClawback,
  AMMInfoRequest,
  AMMInfoResponse,
  AccountInfoRequest,
  AccountInfoResponse,
  IssuedCurrencyAmount,
  Currency,
  Client,
  AuthAccount,
} from "xrpl";
import { deriveKeypair } from "ripple-keypairs";
import { withClient } from "../utils/client";
import { getNodeUrl } from "../utils/node";
import {
  decryptKeystore,
  getKeystoreDir,
  resolveAccount,
  type KeystoreFile,
} from "../utils/keystore";
import { promptPassword } from "../utils/prompt";

// ── Asset spec helpers ──────────────────────────────────────────────────────

interface AssetSpec {
  currency: string;
  issuer?: string;
}

function parseAssetSpec(spec: string): AssetSpec {
  if (spec.toUpperCase() === "XRP") {
    return { currency: "XRP" };
  }
  const slashIdx = spec.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(
      `Invalid asset spec "${spec}" — use "XRP" or "CURRENCY/issuer" (e.g. "USD/rIssuer")`
    );
  }
  const currency = spec.slice(0, slashIdx).toUpperCase();
  const issuer = spec.slice(slashIdx + 1);
  if (!currency || !issuer || !issuer.startsWith("r")) {
    throw new Error(
      `Invalid asset spec "${spec}" — use "XRP" or "CURRENCY/issuer" (e.g. "USD/rIssuer")`
    );
  }
  return { currency, issuer };
}

function assetSpecToXrplCurrency(spec: AssetSpec): Currency {
  if (spec.currency === "XRP") {
    return { currency: "XRP" as const };
  }
  return { currency: spec.currency, issuer: spec.issuer! };
}

/**
 * Build an xrpl Amount from an asset spec and a plain number string.
 * XRP: amount is in drops (integer string).
 * IOU: amount is decimal value string.
 */
function buildAmmAmount(
  spec: AssetSpec,
  amountStr: string
): string | IssuedCurrencyAmount {
  if (spec.currency === "XRP") {
    const drops = Math.round(Number(amountStr));
    if (isNaN(drops) || drops <= 0 || !Number.isFinite(drops)) {
      throw new Error(`Invalid XRP drop amount "${amountStr}" — must be a positive integer (drops)`);
    }
    return drops.toString();
  } else {
    const value = Number(amountStr);
    if (isNaN(value) || value <= 0) {
      throw new Error(`Invalid IOU amount "${amountStr}" — must be a positive number`);
    }
    return { currency: spec.currency, issuer: spec.issuer!, value: amountStr };
  }
}

// ── Wallet resolution ───────────────────────────────────────────────────────

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

// ── amm create ──────────────────────────────────────────────────────────────

interface AmmCreateOptions {
  asset: string;
  asset2: string;
  amount: string;
  amount2: string;
  tradingFee: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammCreateCommand = new Command("create")
  .description("Create a new AMM liquidity pool")
  .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer" (e.g. "USD/rIssuer")')
  .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
  .requiredOption("--amount <value>", "Amount of first asset (XRP: drops, IOU: decimal)")
  .requiredOption("--amount2 <value>", "Amount of second asset (XRP: drops, IOU: decimal)")
  .requiredOption("--trading-fee <n>", "Trading fee in units of 1/100000 (0–1000, where 1000 = 1%)")
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias from keystore")
  .option("--password <password>", "Keystore decryption password (insecure, prefer interactive prompt)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: AmmCreateOptions, cmd: Command) => {
    // Validate trading fee
    const tradingFee = parseInt(options.tradingFee, 10);
    if (isNaN(tradingFee) || tradingFee < 0 || tradingFee > 1000) {
      process.stderr.write("Error: --trading-fee must be an integer between 0 and 1000\n");
      process.exit(1);
    }

    // Parse asset specs
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // Validate assets are not the same
    const sameAsset =
      assetSpec!.currency === assetSpec2!.currency &&
      (assetSpec!.issuer ?? "") === (assetSpec2!.issuer ?? "");
    if (sameAsset) {
      process.stderr.write("Error: --asset and --asset2 must be different assets\n");
      process.exit(1);
    }

    // Build amounts
    let xrplAmount: ReturnType<typeof buildAmmAmount>;
    let xrplAmount2: ReturnType<typeof buildAmmAmount>;
    try {
      xrplAmount = buildAmmAmount(assetSpec!, options.amount);
    } catch (e: unknown) {
      process.stderr.write(`Error: --amount: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      xrplAmount2 = buildAmmAmount(assetSpec2!, options.amount2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --amount2: ${(e as Error).message}\n`);
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const baseTx: AMMCreate = {
        TransactionType: "AMMCreate",
        Account: signerWallet.address,
        Amount: xrplAmount as AMMCreate["Amount"],
        Amount2: xrplAmount2 as AMMCreate["Amount2"],
        TradingFee: tradingFee,
      };

      const filled = await client.autofill(baseTx);
      filled.LastLedgerSequence = (filled.LastLedgerSequence ?? 0) + 200;

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
          console.log(signed.hash);
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
        meta?: { TransactionResult?: string };
      };

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
      const ammInfoReq: AMMInfoRequest = {
        command: "amm_info",
        asset: assetSpecToXrplCurrency(assetSpec!),
        asset2: assetSpecToXrplCurrency(assetSpec2!),
      };
      const ammInfoResp = (await client.request(ammInfoReq)) as AMMInfoResponse;
      const ammAccount = ammInfoResp.result.amm.account;
      const lpTokenCurrency = ammInfoResp.result.amm.lp_token.currency;

      if (options.json) {
        console.log(
          JSON.stringify({ hash, result: resultCode, ammAccount, lpTokenCurrency })
        );
      } else {
        console.log(`AMM Account: ${ammAccount}`);
        console.log(`LP Token: ${lpTokenCurrency}`);
      }
    });
  });

// ── amm info ────────────────────────────────────────────────────────────────

interface AmmInfoOptions {
  asset: string;
  asset2: string;
  json: boolean;
}

const ammInfoCommand = new Command("info")
  .description("Query AMM pool state via amm_info RPC")
  .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
  .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
  .option("--json", "Output raw amm_info result as JSON", false)
  .action(async (options: AmmInfoOptions, cmd: Command) => {
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
      process.exit(1);
    }

    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const ammInfoReq: AMMInfoRequest = {
        command: "amm_info",
        asset: assetSpecToXrplCurrency(assetSpec!),
        asset2: assetSpecToXrplCurrency(assetSpec2!),
      };

      let ammInfoResp: AMMInfoResponse;
      try {
        ammInfoResp = (await client.request(ammInfoReq)) as AMMInfoResponse;
      } catch (e: unknown) {
        process.stderr.write(`Error: AMM not found — ${(e as Error).message}\n`);
        process.exit(1);
      }

      const amm = ammInfoResp!.result.amm;

      if (options.json) {
        console.log(JSON.stringify(amm));
        return;
      }

      // Human-readable output
      const formatAmount = (a: string | IssuedCurrencyAmount): string => {
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

async function submitTx(
  client: Client,
  signerWallet: Wallet,
  baseTx: AMMDeposit | AMMWithdraw | AMMBid | AMMVote | AMMDelete | AMMClawback,
  options: { wait: boolean; json: boolean; dryRun: boolean }
): Promise<void> {
  const filled = await client.autofill(baseTx);
  filled.LastLedgerSequence = (filled.LastLedgerSequence ?? 0) + 200;

  // autofill uses ledger_index:'current' for sequence, which can be stale on a
  // fresh WebSocket connection routed to a server that hasn't applied the latest
  // validated ledger yet.  Re-fetch from 'validated' (consistent across all nodes).
  const accountInfoResp = await client.request({
    command: "account_info",
    account: signerWallet.address,
    ledger_index: "validated",
  } as AccountInfoRequest) as AccountInfoResponse;
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
    } else {
      console.log(signed.hash);
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
    meta?: { TransactionResult?: string };
  };
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
  } else {
    console.log(`Transaction: ${hash}`);
    console.log(`Result:      ${resultCode}`);
  }
}

// ── LP token auto-fetch ──────────────────────────────────────────────────────

async function fetchLpToken(
  client: Client,
  assetSpec: AssetSpec,
  assetSpec2: AssetSpec
): Promise<{ currency: string; issuer: string }> {
  const req: AMMInfoRequest = {
    command: "amm_info",
    asset: assetSpecToXrplCurrency(assetSpec),
    asset2: assetSpecToXrplCurrency(assetSpec2),
  };
  const resp = (await client.request(req)) as AMMInfoResponse;
  return {
    currency: resp.result.amm.lp_token.currency,
    issuer: resp.result.amm.lp_token.issuer,
  };
}

// ── amm deposit ──────────────────────────────────────────────────────────────

interface AmmDepositOptions {
  asset: string;
  asset2: string;
  amount?: string;
  amount2?: string;
  lpTokenOut?: string;
  ePrice?: string;
  forEmpty: boolean;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammDepositCommand = new Command("deposit")
  .description("Deposit assets into an AMM pool")
  .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
  .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
  .option("--amount <value>", "Amount of first asset to deposit (XRP: drops, IOU: decimal)")
  .option("--amount2 <value>", "Amount of second asset to deposit (XRP: drops, IOU: decimal)")
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
  .action(async (options: AmmDepositOptions, cmd: Command) => {
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
      process.exit(1);
    }

    const { amount, amount2, lpTokenOut, ePrice, forEmpty } = options;

    // Infer deposit mode from flag combination
    type DepositMode =
      | "tfLPToken"
      | "tfSingleAsset"
      | "tfTwoAsset"
      | "tfTwoAssetIfEmpty"
      | "tfOneAssetLPToken"
      | "tfLimitLPToken";

    let mode: DepositMode | null = null;
    if (lpTokenOut && !amount)                                  mode = "tfLPToken";
    else if (amount && lpTokenOut && !amount2)                  mode = "tfOneAssetLPToken";
    else if (amount && ePrice && !amount2 && !lpTokenOut)       mode = "tfLimitLPToken";
    else if (amount && amount2 && forEmpty)                     mode = "tfTwoAssetIfEmpty";
    else if (amount && amount2 && !forEmpty)                    mode = "tfTwoAsset";
    else if (amount && !amount2 && !lpTokenOut && !ePrice)      mode = "tfSingleAsset";

    if (!mode) {
      process.stderr.write(
        "Error: invalid flag combination for amm deposit. Valid modes:\n" +
        "  --lp-token-out                         (tfLPToken)\n" +
        "  --amount                               (tfSingleAsset)\n" +
        "  --amount --amount2                     (tfTwoAsset)\n" +
        "  --amount --amount2 --for-empty         (tfTwoAssetIfEmpty)\n" +
        "  --amount --lp-token-out                (tfOneAssetLPToken)\n" +
        "  --amount --ePrice                      (tfLimitLPToken)\n"
      );
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const asset = assetSpecToXrplCurrency(assetSpec!);
      const asset2 = assetSpecToXrplCurrency(assetSpec2!);

      const baseTx: AMMDeposit = {
        TransactionType: "AMMDeposit",
        Account: signerWallet.address,
        Asset: asset,
        Asset2: asset2,
        Flags: AMMDepositFlags[mode!],
      };

      // Add amounts based on mode
      if (amount) {
        baseTx.Amount = buildAmmAmount(assetSpec!, amount) as AMMDeposit["Amount"];
      }
      if (amount2) {
        baseTx.Amount2 = buildAmmAmount(assetSpec2!, amount2) as AMMDeposit["Amount2"];
      }
      if (ePrice) {
        baseTx.EPrice = buildAmmAmount(assetSpec!, ePrice) as AMMDeposit["EPrice"];
      }
      if (lpTokenOut) {
        const lpInfo = await fetchLpToken(client, assetSpec!, assetSpec2!);
        baseTx.LPTokenOut = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: lpTokenOut };
      }

      await submitTx(client, signerWallet, baseTx, options);
    });
  });

// ── amm withdraw ─────────────────────────────────────────────────────────────

interface AmmWithdrawOptions {
  asset: string;
  asset2: string;
  lpTokenIn?: string;
  amount?: string;
  amount2?: string;
  ePrice?: string;
  all: boolean;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammWithdrawCommand = new Command("withdraw")
  .description("Withdraw assets from an AMM pool")
  .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
  .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
  .option("--lp-token-in <value>", "LP token amount to redeem (auto-fetches currency/issuer)")
  .option("--amount <value>", "Amount of first asset to withdraw (XRP: drops, IOU: decimal)")
  .option("--amount2 <value>", "Amount of second asset to withdraw (XRP: drops, IOU: decimal)")
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
  .action(async (options: AmmWithdrawOptions, cmd: Command) => {
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
      process.exit(1);
    }

    const { lpTokenIn, amount, amount2, ePrice, all } = options;

    // Infer withdraw mode from flag combination
    type WithdrawMode =
      | "tfLPToken"
      | "tfWithdrawAll"
      | "tfOneAssetWithdrawAll"
      | "tfSingleAsset"
      | "tfTwoAsset"
      | "tfOneAssetLPToken"
      | "tfLimitLPToken";

    let mode: WithdrawMode | null = null;
    if (lpTokenIn && !amount && !amount2)                             mode = "tfLPToken";
    else if (all && !amount && !amount2)                              mode = "tfWithdrawAll";
    else if (all && amount && !amount2)                               mode = "tfOneAssetWithdrawAll";
    else if (amount && lpTokenIn)                                     mode = "tfOneAssetLPToken";
    else if (amount && ePrice && !amount2 && !lpTokenIn && !all)      mode = "tfLimitLPToken";
    else if (amount && amount2 && !lpTokenIn && !ePrice && !all)      mode = "tfTwoAsset";
    else if (amount && !amount2 && !lpTokenIn && !ePrice && !all)     mode = "tfSingleAsset";

    if (!mode) {
      process.stderr.write(
        "Error: invalid flag combination for amm withdraw. Valid modes:\n" +
        "  --lp-token-in                          (tfLPToken)\n" +
        "  --all                                  (tfWithdrawAll)\n" +
        "  --all --amount                         (tfOneAssetWithdrawAll)\n" +
        "  --amount                               (tfSingleAsset)\n" +
        "  --amount --amount2                     (tfTwoAsset)\n" +
        "  --amount --lp-token-in                 (tfOneAssetLPToken)\n" +
        "  --amount --ePrice                      (tfLimitLPToken)\n"
      );
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const asset = assetSpecToXrplCurrency(assetSpec!);
      const asset2 = assetSpecToXrplCurrency(assetSpec2!);

      const baseTx: AMMWithdraw = {
        TransactionType: "AMMWithdraw",
        Account: signerWallet.address,
        Asset: asset,
        Asset2: asset2,
        Flags: AMMWithdrawFlags[mode!],
      };

      if (amount) {
        baseTx.Amount = buildAmmAmount(assetSpec!, amount) as AMMWithdraw["Amount"];
      }
      if (amount2) {
        baseTx.Amount2 = buildAmmAmount(assetSpec2!, amount2) as AMMWithdraw["Amount2"];
      }
      if (ePrice) {
        baseTx.EPrice = buildAmmAmount(assetSpec!, ePrice) as AMMWithdraw["EPrice"];
      }
      if (lpTokenIn) {
        const lpInfo = await fetchLpToken(client, assetSpec!, assetSpec2!);
        baseTx.LPTokenIn = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: lpTokenIn };
      }

      await submitTx(client, signerWallet, baseTx, options);
    });
  });

// ── amm bid ──────────────────────────────────────────────────────────────────

interface AmmBidOptions {
  asset: string;
  asset2: string;
  bidMin?: string;
  bidMax?: string;
  authAccount: string[];
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammBidCommand = new Command("bid")
  .description("Bid on an AMM auction slot to earn a reduced trading fee")
  .requiredOption("--asset <spec>", 'First asset: "XRP" or "CURRENCY/issuer"')
  .requiredOption("--asset2 <spec>", 'Second asset: "XRP" or "CURRENCY/issuer"')
  .option("--bid-min <value>", "Minimum LP token amount to bid (auto-fetches currency/issuer)")
  .option("--bid-max <value>", "Maximum LP token amount to bid (auto-fetches currency/issuer)")
  .option("--auth-account <address>", "Address to authorize for discounted trading (repeatable, max 4)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--seed <seed>", "Family seed for signing")
  .option("--mnemonic <phrase>", "BIP39 mnemonic for signing")
  .option("--account <address-or-alias>", "Account address or alias from keystore")
  .option("--password <password>", "Keystore decryption password (insecure)")
  .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/)")
  .option("--no-wait", "Submit without waiting for validation")
  .option("--json", "Output as JSON", false)
  .option("--dry-run", "Print signed tx without submitting", false)
  .action(async (options: AmmBidOptions, cmd: Command) => {
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const asset = assetSpecToXrplCurrency(assetSpec!);
      const asset2 = assetSpecToXrplCurrency(assetSpec2!);

      const baseTx: AMMBid = {
        TransactionType: "AMMBid",
        Account: signerWallet.address,
        Asset: asset,
        Asset2: asset2,
      };

      if (options.bidMin || options.bidMax) {
        const lpInfo = await fetchLpToken(client, assetSpec!, assetSpec2!);
        if (options.bidMin) {
          baseTx.BidMin = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: options.bidMin };
        }
        if (options.bidMax) {
          baseTx.BidMax = { currency: lpInfo.currency, issuer: lpInfo.issuer, value: options.bidMax };
        }
      }

      if (options.authAccount.length > 0) {
        baseTx.AuthAccounts = options.authAccount.map((addr): AuthAccount => ({
          AuthAccount: { Account: addr },
        }));
      }

      await submitTx(client, signerWallet, baseTx, options);
    });
  });

// ── amm vote ─────────────────────────────────────────────────────────────────

interface AmmVoteOptions {
  asset: string;
  asset2: string;
  tradingFee: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammVoteCommand = new Command("vote")
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
  .action(async (options: AmmVoteOptions, cmd: Command) => {
    const tradingFee = parseInt(options.tradingFee, 10);
    if (isNaN(tradingFee) || tradingFee < 0 || tradingFee > 1000) {
      process.stderr.write("Error: --trading-fee must be an integer between 0 and 1000\n");
      process.exit(1);
    }

    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const baseTx: AMMVote = {
        TransactionType: "AMMVote",
        Account: signerWallet.address,
        Asset: assetSpecToXrplCurrency(assetSpec!),
        Asset2: assetSpecToXrplCurrency(assetSpec2!),
        TradingFee: tradingFee,
      };

      await submitTx(client, signerWallet, baseTx, options);
    });
  });

// ── amm delete ───────────────────────────────────────────────────────────────

interface AmmDeleteOptions {
  asset: string;
  asset2: string;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammDeleteCommand = new Command("delete")
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
  .action(async (options: AmmDeleteOptions, cmd: Command) => {
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const baseTx: AMMDelete = {
        TransactionType: "AMMDelete",
        Account: signerWallet.address,
        Asset: assetSpecToXrplCurrency(assetSpec!),
        Asset2: assetSpecToXrplCurrency(assetSpec2!),
      };

      await submitTx(client, signerWallet, baseTx, options);
    });
  });

// ── amm clawback ─────────────────────────────────────────────────────────────

interface AmmClawbackOptions {
  asset: string;
  asset2: string;
  holder: string;
  amount?: string;
  bothAssets: boolean;
  seed?: string;
  mnemonic?: string;
  account?: string;
  password?: string;
  keystore?: string;
  wait: boolean;
  json: boolean;
  dryRun: boolean;
}

const ammClawbackCommand = new Command("clawback")
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
  .action(async (options: AmmClawbackOptions, cmd: Command) => {
    let assetSpec: AssetSpec;
    let assetSpec2: AssetSpec;
    try {
      assetSpec = parseAssetSpec(options.asset);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset: ${(e as Error).message}\n`);
      process.exit(1);
    }
    try {
      assetSpec2 = parseAssetSpec(options.asset2);
    } catch (e: unknown) {
      process.stderr.write(`Error: --asset2: ${(e as Error).message}\n`);
      process.exit(1);
    }

    // AMMClawback Asset must be an IOU, not XRP
    if (assetSpec!.currency === "XRP" || !assetSpec!.issuer) {
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
    const url = getNodeUrl(cmd);

    await withClient(url, async (client) => {
      const baseTx: AMMClawback = {
        TransactionType: "AMMClawback",
        Account: signerWallet.address,
        Asset: { currency: assetSpec!.currency, issuer: assetSpec!.issuer! },
        Asset2: assetSpecToXrplCurrency(assetSpec2!),
        Holder: options.holder,
      };

      if (options.amount) {
        const value = Number(options.amount);
        if (isNaN(value) || value <= 0) {
          process.stderr.write(`Error: --amount: must be a positive number\n`);
          process.exit(1);
        }
        baseTx.Amount = {
          currency: assetSpec!.currency,
          issuer: assetSpec!.issuer!,
          value: options.amount,
        };
      }

      if (options.bothAssets) {
        baseTx.Flags = AMMClawbackFlags.tfClawTwoAssets;
      }

      await submitTx(client, signerWallet, baseTx, options);
    });
  });

// ── export ───────────────────────────────────────────────────────────────────

export const ammCommand = new Command("amm")
  .description("Manage AMM liquidity pools on the XRP Ledger")
  .addCommand(ammCreateCommand)
  .addCommand(ammInfoCommand)
  .addCommand(ammDepositCommand)
  .addCommand(ammWithdrawCommand)
  .addCommand(ammBidCommand)
  .addCommand(ammVoteCommand)
  .addCommand(ammDeleteCommand)
  .addCommand(ammClawbackCommand);
