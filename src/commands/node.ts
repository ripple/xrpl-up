import http from 'node:http';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { Wallet } from 'xrpl';
import { printBanner } from '../utils/banner';
import { logger } from '../utils/logger';
import { loadConfig, resolveNetwork, isMainnet } from '../core/config';
import { NetworkManager } from '../core/network';
import { WalletStore } from '../core/wallet-store';
import {
  checkDockerAvailable,
  composeUp,
  composeDown,
  DEFAULT_IMAGE,
  LOCAL_WS_URL,
  FAUCET_URL,
  COMPOSE_PROJECT,
} from '../core/compose';
import { validateConfig, printValidationResult } from './config';
import { GENESIS_ADDRESS } from '../core/standalone';
import { fetchForkAccounts, fetchActiveAccountsInLedger, applyForkAccounts, ForkAccount } from '../core/fork';
import { tecMessage } from '../utils/tec-codes';

export interface NodeOptions {
  network?: string;
  accountCount?: number;
  local?: boolean;
  localNetwork?: boolean;
  image?: string;
  ledgerInterval?: number;
  fork?: boolean;
  forkAccounts?: string;        // comma-separated addresses
  accountsFromLedger?: number;  // scan this ledger for active accounts
  forkAtLedger?: number;        // snapshot balances at this ledger (default: accountsFromLedger-1 or latest)
  forkSource?: string;
  noAutoAdvance?: boolean;
  noSecrets?: boolean;  // suppress private key output (auto-enabled with --detach)
  debug?: boolean;
  detach?: boolean;
  noRestart?: boolean;  // bypass wrapper entrypoint so container exits with rippled's code
  config?: string;  // path to a custom rippled.cfg (local mode only)
}

