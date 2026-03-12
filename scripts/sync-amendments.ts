/**
 * sync-amendments.ts
 *
 * Fetches all amendments enabled on mainnet (or any source network) and
 * force-enables them in the local rippled sandbox.
 *
 * Usage:
 *   xrpl-up run scripts/sync-amendments.ts --network local
 *   xrpl-up run scripts/sync-amendments.ts --network local -- --from testnet
 *   xrpl-up run scripts/sync-amendments.ts --network local -- --dry-run
 */

import { Client } from 'xrpl';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SOURCE_WS: Record<string, string> = {
  mainnet: 'wss://xrplcluster.com',
  testnet: 'wss://s.altnet.rippletest.net:51233',
  devnet:  'wss://s.devnet.rippletest.net:51233',
};

const LOCAL_WS = 'ws://localhost:6006';

const args   = process.argv.slice(2);
const from   = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'mainnet';
const dryRun = args.includes('--dry-run');

if (!SOURCE_WS[from]) {
  console.error(`Unknown source network: "${from}". Use mainnet | testnet | devnet`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const source = new Client(SOURCE_WS[from]);
const local  = new Client(LOCAL_WS);

await source.connect();
await local.connect();

console.log(`\nFetching amendments from ${from}...`);
const [sourceResp, localResp] = await Promise.all([
  source.request({ command: 'feature' }),
  local.request({ command: 'feature' }),
]);

await source.disconnect();

const sourceFeatures = sourceResp.result.features as Record<string, {
  name?: string; enabled: boolean; supported: boolean; vetoed: boolean;
}>;
const localFeatures = localResp.result.features as Record<string, {
  name?: string; enabled: boolean; supported: boolean; vetoed: boolean;
}>;

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const toEnable:     Array<{ hash: string; name: string }> = [];
const alreadyOn:    Array<{ hash: string; name: string }> = [];
const unsupported:  Array<{ hash: string; name: string }> = [];
const notOnSource:  Array<{ hash: string; name: string }> = [];

for (const [hash, info] of Object.entries(sourceFeatures)) {
  const label = info.name ?? hash.slice(0, 16) + '...';
  if (!info.enabled) continue; // not active on source network — skip

  const localInfo = localFeatures[hash];
  if (!localInfo) {
    unsupported.push({ hash, name: label });  // rippled image doesn't know this amendment
  } else if (localInfo.enabled) {
    alreadyOn.push({ hash, name: label });
  } else {
    toEnable.push({ hash, name: label });
  }
}

// Amendments enabled locally but NOT on the source network (informational only)
for (const [hash, info] of Object.entries(localFeatures)) {
  if (!info.enabled) continue;
  if (!sourceFeatures[hash]?.enabled) {
    notOnSource.push({ hash, name: info.name ?? hash.slice(0, 16) + '...' });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pad = (s: string, n = 30) => s.slice(0, n).padEnd(n);

console.log(`\n── Already enabled locally (${alreadyOn.length}) ─────────────────────────────`);
for (const { name, hash } of alreadyOn) {
  console.log(`  ✔  ${pad(name)} ${hash}`);
}

if (toEnable.length > 0) {
  console.log(`\n── To enable from ${from} (${toEnable.length}) ──────────────────────────────`);
  for (const { name, hash } of toEnable) {
    console.log(`  +  ${pad(name)} ${hash}`);
  }
}

if (unsupported.length > 0) {
  console.log(`\n── Not supported by local rippled build — skipped (${unsupported.length}) ───`);
  for (const { name, hash } of unsupported) {
    console.log(`  ✗  ${pad(name)} ${hash}`);
  }
  console.log(`\n  Upgrade the local image to include these:`);
  console.log(`    xrpl-up config set rippled-image rippleci/rippled:latest`);
  console.log(`    xrpl-up reset --local && xrpl-up node`);
}

if (notOnSource.length > 0) {
  console.log(`\n── Enabled locally but NOT on ${from} (${notOnSource.length}) ────────────`);
  for (const { name, hash } of notOnSource) {
    console.log(`  ~  ${pad(name)} ${hash}`);
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

if (toEnable.length === 0) {
  console.log(`\n✔ Local sandbox already matches ${from}. Nothing to do.\n`);
  await local.disconnect();
  process.exit(0);
}

if (dryRun) {
  console.log(`\n[dry-run] ${toEnable.length} amendments would be enabled. Re-run without --dry-run to apply.\n`);
  await local.disconnect();
  process.exit(0);
}

console.log(`\nEnabling ${toEnable.length} amendment(s)...`);
for (const { hash, name } of toEnable) {
  await local.request({ command: 'feature', feature: hash, vetoed: false } as any);
  console.log(`  ✔ ${name}`);
}

// Wait for next ledger close so amendments take effect
console.log('\nWaiting for ledger close...');
await new Promise<void>(resolve => {
  local.on('ledgerClosed', () => resolve());
  local.request({ command: 'subscribe', streams: ['ledger'] }).catch(() => resolve());
  setTimeout(resolve, 8000); // fallback timeout
});

// Verify
const verifyResp = await local.request({ command: 'feature' });
const verifiedFeatures = verifyResp.result.features as typeof localFeatures;

const failed = toEnable.filter(({ hash }) => !verifiedFeatures[hash]?.enabled);
if (failed.length > 0) {
  console.log(`\n⚠ ${failed.length} amendment(s) did not activate:`);
  for (const { name } of failed) console.log(`  - ${name}`);
} else {
  console.log(`\n✔ All ${toEnable.length} amendments now active.`);
  if (unsupported.length > 0) {
    console.log(`⚠ ${unsupported.length} amendment(s) could not be applied (unsupported by local build).`);
  }
}

await local.disconnect();
