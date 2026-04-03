import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { logger } from '../utils/logger';

/* ── Config template ──────────────────────────────────────────────────────── */

function generateConfig(defaultNetwork: string): string {
  return `// xrpl-up.config.js
// @ts-check
/** @type {import('xrpl-up').XrplUpConfig} */
module.exports = {
  networks: {
    local: {
      url: 'ws://localhost:6006',
      name: 'Local rippled (Docker)',
    },
    testnet: {
      url: 'wss://s.altnet.rippletest.net:51233',
      name: 'XRPL Testnet',
    },
    devnet: {
      url: 'wss://s.devnet.rippletest.net:51233',
      name: 'XRPL Devnet',
    },
    mainnet: {
      url: 'wss://xrplcluster.com',
      name: 'XRPL Mainnet',
    },
  },
  defaultNetwork: '${defaultNetwork}',
  accounts: {
    count: 10,
  },
};
`;
}

/* ── package.json ─────────────────────────────────────────────────────────── */

const packageJsonTemplate = (name: string) =>
  JSON.stringify(
    {
      name,
      version: '0.1.0',
      description: 'An XRPL project using xrpl-up',
      scripts: {
        start: 'xrpl-up start',
        accounts: 'xrpl-up accounts',
      },
      dependencies: {
        xrpl: '^4.6.0',
      },
      devDependencies: {
        typescript: '^5.3.0',
        tsx: '^4.7.0',
        '@types/node': '^20.0.0',
      },
    },
    null,
    2
  );

/* ── tsconfig ─────────────────────────────────────────────────────────────── */

const TSCONFIG_TEMPLATE = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      lib: ['ES2020'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: './src',
    },
    include: ['src/**/*', 'scripts/**/*'],
    exclude: ['node_modules', 'dist'],
  },
  null,
  2
);

/* ── Example scripts — remote (testnet/devnet/mainnet) ────────────────────── */

