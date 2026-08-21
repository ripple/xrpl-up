# Multi-Sig + Tickets: Out-of-Order Parallel Signing

Combine a **SignerList** (2-of-3 multi-signature) with **Tickets** (reserved sequence numbers) so that multiple co-signers can independently prepare and submit transactions in any order — with no coordination overhead.

**Real-world use:** treasury accounts, DAO-style governance, corporate treasury requiring dual approval.

---

## Prerequisites

```bash
xrpl-up start
xrpl-up status   # wait until "healthy"
export XRPL_NETWORK=local
```

---

## Part 1 — Set Up the Multi-Sig Account

### 1a. Create four accounts

The treasury account + three signers (Alice, Bob, Carol):

```bash
TREASURY_JSON=$(xrpl-up faucet --network local --json)
TREASURY_SEED=$(echo "$TREASURY_JSON" | jq -r .seed)
TREASURY=$(echo "$TREASURY_JSON" | jq -r .address)

ALICE_JSON=$(xrpl-up faucet --network local --json)
ALICE_SEED=$(echo "$ALICE_JSON" | jq -r .seed)
ALICE=$(echo "$ALICE_JSON" | jq -r .address)

BOB_JSON=$(xrpl-up faucet --network local --json)
BOB_SEED=$(echo "$BOB_JSON" | jq -r .seed)
BOB=$(echo "$BOB_JSON" | jq -r .address)

CAROL_JSON=$(xrpl-up faucet --network local --json)
CAROL_SEED=$(echo "$CAROL_JSON" | jq -r .seed)
CAROL=$(echo "$CAROL_JSON" | jq -r .address)
```

### 1b. Install a 2-of-3 signer list on the treasury

```bash
xrpl-up multisig set --quorum 2 \
  --signer $ALICE:1 --signer $BOB:1 --signer $CAROL:1 \
  --seed $TREASURY_SEED
# ✔ Signer list set  quorum 2  signers: rAliceXXX(1) rBobXXX(1) rCarolXXX(1)
```

Verify the signer list was applied:

```bash
xrpl-up account info $TREASURY
# SignerList:  quorum 2
#   rAliceXXX  weight 1
#   rBobXXX    weight 1
#   rCarolXXX  weight 1
```

---

## Part 2 — Reserve Tickets

Tickets let co-signers prepare transactions independently — no sequence dependency between them. Reserve them **before** disabling the master key below — `xrpl-up ticket create` only supports single-key signing, so it can't run once the master key is gone (live-verified: doing this in the other order fails with `transaction expired`/`tefNO_TICKET`).

### 2a. Reserve 3 tickets

```bash
# The treasury account reserves 3 tickets (still signing with the master key, which is still active)
TICKETS_JSON=$(xrpl-up ticket create --count 3 --seed $TREASURY_SEED --json)
T1=$(echo "$TICKETS_JSON" | jq -r '.sequences[0]')
T2=$(echo "$TICKETS_JSON" | jq -r '.sequences[1]')
T3=$(echo "$TICKETS_JSON" | jq -r '.sequences[2]')
```

### 2b. List the reserved tickets

```bash
xrpl-up ticket list $TREASURY
# TicketSequence  10
# TicketSequence  11
# TicketSequence  12
```

### 2c. Disable the master key (optional — enforces multi-sig only)

> ⚠️ Only do this after confirming the signer list is correct **and** after reserving all the tickets you need. If you disable the master key with no valid signer list you permanently lose access — and once it's disabled, `xrpl-up ticket create`/most other single-key commands stop working for this account entirely (they'd need their own multisig script, same as `scripts/multisig-sign.ts` below).

```bash
xrpl-up account set --set-flag disableMaster --seed $TREASURY_SEED
# ✔ Flag set: disableMaster
# ⚠  Master key is now disabled. All future transactions require multi-sig.
```

---

## Part 3 — Pre-Sign Transactions with Tickets

Each co-signer builds and signs a transaction using a different ticket. They can do this simultaneously — no ordering required.

Use a script with `xrpl-up run` to sign multi-sig transactions. Below is `scripts/multisig-sign.ts`. `xrpl-up run` invokes scripts via `tsx`, which compiles `.ts` files to CJS unless the project's `package.json` sets `"type": "module"` — and top-level `await` isn't valid CJS, so the body is wrapped in an `async` function instead:

