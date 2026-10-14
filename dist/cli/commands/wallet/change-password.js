"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePasswordCommand = void 0;
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const keystore_1 = require("../../utils/keystore");
const prompt_1 = require("../../utils/prompt");
exports.changePasswordCommand = new commander_1.Command("change-password")
    .alias("cp")
    .description("Re-encrypt a keystore file with a new password")
    .argument("<address>", "XRPL address of the keystore entry to update")
    .option("--password <current>", "Current password (insecure, prefer interactive prompt)")
    .option("--new-password <new>", "New password (insecure, prefer interactive prompt)")
    .option("--keystore <dir>", "Keystore directory (default: ~/.xrpl/keystore/; XRPL_KEYSTORE env var also accepted)")
    .action(async (address, options) => {
    const keystoreDir = (0, keystore_1.getKeystoreDir)(options);
    const filePath = (0, path_1.join)(keystoreDir, `${address}.json`);
    if (!(0, fs_1.existsSync)(filePath)) {
        process.stderr.write(`Error: keystore file not found for address ${address}\n`);
        process.exit(1);
    }
    let keystoreData;
    try {
        keystoreData = JSON.parse((0, fs_1.readFileSync)(filePath, "utf-8"));
    }
    catch {
        process.stderr.write("Error: failed to read or parse keystore file\n");
        process.exit(1);
    }
    let currentPassword;
    if (options.password !== undefined) {
        process.stderr.write("Warning: passing passwords via flag is insecure\n");
        currentPassword = options.password;
    }
    else {
        currentPassword = await (0, prompt_1.promptPassword)("Current password: ");
    }
    let seed;
    try {
        seed = (0, keystore_1.decryptKeystore)(keystoreData, currentPassword);
    }
    catch {
        process.stderr.write("Error: wrong password or corrupt keystore\n");
        process.exit(1);
    }
    let newPassword;
    if (options.newPassword !== undefined) {
        process.stderr.write("Warning: passing passwords via flag is insecure\n");
        newPassword = options.newPassword;
    }
    else {
        newPassword = await (0, prompt_1.promptPassword)("New password: ");
    }
    const newKeystoreData = (0, keystore_1.encryptKeystore)(seed, newPassword, keystoreData.keyType, keystoreData.address);
    const tmpPath = `${filePath}.tmp`;
    (0, fs_1.writeFileSync)(tmpPath, JSON.stringify(newKeystoreData, null, 2), "utf-8");
    (0, fs_1.renameSync)(tmpPath, filePath);
    console.log(`Password changed for ${address}`);
});
