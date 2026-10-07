"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.loadConfig = loadConfig;
exports.resolveNetwork = resolveNetwork;
exports.isMainnet = isMainnet;
exports.looksLikeMainnetUrl = looksLikeMainnetUrl;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
exports.DEFAULT_CONFIG = {
    networks: {
        local: {
            url: 'ws://localhost:6006',
            name: 'Local Sandbox',
        },
        testnet: {
            url: 'wss://s.altnet.rippletest.net:51233',
            name: 'XRPL Testnet',
        },
        devnet: {
            url: 'wss://s.devnet.rippletest.net:51233',
            name: 'XRPL Devnet',
        },
    },
    defaultNetwork: 'testnet',
    accounts: {
        count: 10,
    },
};
function mergeConfig(defaults, user) {
    return {
        ...defaults,
        ...user,
        networks: {
            ...defaults.networks,
            ...(user.networks ?? {}),
        },
        accounts: {
            ...defaults.accounts,
            ...(user.accounts ?? {}),
        },
    };
}
function loadConfig() {
    const cwd = process.cwd();
    const candidates = [
        path_1.default.join(cwd, 'xrpl-up.config.js'),
        path_1.default.join(cwd, 'xrpl-up.config.json'),
        path_1.default.join(cwd, '.xrpl-up.json'),
    ];
    for (const cfgPath of candidates) {
        if (!fs_1.default.existsSync(cfgPath))
            continue;
        try {
            let userConfig;
            if (cfgPath.endsWith('.json')) {
                userConfig = JSON.parse(fs_1.default.readFileSync(cfgPath, 'utf-8'));
            }
            else {
                const mod = require(cfgPath);
                userConfig = mod.default ?? mod;
            }
            return mergeConfig(exports.DEFAULT_CONFIG, userConfig);
        }
        catch {
            // fall through
        }
    }
    return exports.DEFAULT_CONFIG;
}
function resolveNetwork(config, networkName) {
    const name = networkName ?? config.defaultNetwork;
    const netCfg = config.networks[name];
    if (!netCfg) {
        const available = Object.keys(config.networks).join(', ');
        throw new Error(`Network "${name}" not found. Available: ${available}`);
    }
    return { name, config: netCfg };
}
/** Best-effort detection of mainnet URLs. Used to block/warn operations that
 *  should not target the production XRPL network. */
function isMainnet(_networkName, networkConfig) {
    return (networkConfig.url.includes('xrplcluster.com') ||
        networkConfig.url.includes('s1.ripple.com') ||
        networkConfig.url.includes('s2.ripple.com'));
}
/** URL-only variant for use outside the config system (e.g. CLI wrapper commands). */
function looksLikeMainnetUrl(url) {
    return (url.includes('xrplcluster.com') ||
        url.includes('s1.ripple.com') ||
        url.includes('s2.ripple.com'));
}
