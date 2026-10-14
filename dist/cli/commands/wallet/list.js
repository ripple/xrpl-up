"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const keystore_1 = require("../../utils/keystore");
exports.listCommand = new commander_1.Command("list")
    .alias("ls")
    .description("List keystored accounts")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--json", "Output as JSON array", false)
    .action((options) => {
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    if (!(0, fs_1.existsSync)(keystoreDir)) {
        if (options.json) {
            console.log(JSON.stringify([]));
        }
        else {
            console.log("(empty)");
        }
        return;
    }
    const files = (0, fs_1.readdirSync)(keystoreDir).filter((f) => f.endsWith(".json"));
    const entries = files.map((f) => {
        const address = (0, path_1.basename)(f, ".json");
        try {
            const data = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(keystoreDir, f), "utf-8"));
            const entry = { address };
            if (data.label) {
                entry.alias = data.label;
            }
            return entry;
        }
        catch {
            return { address };
        }
    });
    if (options.json) {
        console.log(JSON.stringify(entries));
    }
    else if (entries.length === 0) {
        console.log("(empty)");
    }
    else {
        entries.forEach(({ address, alias }) => {
            if (alias) {
                console.log(`${address}  ${alias}`);
            }
            else {
                console.log(address);
            }
        });
    }
});
