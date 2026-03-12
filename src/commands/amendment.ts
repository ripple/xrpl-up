import chalk from 'chalk';
import ora from 'ora';
import { Client } from 'xrpl';
import { loadConfig, resolveNetwork, DEFAULT_CONFIG } from '../core/config';
import { LOCAL_WS_URL } from '../core/compose';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AmendmentInfo {
  hash: string;
  name: string;
  enabled: boolean;
  supported: boolean;
  vetoed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveSourceUrl(from: string): string {
  const config = loadConfig();
  // Allow named networks from config (mainnet, testnet, devnet, custom)
  try {
    const { config: netCfg } = resolveNetwork(config, from);
    return netCfg.url;
  } catch {
    throw new Error(
      `Unknown source network: "${from}". ` +
      `Available: ${Object.keys(DEFAULT_CONFIG.networks).join(', ')}`
    );
  }
}

async function fetchFeatures(url: string): Promise<AmendmentInfo[]> {
  const client = new Client(url);
  await client.connect();
  try {
    const resp = await client.request({ command: 'feature' } as any);
    const features = (resp.result as any).features as Record<string, {
      name?: string;
      enabled: boolean;
      supported: boolean;
      vetoed: boolean;
    }>;
    return Object.entries(features).map(([hash, info]) => ({
      hash,
      name: info.name ?? hash.slice(0, 20) + '…',
      enabled:   info.enabled,
      supported: info.supported,
      vetoed:    info.vetoed,
    }));
  } finally {
    await client.disconnect();
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ── amendment list ────────────────────────────────────────────────────────────

export interface AmendmentListOptions {
  local?: boolean;
  network?: string;
  diff?: string;         // compare against this network
  disabled?: boolean;    // show only disabled
}

export async function amendmentListCommand(options: AmendmentListOptions): Promise<void> {
  const targetUrl = options.local
    ? LOCAL_WS_URL
    : resolveNetwork(loadConfig(), options.network).config.url;

  const targetLabel = options.local ? 'local' : (options.network ?? loadConfig().defaultNetwork);

  const spinner = ora({
    text: `Fetching amendments from ${chalk.cyan(targetLabel)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    const amendments = await fetchFeatures(targetUrl);

    let diffMap: Map<string, AmendmentInfo> | null = null;
    if (options.diff) {
      spinner.text = `Fetching amendments from ${chalk.cyan(options.diff)} for comparison…`;
      const diffAmendments = await fetchFeatures(resolveSourceUrl(options.diff));
      diffMap = new Map(diffAmendments.map(a => [a.hash, a]));
    }

    spinner.stop();

    const filtered = options.disabled
      ? amendments.filter(a => !a.enabled)
      : amendments;

    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));

    const NAME_W = 34;
    const HASH_W = 18;

    if (diffMap) {
      // Side-by-side diff view
      logger.log(
        `\n  ${chalk.bold(pad('Name', NAME_W))}  ${chalk.bold(pad('Hash', HASH_W))}  ` +
        `${chalk.bold(pad(targetLabel, 8))}  ${chalk.bold(options.diff!)}`
      );
      logger.log('  ' + '─'.repeat(NAME_W + HASH_W + 26));

      for (const a of sorted) {
        const localMark  = a.enabled ? chalk.green('✔') : chalk.dim('✗');
        const diffInfo   = diffMap.get(a.hash);
        const diffMark   = diffInfo?.enabled ? chalk.green('✔') : chalk.dim('✗');
        const nameStr    = a.enabled ? chalk.white(pad(a.name, NAME_W)) : chalk.dim(pad(a.name, NAME_W));
        const gap        = a.enabled !== diffInfo?.enabled ? chalk.yellow(' ◄ gap') : '';
        logger.log(`  ${nameStr}  ${chalk.dim(pad(a.hash.slice(0, 16) + '…', HASH_W))}  ${pad(localMark, 8)}  ${diffMark}${gap}`);
      }

      // Amendments on diff network not in local at all
      for (const [hash, info] of diffMap.entries()) {
        if (!amendments.find(a => a.hash === hash) && info.enabled) {
          logger.log(
            `  ${chalk.red(pad(info.name, NAME_W))}  ${chalk.dim(pad(hash.slice(0, 16) + '…', HASH_W))}  ` +
            `${chalk.dim('✗ (n/s)')}  ${chalk.green('✔')}${chalk.yellow(' ◄ unsupported by local build')}`
          );
        }
      }
    } else {
      // Simple list
      logger.log(
        `\n  ${chalk.bold(pad('Name', NAME_W))}  ${chalk.bold(pad('Hash', HASH_W))}  ` +
        `${chalk.bold('Enabled')}  ${chalk.bold('Supported')}`
      );
      logger.log('  ' + '─'.repeat(NAME_W + HASH_W + 20));

      for (const a of sorted) {
        const enabledMark   = a.enabled   ? chalk.green('✔') : chalk.dim('✗');
        const supportedMark = a.supported ? chalk.green('✔') : chalk.dim('✗');
        const nameStr       = a.enabled   ? chalk.white(pad(a.name, NAME_W)) : chalk.dim(pad(a.name, NAME_W));
        logger.log(`  ${nameStr}  ${chalk.dim(pad(a.hash.slice(0, 16) + '…', HASH_W))}  ${pad(enabledMark, 9)}  ${supportedMark}`);
      }
    }

    logger.blank();
    const enabled   = amendments.filter(a => a.enabled).length;
    const supported = amendments.filter(a => a.supported && !a.enabled).length;
    logger.dim(`  ${enabled} enabled  ·  ${supported} supported but not enabled  ·  ${amendments.length} total known`);
    logger.blank();
  } catch (err: unknown) {
    spinner.fail('Failed to fetch amendments');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── amendment info ────────────────────────────────────────────────────────────

export interface AmendmentInfoOptions {
  local?: boolean;
  network?: string;
}

export async function amendmentInfoCommand(nameOrHash: string, options: AmendmentInfoOptions): Promise<void> {
  const targetUrl = options.local
    ? LOCAL_WS_URL
    : resolveNetwork(loadConfig(), options.network).config.url;

  const targetLabel = options.local ? 'local' : (options.network ?? loadConfig().defaultNetwork);

  const spinner = ora({
    text: `Looking up amendment on ${chalk.cyan(targetLabel)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    const amendments = await fetchFeatures(targetUrl);

    const query = nameOrHash.toLowerCase();
    const found = amendments.find(
      a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query)
    );

    if (!found) {
      spinner.fail(`Amendment not found: ${nameOrHash}`);
      logger.dim(`  Run: xrpl-up amendment list${options.local ? ' --local' : ''} to see all known amendments.`);
      process.exit(1);
    }

    spinner.succeed(chalk.green(`Amendment: ${found.name}`));
    logger.blank();

    const W = 12;
    const row = (k: string, v: string) => logger.log(`  ${chalk.dim(pad(k + ':', W))} ${v}`);

    row('Name',      chalk.white(found.name));
    row('Hash',      chalk.dim(found.hash));
    row('Enabled',   found.enabled   ? chalk.green('✔ yes') : chalk.dim('✗ no'));
    row('Supported', found.supported ? chalk.green('✔ yes') : chalk.red('✗ no (rippled image too old)'));
    row('Vetoed',    found.vetoed    ? chalk.red('✔ yes') : chalk.dim('no'));
    logger.blank();

    if (!found.enabled && found.supported) {
      logger.dim(`  Enable with: xrpl-up amendment enable ${found.name} --local`);
      logger.blank();
    }
    if (!found.supported) {
      logger.dim('  Upgrade the local rippled image to support this amendment:');
      logger.dim('    Edit the rippled-image field in your xrpl-up config (xrpl-up config export to view path)');
      logger.dim('    xrpl-up reset --local && xrpl-up node');
      logger.blank();
    }
  } catch (err: unknown) {
    spinner.fail('Failed to look up amendment');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── amendment enable / disable ────────────────────────────────────────────────

export interface AmendmentToggleOptions {
  local?: boolean;
}

export async function amendmentEnableCommand(nameOrHash: string, options: AmendmentToggleOptions): Promise<void> {
  if (!options.local) {
    logger.error('amendment enable only works with --local (cannot admin-RPC a public node).');
    process.exit(1);
  }
  await toggleAmendment(nameOrHash, false /* vetoed = false → accept */);
}

export async function amendmentDisableCommand(nameOrHash: string, options: AmendmentToggleOptions): Promise<void> {
  if (!options.local) {
    logger.error('amendment disable only works with --local (cannot admin-RPC a public node).');
    process.exit(1);
  }
  await toggleAmendment(nameOrHash, true /* vetoed = true → reject */);
}

async function toggleAmendment(nameOrHash: string, veto: boolean): Promise<void> {
  const verb = veto ? 'Disabling' : 'Enabling';
  const done = veto ? 'disabled (vetoed)' : 'enabled';

  const spinner = ora({
    text: `${verb} amendment ${chalk.cyan(nameOrHash)} on local sandbox…`,
    color: 'cyan',
    indent: 2,
  }).start();

  const client = new Client(LOCAL_WS_URL);
  try {
    await client.connect();

    // Resolve name → hash
    const amendments = await fetchFeatures(LOCAL_WS_URL);
    const query = nameOrHash.toLowerCase();
    const found = amendments.find(
      a => a.name.toLowerCase() === query || a.hash.toLowerCase() === query || a.hash.toLowerCase().startsWith(query)
    );

    if (!found) {
      spinner.fail(`Amendment not found: ${nameOrHash}`);
      logger.dim('  Run: xrpl-up amendment list --local to see available amendments.');
      await client.disconnect();
      process.exit(1);
    }

    if (!found.supported) {
      spinner.fail(`Amendment not supported by local rippled build: ${found.name}`);
      logger.dim('  Upgrade the local rippled image to include this amendment.');
      await client.disconnect();
      process.exit(1);
    }

    if (!veto && found.enabled) {
      spinner.succeed(chalk.green(`Already enabled: ${found.name}`));
      await client.disconnect();
      return;
    }

    // Submit feature accept/reject via admin RPC
    await (client as any).connection.request({
      command: 'feature',
      feature: found.hash,
      vetoed: veto,
    });

    // Amendments go through rippled's voting process even in standalone mode.
    // A flag ledger occurs every 256 ledger closes; only then does the
    // amendment transition from "majority" to "enabled". Poll until enabled
    // (or up to ~FLAG_LEDGER_COUNT+1 ledger closes before giving up).
    const FLAG_LEDGER = 256;
    const POLL_TIMEOUT_MS = (FLAG_LEDGER + 10) * 2000; // ~10 min ceiling
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let activated = false;

    spinner.text = `Waiting for amendment to activate (may take up to ~${FLAG_LEDGER} ledger closes)…`;

    while (Date.now() < deadline) {
      await waitForLedgerClose(client, 3000);
      const current = await fetchFeatures(LOCAL_WS_URL);
      const status = current.find(a => a.hash === found.hash);
      if (!veto && status?.enabled) { activated = true; break; }
      if (veto  && !status?.enabled) { activated = true; break; }
    }

    if (activated) {
      spinner.succeed(chalk.green(`Amendment ${done}: ${found.name}`));
      logger.dim(`  Hash: ${found.hash}`);
    } else {
      spinner.warn(chalk.yellow(`Amendment vote cast but not yet active: ${found.name}`));
      logger.dim(`  The amendment is queued and will activate after the next flag ledger.`);
      logger.dim(`  Tip: for instant activation use genesis config then xrpl-up reset.`);
    }
    logger.blank();
  } catch (err: unknown) {
    await client.disconnect().catch(() => {});
    spinner.fail(`Failed to ${veto ? 'disable' : 'enable'} amendment`);
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  await client.disconnect().catch(() => {});
}

// ── amendment sync ────────────────────────────────────────────────────────────

export interface AmendmentSyncOptions {
  from: string;
  local?: boolean;
  dryRun?: boolean;
}

export async function amendmentSyncCommand(options: AmendmentSyncOptions): Promise<void> {
  if (!options.local) {
    logger.error('amendment sync only works with --local (cannot admin-RPC a public node).');
    process.exit(1);
  }

  const sourceUrl   = resolveSourceUrl(options.from);
  const sourceLabel = options.from;

  const spinner = ora({
    text: `Fetching amendments from ${chalk.cyan(sourceLabel)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  const client = new Client(LOCAL_WS_URL);

  try {
    // 1. Fetch both networks in parallel
    const [sourceAmendments, localAmendments] = await Promise.all([
      fetchFeatures(sourceUrl),
      (async () => {
        await client.connect();
        return fetchFeatures(LOCAL_WS_URL);
      })(),
    ]);

    // 2. Diff
    const localMap  = new Map(localAmendments.map(a => [a.hash, a]));

    const toEnable:    AmendmentInfo[] = [];
    const alreadyOn:   AmendmentInfo[] = [];
    const unsupported: AmendmentInfo[] = [];

    for (const a of sourceAmendments) {
      if (!a.enabled) continue;           // not active on source — skip
      const local = localMap.get(a.hash);
      if (!local)          { unsupported.push(a); continue; }   // image too old
      if (local.enabled)   { alreadyOn.push(a);   continue; }   // already on
      toEnable.push(a);
    }

    spinner.stop();

    // 3. Report diff
    const NAME_W = 34;

    if (alreadyOn.length > 0) {
      logger.log(chalk.dim(`\n  ── Already enabled (${alreadyOn.length}) ─────────────────────────────────────`));
      for (const a of alreadyOn.sort((x, y) => x.name.localeCompare(y.name))) {
        logger.log(`  ${chalk.green('✔')}  ${chalk.dim(pad(a.name, NAME_W))} ${chalk.dim(a.hash.slice(0, 16) + '…')}`);
      }
    }

    if (toEnable.length > 0) {
      logger.log(chalk.cyan(`\n  ── To enable from ${sourceLabel} (${toEnable.length}) ${'─'.repeat(Math.max(0, 38 - sourceLabel.length))}`));
      for (const a of toEnable.sort((x, y) => x.name.localeCompare(y.name))) {
        logger.log(`  ${chalk.yellow('+')}  ${pad(a.name, NAME_W)} ${chalk.dim(a.hash.slice(0, 16) + '…')}`);
      }
    }

    if (unsupported.length > 0) {
      logger.log(chalk.dim(`\n  ── Not supported by local rippled build — skipped (${unsupported.length}) ──`));
      for (const a of unsupported.sort((x, y) => x.name.localeCompare(y.name))) {
        logger.log(`  ${chalk.red('✗')}  ${chalk.dim(pad(a.name, NAME_W))} ${chalk.dim(a.hash.slice(0, 16) + '…')}`);
      }
      logger.blank();
      logger.dim('  To include unsupported amendments, upgrade the rippled image:');
      logger.dim('    Edit the rippled-image field in your xrpl-up config (xrpl-up config export to view path)');
      logger.dim('    xrpl-up reset --local && xrpl-up node');
    }

    logger.blank();

    if (toEnable.length === 0) {
      logger.log(chalk.green(`  ✔ Local sandbox already matches ${sourceLabel}. Nothing to do.`));
      logger.blank();
      await client.disconnect();
      return;
    }

    if (options.dryRun) {
      logger.dim(`  [dry-run] ${toEnable.length} amendment(s) would be enabled. Re-run without --dry-run to apply.`);
      logger.blank();
      await client.disconnect();
      return;
    }

    // 4. Enable each amendment
    const applySpinner = ora({
      text: `Enabling ${toEnable.length} amendment(s)…`,
      color: 'cyan',
      indent: 2,
    }).start();

    for (const a of toEnable) {
      await (client as any).connection.request({
        command: 'feature',
        feature: a.hash,
        vetoed: false,
      });
      applySpinner.text = `Enabled: ${a.name}`;
    }

    // 5. Poll until all amendments activate (flag ledger may take up to 256 closes)
    const FLAG_LEDGER = 256;
    const POLL_TIMEOUT_MS = (FLAG_LEDGER + 10) * 2000; // ~10 min ceiling
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const targetHashes = new Set(toEnable.map(a => a.hash));

    applySpinner.text = `Waiting for amendments to activate (may take up to ~${FLAG_LEDGER} ledger closes)…`;

    let verifiedMap = new Map<string, AmendmentInfo>();
    while (Date.now() < deadline) {
      await waitForLedgerClose(client, 3000);
      const current = await fetchFeatures(LOCAL_WS_URL);
      verifiedMap = new Map(current.map(a => [a.hash, a]));
      if ([...targetHashes].every(h => verifiedMap.get(h)?.enabled)) break;
    }

    // 6. Report
    const failed = toEnable.filter(a => !verifiedMap.get(a.hash)?.enabled);

    if (failed.length > 0) {
      applySpinner.warn(chalk.yellow(`${toEnable.length - failed.length} activated, ${failed.length} vote(s) cast but not yet active:`));
      for (const a of failed) logger.log(`    ${chalk.yellow('~')} ${a.name}`);
      logger.dim('  Tip: for instant activation use the genesis config then xrpl-up reset --local.');
    } else {
      applySpinner.succeed(
        chalk.green(`${toEnable.length} amendment(s) enabled. Local sandbox now matches ${sourceLabel}.`)
      );
      if (unsupported.length > 0) {
        logger.dim(`  ⚠  ${unsupported.length} amendment(s) skipped (not supported by local rippled build).`);
      }
    }

    logger.blank();
  } catch (err: unknown) {
    await client.disconnect().catch(() => {});
    spinner.fail('Sync failed');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  await client.disconnect().catch(() => {});
}

// ── Internal: wait for next ledger close ──────────────────────────────────────

function waitForLedgerClose(client: Client, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    client.request({ command: 'subscribe', streams: ['ledger'] } as any)
      .then(() => {
        client.once('ledgerClosed' as any, () => {
          clearTimeout(timer);
          resolve();
        });
      })
      .catch(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}
