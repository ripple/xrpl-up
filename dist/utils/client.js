"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVNET_URL = exports.TESTNET_FALLBACK_URL = exports.TESTNET_URL = void 0;
exports.resolveNodeUrl = resolveNodeUrl;
exports.withClient = withClient;
const dev_build_1 = require("./dev-build");
const xrpl_1 = require("xrpl");
exports.TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
exports.TESTNET_FALLBACK_URL = "wss://testnet.xrpl-labs.com/";
exports.DEVNET_URL = "wss://s.devnet.rippletest.net:51233";
const NETWORK_URLS = {
    testnet: exports.TESTNET_URL,
    devnet: exports.DEVNET_URL,
};
/** Resolves a network alias ("testnet" | "devnet") or passes through a raw WebSocket URL unchanged. */
function resolveNodeUrl(nodeOrNetwork) {
    if (nodeOrNetwork in NETWORK_URLS) {
        return NETWORK_URLS[nodeOrNetwork];
    }
    return nodeOrNetwork;
}
const RETRY_SLEEP_MS = 2_000;
const RETRY_MAX = 5;
async function withClientOnce(nodeUrl, fn) {
    const client = new xrpl_1.Client(nodeUrl, { timeout: 60_000 });
    await client.connect();
    (0, dev_build_1.normalizeDevBuildVersion)(client);
    try {
        return await fn(client);
    }
    finally {
        await client.disconnect();
    }
}
/** Connects to an XRPL node, runs `fn`, then disconnects — even on error.
 *  For testnet nodes, retries up to 5 times alternating between primary and
 *  fallback, sleeping 2 s between each attempt. */
async function withClient(nodeUrl, fn) {
    const isFallbackable = nodeUrl === exports.TESTNET_URL || nodeUrl === exports.TESTNET_FALLBACK_URL;
    if (!isFallbackable) {
        return withClientOnce(nodeUrl, fn);
    }
    const alt = nodeUrl === exports.TESTNET_URL ? exports.TESTNET_FALLBACK_URL : exports.TESTNET_URL;
    const urls = [nodeUrl, alt];
    let lastErr;
    for (let i = 0; i < RETRY_MAX; i++) {
        if (i > 0)
            await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
        try {
            return await withClientOnce(urls[i % 2], fn);
        }
        catch (err) {
            lastErr = err;
            const isTimeout = err instanceof Error && err.message.includes("Timeout");
            if (!isTimeout)
                throw err;
        }
    }
    throw lastErr;
}
