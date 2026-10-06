/**
 * Prints the newest xrpld version published to a packages.xrplf.org deb
 * channel (default: deb-develop), e.g. 3.5.0~b0-1220.20261001gite6055dd.
 *
 * Develop versions are <xrpld version>-<CI run number>.<date>git<sha>; the run
 * number only ever increases, so the highest one is the newest build.
 *
 *   npx tsx scripts/latest-xrpld-deb.ts [channel]
 */
const channel = process.argv[2] ?? process.env.XRPLD_DEB_CHANNEL ?? 'deb-develop';
const url = `https://packages.xrplf.org/repository/${channel}/dists/any/main/binary-amd64/Packages`;

async function main(): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);

  let best: { version: string; run: number } | null = null;
  for (const stanza of (await res.text()).split(/\n\n+/)) {
    const pkg = /^Package: (.+)$/m.exec(stanza)?.[1];
    const version = /^Version: (.+)$/m.exec(stanza)?.[1];
    if (pkg !== 'xrpld' || !version) continue; // not xrpld-assert / -dbgsym
    const run = Number(/-(\d+)\./.exec(version)?.[1] ?? /-(\d+)$/.exec(version)?.[1]);
    if (!Number.isFinite(run)) continue;
    if (!best || run > best.run) best = { version, run };
  }
  if (!best) throw new Error(`no xrpld packages found in ${channel}`);
  console.log(best.version);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
