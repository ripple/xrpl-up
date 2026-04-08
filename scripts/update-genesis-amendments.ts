#!/usr/bin/env npx tsx
/**
 * update-genesis-amendments.ts
 *
 * Queries mainnet for all enabled amendments, queries the local rippled for
 * supported amendments, and appends any new (enabled on mainnet AND supported
 * locally) amendments to the [amendments] block in src/core/compose.ts.
 *
 * Environment variables:
 *   MAINNET_WS  — mainnet WebSocket URL  (default: wss://xrplcluster.com)
 *   LOCAL_WS    — local rippled URL       (default: ws://localhost:6006)
 *
 * Exit codes:
 *   0 — success (changes may or may not have been made; git diff decides)
 *   1 — fatal error
 */

import { Client } from 'xrpl';
import * as fs from 'fs';
import * as path from 'path';

const MAINNET_WS = process.env.MAINNET_WS ?? 'wss://xrplcluster.com';
const LOCAL_WS   = process.env.LOCAL_WS   ?? 'ws://localhost:6006';
const COMPOSE_TS = path.resolve(__dirname, '../src/core/compose.ts');

interface FeatureInfo {
  name?: string;
  enabled: boolean;
  supported: boolean;
}

async function fetchFeatures(url: string): Promise<Record<string, FeatureInfo>> {
  const client = new Client(url, { timeout: 60_000 });
  await client.connect();
  try {
    const resp = await client.request({ command: 'feature' } as any);
    return (resp.result as any).features as Record<string, FeatureInfo>;
  } finally {
    await client.disconnect();
  }
}

async function main() {
  console.log(`Fetching amendments from mainnet (${MAINNET_WS})...`);
  const mainnetFeatures = await fetchFeatures(MAINNET_WS);

  console.log(`Fetching amendments from local rippled (${LOCAL_WS})...`);
  const localFeatures = await fetchFeatures(LOCAL_WS);

  // Amendments enabled on mainnet
  const enabledOnMainnet = Object.entries(mainnetFeatures)
    .filter(([, info]) => info.enabled)
    .map(([hash, info]) => ({ hash, name: info.name ?? hash }));

  console.log(`Mainnet: ${enabledOnMainnet.length} enabled amendments`);

  // Read existing compose.ts and extract current hashes
  const composeSrc = fs.readFileSync(COMPOSE_TS, 'utf-8');
  const existingHashes = new Set<string>();
  for (const match of composeSrc.matchAll(/^([0-9A-F]{64})\s+\S+/gm)) {
    existingHashes.add(match[1]);
  }
  console.log(`compose.ts: ${existingHashes.size} existing amendment entries`);

  // Find new amendments: enabled on mainnet, supported by local, not already listed
  const newAmendments: { hash: string; name: string }[] = [];
  const unsupported: string[] = [];

  for (const { hash, name } of enabledOnMainnet) {
    if (existingHashes.has(hash)) continue;
    const local = localFeatures[hash];
    if (local?.supported) {
      newAmendments.push({ hash, name });
    } else {
      unsupported.push(`${name} (${hash.slice(0, 12)}...)`);
    }
  }

  if (unsupported.length > 0) {
    console.log(`\nSkipped ${unsupported.length} amendments (enabled on mainnet but not supported by local rippled):`);
    for (const s of unsupported) console.log(`  - ${s}`);
  }

  if (newAmendments.length === 0) {
    console.log('\nNo new amendments to add. compose.ts is up to date.');
    return;
  }

  // Sort by name for readability
  newAmendments.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\nAdding ${newAmendments.length} new amendments:`);
  for (const { hash, name } of newAmendments) {
    console.log(`  + ${hash} ${name}`);
  }

  // Insert new entries before the "# sync:end" marker
  const newLines = newAmendments.map(({ hash, name }) => `${hash} ${name}`).join('\n');
  const updated = composeSrc.replace('# sync:end', `${newLines}\n# sync:end`);

  fs.writeFileSync(COMPOSE_TS, updated, 'utf-8');
  console.log(`\nWrote ${newAmendments.length} new entries to ${COMPOSE_TS}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
