"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const xrpl_1 = require("xrpl");
class WalletStore {
    _accounts = [];
    _storePath;
    constructor(networkName) {
        const dir = path_1.default.join(os_1.default.homedir(), '.xrpl-up');
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        this._storePath = path_1.default.join(dir, `${networkName}-accounts.json`);
        this._load();
    }
    _load() {
        if (!fs_1.default.existsSync(this._storePath))
            return;
        try {
            this._accounts = JSON.parse(fs_1.default.readFileSync(this._storePath, 'utf-8'));
        }
        catch {
            this._accounts = [];
        }
    }
    _save() {
        fs_1.default.writeFileSync(this._storePath, JSON.stringify(this._accounts, null, 2));
    }
    add(wallet, balance) {
        const stored = {
            index: this._accounts.length,
            address: wallet.address,
            seed: wallet.seed ?? '',
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            balance,
        };
        this._accounts.push(stored);
        this._save();
        return stored;
    }
    all() {
        return [...this._accounts];
    }
    clear() {
        this._accounts = [];
        if (fs_1.default.existsSync(this._storePath)) {
            fs_1.default.unlinkSync(this._storePath);
        }
    }
    toWallet(stored) {
        return xrpl_1.Wallet.fromSeed(stored.seed);
    }
    get count() {
        return this._accounts.length;
    }
}
exports.WalletStore = WalletStore;
