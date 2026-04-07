import fs from 'fs';
import path from 'path';
import os from 'os';
import { Wallet } from 'xrpl';

export interface StoredAccount {
  index: number;
  address: string;
  seed: string;
  privateKey: string;
  publicKey: string;
  balance: number; // XRP
}

export class WalletStore {
  private _accounts: StoredAccount[] = [];
  private _storePath: string;

  constructor(networkName: string) {
    const dir = path.join(os.homedir(), '.xrpl-up');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this._storePath = path.join(dir, `${networkName}-accounts.json`);
    this._load();
  }

  private _load(): void {
    if (!fs.existsSync(this._storePath)) return;
    try {
      this._accounts = JSON.parse(fs.readFileSync(this._storePath, 'utf-8'));
    } catch {
      this._accounts = [];
    }
  }

  private _save(): void {
    fs.writeFileSync(this._storePath, JSON.stringify(this._accounts, null, 2));
  }

  add(wallet: Wallet, balance: number): StoredAccount {
    const stored: StoredAccount = {
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

  all(): StoredAccount[] {
    return [...this._accounts];
  }

  clear(): void {
    this._accounts = [];
    if (fs.existsSync(this._storePath)) {
      fs.unlinkSync(this._storePath);
    }
  }

  toWallet(stored: StoredAccount): Wallet {
    return Wallet.fromSeed(stored.seed);
  }

  get count(): number {
    return this._accounts.length;
  }
}
