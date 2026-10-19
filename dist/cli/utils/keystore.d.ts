export interface KeystoreFile {
    version: 1;
    address: string;
    label?: string;
    keyType: "ed25519" | "secp256k1";
    kdf: "pbkdf2";
    kdfparams: {
        iterations: 600000;
        keylen: 32;
        digest: "sha256";
        salt: string;
    };
    cipher: "aes-256-gcm";
    cipherparams: {
        iv: string;
        tag: string;
    };
    ciphertext: string;
}
export declare function getKeystoreDir(options: {
    keystore?: string;
}): string;
export declare function encryptKeystore(seed: string, password: string, keyType: "ed25519" | "secp256k1", address: string, label?: string): KeystoreFile;
export declare function decryptKeystore(file: KeystoreFile, password: string): string;
/**
 * Resolves an address-or-alias to an XRPL address.
 * - If the input looks like an XRPL address (starts with 'r', length 25-34), returns it unchanged.
 * - Otherwise scans keystoreDir for a *.json file with a matching label field.
 * - Throws if no matching alias is found.
 */
export declare function resolveAccount(addressOrAlias: string, keystoreDir: string): string;
//# sourceMappingURL=keystore.d.ts.map