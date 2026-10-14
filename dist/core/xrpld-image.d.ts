/**
 * A specific xrpld build published to packages.xrplf.org, e.g.
 * { channel: 'deb-develop', version: '3.5.0~b0-1220.20261001gite6055dd' }.
 */
export interface DebSource {
    channel: string;
    version: string;
}
export declare const XRPLD_DEB: DebSource | null;
/** Local image tag for a deb build. Docker tags only allow [A-Za-z0-9_.-], so `~`/`+`/`:` become `-`. */
export declare function debImageTag(deb: DebSource): string;
export declare const DEFAULT_IMAGE: string;
/**
 * Binary path inside the image. Images named "xrpld" ship /usr/bin/xrpld; the
 * pre-rebrand "rippled" images use /opt/ripple/bin/rippled.
 */
export declare function xrpldBinaryPath(image: string): string;
/** xrpld only ships amd64, so ARM hosts (Apple Silicon) need emulation. */
export declare function dockerPlatformArg(): string;
/**
 * Make sure `image` is available locally: build it from the pinned deb if it
 * is this build's deb image (nothing publishes it to a registry), otherwise
 * pull it.
 */
export declare function ensureImage(image: string): void;
//# sourceMappingURL=xrpld-image.d.ts.map