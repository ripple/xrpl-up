"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDevBuildVersion = normalizeDevBuildVersion;
/**
 * rippled builds that aren't on a release line report `0.0.0-dev+<sha>`. xrpl.js
 * adds the required NetworkID to a transaction only when the server's build
 * version is >= 1.11.0, so against such a build every transaction on a
 * custom-network_id sandbox is rejected with telREQUIRES_NETWORK_ID. A
 * `0.0.0` build is the newest code, not an old server — report it as recent.
 */
function normalizeDevBuildVersion(client) {
    if (client.buildVersion && /^0\.0\.0(?![0-9])/.test(client.buildVersion)) {
        client.buildVersion = '999.0.0';
    }
}
