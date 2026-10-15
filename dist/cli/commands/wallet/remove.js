"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const keystore_1 = require("../../utils/keystore");
exports.removeCommand = new commander_1.Command("remove")
    .alias("rm")
    .description("Remove a wallet from the keystore")
    .argument("<address>", "XRPL address to remove from keystore")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .action((address, options) => {
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    if (!(0, fs_1.existsSync)(filePath)) {
        process.stderr.write(`Error: no keystore entry found for ${address}\n`);
        process.exit(1);
    }
    (0, fs_1.rmSync)(filePath);
    console.log(`Removed ${address}`);
});