/** Call the local faucet HTTP server to fund a fresh wallet. */
async function callFaucet(): Promise<{ address: string; seed: string; balance: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${FAUCET_URL}/faucet`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { address: string; seed: string; balance: number; error?: string };
            if (res.statusCode !== 200) {
              reject(new Error(parsed.error ?? `Faucet returned HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid faucet response: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const TABLE_CHARS = {
  top: '─',
  'top-mid': '┬',
  'top-left': '┌',
  'top-right': '┐',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '└',
  'bottom-right': '┘',
  left: '│',
  'left-mid': '├',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '┤',
  middle: '│',
};

function printTable(str: string): void {
  console.log(
    str.split('\n').map((l) => '  ' + l).join('\n')
  );
}

export async function nodeCommand(options: NodeOptions = {}): Promise<void> {
  printBanner();

  let networkName: string;
  let networkUrl: string;
  let networkDisplayName: string;
  let isLocal = false;

  // ── Resolve network ────────────────────────────────────────────────────────
  if (options.local) {
    isLocal = true;
    networkName = 'local';
    networkDisplayName = 'Local rippled (Docker)';
    networkUrl = LOCAL_WS_URL;

    // Check Docker before doing anything else
    checkDockerAvailable(); // throws if Docker is unavailable
  } else {
    const config = loadConfig();
    const resolved = resolveNetwork(config, options.network);
    networkName = resolved.name;
    networkUrl = resolved.config.url;
    networkDisplayName = resolved.config.name ?? resolved.name;

    if (isMainnet(resolved.name, resolved.config)) {
      logger.error('Cannot start sandbox on Mainnet — use testnet, devnet, or --local.');
      process.exit(1);
    }
  }

  // ── Validate fork options ──────────────────────────────────────────────────
  if (options.fork && !isLocal) {
    logger.error('--fork requires --local mode.');
    process.exit(1);
  }

  if (options.fork) {
    const hasAccounts = (options.forkAccounts ?? '').split(',').map(a => a.trim()).filter(Boolean).length > 0;
    const hasLedger = options.accountsFromLedger != null;
    if (!hasAccounts && !hasLedger) {
      logger.error('--fork requires --fork-accounts <addr1,...> or --add-accounts-from-ledger <index>');
      process.exit(1);
    }
  }

  // ── Confirm previous state removal (fork mode) ────────────────────────────
  const store = new WalletStore(networkName);

  if (isLocal && options.fork) {
    const existing = store.all();
    if (existing.length > 0) {
      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Previous state found (${existing.length} accounts). Remove and start fresh?`,
          default: true,
        },
      ]);
      if (!confirmed) {
        logger.info('Keeping previous state. Exiting.');
        process.exit(0);
      }
    }
  }

  // ── Start Docker Compose stack (local mode only) ───────────────────────────
  const localNetwork = isLocal && (options.localNetwork ?? false);
  const noConsensus = isLocal && !localNetwork;
  const persist = isLocal && localNetwork; // --local-network always persists

  if (isLocal) {
    const image = options.image ?? DEFAULT_IMAGE;
    const dockerSpinner = ora({
      text: `Building & starting local stack${chalk.dim(' (first run may take a minute…)')}`,
      color: 'cyan',
      indent: 2,
    }).start();

    try {
      // Validate custom config before starting Docker — surface errors early
      if (options.config) {
        const validation = validateConfig(options.config);
        if (validation.errors.length > 0 || validation.warnings.length > 0 || validation.recommendations.length > 0) {
          printValidationResult(options.config, validation);
        }
        if (validation.errors.length > 0) {
          throw new Error('Custom config has errors — fix them before starting (run: xrpl-up config validate ' + options.config + ')');
        }
      }

      // In --local-network mode, ledgers close via consensus (~4s) — no ledger_accept needed.
      // In standalone mode (default), faucet auto-advances ledgers when detached.
      const ledgerIntervalMs = noConsensus
        ? (options.detach ? (options.ledgerInterval ?? 1000) : 0)
        : 0;
      await composeUp(image, noConsensus, options.debug ?? false, ledgerIntervalMs, options.config, options.noRestart ?? false);
      dockerSpinner.succeed(
        `Local stack started  ${chalk.dim('rippled ws://localhost:6006')}  ${chalk.dim('faucet http://localhost:3001')}`
      );

      // When --exit-on-crash is set, attach two background watchers:
      //
      // 1. Log poller  — polls `docker logs` every 500 ms looking for the
      //    "Logic error:" line that rippled always emits before abort().
      //    When detected it sends SIGABRT *directly to rippled's own PID*
      //    (not via `docker kill`, which targets PID 1) using `docker exec kill -6`.
      //    This is necessary because glibc's abort() uses tgkill() (thread-targeted)
      //    which under Rosetta 2 / Docker Desktop on Apple Silicon does not reliably
      //    deliver the signal.  Sending via `kill(rippled_pid, SIGABRT)` from
      //    another process bypasses that issue.
      //
      // 2. docker wait  — blocks until the container exits and reports the code.
      //    Exit 134 = 128 + SIGABRT(6), which is what rippled produces on abort().
      //
      // The compose entrypoint override (/bin/sh wrapper without exec) ensures
      // rippled is NOT PID 1.  This is critical: Linux silently drops unhandled
      // signals for PID 1, including SIGABRT.  As a non-PID-1 process rippled
      // receives the external SIGABRT normally and exits 134.
      if (options.noRestart && !options.detach) {
        const { spawn: spawnProc, execSync } = await import('child_process');
        const containerName = `${COMPOSE_PROJECT}-rippled-1`;
        let abortSent = false;

        // Record the timestamp we start watching so we only look at new log lines.
        const watchFrom = new Date().toISOString();

        // Poll docker logs every 500 ms for the crash pattern.
        const pollInterval = setInterval(() => {
          if (abortSent) { clearInterval(pollInterval); return; }
          try {
            const recent = execSync(
              `docker logs --since "${watchFrom}" --tail 50 ${containerName} 2>&1`,
              { timeout: 2000 },
            ).toString();
            if (recent.includes('Logic error:') || recent.includes('Assertion failed:')) {
              abortSent = true;
              clearInterval(pollInterval);
              // Send SIGABRT to rippled's own PID (not PID 1) via docker exec.
              execSync(
                `docker exec ${containerName} sh -c "kill -6 \\$(ps ax | grep /opt/ripple/bin/rippled | grep -v 'sh -c\\|grep\\|ps' | awk '{print \\$1}' | head -1)"`,
                { timeout: 3000, stdio: 'pipe' },
              );
            }
          } catch { /* transient error — keep polling */ }
        }, 500);

        // docker wait blocks until the container exits and echoes the exit code.
        const waiter = spawnProc('docker', ['wait', containerName], {
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        waiter.stdout?.on('data', (data: Buffer) => {
          clearInterval(pollInterval);
          const code = parseInt(data.toString().trim(), 10);
          const note = code === 134 ? ' (SIGABRT — process crashed)' : '';
          logger.log(chalk.red(`\n✗ rippled exited — code ${code}${note}`));
        });
      }
    } catch (err: unknown) {
      dockerSpinner.fail('Failed to start local stack');
      logger.error(err instanceof Error ? err.message : String(err));
      composeDown();
      process.exit(1);
    }
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  const localNetworkConfig = { url: networkUrl, name: networkDisplayName };
  const manager = new NetworkManager(networkName, localNetworkConfig);

  const connectSpinner = ora({
    text: `Connecting to ${chalk.cyan(networkDisplayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
  } catch (err: unknown) {
    connectSpinner.fail('Connection failed');
    logger.error(err instanceof Error ? err.message : String(err));
    if (isLocal) composeDown();
    process.exit(1);
  }

  const serverInfo = await manager.getServerInfo();
  connectSpinner.succeed(`Connected to ${chalk.cyan.bold(networkDisplayName)}`);

  logger.blank();
  logger.section('Network');
  logger.log(`${chalk.dim('Endpoint:')}   ${chalk.white(networkUrl)}`);
  logger.log(
    `${chalk.dim('Ledger:')}     ${chalk.white('#' + serverInfo.ledgerIndex.toLocaleString())}`
  );
  if (serverInfo.buildVersion) {
    logger.log(`${chalk.dim('Version:')}    ${chalk.dim(serverInfo.buildVersion)}`);
  }
  if (isLocal) {
    logger.log(`${chalk.dim('Genesis:')}    ${chalk.dim(GENESIS_ADDRESS)}`);
    logger.log(`${chalk.dim('Faucet:')}     ${chalk.dim('http://localhost:3001')}`);
    const ledgerInterval = options.ledgerInterval ?? 1000;
    if (noConsensus) {
      logger.log(`${chalk.dim('Ledger:')}     ${chalk.dim(`auto-advance every ${ledgerInterval}ms (standalone)`)}`);
    } else {
      logger.log(`${chalk.dim('Ledger:')}     ${chalk.dim('consensus close ~4s (persistent)')}`);
    }
    if (options.debug) {
      logger.log(`${chalk.dim('Logs:')}       ${chalk.dim('debug level — run: xrpl-up logs rippled')}`);
    }
    if (options.noRestart) {
      logger.log(`${chalk.dim('Restart:')}    ${chalk.dim('disabled — container will exit with rippled\'s code')}`);
    }
  }
  logger.blank();

  // ── Fund accounts ──────────────────────────────────────────────────────────
  const config = loadConfig();

  // In persist mode, keep existing accounts — the ledger state is preserved.
  // In ephemeral mode, wipe and re-fund fresh accounts every run.
  if (!persist) store.clear();

  const existingAccounts = store.all();
  const count = options.accountCount ?? (options.fork ? 0 : (config.accounts?.count ?? 10));

  // In persist mode with existing accounts, skip funding and reload from store.
  if (persist && existingAccounts.length > 0) {
    logger.info(
      `Resuming with ${chalk.cyan(String(existingAccounts.length))} persisted accounts  ${chalk.dim('(use xrpl-up reset to start fresh)')}`
    );
    logger.blank();
  }

  const fundLabel = isLocal ? 'local faucet' : 'testnet faucet';
  const shouldFund = !persist || existingAccounts.length === 0;

  const fundSpinner = shouldFund ? ora({
    text: chalk.dim(`Funding account 1/${count} from ${fundLabel}…`),
    color: 'cyan',
    indent: 2,
  }).start() : null;

  const funded: Array<{ wallet: Wallet; balance: number }> = shouldFund ? [] : existingAccounts
    .filter(a => !a.forked)
    .map(a => ({
      wallet: store.toWallet(a)!,
      balance: a.balance,
    }));

  if (shouldFund) {
    const FAUCET_DELAY_MS = 1200; // polite pause between remote faucet calls

    for (let i = 0; i < count; i++) {
      fundSpinner!.text = chalk.dim(`Funding account ${i + 1}/${count} from ${fundLabel}…`);
      try {
        let wallet: Wallet;
        let balance: number;

        if (isLocal) {
          // Call the local faucet HTTP server
          const result = await callFaucet();
          wallet = Wallet.fromSeed(result.seed);
          balance = result.balance;
        } else {
          const result = await manager.client.fundWallet();
          wallet = result.wallet;
          balance = result.balance;
          if (i < count - 1) await sleep(FAUCET_DELAY_MS);
        }

        funded.push({ wallet, balance });
        store.add(wallet, balance);
      } catch (err: unknown) {
        fundSpinner!.fail(`Failed to fund account ${i + 1}`);
        logger.error(err instanceof Error ? err.message : String(err));
        await manager.disconnect();
        if (isLocal) composeDown();
        process.exit(1);
      }
    }

    fundSpinner!.succeed(
      chalk.green(`${count} accounts funded on ${chalk.cyan(networkDisplayName)}`)
    );
    logger.blank();
  }

  // ── Fork mainnet accounts (--fork only) ────────────────────────────────────
  let forkedAccounts: ForkAccount[] = [];

  if (isLocal && options.fork) {
    const forkSource = options.forkSource ?? 'wss://xrplcluster.com';
    const explicitAddresses = (options.forkAccounts ?? '')
      .split(',')
      .map(a => a.trim())
      .filter(Boolean);

    const forkSpinner = ora({ color: 'cyan', indent: 2 }).start();

    try {
      let addresses: string[] = explicitAddresses;
      // Determine which ledger to snapshot balances from:
      //   1. --fork-at-ledger (explicit) always wins
      //   2. When --add-accounts-from-ledger is used, default to N-1 (state before that ledger)
      //   3. Otherwise undefined → latest validated
      let balanceLedger: number | undefined =
        options.forkAtLedger ??
        (options.accountsFromLedger != null ? options.accountsFromLedger - 1 : undefined);

      // Auto-discover accounts from the specified ledger
      if (options.accountsFromLedger != null) {
        forkSpinner.text = `Scanning ledger #${options.accountsFromLedger.toLocaleString()} for active accounts…`;
        const discovered = await fetchActiveAccountsInLedger(forkSource, options.accountsFromLedger);
        // Merge with any explicit addresses, deduplicate
        const merged = new Set([...addresses, ...discovered]);
        addresses = Array.from(merged);
        forkSpinner.text = `Found ${chalk.cyan(String(addresses.length))} account(s)  ${chalk.dim(`(ledger #${options.accountsFromLedger.toLocaleString()})`)} — fetching balances at ledger #${(balanceLedger ?? 0).toLocaleString()}…`;
      } else {
        forkSpinner.text = `Fetching state for ${chalk.cyan(String(addresses.length))} account(s) from ${chalk.dim(forkSource)}…`;
      }

      forkedAccounts = await fetchForkAccounts(forkSource, addresses, balanceLedger);

      if (forkedAccounts.length === 0) {
        forkSpinner.warn('No accounts found — check addresses or ledger index');
      } else {
        await applyForkAccounts(manager.client, forkedAccounts, (done, total) => {
          forkSpinner.text = `Forking accounts ${chalk.cyan(String(done))}/${total}…`;
        });

        const snapshotLedger = forkedAccounts[0]?.ledgerIndex;
        const ledgerLabel = snapshotLedger
          ? chalk.dim(` (state at ledger #${snapshotLedger.toLocaleString()})`)
          : '';
        forkSpinner.succeed(
          `Forked ${chalk.cyan(String(forkedAccounts.length))} account(s) from ${chalk.dim(forkSource)}${ledgerLabel}`
        );

        for (const fa of forkedAccounts) {
          store.addForked(fa.address, fa.xrpBalance);
        }
      }
    } catch (err: unknown) {
      forkSpinner.fail('Failed to fork accounts');
      logger.error(err instanceof Error ? err.message : String(err));
      await manager.disconnect();
      composeDown();
      process.exit(1);
    }

    logger.blank();
  }

  // ── Address → friendly name map (used by transaction log) ─────────────────
  const addressMap = new Map<string, string>();
  for (const [i, { wallet }] of funded.entries()) {
    addressMap.set(wallet.address, `Account #${i}`);
  }
  for (const [i, fa] of forkedAccounts.entries()) {
    addressMap.set(fa.address, `Fork #${i}`);
  }
  function labelAddress(addr: string): string {
    return addressMap.get(addr) ?? addr.slice(0, 8) + '…';
  }

  // ── Warning ────────────────────────────────────────────────────────────────
  console.log(
    chalk.yellow.bold('  WARNING') +
    chalk.yellow(' — These accounts and their private keys are publicly known.')
  );
  console.log(
    chalk.yellow('           Any funds sent to them on Mainnet WILL BE LOST.')
  );
  logger.blank();

  // ── Forked accounts table ──────────────────────────────────────────────────
  if (forkedAccounts.length > 0) {
    const forkSource = options.forkSource ?? 'wss://xrplcluster.com';
    const snapshotLedger = forkedAccounts[0]?.ledgerIndex;
    const scanLedger = options.accountsFromLedger ?? null;
    const ledgerLabel = snapshotLedger
      ? `  ${chalk.dim('state at ledger #' + snapshotLedger.toLocaleString())}` +
        (scanLedger ? chalk.dim(`  (scanned from ledger #${scanLedger.toLocaleString()})`) : '')
      : '';
    logger.section(`Fork  ${chalk.dim(forkSource)}${ledgerLabel}`);

    const forkTable = new Table({
      head: [chalk.cyan('#'), chalk.cyan('Address'), chalk.cyan('Balance'), chalk.cyan('Mainnet Seq')],
      style: { head: [], border: [] },
      chars: TABLE_CHARS,
      colWidths: [4, 38, 16, 14],
    });

    for (const [i, fa] of forkedAccounts.entries()) {
      forkTable.push([
        chalk.dim(String(i)),
        chalk.white(fa.address),
        chalk.green(`${fa.xrpBalance.toLocaleString()} XRP`),
        chalk.dim(fa.sequence.toLocaleString()),
      ]);
    }

    printTable(forkTable.toString());
    logger.blank();
    logger.dim('  Note: forked accounts have no known seed — use your mainnet key to sign.');
    logger.blank();
  }

  // ── Accounts table ─────────────────────────────────────────────────────────
  logger.section('Accounts');

  const printSecrets = !options.noSecrets && !options.detach;

  const table = new Table({
    head: printSecrets
      ? [chalk.cyan('#'), chalk.cyan('Address'), chalk.cyan('Balance'), chalk.cyan('Seed')]
      : [chalk.cyan('#'), chalk.cyan('Address'), chalk.cyan('Balance')],
    style: { head: [], border: [] },
    chars: TABLE_CHARS,
    colWidths: printSecrets ? [4, 38, 13, 34] : [4, 38, 13],
  });

  for (const [i, { wallet, balance }] of funded.entries()) {
    const row: string[] = [
      chalk.dim(String(i)),
      chalk.white(wallet.address),
      chalk.green(`${balance} XRP`),
    ];
    if (printSecrets) row.push(chalk.dim(wallet.seed ?? '—'));
    table.push(row);
  }

  printTable(table.toString());
  logger.blank();

  // ── Private keys (suppressed in --detach / --no-secrets) ──────────────────
  if (printSecrets) {
    logger.section('Private Keys');
    for (const [i, { wallet }] of funded.entries()) {
      logger.log(`${chalk.dim('Account #' + i + ':')} ${chalk.white(wallet.address)}`);
      logger.log(`${chalk.dim('Private Key: ')} ${chalk.dim(wallet.privateKey)}`);
      logger.blank();
    }
  }

  // ── Detach mode (CI/CD) ────────────────────────────────────────────────────
  if (isLocal && options.detach) {
    logger.log(`  ${chalk.green('✔')} Sandbox ready  ${chalk.dim('→')}  ${chalk.cyan(LOCAL_WS_URL)}`);
    if (noConsensus) {
      logger.dim(`  Auto-advancing ledger every ${options.ledgerInterval ?? 1000}ms via faucet server`);
    } else {
      logger.dim(`  Consensus network — ledgers close automatically every ~4s`);
    }
    logger.dim(`  Run ${chalk.white('xrpl-up stop')} to tear down`);
    logger.blank();
    await manager.disconnect();
    return;
  }

  // ── Keep alive ─────────────────────────────────────────────────────────────
  logger.section('Sandbox running');
  if (isLocal) {
    const ledgerInterval = options.ledgerInterval ?? 1000;
    const advanceMsg = options.noAutoAdvance
      ? 'auto-advance disabled'
      : `auto-advancing ledger every ${ledgerInterval}ms`;
    logger.dim(`Local rippled  ·  ${advanceMsg}  ·  Press Ctrl+C to stop`);
    logger.dim(`Logs: xrpl-up logs | xrpl-up logs rippled | xrpl-up logs faucet`);
  } else {
    logger.dim('Subscribed to ledger stream  ·  Press Ctrl+C to stop');
  }
  logger.blank();

  // ── Auto-ledger-advance (standalone local mode only) ────────────────────────
  let advanceHandle: ReturnType<typeof setTimeout> | undefined;

  if (isLocal && !noConsensus && !options.noAutoAdvance) {
    // Consensus mode: ledgers close automatically via consensus.
    // Subscribe to transactions for live display (no ledger_accept needed).
    await manager.subscribeToTransactions((tx) => {
      const t       = (tx.transaction ?? tx) as Record<string, unknown>;
      const meta    = tx.meta as Record<string, unknown> | undefined;
      const result  = (meta?.TransactionResult as string) ?? 'unknown';
      const ok      = result === 'tesSUCCESS';
      const icon    = ok ? chalk.green('✓') : chalk.red('✗');
      const type    = chalk.white(String(t.TransactionType ?? '').padEnd(18));
      const from    = chalk.dim(labelAddress(String(t.Account ?? '')));
      const to      = t.Destination
        ? chalk.dim(' → ') + chalk.dim(labelAddress(String(t.Destination)))
        : '';
      const fee     = chalk.dim(`fee: ${t.Fee ?? '?'} drops`);
      const outcome = ok ? '' : chalk.red(`  ${tecMessage(result)}`);
      console.log(`\n  ${icon} ${type} ${from}${to}  ${fee}${outcome}`);
    });
  } else if (isLocal && !options.noAutoAdvance) {
    const ledgerInterval = options.ledgerInterval ?? 1000;

    const scheduleAdvance = () => {
      advanceHandle = setTimeout(async () => {
        try {
          const res = await (manager.client as any).request({ command: 'ledger_accept' });
          const idx = (res.result.ledger_current_index as number) ?? 0;
          process.stdout.write(
            `\r  ${chalk.dim('Ledger')} ${chalk.cyan('#' + idx.toLocaleString())}` +
            `  ${chalk.dim('·')}  ${chalk.dim('auto-advance')}` +
            `  ${chalk.dim('·')}  ${chalk.dim(new Date().toLocaleTimeString())}` +
            '          '
          );
        } catch { /* swallow — node may be shutting down */ }
        scheduleAdvance();
      }, ledgerInterval);
    };

    scheduleAdvance();

    // ── Live transaction log ─────────────────────────────────────────────────
    await manager.subscribeToTransactions((tx) => {
      const t       = (tx.transaction ?? tx) as Record<string, unknown>;
      const meta    = tx.meta as Record<string, unknown> | undefined;
      const result  = (meta?.TransactionResult as string) ?? 'unknown';
      const ok      = result === 'tesSUCCESS';
      const icon    = ok ? chalk.green('✓') : chalk.red('✗');
      const type    = chalk.white(String(t.TransactionType ?? '').padEnd(18));
      const from    = chalk.dim(labelAddress(String(t.Account ?? '')));
      const to      = t.Destination
        ? chalk.dim(' → ') + chalk.dim(labelAddress(String(t.Destination)))
        : '';
      const fee     = chalk.dim(`fee: ${t.Fee ?? '?'} drops`);
      const outcome = ok ? '' : chalk.red(`  ${tecMessage(result)}`);
      console.log(`\n  ${icon} ${type} ${from}${to}  ${fee}${outcome}`);
    });
  } else {
    // Remote networks: just display ledger closes
    await manager.subscribeToLedger((ledgerIndex, txnCount) => {
      process.stdout.write(
        `\r  ${chalk.dim('Ledger')} ${chalk.cyan('#' + ledgerIndex.toLocaleString())}` +
          `  ${chalk.dim('·')}  ${chalk.dim('Txns:')} ${chalk.white(String(txnCount))}` +
          `  ${chalk.dim('·')}  ${chalk.dim(new Date().toLocaleTimeString())}` +
          '          '
      );
    });
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.on('SIGINT', async () => {
    console.log('\n');
    if (advanceHandle) clearTimeout(advanceHandle);
    logger.info('Shutting down sandbox…');
    await manager.disconnect();
    if (isLocal) {
      logger.info('Stopping local stack…');
      composeDown();
    }
    process.exit(0);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