```typescript
// scripts/multisig-sign.ts
// Reads TREASURY, DEST, ALICE_SEED, BOB_SEED, TICKET from the environment — no hardcoded secrets/IDs
import { Client, Wallet, encode, decode, decodeAccountID } from 'xrpl';

async function main() {
  const client = new Client('ws://localhost:6006');
  await client.connect();

  const treasury  = process.env.TREASURY!;
  const dest      = process.env.DEST!;
  const aliceWallet = Wallet.fromSeed(process.env.ALICE_SEED!);
  const bobWallet   = Wallet.fromSeed(process.env.BOB_SEED!);

  // Tx 1: uses the given ticket — Alice and Bob sign independently.
  // autofill(tx, signersCount) fills the multisig-adjusted Fee and LastLedgerSequence
  // (a plain autofill(tx) without the signers count omits both).
  const tx1 = await client.autofill({
    TransactionType: 'Payment',
    Account: treasury,
    Destination: dest,
    Amount: '5000000',    // 5 XRP in drops
    Sequence: 0,          // must be 0 when using a ticket
    TicketSequence: Number(process.env.TICKET),
    SigningPubKey: '',    // empty for multi-sig
  } as any, 2);

  // wallet.sign(tx, true) returns a binary-encoded tx_blob (hex), not JSON —
  // decode() it back to an object to read the SigningPubKey/TxnSignature it produced.
  const aliceSigned = decode(aliceWallet.sign(tx1, true).tx_blob) as any;
  const bobSigned = decode(bobWallet.sign(tx1, true).tx_blob) as any;

  // The ledger requires Signers sorted by the *binary* AccountID, ascending —
  // base58 address string order does not match this.
  const signers = [
    { Signer: { Account: aliceWallet.address, SigningPubKey: aliceSigned.Signers[0].Signer.SigningPubKey, TxnSignature: aliceSigned.Signers[0].Signer.TxnSignature } },
    { Signer: { Account: bobWallet.address,   SigningPubKey: bobSigned.Signers[0].Signer.SigningPubKey,   TxnSignature: bobSigned.Signers[0].Signer.TxnSignature } },
  ].sort((a, b) => Buffer.compare(decodeAccountID(a.Signer.Account), decodeAccountID(b.Signer.Account)));

  // Combine and submit (2-of-3 quorum met)
  const combined = await client.submitAndWait(encode({ ...tx1, Signers: signers } as any));
  console.log('Tx1 result:', combined.result.meta?.TransactionResult);

  await client.disconnect();
}

main();
```

`xrpl-up run` executes scripts with Node's normal module resolution, which only finds packages under the local `node_modules` of the project the script lives in — install `xrpl` there first (`npm install xrpl`).

```bash
DEST_JSON=$(xrpl-up faucet --network local --json)
DEST=$(echo "$DEST_JSON" | jq -r .address)

TREASURY=$TREASURY DEST=$DEST ALICE_SEED=$ALICE_SEED BOB_SEED=$BOB_SEED TICKET=$T1 \
  xrpl-up run scripts/multisig-sign.ts
# tesSUCCESS   ($T1 consumed)
```

---

## Part 4 — Submit Out-of-Order

With tickets, there is **no ordering requirement**. Reuse the same `scripts/multisig-sign.ts` from Part 3, submitting `$T3` before `$T2`:

```bash
# Tx using $T3 submitted first
TREASURY=$TREASURY DEST=$DEST ALICE_SEED=$ALICE_SEED BOB_SEED=$BOB_SEED TICKET=$T3 \
  xrpl-up run scripts/multisig-sign.ts
# tesSUCCESS   ($T3 consumed)

# Tx using $T2 submitted second — still valid
TREASURY=$TREASURY DEST=$DEST ALICE_SEED=$ALICE_SEED BOB_SEED=$BOB_SEED TICKET=$T2 \
  xrpl-up run scripts/multisig-sign.ts
# tesSUCCESS   ($T2 consumed)
```

After all tickets are used:

```bash
xrpl-up ticket list $TREASURY
# (empty — all tickets consumed)

xrpl-up account transactions $TREASURY --limit 5
# Three Payment txs — submitted out of order (12 before 11 before 10)
```

---

## Part 5 — Verify the Account State

```bash
xrpl-up account info $TREASURY
# DisableMaster  ✔
# SignerList     quorum 2  (Alice, Bob, Carol)
```

---

## Flow Summary

```
Treasury ──[signer-list 2-of-3]──> Alice + Bob + Carol

Tickets:   T10  T11  T12   (reserved upfront)

Alice signs T10 independently  ──┐
Bob   signs T10 independently  ──┤──> submit T10 (2-of-3 ✔)
                                  │
Carol signs T12 independently  ──┐│
Bob   signs T12 independently  ──┤┤──> submit T12 FIRST (out of order ✔)
                                  ││
Alice signs T11 independently  ──┐││
Bob   signs T11 independently  ──┤┤┤──> submit T11 LAST (still ✔)
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **SignerList** | On-ledger list of co-signers; transactions need combined weight ≥ quorum. |
| **disableMaster** | Prevents single-key signing; all txs require the signer list. Safe only after signer list is set. |
| **TicketSequence** | Replaces normal `Sequence`; set `Sequence = 0` in the tx. |
| **Out-of-order** | Ticket 12 can be submitted before ticket 10 — no ordering dependency. |
| **Multi-sig fee** | Transactions with multiple signers pay a higher fee (12 + 12 × N drops). |

---

## Next steps

- [Tickets](../simple/tickets.md) — tickets without multi-sig
- [Deposit Auth](../simple/deposit-auth.md) — control who can pay the treasury
- [Escrow](../simple/escrow.md) — lock treasury disbursements behind time or conditions
