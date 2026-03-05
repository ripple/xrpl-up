#!/usr/bin/env node
import { Command } from 'commander';
import { nodeCommand } from './commands/node';
import { accountsCommand } from './commands/accounts';
import { faucetCommand } from './commands/faucet';
import { runCommand } from './commands/run';
import { initCommand } from './commands/init';
import { logsCommand } from './commands/logs';
import { statusCommand } from './commands/status';
import { composeDown } from './core/compose';
import { snapshotSave, snapshotRestore, snapshotList } from './commands/snapshot';
import { configExport, configValidate } from './commands/config';
import { ammInfoCommand, ammCreateCommand } from './commands/amm';
import { resetCommand } from './commands/reset';
import {
  nftMintCommand, nftListCommand, nftOffersCommand,
  nftBurnCommand, nftSellCommand, nftAcceptCommand,
} from './commands/nft';
import {
  channelCreateCommand, channelListCommand, channelFundCommand,
  channelClaimCommand, channelSignCommand, channelVerifyCommand,
} from './commands/channel';
import {
  mptCreateCommand, mptDestroyCommand, mptAuthorizeCommand,
  mptSetCommand, mptInfoCommand,
} from './commands/mpt';

import { logger } from './utils/logger';

const pkg = require('../package.json') as { version: string };
const program = new Command();

program
  .name('xrpl-up')
  .description('XRPL sandbox for local development')
  .version(pkg.version, '-v, --version');

// ── node ─────────────────────────────────────────────────────────────────────
program
  .command('node')
  .description('Start an XRPL sandbox with pre-funded accounts')
  .option(
    '-n, --network <network>',
    'Network to connect to (testnet | devnet)',
    'testnet'
  )
  .option(
    '-a, --accounts <number>',
    'Number of accounts to fund (default: 0 with --fork, 10 otherwise)'
  )
  .option(
    '--local',
    'Run a local rippled node via Docker instead of connecting to testnet/devnet'
  )
  .option(
    '--image <image>',
    'Docker image to use for local rippled',
    'xrpllabsofficial/xrpld:latest'
  )
  .option(
    '--ledger-interval <ms>',
    'Ledger auto-advance interval in milliseconds (local mode only)',
    '1000'
  )
  .option(
    '--persist',
    'Persist ledger state and accounts across restarts (local mode only)'
  )
  .option(
    '--fork',
    'Fork XRP balances from a remote network into the local node (requires --local)'
  )
  .option(
    '--fork-accounts <addresses>',
    'Comma-separated addresses to fork (optional if --add-accounts-from-ledger is given)'
  )
  .option(
    '--add-accounts-from-ledger <ledger>',
    'Scan this ledger for active accounts and add them to the fork'
  )
  .option(
    '--fork-at-ledger <ledger>',
    'Ledger index to snapshot balances from (default: N-1 when --add-accounts-from-ledger is used, latest otherwise)'
  )
  .option(
    '--fork-source <url>',
    'WebSocket URL of the network to fork from',
    'wss://xrplcluster.com'
  )
  .option(
    '--no-auto-advance',
    'Disable automatic ledger advancement'
  )
  .option(
    '--detach',
    'Start sandbox in the background and exit (for CI/CD pipelines)'
  )
  .option(
    '--no-secrets',
    'Do not print seeds or private keys to stdout (auto-enabled with --detach)'
  )
  .option(
    '--debug',
    'Enable debug-level rippled logging (view with: xrpl-up logs rippled)'
  )
  .option(
    '--config <path>',
    'Path to a custom rippled.cfg — skips auto-generation (local mode only)'
  )
  .action((opts: {
    network: string;
    accounts?: string;
    local?: boolean;
    persist?: boolean;
    image?: string;
    ledgerInterval: string;
    fork?: boolean;
    forkAccounts?: string;
    addAccountsFromLedger?: string;
    forkAtLedger?: string;
    forkSource?: string;
    autoAdvance?: boolean;
    debug?: boolean;
    detach?: boolean;
    secrets?: boolean;
    config?: string;
  }) => {
    nodeCommand({
      network: opts.local ? undefined : opts.network,
      accountCount: opts.accounts !== undefined ? parseInt(opts.accounts, 10) : undefined,
      local: opts.local,
      persist: opts.persist,
      image: opts.image,
      ledgerInterval: parseInt(opts.ledgerInterval, 10),
      fork: opts.fork,
      forkAccounts: opts.forkAccounts,
      accountsFromLedger: opts.addAccountsFromLedger ? parseInt(opts.addAccountsFromLedger, 10) : undefined,
      forkAtLedger: opts.forkAtLedger ? parseInt(opts.forkAtLedger, 10) : undefined,
      forkSource: opts.forkSource,
      noAutoAdvance: opts.autoAdvance === false,
      noSecrets: opts.secrets === false,
      debug: opts.debug,
      detach: opts.detach,
      config: opts.config,
    }).catch(handleError);
  });

