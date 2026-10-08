/**
 * Lists the xrpld builds in a packages.xrplf.org deb channel that still need an
 * xrpl-up built for them, oldest first, as JSON:
 *
 *   [{ "version": "0.0.0~dev-1238.20261005git9cbf78b", "slug": "0.0.0-dev-1238.20261005git9cbf78b", "run": 1238 }]
 *
 *   DONE_SLUGS="<slug>\n<slug>" npx tsx scripts/new-xrpld-debs.ts <channel> [cap] [window]
 *
 * A build is done when its slug is in DONE_SLUGS (one per line): it has a release
 * tag, or a failure marker. Only the newest `window` builds in the channel are
 * considered (default 30, about a week), so a gap left by a failed build is
 * retried but old history is never built. At most `cap` (default 4) are
 * returned, keeping the newest.
 *
 * A channel that needs a login reads APT_USERNAME / APT_PASSWORD from the
 * environment.
 */
const channel = process.argv[2] ?? 'deb-develop';
const cap = Number(process.argv[3] ?? 4);
const window = Number(process.argv[4] ?? 30);
const done = new Set(
  (process.env.DONE_SLUGS ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
);
const base = process.env.APT_BASE ?? 'https://packages.xrplf.org/repository';
const url = `${base}/${channel}/dists/any/main/binary-amd64/Packages`;

interface Build { version: string; slug: string; run: number }

/**
 * Order of a version in a channel. Develop builds end in -<CI run number>.<date>git<sha>
 * and are ordered by that number, which only ever increases. Release-line builds
 * (3.4.1~rc3-1, 3.4.1-1) are ordered like dpkg orders them: by X.Y.Z,
 * then a pre-release (~rc3, ~b0) before the final, then the revision.
 */
function sortKey(version: string): { run: number; key: (string | number)[] } {
  // -<run>.<date>git<sha>: a CI build, whatever release line it is on (0.0.0~dev, 3.5.0~b0).
  const dev = /-(\d+)\.\d{8}git/.exec(version);
  const rel = /^(\d+)\.(\d+)\.(\d+)(?:~([A-Za-z]+)(\d+))?-(\d+)/.exec(version);
  if (dev) return { run: Number(dev[1]), key: [Number(dev[1])] };
  if (rel) {
    const [, x, y, z, pre, preN, rev] = rel;
    return { run: 0, key: [Number(x), Number(y), Number(z), pre ? 0 : 1, pre ?? '', Number(preN ?? 0), Number(rev)] };
  }
  return { run: NaN, key: [NaN] };
}

function compare(a: Build, b: Build): number {
  const ka = sortKey(a.version).key;
  const kb = sortKey(b.version).key;
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    if (ka[i] === kb[i]) continue;
    return ka[i] < kb[i] ? -1 : 1;
  }
  return 0;
}

async function main(): Promise<void> {
  // A channel that needs a login takes it from the environment.
  const headers: Record<string, string> = {};
  if (process.env.APT_USERNAME) {
    headers.Authorization = 'Basic ' + Buffer.from(`${process.env.APT_USERNAME}:${process.env.APT_PASSWORD ?? ''}`).toString('base64');
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);

  const byVersion = new Map<string, Build>();
  for (const stanza of (await res.text()).split(/\n\n+/)) {
    const pkg = /^Package: (.+)$/m.exec(stanza)?.[1];
    const version = /^Version: (.+)$/m.exec(stanza)?.[1];
    if (pkg !== 'xrpld' || !version) continue; // not xrpld-assert / -dbgsym
    const { run, key } = sortKey(version);
    if (key.some((k) => typeof k === 'number' && !Number.isFinite(k))) continue;
    byVersion.set(version, { version, slug: version.replace(/[^A-Za-z0-9_.-]/g, '-'), run });
  }
  if (byVersion.size === 0) throw new Error(`no xrpld packages found in ${channel}`);

  const recent = [...byVersion.values()].sort(compare).slice(-window);
  const todo = recent.filter((b) => !done.has(b.slug)).slice(-cap);
  console.log(JSON.stringify(todo));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
