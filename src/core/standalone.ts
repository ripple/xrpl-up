import { Client, Wallet, xrpToDrops } from 'xrpl';

/**
 * The master/genesis account that rippled creates in standalone mode.
 * It holds 100,000,000,000 XRP and is used to fund test wallets.
 */
export const GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
export const GENESIS_ADDRESS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

export function getGenesisWallet(): Wallet {
  return Wallet.fromSeed(GENESIS_SEED);
}

/**
 * Create a fresh wallet and fund it from the genesis account.
 *
 * In standalone mode rippled does not auto-close ledgers, so we call
 * `ledger_accept` after submitting each payment to advance the ledger
 * and get the transaction validated.
 */
export async function fundWalletFromGenesis(
  client: Client,
  amountXrp = 1000
): Promise<{ wallet: Wallet; balance: number }> {
  const genesis = getGenesisWallet();
  const newWallet = Wallet.generate();

  // autofill fills in Sequence, Fee, and LastLedgerSequence
  const paymentTx = await client.autofill({
    TransactionType: 'Payment',
    Account: genesis.address,
    Amount: xrpToDrops(String(amountXrp)),
    Destination: newWallet.address,
  });

  const { tx_blob } = genesis.sign(paymentTx);

  // Submit without waiting — we drive validation manually
  await client.submit(tx_blob);

  // Advance the ledger so the transaction gets validated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).request({ command: 'ledger_accept' });

  return { wallet: newWallet, balance: amountXrp };
}
