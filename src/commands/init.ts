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
        node: 'xrpl-up node',
        accounts: 'xrpl-up accounts',
      },
      dependencies: {
        'xrpl-up': '^0.1.0',
        xrpl: '^2.14.0',
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
// Run with: xrpl-up run scripts/example-payment.ts
import { Client, xrpToDrops } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const networkName = process.env.XRPL_NETWORK_NAME ?? 'testnet';

  const client = new Client(networkUrl);
  await client.connect();
  console.log('Connected to', networkName);

  // Fund two wallets from the testnet faucet
  console.log('\\nFunding sender wallet…');
  const { wallet: sender, balance: senderBalance } = await client.fundWallet();
  console.log('Sender:', sender.address, '|', senderBalance, 'XRP');

  console.log('Funding receiver wallet…');
  const { wallet: receiver } = await client.fundWallet();
  console.log('Receiver:', receiver.address);

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

const EXAMPLE_NFT_SCRIPT = `// scripts/example-nft.ts
// Mint an NFT on XRPL testnet
// Run with: xrpl-up run scripts/example-nft.ts
import { Client, convertStringToHex } from 'xrpl';

async function main() {
  const networkUrl = process.env.XRPL_NETWORK_URL ?? 'wss://s.altnet.rippletest.net:51233';
  const client = new Client(networkUrl);
  await client.connect();

  console.log('Funding minter wallet…');
  const { wallet: minter } = await client.fundWallet();
  console.log('Minter:', minter.address);

  const uri = convertStringToHex('https://example.com/my-nft-metadata.json');

  console.log('\\nMinting NFT…');
  const result = await client.submitAndWait(
    {
      TransactionType: 'NFTokenMint',
      Account: minter.address,
      NFTokenTaxon: 0,
      Flags: 8, // tfTransferable
      URI: uri,
    },
    { wallet: minter }
  );

  const meta = result.result.meta;
  const outcome =
    typeof meta === 'object' && meta !== null ? meta.TransactionResult : 'unknown';

  if (outcome === 'tesSUCCESS') {
    console.log('\\n✓ NFT minted!');
    console.log('  Tx hash:', result.result.hash);

    // Fetch the minted NFTs
    const nfts = await client.request({
      command: 'account_nfts',
      account: minter.address,
    });
    console.log('  Minted NFTs:', nfts.result.account_nfts.length);
  } else {
    console.error('Mint failed:', outcome);
  }

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

/* ── Example scripts — local rippled ─────────────────────────────────────── */

const EXAMPLE_PAYMENT_LOCAL = `// scripts/example-payment.ts
// Run with: xrpl-up run scripts/example-payment.ts
// Requires: xrpl-up node --local  (running in another terminal)
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
  const client = new Client(NETWORK_URL);
  await client.connect();
  console.log('Connected to local rippled');

  console.log('\\nFunding sender wallet…');
  const sender = await fundAccount();
  console.log('Sender:', sender.address);

  console.log('Funding receiver wallet…');
  const receiver = await fundAccount();
  console.log('Receiver:', receiver.address);

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

const EXAMPLE_NFT_LOCAL = `// scripts/example-nft.ts
// Mint an NFT on the local xrpl-up sandbox
// Run with: xrpl-up run scripts/example-nft.ts
// Requires: xrpl-up node --local  (running in another terminal)
import { Client, Wallet, convertStringToHex } from 'xrpl';

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
  const client = new Client(NETWORK_URL);
  await client.connect();

  console.log('Funding minter wallet…');
  const minter = await fundAccount();
  console.log('Minter:', minter.address);

  const uri = convertStringToHex('https://example.com/my-nft-metadata.json');

  console.log('\\nMinting NFT…');
  const result = await client.submitAndWait(
    {
      TransactionType: 'NFTokenMint',
      Account: minter.address,
      NFTokenTaxon: 0,
      Flags: 8, // tfTransferable
      URI: uri,
    },
    { wallet: minter }
  );

  const meta = result.result.meta;
  const outcome =
    typeof meta === 'object' && meta !== null ? meta.TransactionResult : 'unknown';

  if (outcome === 'tesSUCCESS') {
    console.log('\\n✓ NFT minted!');
    console.log('  Tx hash:', result.result.hash);

    const nfts = await client.request({
      command: 'account_nfts',
      account: minter.address,
    });
    console.log('  Minted NFTs:', nfts.result.account_nfts.length);
  } else {
    console.error('Mint failed:', outcome);
  }

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
// Requires: xrpl-up node --local  (running in another terminal)
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
  const client = new Client(NETWORK_URL);
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
        { name: 'local    — local rippled via Docker (xrpl-up node --local)', value: 'local'   },
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
    { file: 'scripts/example-nft.ts',     content: isLocal ? EXAMPLE_NFT_LOCAL     : EXAMPLE_NFT_SCRIPT     },
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
    ? `xrpl-up node --local     ${chalk.dim('# start local Docker sandbox')}`
    : `xrpl-up node             ${chalk.dim('# start sandbox with funded accounts')}`;

  const steps = [
    `${cd}npm install`,
    nodeCmd,
    `xrpl-up accounts          ${chalk.dim('# list sandbox accounts')}`,
    `xrpl-up run scripts/example-payment.ts  ${chalk.dim('# send XRP')}`,
    ...(isLocal ? [`xrpl-up run scripts/example-amm.ts    ${chalk.dim('# create AMM pool and trade')}`] : []),
  ];
  console.log('  Next steps:');
  for (const step of steps) {
    console.log(`    ${chalk.cyan(step)}`);
  }
  logger.blank();
}
