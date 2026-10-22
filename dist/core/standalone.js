"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENESIS_ADDRESS = exports.GENESIS_SEED = void 0;
exports.getGenesisWallet = getGenesisWallet;
exports.fundWalletFromGenesis = fundWalletFromGenesis;
const xrpl_1 = require("xrpl");
/**
 * The master/genesis account that rippled creates in standalone mode.
 * It holds 100,000,000,000 XRP and is used to fund test wallets.
 */
exports.GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
exports.GENESIS_ADDRESS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
function getGenesisWallet() {
    return xrpl_1.Wallet.fromSeed(exports.GENESIS_SEED);
}
/**
 * Create a fresh wallet and fund it from the genesis account.
 *
 * In standalone mode rippled does not auto-close ledgers, so we call
 * `ledger_accept` after submitting each payment to advance the ledger
 * and get the transaction validated.
 */
async function fundWalletFromGenesis(client, amountXrp = 1000) {
    const genesis = getGenesisWallet();
    const newWallet = xrpl_1.Wallet.generate();
    // autofill fills in Sequence, Fee, and LastLedgerSequence
    const paymentTx = await client.autofill({
        TransactionType: 'Payment',
        Account: genesis.address,
        Amount: (0, xrpl_1.xrpToDrops)(String(amountXrp)),
        Destination: newWallet.address,
    });
    const { tx_blob } = genesis.sign(paymentTx);
    // Submit without waiting — we drive validation manually
    await client.submit(tx_blob);
    // Advance the ledger so the transaction gets validated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.request({ command: 'ledger_accept' });
    return { wallet: newWallet, balance: amountXrp };
}
