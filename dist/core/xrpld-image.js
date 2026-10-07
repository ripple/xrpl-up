"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_IMAGE = exports.XRPLD_DEB = void 0;
exports.debImageTag = debImageTag;
exports.xrpldBinaryPath = xrpldBinaryPath;
exports.dockerPlatformArg = dockerPlatformArg;
exports.ensureImage = ensureImage;
const child_process_1 = require("child_process");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const xrpld_source_json_1 = __importDefault(require("./xrpld-source.json"));
// xrpld-source.json says which xrpld this build of xrpl-up runs: either a
// registry image, or a deb package that gets built into a local image on
// first start. The develop-build workflow rewrites it per rippled commit.
const source = xrpld_source_json_1.default;
exports.XRPLD_DEB = source.deb;
/** Local image tag for a deb build. Docker tags only allow [A-Za-z0-9_.-], so `~`/`+`/`:` become `-`. */
function debImageTag(deb) {
    return `xrpl-up/xrpld:${deb.version.replace(/[^A-Za-z0-9_.-]/g, '-')}`;
}
if (!exports.XRPLD_DEB && !source.image) {
    throw new Error('xrpld-source.json must set either "image" or "deb"');
}
exports.DEFAULT_IMAGE = exports.XRPLD_DEB ? debImageTag(exports.XRPLD_DEB) : source.image;
/**
 * Binary path inside the image. Images named "xrpld" ship /usr/bin/xrpld; the
 * pre-rebrand "rippled" images use /opt/ripple/bin/rippled.
 */
function xrpldBinaryPath(image) {
    const repo = image.split(':')[0];
    return repo === 'xrpld' || repo.endsWith('/xrpld') ? '/usr/bin/xrpld' : '/opt/ripple/bin/rippled';
}
/** xrpld only ships amd64, so ARM hosts (Apple Silicon) need emulation. */
function dockerPlatformArg() {
    return node_os_1.default.arch() === 'arm64' ? '--platform linux/amd64 ' : '';
}
function getXrpldImageContext() {
    // Compiled: dist/core → dist/xrpld-image. Under tsx: src/core → dist/xrpld-image.
    if (__dirname.includes(`${node_path_1.default.sep}src${node_path_1.default.sep}`)) {
        return node_path_1.default.resolve(__dirname, '..', '..', 'dist', 'xrpld-image');
    }
    return node_path_1.default.resolve(__dirname, '..', 'xrpld-image');
}
function imageExists(image) {
    try {
        (0, child_process_1.execSync)(`docker image inspect "${image}"`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Make sure `image` is available locally: build it from the pinned deb if it
 * is this build's deb image (nothing publishes it to a registry), otherwise
 * pull it.
 */
function ensureImage(image) {
    if (imageExists(image))
        return;
    if (exports.XRPLD_DEB && image === debImageTag(exports.XRPLD_DEB)) {
        console.log(`  Building xrpld ${exports.XRPLD_DEB.version} from packages.xrplf.org (first time only)…`);
        (0, child_process_1.execSync)(`docker build ${dockerPlatformArg()}` +
            `--build-arg CHANNEL="${exports.XRPLD_DEB.channel}" ` +
            `--build-arg VERSION="${exports.XRPLD_DEB.version}" ` +
            `-t "${image}" "${getXrpldImageContext()}"`, { stdio: 'inherit' });
        return;
    }
    console.log(`  Pulling ${image} (first time only)…`);
    (0, child_process_1.execSync)(`docker pull ${dockerPlatformArg()}"${image}"`, { stdio: 'inherit' });
}