const EXAMPLE_PAYMENT_SCRIPT = `// scripts/example-payment.ts
// Send XRP between two wallets on XRPL testnet and verify balances.
// Run with: xrpl-up run scripts/example-payment.ts
import { Client, xrpToDrops } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const networkName = process.env.XRPL_NETWORK_NAME ?? 'testnet';

  const client = new Client(networkUrl, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to', networkName);

  // Fund two wallets from the testnet faucet
  console.log('\\nFunding sender wallet…');
  const { wallet: sender, balance: senderBalance } = await client.fundWallet();
  console.log('Sender:', sender.address, '|', senderBalance, 'XRP');

  console.log('Funding receiver wallet…');
  const { wallet: receiver } = await client.fundWallet();
  console.log('Receiver:', receiver.address);

  // Check balances before payment
  const senderBefore   = await client.getXrpBalance(sender.address);
  const receiverBefore = await client.getXrpBalance(receiver.address);
  console.log('\\nBalances before:');
  console.log('  Sender:  ', senderBefore, 'XRP');
  console.log('  Receiver:', receiverBefore, 'XRP');

  // Send 10 XRP
  const amount = '10';
  console.log(\`\\nSending \${amount} XRP to \${receiver.address}…\`);

  const tx = {
    TransactionType: 'Payment' as const,
    Account: sender.address,
    Amount: xrpToDrops(amount),
    Destination: receiver.address,
  };

  const result = await client.submitAndWait(tx, { wallet: sender });

  const meta = result.result.meta;
  const outcome =
    typeof meta === 'object' && meta !== null ? meta.TransactionResult : 'unknown';

  if (outcome === 'tesSUCCESS') {
    console.log('\\n✓ Payment successful!');
    console.log('  Tx hash:', result.result.hash);

    // Verify balances after payment
    const senderAfter   = await client.getXrpBalance(sender.address);
    const receiverAfter = await client.getXrpBalance(receiver.address);
    console.log('\\nBalances after:');
    console.log('  Sender:  ', senderAfter,   'XRP  (sent 10 XRP + tx fee)');
    console.log('  Receiver:', receiverAfter, 'XRP  (+10 XRP received)');
  } else {
    console.error('Payment failed:', outcome);
  }

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_TOKEN_SCRIPT = `// scripts/example-token.ts
// Issue a custom token (IOU) on XRPL testnet: set up trust line and send tokens.
// Run with: xrpl-up run scripts/example-token.ts
import { Client, AccountSetAsfFlags } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const client = new Client(networkUrl, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to testnet\\n');

  // ── 1. Fund accounts ──────────────────────────────────────────────────────
  console.log('── Funding accounts ─────────────────────────────────────────');
  const { wallet: issuer } = await client.fundWallet();
  const { wallet: holder } = await client.fundWallet();
  console.log('Issuer:', issuer.address);
  console.log('Holder:', holder.address);

  // ── 2. Enable DefaultRipple on issuer ─────────────────────────────────────
  // Required so tokens can ripple across trust lines in the DEX.
  console.log('\\n── Enabling DefaultRipple on issuer ─────────────────────────');
  await client.submitAndWait({
    TransactionType: 'AccountSet',
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  }, { wallet: issuer });
  console.log('DefaultRipple enabled');

  // ── 3. Holder creates a trust line ────────────────────────────────────────
  // A trust line lets an account hold a specific IOU token.
  console.log('\\n── Setting up trust line ────────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'TrustSet',
    Account: holder.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, { wallet: holder });
  console.log('Trust line set: holder can hold up to 10,000 USD');

  // ── 4. Issuer sends 1,000 USD to holder ───────────────────────────────────
  console.log('\\n── Issuing tokens ───────────────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: holder.address,
    Amount: { currency: 'USD', issuer: issuer.address, value: '1000' },
  }, { wallet: issuer });
  console.log('Issued 1,000 USD to holder');

  // ── 5. Verify balance ─────────────────────────────────────────────────────
  const lines = await client.request({
    command: 'account_lines',
    account: holder.address,
    ledger_index: 'validated',
  });
  const usdLine = (lines.result as any).lines.find(
    (l: any) => l.currency === 'USD' && l.account === issuer.address
  );
  console.log('\\n✓ Holder USD balance:', usdLine?.balance ?? '0', 'USD');
  console.log('  Issuer:', issuer.address);

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_DEX_SCRIPT = `// scripts/example-dex.ts
// Place and manage a DEX order on XRPL testnet.
//
// ⚠️  IMPORTANT: DEX orders only fill when a matching counterparty exists on-chain.
//     This script creates an offer, lists it, then cancels it — because no
//     matching buyer will appear automatically on testnet.
//     For guaranteed fills, run example-amm.ts (AMM pool) instead.
//
// Run with: xrpl-up run scripts/example-dex.ts
import { Client, AccountSetAsfFlags } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const client = new Client(networkUrl, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to testnet\\n');

  // ── 1. Set up accounts and issue a token ─────────────────────────────────
  console.log('── Setting up accounts and USD token ────────────────────────');
  const { wallet: issuer } = await client.fundWallet();
  const { wallet: trader } = await client.fundWallet();
  console.log('Issuer:', issuer.address);
  console.log('Trader:', trader.address);

  await client.submitAndWait({
    TransactionType: 'AccountSet',
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  }, { wallet: issuer });

  await client.submitAndWait({
    TransactionType: 'TrustSet',
    Account: trader.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, { wallet: trader });

  await client.submitAndWait({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: trader.address,
    Amount: { currency: 'USD', issuer: issuer.address, value: '500' },
  }, { wallet: issuer });
  console.log('Trader funded with 500 USD');

  // ── 2. Place a DEX offer: sell 100 USD, buy 50 XRP ───────────────────────
  console.log('\\n── Placing DEX offer: sell 100 USD, buy 50 XRP ──────────────');
  console.log('⚠  This offer will stay open until a matching buyer appears.');
  const offerResult = await client.submitAndWait({
    TransactionType: 'OfferCreate',
    Account: trader.address,
    TakerGets: { currency: 'USD', issuer: issuer.address, value: '100' },
    TakerPays: '50000000', // 50 XRP in drops
  }, { wallet: trader });

  const offerMeta = (offerResult.result as any).meta;
  const offerNode = offerMeta?.AffectedNodes?.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === 'Offer'
  );
  const offerSeq: number | undefined = offerNode?.CreatedNode?.NewFields?.Sequence;
  console.log('Offer created, sequence:', offerSeq ?? '(check account_offers)');

  // ── 3. List open offers ───────────────────────────────────────────────────
  console.log('\\n── Open offers ──────────────────────────────────────────────');
  const offersRes = await client.request({
    command: 'account_offers',
    account: trader.address,
    ledger_index: 'current',
  } as any);
  const offers = (offersRes.result as any).offers as any[];
  console.log(\`Found \${offers.length} open offer(s):\`);
  for (const o of offers) {
    const gets = typeof o.taker_gets === 'string'
      ? \`\${Number(o.taker_gets) / 1e6} XRP\`
      : \`\${o.taker_gets.value} \${o.taker_gets.currency}\`;
    const pays = typeof o.taker_pays === 'string'
      ? \`\${Number(o.taker_pays) / 1e6} XRP\`
      : \`\${o.taker_pays.value} \${o.taker_pays.currency}\`;
    console.log(\`  Seq \${o.seq}: sell \${gets}, buy \${pays}\`);
  }

  // ── 4. Cancel the offer ───────────────────────────────────────────────────
  if (offerSeq !== undefined) {
    console.log('\\n── Cancelling offer ─────────────────────────────────────────');
    await client.submitAndWait({
      TransactionType: 'OfferCancel',
      Account: trader.address,
      OfferSequence: offerSeq,
    }, { wallet: trader });
    console.log('✓ Offer cancelled');
  }

  console.log('\\n✓ DEX example complete!');
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_NFT_SCRIPT = `// scripts/example-nft.ts
// Full NFT lifecycle on XRPL testnet: mint → sell offer → accept → burn.
// Run with: xrpl-up run scripts/example-nft.ts
import { Client } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const client = new Client(networkUrl, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to testnet\\n');

  // ── 1. Fund minter and buyer ──────────────────────────────────────────────
  console.log('── Funding accounts ─────────────────────────────────────────');
  const { wallet: minter } = await client.fundWallet();
  const { wallet: buyer  } = await client.fundWallet();
  console.log('Minter:', minter.address);
  console.log('Buyer: ', buyer.address);

  // ── 2. Mint an NFT ────────────────────────────────────────────────────────
  console.log('\\n── Minting NFT ──────────────────────────────────────────────');
  const uri = Buffer.from('https://example.com/my-nft-metadata.json', 'utf8')
    .toString('hex').toUpperCase();

  await client.submitAndWait({
    TransactionType: 'NFTokenMint',
    Account: minter.address,
    NFTokenTaxon: 0,
    Flags: 8, // tfTransferable
    URI: uri,
  }, { wallet: minter });

  const nftsRes = await client.request({ command: 'account_nfts', account: minter.address });
  const nftId = nftsRes.result.account_nfts[0]?.NFTokenID;
  console.log('✓ Minted NFTokenID:', nftId);

  // ── 3. Create a sell offer ────────────────────────────────────────────────
  console.log('\\n── Creating sell offer (10 XRP) ─────────────────────────────');
  const offerResult = await client.submitAndWait({
    TransactionType: 'NFTokenCreateOffer',
    Account: minter.address,
    NFTokenID: nftId,
    Amount: '10000000', // 10 XRP in drops
    Flags: 1,           // tfSellToken
  }, { wallet: minter });

  const offerMeta = (offerResult.result as any).meta;
  const offerNode = offerMeta?.AffectedNodes?.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === 'NFTokenOffer'
  );
  const sellOfferId = offerNode?.CreatedNode?.LedgerIndex as string | undefined;
  console.log('✓ Sell offer ID:', sellOfferId);

  // ── 4. Buyer accepts the sell offer ──────────────────────────────────────
  console.log('\\n── Buyer accepts sell offer ─────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'NFTokenAcceptOffer',
    Account: buyer.address,
    NFTokenSellOffer: sellOfferId,
  }, { wallet: buyer });
  console.log('✓ NFT transferred to buyer');

  const buyerNfts = await client.request({ command: 'account_nfts', account: buyer.address });
  console.log('  Buyer now holds', buyerNfts.result.account_nfts.length, 'NFT(s)');

  // ── 5. Burn the NFT ───────────────────────────────────────────────────────
  console.log('\\n── Burning the NFT ──────────────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'NFTokenBurn',
    Account: buyer.address,
    NFTokenID: nftId,
  }, { wallet: buyer });

  const afterBurn = await client.request({ command: 'account_nfts', account: buyer.address });
  console.log('✓ NFT burned — buyer now holds', afterBurn.result.account_nfts.length, 'NFT(s)');

  console.log('\\n✓ NFT lifecycle complete!');
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_MPT_SCRIPT = `// scripts/example-mpt.ts
// Issue and transfer a Multi-Purpose Token (MPT) on XRPL testnet.
// Run with: xrpl-up run scripts/example-mpt.ts
import { Client, MPTokenIssuanceCreateFlags } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const client = new Client(networkUrl, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to testnet\\n');

  // ── 1. Fund accounts ──────────────────────────────────────────────────────
  console.log('── Funding accounts ─────────────────────────────────────────');
  const { wallet: issuer } = await client.fundWallet();
  const { wallet: holder } = await client.fundWallet();
  console.log('Issuer:', issuer.address);
  console.log('Holder:', holder.address);

  // ── 2. Create an MPT issuance ─────────────────────────────────────────────
  // MPTs are fungible tokens that live directly on accounts (no trust lines needed).
  console.log('\\n── Creating MPT issuance ────────────────────────────────────');
  const issuanceResult = await client.submitAndWait({
    TransactionType: 'MPTokenIssuanceCreate',
    Account: issuer.address,
    MaximumAmount: '1000000',                              // max supply: 1,000,000 tokens
    Flags: MPTokenIssuanceCreateFlags.tfMPTCanTransfer,    // holders can transfer to each other
  }, { wallet: issuer });

  // Extract the issuance ID from AffectedNodes
  const issuanceMeta = (issuanceResult.result as any).meta;
  const issuanceNode = issuanceMeta?.AffectedNodes?.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === 'MPTokenIssuance'
  );
  const issuanceId = issuanceNode?.CreatedNode?.LedgerIndex as string;
  console.log('✓ MPT Issuance ID:', issuanceId);

  // ── 3. Holder opts in (MPTokenAuthorize) ─────────────────────────────────
  // Unlike IOU trust lines, MPT holders must explicitly authorize before receiving tokens.
  console.log('\\n── Holder opts in to receive MPT ────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'MPTokenAuthorize',
    Account: holder.address,
    MPTokenIssuanceID: issuanceId,
  }, { wallet: holder });
  console.log('Holder opted in');

  // ── 4. Issuer sends 1,000 tokens to holder ────────────────────────────────
  console.log('\\n── Issuing 1,000 tokens to holder ───────────────────────────');
  await client.submitAndWait({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: holder.address,
    Amount: { mpt_issuance_id: issuanceId, value: '1000' },
  }, { wallet: issuer });
  console.log('Sent 1,000 MPT to holder');

  // ── 5. Verify holder balance ──────────────────────────────────────────────
  const res = await client.request({
    command: 'account_objects',
    account: holder.address,
    type: 'mptoken',
    ledger_index: 'validated',
  } as any);
  const mptObj = (res.result as any).account_objects.find(
    (o: any) => o.MPTokenIssuanceID === issuanceId
  );
  console.log('\\n✓ Holder MPT balance:', mptObj?.MPTAmount ?? '0', 'tokens');
  console.log('  Issuance ID:', issuanceId);

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

/* ── Example scripts — local rippled ─────────────────────────────────────── */

const EXAMPLE_PAYMENT_LOCAL = `// scripts/example-payment.ts
// Send XRP between two wallets on the local xrpl-up sandbox and verify balances.
// Run with: xrpl-up run scripts/example-payment.ts
// Requires: xrpl-up start --local  (running in another terminal)
import { Client, Wallet, xrpToDrops } from 'xrpl';

