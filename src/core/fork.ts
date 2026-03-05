import { Client, Wallet, xrpToDrops, dropsToXrp } from 'xrpl';
import { getGenesisWallet } from './standalone';

export interface ForkAccount {
  address: string;
  xrpBalance: number; // XRP (not drops)
  ledgerIndex: number;
  sequence: number;   // mainnet Sequence at snapshot time (display/diagnostics only)
}

/**
 * Scan a ledger's transactions and return every unique account address that
 * appeared in that ledger — as sender, destination, or any AffectedNode.
 *
 * Use case: "ledger N has an issue — give me all accounts that touched it
 * so I can replay from ledger N-1."
 */
export async function fetchActiveAccountsInLedger(
  sourceUrl: string,
  ledgerIndex: number
): Promise<string[]> {
  const client = new Client(sourceUrl);
  await client.connect();

  try {
    const res = await client.request({
      command: 'ledger',
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
    } as any) as any;

    const transactions: any[] = res.result.ledger?.transactions ?? [];
    const addresses = new Set<string>();

    for (const tx of transactions) {
      // Top-level sender / destination
      if (tx.Account) addresses.add(tx.Account);
      if (tx.Destination) addresses.add(tx.Destination);

      // Every AccountRoot node touched by this transaction's metadata
      const meta = tx.metaData ?? tx.meta;
      if (meta?.AffectedNodes) {
        for (const node of meta.AffectedNodes) {
          const nodeData =
            node.ModifiedNode ?? node.CreatedNode ?? node.DeletedNode;
          if (nodeData?.LedgerEntryType === 'AccountRoot') {
            const account =
              nodeData.FinalFields?.Account ?? nodeData.NewFields?.Account;
            if (account) addresses.add(account);
          }
        }
      }
    }

    return Array.from(addresses);
  } finally {
    await client.disconnect();
  }
}

/**
 * Fetch XRP balances for the given addresses from a remote XRPL network.
 * Accounts that don't exist at the requested ledger are silently skipped.
 */
export async function fetchForkAccounts(
  sourceUrl: string,
  addresses: string[],
  ledgerIndex?: number
): Promise<ForkAccount[]> {
  const client = new Client(sourceUrl);
  await client.connect();

  const results: ForkAccount[] = [];
  let resolvedLedger = ledgerIndex;

  try {
    for (const address of addresses) {
      try {
        const res = await client.request({
          command: 'account_info',
          account: address,
          ledger_index: ledgerIndex ?? 'validated',
        });

        const info = res.result.account_data;
        if (!resolvedLedger) {
          resolvedLedger = (res.result as any).ledger_index ?? 0;
        }

        results.push({
          address,
          xrpBalance: Number(dropsToXrp(info.Balance)),
          ledgerIndex: resolvedLedger ?? 0,
          sequence: info.Sequence,
        });
      } catch (err: unknown) {
        // Account not found on source network at this ledger — skip
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('actNotFound') || msg.includes('Account not found')) {
          continue;
        }
        throw err;
      }
    }
  } finally {
    await client.disconnect();
  }

  return results;
}

/**
 * Fund forked addresses on a local standalone rippled node from the genesis account.
 * Each Payment is followed by ledger_accept to validate it immediately.
 *
 * Note: local account Sequence will be ~2–5 (the current ledger index), not the
 * mainnet Sequence. Replaying signed mainnet tx_blobs that carry a high Sequence
 * will fail with terPRE_SEQ — this is a known limitation. The fork is primarily
 * useful for replicating account balances.
 *
 * @param onProgress  Optional callback fired after each account is created.
 */
export async function applyForkAccounts(
  client: Client,
  accounts: ForkAccount[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const genesis: Wallet = getGenesisWallet();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    // rippled base reserve is 10 XRP; we must send at least that.
    const amountXrp = Math.max(account.xrpBalance, 10);

    const paymentTx = await client.autofill({
      TransactionType: 'Payment',
      Account: genesis.address,
      Amount: xrpToDrops(String(amountXrp)),
      Destination: account.address,
    });

    const { tx_blob } = genesis.sign(paymentTx);
    await client.submit(tx_blob);

    // Advance the ledger to validate the payment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).request({ command: 'ledger_accept' });

    onProgress?.(i + 1, accounts.length);
  }
}
