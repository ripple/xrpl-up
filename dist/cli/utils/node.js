"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNodeUrl = getNodeUrl;
const client_1 = require("./client");
const config_1 = require("../../core/config");
let mainnetWarningShown = false;
/** Returns the resolved XRPL node WebSocket URL from the global --network option. */
function getNodeUrl(cmd) {
    const opts = cmd.optsWithGlobals();
    const url = (0, client_1.resolveNodeUrl)(opts.network);
    if (!mainnetWarningShown && (0, config_1.looksLikeMainnetUrl)(url)) {
        process.stderr.write("Warning: The node URL appears to be an XRPL production endpoint. " +
            "xrpl-up is intended for local and test network development only.\n");
        mainnetWarningShown = true;
    }
    return url;
}
