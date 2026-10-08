import { Wallet } from 'xrpl';
export interface StoredAccount {
    index: number;
    address: string;
    seed: string;
    privateKey: string;
    publicKey: string;
    balance: number;
}
export declare class WalletStore {
    private _accounts;
    private _storePath;
    constructor(networkName: string);
    private _load;
    private _save;
    add(wallet: Wallet, balance: number): StoredAccount;
    all(): StoredAccount[];
    clear(): void;
    toWallet(stored: StoredAccount): Wallet;
    get count(): number;
}
//# sourceMappingURL=wallet-store.d.ts.map