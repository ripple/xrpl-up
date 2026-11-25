"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aliasCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const keystore_1 = require("../../utils/keystore");
function checkAliasUniqueness(name, excludeAddress, keystoreDir) {
    let files;
    try {
        files = (0, fs_1.readdirSync)(keystoreDir).filter((f) => f.endsWith(".json"));
    }
    catch {
        return null;
    }
    for (const file of files) {
        try {
            const data = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(keystoreDir, file), "utf-8"));
            if (data.label === name && data.address && data.address !== excludeAddress) {
                return data.address;
            }
        }
        catch {
            // skip unreadable files
        }
    }
    return null;
}
exports.aliasCommand = new commander_1.Command("alias").description("Manage wallet aliases");
exports.aliasCommand
    .command("set")
    .description("Set a human-readable alias on a keystore entry")
    .argument("<address>", "XRPL address of the wallet")
    .argument("<name>", "Alias name to set")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--force", "Overwrite existing alias even if used by another address", false)
    .action((address, name, options) => {
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    (0, fs_1.mkdirSync)(keystoreDir, { recursive: true });
    const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    if (!(0, fs_1.existsSync)(filePath)) {
        process.stderr.write(`Error: keystore file for ${address} not found\n`);
        process.exit(1);
    }
    const conflictAddress = checkAliasUniqueness(name, address, keystoreDir);
    if (conflictAddress !== null && !options.force) {
        process.stderr.write(`Error: alias '${name}' is already used by ${conflictAddress}. Use --force to overwrite.\n`);
        process.exit(1);
    }
    const data = JSON.parse((0, fs_1.readFileSync)(filePath, "utf-8"));
    data.label = name;
    const tmpPath = `${filePath}.tmp`;
    (0, fs_1.writeFileSync)(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    (0, fs_1.renameSync)(tmpPath, filePath);
    console.log(`Alias '${name}' set for ${address}`);
});
exports.aliasCommand
    .command("list")
    .description("List all wallets with aliases")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .option("--json", "Output as JSON array", false)
    .action((options) => {
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    let files = [];
    try {
        files = (0, fs_1.readdirSync)(keystoreDir).filter((f) => f.endsWith(".json"));
    }
    catch {
        // directory doesn't exist — no aliases
    }
    const aliases = [];
    for (const file of files) {
        try {
            const data = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(keystoreDir, file), "utf-8"));
            if (data.label && data.address) {
                aliases.push({ alias: data.label, address: data.address });
            }
        }
        catch {
            // skip unreadable files
        }
    }
    if (options.json) {
        console.log(JSON.stringify(aliases));
        return;
    }
    if (aliases.length === 0) {
        console.log("(no aliases set)");
        return;
    }
    for (const { alias, address } of aliases) {
        console.log(`${alias}  →  ${address}`);
    }
});
exports.aliasCommand
    .command("remove")
    .description("Remove alias from a keystore entry")
    .argument("<address>", "XRPL address of the wallet")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .action((address, options) => {
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    if (!(0, fs_1.existsSync)(filePath)) {
        process.stderr.write(`Error: keystore file for ${address} not found\n`);
        process.exit(1);
    }
    const data = JSON.parse((0, fs_1.readFileSync)(filePath, "utf-8"));
    delete data.label;
    const tmpPath = `${filePath}.tmp`;
    (0, fs_1.writeFileSync)(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    (0, fs_1.renameSync)(tmpPath, filePath);
    console.log(`Alias removed from ${address}`);
});