const NETWORK_URL = process.env.XRPL_NETWORK_URL ?? 'ws://localhost:6006';
const FAUCET_URL  = 'http://localhost:3001';

/** Fund a new account using the local xrpl-up faucet. */
async function fundAccount(): Promise<Wallet> {
  const res = await fetch(\`\${FAUCET_URL}/faucet\`, { method: 'POST' });
  if (!res.ok) throw new Error(\`Faucet error: \${res.statusText}\`);
  const { seed } = await res.json() as { address: string; seed: string; balance: number };
  return Wallet.fromSeed(seed);
}

async function main() {
  const client = new Client(NETWORK_URL, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to local rippled');

  console.log('\\nFunding sender wallet…');
  const sender = await fundAccount();
  console.log('Sender:', sender.address);

  console.log('Funding receiver wallet…');
  const receiver = await fundAccount();
  console.log('Receiver:', receiver.address);

  // Check balances before payment
  const senderBefore   = await client.getXrpBalance(sender.address);
  const receiverBefore = await client.getXrpBalance(receiver.address);
  console.log('\\nBalances before:');
  console.log('  Sender:  ', senderBefore, 'XRP');
  console.log('  Receiver:', receiverBefore, 'XRP');

  // Send 10 XRP
  const amount = '10';
  console.log(\`\\nSending \${amount} XRP to \${receiver.address}…\`);

  const tx = {
    TransactionType: 'Payment' as const,
    Account: sender.address,
    Amount: xrpToDrops(amount),
    Destination: receiver.address,
  };

  const result = await client.submitAndWait(tx, { wallet: sender });

  const meta = result.result.meta;
  const outcome =
    typeof meta === 'object' && meta !== null ? meta.TransactionResult : 'unknown';

  if (outcome === 'tesSUCCESS') {
    console.log('\\n✓ Payment successful!');
    console.log('  Tx hash:', result.result.hash);

    // Verify balances after payment
    const senderAfter   = await client.getXrpBalance(sender.address);
    const receiverAfter = await client.getXrpBalance(receiver.address);
    console.log('\\nBalances after:');
    console.log('  Sender:  ', senderAfter,   'XRP  (sent 10 XRP + tx fee)');
    console.log('  Receiver:', receiverAfter, 'XRP  (+10 XRP received)');
  } else {
    console.error('Payment failed:', outcome);
  }

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_TOKEN_LOCAL = `// scripts/example-token.ts
// Issue a custom token (IOU) on the local xrpl-up sandbox.
// Run with: xrpl-up run scripts/example-token.ts
// Requires: xrpl-up start --local  (running in another terminal)
import { Client, Wallet, AccountSetAsfFlags } from 'xrpl';

const NETWORK_URL = process.env.XRPL_NETWORK_URL ?? 'ws://localhost:6006';
const FAUCET_URL  = 'http://localhost:3001';

/** Fund a new account using the local xrpl-up faucet. */
async function fundAccount(): Promise<Wallet> {
  const res = await fetch(\`\${FAUCET_URL}/faucet\`, { method: 'POST' });
  if (!res.ok) throw new Error(\`Faucet error: \${res.statusText}\`);
  const { seed } = await res.json() as { address: string; seed: string; balance: number };
  return Wallet.fromSeed(seed);
}

async function main() {
  const client = new Client(NETWORK_URL, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to local rippled\\n');

  // ── 1. Fund accounts ──────────────────────────────────────────────────────
  console.log('── Funding accounts ─────────────────────────────────────────');
  const issuer = await fundAccount();
  const holder = await fundAccount();
  console.log('Issuer:', issuer.address);
  console.log('Holder:', holder.address);

  // ── 2. Enable DefaultRipple on issuer ─────────────────────────────────────
  console.log('\\n── Enabling DefaultRipple on issuer ─────────────────────────');
  await client.submitAndWait({
    TransactionType: 'AccountSet',
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  }, { wallet: issuer });
  console.log('DefaultRipple enabled');

  // ── 3. Holder creates a trust line ────────────────────────────────────────
  console.log('\\n── Setting up trust line ────────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'TrustSet',
    Account: holder.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, { wallet: holder });
  console.log('Trust line set: holder can hold up to 10,000 USD');

  // ── 4. Issuer sends 1,000 USD to holder ───────────────────────────────────
  console.log('\\n── Issuing tokens ───────────────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: holder.address,
    Amount: { currency: 'USD', issuer: issuer.address, value: '1000' },
  }, { wallet: issuer });
  console.log('Issued 1,000 USD to holder');

  // ── 5. Verify balance ─────────────────────────────────────────────────────
  const lines = await client.request({
    command: 'account_lines',
    account: holder.address,
    ledger_index: 'current',
  });
  const usdLine = (lines.result as any).lines.find(
    (l: any) => l.currency === 'USD' && l.account === issuer.address
  );
  console.log('\\n✓ Holder USD balance:', usdLine?.balance ?? '0', 'USD');
  console.log('  Issuer:', issuer.address);

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_DEX_LOCAL = `// scripts/example-dex.ts
// Place and fill a DEX order on the local xrpl-up sandbox.
//
// Unlike testnet, we control both sides of the trade — the order fills immediately
// when the buyer submits a matching offer.
//
// Run with: xrpl-up run scripts/example-dex.ts
// Requires: xrpl-up start --local  (running in another terminal)
import { Client, Wallet, AccountSetAsfFlags } from 'xrpl';

const NETWORK_URL = process.env.XRPL_NETWORK_URL ?? 'ws://localhost:6006';
const FAUCET_URL  = 'http://localhost:3001';

/** Fund a new account using the local xrpl-up faucet. */
async function fundAccount(): Promise<Wallet> {
  const res = await fetch(\`\${FAUCET_URL}/faucet\`, { method: 'POST' });
  if (!res.ok) throw new Error(\`Faucet error: \${res.statusText}\`);
  const { seed } = await res.json() as { address: string; seed: string; balance: number };
  return Wallet.fromSeed(seed);
}

async function main() {
  const client = new Client(NETWORK_URL, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to local rippled\\n');

  // ── 1. Set up accounts and issue a token ─────────────────────────────────
  console.log('── Setting up accounts and USD token ────────────────────────');
  const issuer = await fundAccount();
  const seller = await fundAccount();  // will sell USD for XRP
  const buyer  = await fundAccount();  // will buy USD with XRP
  console.log('Issuer:', issuer.address);
  console.log('Seller:', seller.address);
  console.log('Buyer: ', buyer.address);

  await client.submitAndWait({
    TransactionType: 'AccountSet',
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  }, { wallet: issuer });

  // Seller trust line + receive USD from issuer
  await client.submitAndWait({
    TransactionType: 'TrustSet',
    Account: seller.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, { wallet: seller });
  await client.submitAndWait({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: seller.address,
    Amount: { currency: 'USD', issuer: issuer.address, value: '500' },
  }, { wallet: issuer });

  // Buyer trust line (needed to receive USD after the trade)
  await client.submitAndWait({
    TransactionType: 'TrustSet',
    Account: buyer.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, { wallet: buyer });
  console.log('Seller funded with 500 USD');

  // ── 2. Seller places an offer: sell 100 USD, buy 50 XRP ──────────────────
  console.log('\\n── Seller: sell 100 USD, buy 50 XRP ─────────────────────────');
  await client.submitAndWait({
    TransactionType: 'OfferCreate',
    Account: seller.address,
    TakerGets: { currency: 'USD', issuer: issuer.address, value: '100' },
    TakerPays: '50000000', // 50 XRP in drops
  }, { wallet: seller });
  console.log('Seller offer placed');

  // ── 3. Buyer places a matching offer → fills immediately ─────────────────
  console.log('\\n── Buyer: buy 100 USD for 50 XRP (crosses seller offer) ─────');
  const buyResult = await client.submitAndWait({
    TransactionType: 'OfferCreate',
    Account: buyer.address,
    TakerGets: '50000000',                                                  // 50 XRP
    TakerPays: { currency: 'USD', issuer: issuer.address, value: '100' },  // buy 100 USD
  }, { wallet: buyer });

  const meta = (buyResult.result as any).meta;
  const outcome = meta?.TransactionResult ?? 'unknown';
  console.log('Buyer OfferCreate result:', outcome);

  // ── 4. Verify balances ────────────────────────────────────────────────────
  console.log('\\n── Verifying balances ───────────────────────────────────────');
  const lines = await client.request({
    command: 'account_lines',
    account: buyer.address,
    ledger_index: 'current',
  });
  const usdLine = (lines.result as any).lines.find(
    (l: any) => l.currency === 'USD' && l.account === issuer.address
  );
  console.log('Buyer USD balance: ', usdLine?.balance ?? '0', 'USD');

  const sellerXrp = await client.getXrpBalance(seller.address);
  console.log('Seller XRP balance:', sellerXrp, 'XRP  (received from trade)');

  console.log('\\n✓ DEX trade complete!');
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_NFT_LOCAL = `// scripts/example-nft.ts
// Full NFT lifecycle on the local xrpl-up sandbox: mint → sell → buy → burn.
// Run with: xrpl-up run scripts/example-nft.ts
// Requires: xrpl-up start --local  (running in another terminal)
import { Client, Wallet } from 'xrpl';

const NETWORK_URL = process.env.XRPL_NETWORK_URL ?? 'ws://localhost:6006';
const FAUCET_URL  = 'http://localhost:3001';

/** Fund a new account using the local xrpl-up faucet. */
async function fundAccount(): Promise<Wallet> {
  const res = await fetch(\`\${FAUCET_URL}/faucet\`, { method: 'POST' });
  if (!res.ok) throw new Error(\`Faucet error: \${res.statusText}\`);
  const { seed } = await res.json() as { address: string; seed: string; balance: number };
  return Wallet.fromSeed(seed);
}

async function main() {
  const client = new Client(NETWORK_URL, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to local rippled\\n');

  // ── 1. Fund minter and buyer ──────────────────────────────────────────────
  console.log('── Funding accounts ─────────────────────────────────────────');
  const minter = await fundAccount();
  const buyer  = await fundAccount();
  console.log('Minter:', minter.address);
  console.log('Buyer: ', buyer.address);

  // ── 2. Mint an NFT ────────────────────────────────────────────────────────
  console.log('\\n── Minting NFT ──────────────────────────────────────────────');
  const uri = Buffer.from('https://example.com/my-nft-metadata.json', 'utf8')
    .toString('hex').toUpperCase();

  await client.submitAndWait({
    TransactionType: 'NFTokenMint',
    Account: minter.address,
    NFTokenTaxon: 0,
    Flags: 8, // tfTransferable
    URI: uri,
  }, { wallet: minter });

  const nftsRes = await client.request({ command: 'account_nfts', account: minter.address });
  const nftId = nftsRes.result.account_nfts[0]?.NFTokenID;
  console.log('✓ Minted NFTokenID:', nftId);

  // ── 3. Create a sell offer ────────────────────────────────────────────────
  console.log('\\n── Creating sell offer (10 XRP) ─────────────────────────────');
  const offerResult = await client.submitAndWait({
    TransactionType: 'NFTokenCreateOffer',
    Account: minter.address,
    NFTokenID: nftId,
    Amount: '10000000', // 10 XRP in drops
    Flags: 1,           // tfSellToken
  }, { wallet: minter });

  const offerMeta = (offerResult.result as any).meta;
  const offerNode = offerMeta?.AffectedNodes?.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === 'NFTokenOffer'
  );
  const sellOfferId = offerNode?.CreatedNode?.LedgerIndex as string | undefined;
  console.log('✓ Sell offer ID:', sellOfferId);

  // ── 4. Buyer accepts the sell offer ──────────────────────────────────────
  console.log('\\n── Buyer accepts sell offer ─────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'NFTokenAcceptOffer',
    Account: buyer.address,
    NFTokenSellOffer: sellOfferId,
  }, { wallet: buyer });
  console.log('✓ NFT transferred to buyer');

  const buyerNfts = await client.request({ command: 'account_nfts', account: buyer.address });
  console.log('  Buyer now holds', buyerNfts.result.account_nfts.length, 'NFT(s)');

  // ── 5. Burn the NFT ───────────────────────────────────────────────────────
  console.log('\\n── Burning the NFT ──────────────────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'NFTokenBurn',
    Account: buyer.address,
    NFTokenID: nftId,
  }, { wallet: buyer });

  const afterBurn = await client.request({ command: 'account_nfts', account: buyer.address });
  console.log('✓ NFT burned — buyer now holds', afterBurn.result.account_nfts.length, 'NFT(s)');

  console.log('\\n✓ NFT lifecycle complete!');
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_MPT_LOCAL = `// scripts/example-mpt.ts
// Issue and transfer a Multi-Purpose Token (MPT) on the local xrpl-up sandbox.
// Run with: xrpl-up run scripts/example-mpt.ts
// Requires: xrpl-up start --local  (running in another terminal)
import { Client, Wallet, MPTokenIssuanceCreateFlags } from 'xrpl';

const NETWORK_URL = process.env.XRPL_NETWORK_URL ?? 'ws://localhost:6006';
const FAUCET_URL  = 'http://localhost:3001';

/** Fund a new account using the local xrpl-up faucet. */
async function fundAccount(): Promise<Wallet> {
  const res = await fetch(\`\${FAUCET_URL}/faucet\`, { method: 'POST' });
  if (!res.ok) throw new Error(\`Faucet error: \${res.statusText}\`);
  const { seed } = await res.json() as { address: string; seed: string; balance: number };
  return Wallet.fromSeed(seed);
}

async function main() {
  const client = new Client(NETWORK_URL, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to local rippled\\n');

  // ── 1. Fund accounts ──────────────────────────────────────────────────────
  console.log('── Funding accounts ─────────────────────────────────────────');
  const issuer = await fundAccount();
  const holder = await fundAccount();
  console.log('Issuer:', issuer.address);
  console.log('Holder:', holder.address);

  // ── 2. Create an MPT issuance ─────────────────────────────────────────────
  console.log('\\n── Creating MPT issuance ────────────────────────────────────');
  const issuanceResult = await client.submitAndWait({
    TransactionType: 'MPTokenIssuanceCreate',
    Account: issuer.address,
    MaximumAmount: '1000000',                              // max supply: 1,000,000 tokens
    Flags: MPTokenIssuanceCreateFlags.tfMPTCanTransfer,    // holders can transfer to each other
  }, { wallet: issuer });

  const issuanceMeta = (issuanceResult.result as any).meta;
  const issuanceNode = issuanceMeta?.AffectedNodes?.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === 'MPTokenIssuance'
  );
  const issuanceId = issuanceNode?.CreatedNode?.LedgerIndex as string;
  console.log('✓ MPT Issuance ID:', issuanceId);

  // ── 3. Holder opts in (MPTokenAuthorize) ─────────────────────────────────
  console.log('\\n── Holder opts in to receive MPT ────────────────────────────');
  await client.submitAndWait({
    TransactionType: 'MPTokenAuthorize',
    Account: holder.address,
    MPTokenIssuanceID: issuanceId,
  }, { wallet: holder });
  console.log('Holder opted in');

  // ── 4. Issuer sends 1,000 tokens to holder ────────────────────────────────
  console.log('\\n── Issuing 1,000 tokens to holder ───────────────────────────');
  await client.submitAndWait({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: holder.address,
    Amount: { mpt_issuance_id: issuanceId, value: '1000' },
  }, { wallet: issuer });
  console.log('Sent 1,000 MPT to holder');

  // ── 5. Verify holder balance ──────────────────────────────────────────────
  const res = await client.request({
    command: 'account_objects',
    account: holder.address,
    type: 'mptoken',
    ledger_index: 'current',
  } as any);
  const mptObj = (res.result as any).account_objects.find(
    (o: any) => o.MPTokenIssuanceID === issuanceId
  );
  console.log('\\n✓ Holder MPT balance:', mptObj?.MPTAmount ?? '0', 'tokens');
  console.log('  Issuance ID:', issuanceId);

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const EXAMPLE_AMM_LOCAL = `// scripts/example-amm.ts
// Create an XRP/USD AMM pool and execute a trade on the local xrpl-up sandbox.
// Run with: xrpl-up run scripts/example-amm.ts
// Requires: xrpl-up start --local  (running in another terminal)
import { Client, Wallet, xrpToDrops, AccountSetAsfFlags } from 'xrpl';

const NETWORK_URL = process.env.XRPL_NETWORK_URL ?? 'ws://localhost:6006';
const FAUCET_URL  = 'http://localhost:3001';

/** Fund a new account using the local xrpl-up faucet. */
async function fundAccount(): Promise<Wallet> {
  const res = await fetch(\`\${FAUCET_URL}/faucet\`, { method: 'POST' });
  if (!res.ok) throw new Error(\`Faucet error: \${res.statusText}\`);
  const { seed } = await res.json() as { address: string; seed: string; balance: number };
  return Wallet.fromSeed(seed);
}

async function main() {
  const client = new Client(NETWORK_URL, { timeout: 60_000 });
  await client.connect();
  console.log('Connected to local rippled\\n');

  /** Advance the ledger (required in standalone mode). */
  const accept = () => (client as any).request({ command: 'ledger_accept' });

  /** Sign and submit a transaction, then advance the ledger. */
  const submit = async (tx: Record<string, unknown>, wallet: Wallet): Promise<string> => {
    const filled = await client.autofill(tx as any);
    const { tx_blob } = wallet.sign(filled as any);
    const res = await client.submit(tx_blob);
    await accept();
    return (res.result as any).engine_result as string;
  };

  // ── 1. Fund accounts ──────────────────────────────────────────────────────
  console.log('── Setting up accounts ──────────────────────────────────────');
  const issuer = await fundAccount();   // issues USD
  const lp     = await fundAccount();   // provides liquidity
  const trader = await fundAccount();   // executes trades
  console.log('Issuer: ', issuer.address);
  console.log('LP:     ', lp.address);
  console.log('Trader: ', trader.address);

  // ── 2. Enable DefaultRipple on issuer ─────────────────────────────────────
  await submit({
    TransactionType: 'AccountSet',
    Account: issuer.address,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  }, issuer);

  // ── 3. LP: trust line + receive USD from issuer ───────────────────────────
  console.log('\\n── Setting up LP trust line and issuing USD ─────────────────');
  await submit({
    TransactionType: 'TrustSet',
    Account: lp.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, lp);

  await submit({
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: lp.address,
    Amount: { currency: 'USD', issuer: issuer.address, value: '1000' },
  }, issuer);
  console.log('LP funded with 1000 USD');

  // ── 4. Create the AMM pool ────────────────────────────────────────────────
  console.log('\\n── Creating AMM pool: 100 XRP / 100 USD ─────────────────────');
  const createResult = await submit({
    TransactionType: 'AMMCreate',
    Account: lp.address,
    Amount: xrpToDrops('100'),
    Amount2: { currency: 'USD', issuer: issuer.address, value: '100' },
    TradingFee: 500,  // 0.5%
  }, lp);
  console.log('AMMCreate:', createResult);

  // Fetch pool info
  const poolInfo = await client.request({
    command: 'amm_info',
    asset:  { currency: 'XRP' },
    asset2: { currency: 'USD', issuer: issuer.address },
    ledger_index: 'validated',
  } as any);
  const amm = (poolInfo.result as any).amm;
  const poolXrp = (Number(amm.amount) / 1_000_000).toFixed(4);
  const poolUsd = Number(amm.amount2.value).toFixed(4);
  console.log(\`Pool reserves: \${poolXrp} XRP / \${poolUsd} USD\`);
  console.log(\`AMM account:   \${amm.account}\`);
  console.log(\`Trading fee:   \${amm.trading_fee / 1000}%\`);

  // ── 5. Trader: trust line + execute a swap ────────────────────────────────
  console.log('\\n── Trader: buy ~9 USD with XRP ──────────────────────────────');
  await submit({
    TransactionType: 'TrustSet',
    Account: trader.address,
    LimitAmount: { currency: 'USD', issuer: issuer.address, value: '10000' },
  }, trader);

  // OfferCreate: sell up to 15 XRP to buy 9 USD
  const tradeResult = await submit({
    TransactionType: 'OfferCreate',
    Account: trader.address,
    TakerGets: xrpToDrops('15'),                                      // sell up to 15 XRP
    TakerPays: { currency: 'USD', issuer: issuer.address, value: '9' }, // buy 9 USD
  }, trader);
  console.log('OfferCreate:', tradeResult);

  // Pool state after trade
  const poolAfter = await client.request({
    command: 'amm_info',
    asset:  { currency: 'XRP' },
    asset2: { currency: 'USD', issuer: issuer.address },
    ledger_index: 'validated',
  } as any);
  const ammAfter = (poolAfter.result as any).amm;
  const xrpAfter = (Number(ammAfter.amount) / 1_000_000).toFixed(4);
  const usdAfter = Number(ammAfter.amount2.value).toFixed(4);
  console.log(\`Pool reserves: \${xrpAfter} XRP / \${usdAfter} USD  (price moved due to trade)\`);

  // Trader USD balance
  const lines = await client.request({
    command: 'account_lines',
    account: trader.address,
    ledger_index: 'validated',
  });
  const usdLine = (lines.result as any).lines.find(
    (l: any) => l.currency === 'USD' && l.account === issuer.address
  );
  console.log(\`Trader USD balance: \${usdLine?.balance ?? '0'}\`);

  console.log('\\n✓ AMM example complete!');
  console.log(\`  Query pool: xrpl-up amm info XRP USD.\${issuer.address} --local\`);

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

/* ── .gitignore ───────────────────────────────────────────────────────────── */

const GITIGNORE_TEMPLATE = `node_modules/
dist/
.env
*.log
`;

/* ── Command ──────────────────────────────────────────────────────────────── */

export interface InitOptions {
  directory?: string;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const targetDir = options.directory
    ? path.resolve(process.cwd(), options.directory)
    : process.cwd();

  logger.blank();
  console.log(chalk.bold('  Initialize XRPL project'));
  logger.blank();

  const defaultName = path.basename(targetDir);
  const { projectName, defaultNetwork } = await inquirer.prompt<{
    projectName: string;
    defaultNetwork: string;
  }>([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: defaultName,
    },
    {
      type: 'list',
      name: 'defaultNetwork',
      message: 'Default network:',
      choices: [
        { name: 'local    — local rippled via Docker (xrpl-up start --local)', value: 'local'   },
        { name: 'testnet  — XRPL Testnet',                                    value: 'testnet' },
        { name: 'devnet   — XRPL Devnet',                                     value: 'devnet'  },
        { name: 'mainnet  — XRPL Mainnet',                                    value: 'mainnet' },
      ],
      default: 'local',
    },
  ]);

  const isLocal = defaultNetwork === 'local';

  // Create target directory if needed
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });

  const files: Array<{ file: string; content: string }> = [
    { file: 'xrpl-up.config.js',         content: generateConfig(defaultNetwork) },
    { file: 'package.json',               content: packageJsonTemplate(projectName) },
    { file: 'tsconfig.json',              content: TSCONFIG_TEMPLATE },
    { file: '.gitignore',                 content: GITIGNORE_TEMPLATE },
    { file: 'scripts/example-payment.ts', content: isLocal ? EXAMPLE_PAYMENT_LOCAL : EXAMPLE_PAYMENT_SCRIPT },
    { file: 'scripts/example-token.ts',   content: isLocal ? EXAMPLE_TOKEN_LOCAL   : EXAMPLE_TOKEN_SCRIPT   },
    { file: 'scripts/example-dex.ts',     content: isLocal ? EXAMPLE_DEX_LOCAL     : EXAMPLE_DEX_SCRIPT     },
    { file: 'scripts/example-nft.ts',     content: isLocal ? EXAMPLE_NFT_LOCAL     : EXAMPLE_NFT_SCRIPT     },
    { file: 'scripts/example-mpt.ts',     content: isLocal ? EXAMPLE_MPT_LOCAL     : EXAMPLE_MPT_SCRIPT     },
    ...(isLocal ? [{ file: 'scripts/example-amm.ts', content: EXAMPLE_AMM_LOCAL }] : []),
  ];

  logger.blank();
  for (const { file, content } of files) {
    const dest = path.join(targetDir, file);
    if (fs.existsSync(dest)) {
      logger.warning(`${file} already exists — skipped`);
    } else {
      fs.writeFileSync(dest, content);
      logger.success(`Created ${file}`);
    }
  }

  logger.blank();
  console.log(chalk.bold('  Project ready!'));
  logger.blank();

  const cd = options.directory ? `cd ${options.directory} && ` : '';
  const nodeCmd = isLocal
    ? `xrpl-up start --local     ${chalk.dim('# start local Docker sandbox')}`
    : `xrpl-up start             ${chalk.dim('# start sandbox with funded accounts')}`;

  const steps = [
    `${cd}npm install`,
    nodeCmd,
    `xrpl-up accounts                         ${chalk.dim('# list sandbox accounts')}`,
    `xrpl-up run scripts/example-payment.ts   ${chalk.dim('# send XRP + verify balances')}`,
    `xrpl-up run scripts/example-token.ts     ${chalk.dim('# issue a custom token')}`,
    `xrpl-up run scripts/example-dex.ts       ${chalk.dim('# place a DEX order')}`,
    `xrpl-up run scripts/example-nft.ts       ${chalk.dim('# mint, sell, and burn an NFT')}`,
    `xrpl-up run scripts/example-mpt.ts       ${chalk.dim('# issue a Multi-Purpose Token')}`,
    ...(isLocal ? [`xrpl-up run scripts/example-amm.ts       ${chalk.dim('# create AMM pool and trade')}`] : []),
  ];
  console.log('  Next steps:');
  for (const step of steps) {
    console.log(`    ${chalk.cyan(step)}`);
  }
  logger.blank();
}
