import { execSync } from 'child_process';
import os from 'node:os';
import path from 'node:path';
import rawSource from './xrpld-source.json';

/**
 * A specific xrpld build published to packages.xrplf.org, e.g.
 * { channel: 'deb-develop', version: '3.5.0~b0-1220.20261001gite6055dd' }.
 */
export interface DebSource {
  channel: string;
  version: string;
}

// xrpld-source.json says which xrpld this build of xrpl-up runs: either a
// registry image, or a deb package that gets built into a local image on
// first start. The develop-build workflow rewrites it per rippled commit.
const source = rawSource as unknown as { image: string | null; deb: DebSource | null };

export const XRPLD_DEB: DebSource | null = source.deb;

/** Local image tag for a deb build. Docker tags only allow [A-Za-z0-9_.-], so `~`/`+`/`:` become `-`. */
export function debImageTag(deb: DebSource): string {
  return `xrpl-up/xrpld:${deb.version.replace(/[^A-Za-z0-9_.-]/g, '-')}`;
}

if (!XRPLD_DEB && !source.image) {
  throw new Error('xrpld-source.json must set either "image" or "deb"');
}

export const DEFAULT_IMAGE: string = XRPLD_DEB ? debImageTag(XRPLD_DEB) : source.image!;

/**
 * Binary path inside the image. Images named "xrpld" ship /usr/bin/xrpld; the
 * pre-rebrand "rippled" images use /opt/ripple/bin/rippled.
 */
export function xrpldBinaryPath(image: string): string {
  const repo = image.split(':')[0];
  return repo === 'xrpld' || repo.endsWith('/xrpld') ? '/usr/bin/xrpld' : '/opt/ripple/bin/rippled';
}

/** xrpld only ships amd64, so ARM hosts (Apple Silicon) need emulation. */
export function dockerPlatformArg(): string {
  return os.arch() === 'arm64' ? '--platform linux/amd64 ' : '';
}

function getXrpldImageContext(): string {
  // Compiled: dist/core → dist/xrpld-image. Under tsx: src/core → dist/xrpld-image.
  if (__dirname.includes(`${path.sep}src${path.sep}`)) {
    return path.resolve(__dirname, '..', '..', 'dist', 'xrpld-image');
  }
  return path.resolve(__dirname, '..', 'xrpld-image');
}

function imageExists(image: string): boolean {
  try {
    execSync(`docker image inspect "${image}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure `image` is available locally: build it from the pinned deb if it
 * is this build's deb image (nothing publishes it to a registry), otherwise
 * pull it.
 */
export function ensureImage(image: string): void {
  if (imageExists(image)) return;

  if (XRPLD_DEB && image === debImageTag(XRPLD_DEB)) {
    console.log(`  Building xrpld ${XRPLD_DEB.version} from packages.xrplf.org (first time only)…`);
    execSync(
      `docker build ${dockerPlatformArg()}` +
        `--build-arg CHANNEL="${XRPLD_DEB.channel}" ` +
        `--build-arg VERSION="${XRPLD_DEB.version}" ` +
        `-t "${image}" "${getXrpldImageContext()}"`,
      { stdio: 'inherit' },
    );
    return;
  }

  console.log(`  Pulling ${image} (first time only)…`);
  execSync(`docker pull ${dockerPlatformArg()}"${image}"`, { stdio: 'inherit' });
}
