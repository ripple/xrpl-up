/**
 * update-genesis-amendments.ts
 *
 * Updates the [amendments] genesis list in src/core/compose.ts by diffing
 * the current set of mainnet-enabled amendments against what the local rippled
 * binary supports and what is already listed.
 *
 * Logic:
 *   new = mainnet_enabled ∩ local_supported − already_listed
 *
 * The script is meant to be run from the GitHub Actions cron workflow
 * (sync-amendments.yml) after a local rippled node has been started.
 * A human reviews and merges the resulting PR — nothing auto-merges.
 *
 * Usage:
 *   tsx scripts/update-genesis-amendments.ts [--from mainnet|testnet|<wss://...>] [--dry-run]
 *
 * Environment:
 *   MAINNET_WS   Override the default mainnet WebSocket URL
 *   LOCAL_WS     Override the default local WebSocket URL
 */

import { Client } from 'xrpl';
import fs from 'node:fs';
import path from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────

const NAMED_NETWORKS: Record<string, string> = {
  mainnet: 'wss://xrplcluster.com',
  testnet: 'wss://s.altnet.rippletest.net:51233',
  devnet:  'wss://s.devnet.rippletest.net:51233',
};

const args    = process.argv.slice(2);
const fromArg = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'mainnet';
const dryRun  = args.includes('--dry-run');

const SOURCE_WS = process.env.MAINNET_WS ?? NAMED_NETWORKS[fromArg] ?? fromArg;
const LOCAL_WS  = process.env.LOCAL_WS   ?? 'ws://localhost:6006';

if (!SOURCE_WS.startsWith('ws')) {
  console.error(`Unknown source: "${fromArg}". Use mainnet | testnet | devnet | <wss://...>`);
  process.exit(1);
}

// compose.ts lives at src/core/compose.ts relative to the project root.
// This script lives at scripts/, so go up one level.
const COMPOSE_TS = path.resolve(process.cwd(), 'src/core/compose.ts');

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeatureInfo {
  hash: string;
  name: string;
  enabled: boolean;
  supported: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchFeatures(url: string): Promise<FeatureInfo[]> {
  const client = new Client(url);
  await client.connect();
  try {
    const resp = await client.request({ command: 'feature' } as any);
    const features = (resp.result as any).features as Record<string, {
      name?: string;
      enabled: boolean;
      supported: boolean;
    }>;
    return Object.entries(features).map(([hash, info]) => ({
      hash,
      name: info.name ?? hash,
      enabled: info.enabled,
      supported: info.supported,
    }));
  } finally {
    await client.disconnect();
  }
}

/**
 * Extracts all 64-char hex hashes from the [amendments] section of compose.ts.
 * Hashes are uppercase (ABCDEF), 64 chars, followed by a space then the name.
 */
function extractListedHashes(src: string): Set<string> {
  const match = src.match(/\[amendments\]([\s\S]*?)^# sync:end$/m);
  if (!match) throw new Error(
    'Could not find [amendments] … # sync:end block in compose.ts.\n' +
    'Add "# sync:end" as the last line of the [amendments] section.'
  );
  const hashes = new Set<string>();
  for (const m of match[1].matchAll(/^([0-9A-F]{64})\s/gm)) {
    hashes.add(m[1]);
  }
  return hashes;
}

/**
 * Inserts new amendment lines into compose.ts just before the closing
 * backtick of the generateRippledConfig template literal.
 */
function appendToComposeTx(
  src: string,
  newEntries: Array<{ hash: string; name: string }>,
  sourceUrl: string,
): string {
  const SENTINEL = '# sync:end';
  const idx = src.indexOf(SENTINEL);
  if (idx === -1) throw new Error(
    'Could not find "# sync:end" sentinel in compose.ts.\n' +
    'Add "# sync:end" as the last line of the [amendments] section.'
  );

  const date = new Date().toISOString().slice(0, 10);
  const comment = `# Amendments synced on ${date} (source: ${sourceUrl}).`;
  const lines = [comment, ...newEntries.map(e => `${e.hash} ${e.name}`)].join('\n');

  // Insert new lines before the sentinel, keeping the sentinel in place
  return src.slice(0, idx) + lines + '\n' + src.slice(idx);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`[update-genesis-amendments] Source:     ${SOURCE_WS}`);
console.log(`[update-genesis-amendments] Local node: ${LOCAL_WS}`);
console.log(`[update-genesis-amendments] Compose:    ${COMPOSE_TS}`);
if (dryRun) console.log('[update-genesis-amendments] Mode:       dry-run');
console.log('');

// 1. Query both endpoints in parallel
console.log('[update-genesis-amendments] Querying feature RPC on both endpoints…');
const [sourceFeatures, localFeatures] = await Promise.all([
  fetchFeatures(SOURCE_WS),
  fetchFeatures(LOCAL_WS),
]);

const sourceEnabled  = new Map(sourceFeatures.filter(f => f.enabled).map(f => [f.hash, f]));
const localSupported = new Set(localFeatures.filter(f => f.supported).map(f => f.hash));

console.log(`[update-genesis-amendments] Source enabled:   ${sourceEnabled.size}`);
console.log(`[update-genesis-amendments] Local supported:  ${localSupported.size}`);

// 2. Parse compose.ts
const src = fs.readFileSync(COMPOSE_TS, 'utf-8');
const listed = extractListedHashes(src);
console.log(`[update-genesis-amendments] Already listed:   ${listed.size}`);

// 3. Diff
// new = source_enabled ∩ local_supported − already_listed
const toAdd: Array<{ hash: string; name: string }> = [];
const unsupported: Array<{ hash: string; name: string }> = [];

for (const [hash, info] of sourceEnabled) {
  if (listed.has(hash)) continue;               // already in genesis list
  if (!localSupported.has(hash)) {
    unsupported.push({ hash, name: info.name }); // binary too old
    continue;
  }
  toAdd.push({ hash, name: info.name });
}

// Sort by name for stable diffs
toAdd.sort((a, b) => a.name.localeCompare(b.name));

// 4. Report
if (unsupported.length > 0) {
  console.log(`\n── Skipped (not supported by local rippled binary) [${unsupported.length}] ──`);
  for (const { hash, name } of unsupported) {
    console.log(`  ✗  ${name.padEnd(36)} ${hash}`);
  }
  console.log('  → Upgrade the Docker image to pick these up on the next run.');
}

if (toAdd.length === 0) {
  console.log('\n[update-genesis-amendments] Nothing to add — compose.ts is up to date.');
  process.exit(0);
}

console.log(`\n── New amendments to add [${toAdd.length}] ──────────────────────────────────`);
for (const { hash, name } of toAdd) {
  console.log(`  +  ${name.padEnd(36)} ${hash}`);
}

// 5. Apply (or skip on dry-run)
if (dryRun) {
  console.log('\n[update-genesis-amendments] --dry-run: no changes written.');
  process.exit(0);
}

const updated = appendToComposeTx(src, toAdd, SOURCE_WS);
fs.writeFileSync(COMPOSE_TS, updated, 'utf-8');

console.log(`\n[update-genesis-amendments] compose.ts updated (+${toAdd.length} amendment(s)).`);
