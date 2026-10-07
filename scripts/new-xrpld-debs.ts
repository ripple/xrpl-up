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
 * Develop versions are <xrpld version>-<CI run number>.<date>git<sha>; the run
 * number only ever increases.
 */
const channel = process.argv[2] ?? 'deb-develop';
const cap = Number(process.argv[3] ?? 4);
const window = Number(process.argv[4] ?? 30);
const done = new Set(
  (process.env.DONE_SLUGS ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
);
const url = `https://packages.xrplf.org/repository/${channel}/dists/any/main/binary-amd64/Packages`;

interface Build { version: string; slug: string; run: number }

async function main(): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);

  const byRun = new Map<number, Build>();
  for (const stanza of (await res.text()).split(/\n\n+/)) {
    const pkg = /^Package: (.+)$/m.exec(stanza)?.[1];
    const version = /^Version: (.+)$/m.exec(stanza)?.[1];
    if (pkg !== 'xrpld' || !version) continue; // not xrpld-assert / -dbgsym
    const run = Number(/-(\d+)\./.exec(version)?.[1] ?? /-(\d+)$/.exec(version)?.[1]);
    if (!Number.isFinite(run)) continue;
    byRun.set(run, { version, slug: version.replace(/[^A-Za-z0-9_.-]/g, '-'), run });
  }
  if (byRun.size === 0) throw new Error(`no xrpld packages found in ${channel}`);

  const recent = [...byRun.values()].sort((a, b) => a.run - b.run).slice(-window);
  const todo = recent.filter((b) => !done.has(b.slug)).slice(-cap);
  console.log(JSON.stringify(todo));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
