/**
 * Lists the xrpld builds in a packages.xrplf.org deb channel that are newer
 * than the last one already built, oldest first, as JSON:
 *
 *   [{ "version": "0.0.0~dev-1238.20261005git9cbf78b", "slug": "0.0.0-dev-1238.20261005git9cbf78b", "run": 1238 }]
 *
 *   npx tsx scripts/new-xrpld-debs.ts <channel> <lastRun> [cap]
 *
 * Develop versions are <xrpld version>-<CI run number>.<date>git<sha>; the run
 * number only ever increases. <lastRun> is the run number of the newest build
 * that already has a tag, or 0 if none does, in which case only the newest build
 * is returned rather than the channel's whole history. At most <cap> (default
 * 10) builds are returned, keeping the newest.
 */
const channel = process.argv[2] ?? 'deb-develop';
const lastRun = Number(process.argv[3] ?? 0);
const cap = Number(process.argv[4] ?? 10);
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

  const all = [...byRun.values()].sort((a, b) => a.run - b.run);
  const fresh = lastRun > 0 ? all.filter((b) => b.run > lastRun) : all.slice(-1);
  console.log(JSON.stringify(fresh.slice(-cap)));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