// ── accounts ──────────────────────────────────────────────────────────────────
program
  .command('accounts')
  .description('List sandbox accounts and their live XRP balances')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('--local', 'Show accounts for the local Docker sandbox')
  .option('--address <address>', 'Query a specific address directly (bypasses wallet store)')
  .action((opts: { network: string; local?: boolean; address?: string }) => {
    accountsCommand({ network: opts.network, local: opts.local, address: opts.address }).catch(handleError);
  });

// ── faucet ────────────────────────────────────────────────────────────────────
program
  .command('faucet')
  .description('Fund an account using the faucet')
  .option('-n, --network <network>', 'Network: local | testnet | devnet', 'testnet')
  .option('--local', '[deprecated] Alias for --network local')
  .option('-s, --seed <seed>', 'Wallet seed to fund (omit to generate a new wallet)')
  .action((opts: { network: string; local?: boolean; seed?: string }) => {
    const network = opts.local ? 'local' : opts.network;
    faucetCommand({ network, seed: opts.seed }).catch(handleError);
  });

// ── run ───────────────────────────────────────────────────────────────────────
program
  .command('run <script>')
  .description('Run a TypeScript/JavaScript script against an XRPL network')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((script: string, opts: { network: string }) => {
    runCommand({ script, network: opts.network }).catch(handleError);
  });

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init [directory]')
  .description('Scaffold a new XRPL project')
  .action((directory: string | undefined) => {
    initCommand({ directory }).catch(handleError);
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show rippled server info and faucet health')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('--local', 'Show status for the local Docker sandbox')
  .action((opts: { network: string; local?: boolean }) => {
    statusCommand({ network: opts.network, local: opts.local }).catch(handleError);
  });

// ── logs ──────────────────────────────────────────────────────────────────────
program
  .command('logs [service]')
  .description('Stream Docker Compose logs for the local stack (rippled | faucet)')
  .action((service: string | undefined) => {
    logsCommand({ service }).catch(handleError);
  });

// ── stop ───────────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop the local sandbox Docker stack')
  .action(() => {
    composeDown();
    logger.success('Local sandbox stopped.');
  });

// ── reset ──────────────────────────────────────────────────────────────────────
program
  .command('reset')
  .description('Wipe all local sandbox state (containers, ledger volume, accounts)')
  .option('--snapshots', 'Also delete all saved snapshots')
  .action((opts: { snapshots?: boolean }) => {
    resetCommand({ snapshots: opts.snapshots });
  });

// ── snapshot ──────────────────────────────────────────────────────────────────
const snapshot = program
  .command('snapshot')
  .description('Manage ledger state snapshots (requires --persist mode)');

snapshot
  .command('save <name>')
  .description('Save current ledger state as a named snapshot')
  .action((name: string) => {
    snapshotSave(name).catch(handleError);
  });

snapshot
  .command('restore <name>')
  .description('Restore ledger state from a named snapshot')
  .action((name: string) => {
    snapshotRestore(name).catch(handleError);
  });

snapshot
  .command('list')
  .description('List saved snapshots with size and date')
  .action(() => {
    snapshotList();
  });

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Manage rippled configuration');

configCmd
  .command('export')
  .description('Print the default rippled.cfg to stdout (use --output to save to a file)')
  .option('--output <file>', 'Write to a file instead of stdout')
  .option('--debug', 'Use debug log level in the exported config')
  .action((opts: { output?: string; debug?: boolean }) => {
    configExport({ output: opts.output, debug: opts.debug });
  });

configCmd
  .command('validate <file>')
  .description('Validate a rippled.cfg for compatibility with xrpl-up')
  .action((file: string) => {
    configValidate(file);
  });

// ── amm ───────────────────────────────────────────────────────────────────────
const amm = program
  .command('amm')
  .description('Query AMM pool state');

amm
  .command('create <asset1> <asset2>')
  .description(
    'Create an AMM pool with fresh funded accounts (e.g. XRP USD or USD EUR)'
  )
  .option('--amount1 <number>', 'Amount of asset1 to deposit (default: 100)')
  .option('--amount2 <number>', 'Amount of asset2 to deposit (default: 100)')
  .option('--fee <percent>', 'Trading fee in % e.g. 0.5 for 0.5% (default: 0.5)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((asset1: string, asset2: string, opts: {
    amount1?: string;
    amount2?: string;
    fee?: string;
    local?: boolean;
    network: string;
  }) => {
    ammCreateCommand({
      asset1,
      asset2,
      amount1: opts.amount1 !== undefined ? Number(opts.amount1) : undefined,
      amount2: opts.amount2 !== undefined ? Number(opts.amount2) : undefined,
      fee: opts.fee !== undefined ? Number(opts.fee) : undefined,
      local: opts.local,
      network: opts.network,
    }).catch(handleError);
  });

