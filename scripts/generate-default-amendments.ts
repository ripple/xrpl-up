/**
 * Generates src/core/default-amendments.json for the xrpld this build of
 * xrpl-up runs (src/core/xrpld-source.json).
 *
 * An amendment is force-enabled at genesis iff it is
 *   - enabled on mainnet right now,
 *   - supported by that xrpld, and
 *   - not Obsolete in it (retired into the binary: always on, can't be enabled).
 *
 *   npx tsx scripts/generate-default-amendments.ts
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'xrpl';
import { generateRippledConfig } from '../src/core/compose';
import { DEFAULT_IMAGE, XRPLD_DEB, debImageTag, ensureImage, xrpldBinaryPath, dockerPlatformArg } from '../src/core/xrpld-image';

const MAINNET_WS = process.env.MAINNET_WS ?? 'wss://xrplcluster.com';
const OUT = path.resolve(__dirname, '..', 'src', 'core', 'default-amendments.json');
const PROBE_TIMEOUT_MS = 90_000;

interface Feature { name?: string; enabled?: boolean; supported?: boolean; vetoed?: boolean | string }

async function mainnetEnabled(): Promise<Map<string, string>> {
  const client = new Client(MAINNET_WS, { timeout: 30_000 });
  await client.connect();
  try {
    if (client.networkID !== undefined && client.networkID !== 0) {
      throw new Error(`${MAINNET_WS} reports network_id ${client.networkID}, not mainnet (0)`);
    }
    const res = (await client.request({ command: 'feature' } as never)) as unknown as {
      result: { features: Record<string, Feature> };
    };
    const out = new Map<string, string>();
    for (const [hash, f] of Object.entries(res.result.features)) {
      if (f.enabled) out.set(hash.toUpperCase(), f.name ?? hash);
    }
    if (out.size === 0) throw new Error(`${MAINNET_WS} reported no enabled amendments`);
    return out;
  } finally {
    await client.disconnect();
  }
}

async function probe(image: string): Promise<Record<string, Feature>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xrpl-up-probe-'));
  fs.writeFileSync(path.join(dir, 'rippled.cfg'), generateRippledConfig(false, []));
  fs.writeFileSync(path.join(dir, 'validators.txt'), '[validators]\n');

  const bin = xrpldBinaryPath(image);
  const name = `xrpl-up-probe-${process.pid}`;
  execSync(
    `docker run -d --rm ${dockerPlatformArg()}--name ${name} ` +
      `-v "${dir}/rippled.cfg:/config/rippled.cfg:ro" -v "${dir}/validators.txt:/config/validators.txt:ro" ` +
      `--entrypoint ${bin} "${image}" --conf /config/rippled.cfg -a --start`,
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  try {
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const out = execSync(`docker exec ${name} ${bin} --conf /config/rippled.cfg feature`, {
          encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        const parsed = JSON.parse(out.slice(out.indexOf('{')));
        if (parsed?.result?.features) return parsed.result.features;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`${image} did not report its amendments within ${PROBE_TIMEOUT_MS / 1000}s`);
  } finally {
    try { execSync(`docker rm -f ${name}`, { stdio: 'ignore' }); } catch { /* gone */ }
  }
}

async function main(): Promise<void> {
  const image = DEFAULT_IMAGE;
  ensureImage(image);

  const [mainnet, features] = await Promise.all([mainnetEnabled(), probe(image)]);

  const amendments = Object.entries(features)
    .filter(([hash, f]) => mainnet.has(hash.toUpperCase()) && f.supported !== false && f.vetoed !== 'Obsolete')
    .map(([hash, f]) => ({ hash: hash.toUpperCase(), name: f.name ?? mainnet.get(hash.toUpperCase())! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (amendments.length === 0) throw new Error('derived an empty amendment list — refusing to write it');

  const source = XRPLD_DEB ? `deb ${XRPLD_DEB.channel} ${XRPLD_DEB.version}` : image;
  fs.writeFileSync(OUT, JSON.stringify({ xrpld: source, mainnet: MAINNET_WS, amendments }, null, 2) + '\n');
  console.log(`xrpld ${source}: ${amendments.length} amendments (of ${mainnet.size} enabled on mainnet) -> ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
