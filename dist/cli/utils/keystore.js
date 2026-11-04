"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeystoreDir = getKeystoreDir;
exports.encryptKeystore = encryptKeystore;
exports.decryptKeystore = decryptKeystore;
exports.resolveAccount = resolveAccount;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
function getKeystoreDir(options) {
    if (options.keystore) {
        return (0, path_1.resolve)(options.keystore);
    }
    const envDir = process.env["XRPL_KEYSTORE"];
    if (envDir) {
        return (0, path_1.resolve)(envDir);
    }
    return (0, path_1.join)((0, os_1.homedir)(), ".xrpl", "keystore");
}
function encryptKeystore(seed, password, keyType, address, label) {
    const salt = (0, crypto_1.randomBytes)(32);
    const iv = (0, crypto_1.randomBytes)(12);
    const key = (0, crypto_1.pbkdf2Sync)(password, salt, 600000, 32, "sha256");
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv);
    const plaintextBuf = Buffer.from(seed, "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const result = {
        version: 1,
        address,
        keyType,
        kdf: "pbkdf2",
        kdfparams: {
            iterations: 600000,
            keylen: 32,
            digest: "sha256",
            salt: salt.toString("hex"),
        },
        cipher: "aes-256-gcm",
        cipherparams: {
            iv: iv.toString("hex"),
            tag: tag.toString("hex"),
        },
        ciphertext: ciphertext.toString("hex"),
    };
    if (label !== undefined) {
        result.label = label;
    }
    return result;
}
function decryptKeystore(file, password) {
    const salt = Buffer.from(file.kdfparams.salt, "hex");
    const iv = Buffer.from(file.cipherparams.iv, "hex");
    const tag = Buffer.from(file.cipherparams.tag, "hex");
    const ciphertext = Buffer.from(file.ciphertext, "hex");
    const key = (0, crypto_1.pbkdf2Sync)(password, salt, file.kdfparams.iterations, file.kdfparams.keylen, file.kdfparams.digest);
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    try {
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString("utf8");
    }
    catch {
        throw new Error("wrong password or corrupt keystore");
    }
}
/**
 * Resolves an address-or-alias to an XRPL address.
 * - If the input looks like an XRPL address (starts with 'r', length 25-34), returns it unchanged.
 * - Otherwise scans keystoreDir for a *.json file with a matching label field.
 * - Throws if no matching alias is found.
 */
function resolveAccount(addressOrAlias, keystoreDir) {
    if (/^r[a-zA-Z0-9]{24,33}$/.test(addressOrAlias)) {
        return addressOrAlias;
    }
    let files;
    try {
        files = (0, fs_1.readdirSync)(keystoreDir).filter((f) => f.endsWith(".json"));
    }
    catch {
        files = [];
    }
    for (const file of files) {
        try {
            const data = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(keystoreDir, file), "utf-8"));
            if (data.label === addressOrAlias && data.address) {
                return data.address;
            }
        }
        catch {
            // skip unreadable files
        }
    }
    // Also check by address from filename (basename without .json)
    const byFilename = files.map((f) => (0, path_1.basename)(f, ".json"));
    if (byFilename.includes(addressOrAlias)) {
        return addressOrAlias;
    }
    throw new Error(`no wallet with alias ${addressOrAlias} found in keystore`);
}
