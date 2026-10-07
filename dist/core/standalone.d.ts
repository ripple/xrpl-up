import { Client, Wallet } from 'xrpl';
/**
 * The master/genesis account that rippled creates in standalone mode.
 * It holds 100,000,000,000 XRP and is used to fund test wallets.
 */
export declare const GENESIS_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";
export declare const GENESIS_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
export declare function getGenesisWallet(): Wallet;
/**
 * Create a fresh wallet and fund it from the genesis account.
 *
 * In standalone mode rippled does not auto-close ledgers, so we call
 * `ledger_accept` after submitting each payment to advance the ledger
 * and get the transaction validated.
 */
export declare function fundWalletFromGenesis(client: Client, amountXrp?: number): Promise<{
    wallet: Wallet;
    balance: number;
}>;
//# sourceMappingURL=standalone.d.ts.map