amm
  .command('info [asset1] [asset2]')
  .description(
    'Show AMM pool info for an asset pair (e.g. XRP USD.rIssuer) or by AMM account'
  )
  .option('--account <address>', 'Query by AMM account address instead of asset pair')
  .option('--local', 'Query the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((asset1: string | undefined, asset2: string | undefined, opts: {
    account?: string;
    local?: boolean;
    network: string;
  }) => {
    ammInfoCommand({
      asset1,
      asset2,
      account: opts.account,
      local: opts.local,
      network: opts.network,
    }).catch(handleError);
  });


// ── nft ───────────────────────────────────────────────────────────────────────
const nft = program
  .command('nft')
  .description('NFT lifecycle operations (mint, list, sell, buy, burn)');

nft
  .command('mint')
  .description('Mint a new NFT (auto-funds a wallet via faucet if no --seed given)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('-s, --seed <seed>', 'Wallet seed to mint from (omit to auto-fund via faucet)')
  .option('--uri <uri>', 'Metadata URI (will be hex-encoded)')
  .option('--transferable', 'Allow the NFT to be transferred (tfTransferable)')
  .option('--burnable', 'Allow the issuer to burn the NFT (tfBurnable)')
  .option('--taxon <number>', 'NFToken taxon (default: 0)')
  .option('--transfer-fee <percent>', 'Transfer fee percentage, 0–50 (default: 0)')
  .action((opts: {
    local?: boolean; network: string; seed?: string; uri?: string;
    transferable?: boolean; burnable?: boolean; taxon?: string; transferFee?: string;
  }) => {
    nftMintCommand({
      local: opts.local, network: opts.network, seed: opts.seed, uri: opts.uri,
      transferable: opts.transferable, burnable: opts.burnable,
      taxon: opts.taxon !== undefined ? parseInt(opts.taxon, 10) : undefined,
      transferFee: opts.transferFee !== undefined ? Number(opts.transferFee) : undefined,
    }).catch(handleError);
  });

nft
  .command('list')
  .description('List NFTs owned by an account')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('--account <address>', 'Account to list (defaults to first local account)')
  .action((opts: { local?: boolean; network: string; account?: string }) => {
    nftListCommand({ local: opts.local, network: opts.network, account: opts.account })
      .catch(handleError);
  });

nft
  .command('offers <nftokenId>')
  .description('Show open buy and sell offers for an NFT')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((nftokenId: string, opts: { local?: boolean; network: string }) => {
    nftOffersCommand({ nftokenId, local: opts.local, network: opts.network })
      .catch(handleError);
  });

nft
  .command('burn <nftokenId>')
  .description('Burn an NFT (permanently destroy it)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Wallet seed of the NFT holder')
  .action((nftokenId: string, opts: { local?: boolean; network: string; seed: string }) => {
    nftBurnCommand({ nftokenId, local: opts.local, network: opts.network, seed: opts.seed })
      .catch(handleError);
  });

nft
  .command('sell <nftokenId> <price>')
  .description('Create a sell offer for an NFT. Price: "1" = 1 XRP, "10.USD.rIssuer" = IOU')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Wallet seed of the NFT holder')
  .action((nftokenId: string, price: string, opts: { local?: boolean; network: string; seed: string }) => {
    nftSellCommand({ nftokenId, price, local: opts.local, network: opts.network, seed: opts.seed })
      .catch(handleError);
  });

nft
  .command('accept <offerId>')
  .description('Accept an NFT sell (or buy with --buy) offer')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('-s, --seed <seed>', 'Wallet seed of the buyer (omit to auto-fund on local)')
  .option('--buy', 'Accept a buy offer instead of a sell offer')
  .action((offerId: string, opts: { local?: boolean; network: string; seed?: string; buy?: boolean }) => {
    nftAcceptCommand({
      offerId, local: opts.local, network: opts.network, seed: opts.seed, buy: opts.buy,
    }).catch(handleError);
  });

// ── channel ───────────────────────────────────────────────────────────────────
const channel = program
  .command('channel')
  .description('Payment channel operations (create, fund, claim, sign, verify)');

channel
  .command('create <destination> <amount>')
  .description('Create a payment channel. Amount is in XRP.')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('-s, --seed <seed>', 'Source wallet seed (omit to auto-fund on local)')
  .option('--settle-delay <seconds>', 'Settlement delay in seconds (default: 86400)')
  .action((destination: string, amount: string, opts: {
    local?: boolean; network: string; seed?: string; settleDelay?: string;
  }) => {
    channelCreateCommand({
      destination, amount, local: opts.local, network: opts.network, seed: opts.seed,
      settleDelay: opts.settleDelay !== undefined ? parseInt(opts.settleDelay, 10) : undefined,
    }).catch(handleError);
  });

channel
  .command('list')
  .description('List payment channels for an account')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('--account <address>', 'Account to list channels for (defaults to first local account)')
  .action((opts: { local?: boolean; network: string; account?: string }) => {
    channelListCommand({ local: opts.local, network: opts.network, account: opts.account })
      .catch(handleError);
  });

channel
  .command('fund <channelId> <amount>')
  .description('Add XRP to an existing payment channel')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Source wallet seed')
  .action((channelId: string, amount: string, opts: { local?: boolean; network: string; seed: string }) => {
    channelFundCommand({ channelId, amount, local: opts.local, network: opts.network, seed: opts.seed })
      .catch(handleError);
  });

channel
  .command('claim <channelId>')
  .description('Claim funds from a payment channel (use --close to close)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Claimant wallet seed')
  .option('--amount <xrp>', 'XRP amount to claim (for off-chain claim)')
  .option('--signature <hex>', 'Off-chain claim signature from channel sign')
  .option('--public-key <hex>', 'Public key of the wallet that signed the claim (printed by channel sign)')
  .option('--close', 'Request channel close')
  .action((channelId: string, opts: {
    local?: boolean; network: string; seed: string;
    amount?: string; signature?: string; publicKey?: string; close?: boolean;
  }) => {
    channelClaimCommand({
      channelId, local: opts.local, network: opts.network, seed: opts.seed,
      amount: opts.amount, signature: opts.signature, publicKey: opts.publicKey, close: opts.close,
    }).catch(handleError);
  });

channel
  .command('sign <channelId> <amount>')
  .description('Sign an off-chain payment channel claim (no on-chain transaction)')
  .requiredOption('-s, --seed <seed>', 'Source wallet seed')
  .action((channelId: string, amount: string, opts: { seed: string }) => {
    channelSignCommand({ channelId, amount, seed: opts.seed });
  });

channel
  .command('verify <channelId> <amount> <signature> <publicKey>')
  .description('Verify an off-chain payment channel claim signature')
  .action((channelId: string, amount: string, signature: string, publicKey: string) => {
    channelVerifyCommand({ channelId, amount, signature, publicKey });
  });

// ── mpt ───────────────────────────────────────────────────────────────────────
const mpt = program
  .command('mpt')
  .description('Multi-Purpose Token (MPT/XLS-33) operations');

mpt
  .command('create')
  .description('Create a new MPT issuance (auto-funds wallet on local)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .option('-s, --seed <seed>', 'Issuer wallet seed (omit to auto-fund on local)')
  .option('--max-amount <integer>', 'Maximum token supply (integer, e.g. 1000000)')
  .option('--asset-scale <number>', 'Decimal places / asset scale, 0–19 (default: 0)')
  .option('--transfer-fee <number>', 'Transfer fee in hundredths of a percent, 0–50000')
  .option('--metadata <string>', 'Metadata string (will be hex-encoded)')
  .option('--transferable', 'Allow holders to transfer tokens (tfMPTCanTransfer)')
  .option('--require-auth', 'Issuer must authorize each holder (tfMPTRequireAuth)')
  .option('--can-lock', 'Issuer can lock individual holders (tfMPTCanLock)')
  .option('--can-clawback', 'Issuer can clawback tokens from holders (tfMPTCanClawback)')
  .action((opts: {
    local?: boolean; network: string; seed?: string;
    maxAmount?: string; assetScale?: string; transferFee?: string; metadata?: string;
    transferable?: boolean; requireAuth?: boolean; canLock?: boolean; canClawback?: boolean;
  }) => {
    mptCreateCommand({
      local: opts.local, network: opts.network, seed: opts.seed,
      maxAmount: opts.maxAmount,
      assetScale: opts.assetScale !== undefined ? parseInt(opts.assetScale, 10) : undefined,
      transferFee: opts.transferFee !== undefined ? parseInt(opts.transferFee, 10) : undefined,
      metadata: opts.metadata,
      transferable: opts.transferable, requireAuth: opts.requireAuth,
      canLock: opts.canLock, canClawback: opts.canClawback,
    }).catch(handleError);
  });

mpt
  .command('destroy <issuanceId>')
  .description('Destroy an MPT issuance (supply must be zero)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Issuer wallet seed')
  .action((issuanceId: string, opts: { local?: boolean; network: string; seed: string }) => {
    mptDestroyCommand({ issuanceId, local: opts.local, network: opts.network, seed: opts.seed })
      .catch(handleError);
  });

mpt
  .command('authorize <issuanceId>')
  .description('Authorize (or unauthorize) a token holder to hold the MPT')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Issuer or holder wallet seed')
  .option('--holder <address>', 'Holder address to authorize (issuer-side auth)')
  .option('--unauthorize', 'Remove authorization instead of granting it')
  .action((issuanceId: string, opts: {
    local?: boolean; network: string; seed: string; holder?: string; unauthorize?: boolean;
  }) => {
    mptAuthorizeCommand({
      issuanceId, local: opts.local, network: opts.network, seed: opts.seed,
      holder: opts.holder, unauthorize: opts.unauthorize,
    }).catch(handleError);
  });

mpt
  .command('set <issuanceId>')
  .description('Lock or unlock an MPT issuance (or a specific holder)')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .requiredOption('-s, --seed <seed>', 'Issuer wallet seed')
  .option('--lock', 'Lock the issuance (or holder)')
  .option('--unlock', 'Unlock the issuance (or holder)')
  .option('--holder <address>', 'Apply lock/unlock to a specific holder address')
  .action((issuanceId: string, opts: {
    local?: boolean; network: string; seed: string;
    lock?: boolean; unlock?: boolean; holder?: string;
  }) => {
    mptSetCommand({
      issuanceId, local: opts.local, network: opts.network, seed: opts.seed,
      lock: opts.lock, unlock: opts.unlock, holder: opts.holder,
    }).catch(handleError);
  });

mpt
  .command('info <issuanceId>')
  .description('Show on-ledger details of an MPT issuance')
  .option('--local', 'Use the local Docker sandbox')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action((issuanceId: string, opts: { local?: boolean; network: string }) => {
    mptInfoCommand({ issuanceId, local: opts.local, network: opts.network })
      .catch(handleError);
  });

/* ── Error handling ─────────────────────────────────────────────────────────── */
function handleError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('\n  ' + msg);
  process.exit(1);
}

program.parse();
