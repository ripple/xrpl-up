# Multi-Sig + Tickets: Out-of-Order Parallel Signing

Combine a **SignerList** (2-of-3 multi-signature) with **Tickets** (reserved sequence numbers) so that multiple co-signers can independently prepare and submit transactions in any order — with no coordination overhead.

**Real-world use:** treasury accounts, DAO-style governance, corporate treasury requiring dual approval.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Part 1 — Set Up the Multi-Sig Account

### 1a. Create four accounts

The treasury account + three signers (Alice, Bob, Carol):

```bash
xrpl-up faucet --local; xrpl-up faucet --local
xrpl-up faucet --local; xrpl-up faucet --local
# Run xrpl-up accounts --local to see all four:
xrpl-up accounts --local
```

Assign to shell variables from the output:

```bash
TREASURY_SEED=sEdTreasurySeedXXXXXXXXXXXXXXXXXXX
TREASURY=rTreasuryXXXXXXXXXXXXXXXXXXXXXXXXXXX

ALICE=rAliceXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ALICE_SEED=sEdAliceSeedXXXXXXXXXXXXXXXXXXXXX

BOB=rBobXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
BOB_SEED=sEdBobSeedXXXXXXXXXXXXXXXXXXXXXXX

CAROL=rCarolXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 1b. Install a 2-of-3 signer list on the treasury

```bash
xrpl-up accountset signer-list 2 "$ALICE:1,$BOB:1,$CAROL:1" \
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

### 1c. Disable the master key (optional — enforces multi-sig only)

> ⚠️ Only do this after confirming the signer list is correct. If you disable the master key with no valid signer list you permanently lose access.

```bash
xrpl-up account set --set-flag disableMaster --seed $TREASURY_SEED
# ✔ Flag set: disableMaster
# ⚠  Master key is now disabled. All future transactions require multi-sig.
```

---

## Part 2 — Reserve Tickets

Tickets let co-signers prepare transactions independently — no sequence dependency between them.

### 2a. Reserve 3 tickets

```bash
# The treasury account reserves 3 tickets
# (requires multi-sig now that master key is disabled — use a script for this
#  or reserve tickets BEFORE disabling the master key)
xrpl-up ticket create 3 --seed $TREASURY_SEED
# ✔ 3 tickets created
#   sequences: 10, 11, 12

T1=10
T2=11
T3=12
```

### 2b. List the reserved tickets

```bash
xrpl-up ticket list $TREASURY
# TicketSequence  10
# TicketSequence  11
# TicketSequence  12
```

---

## Part 3 — Pre-Sign Transactions with Tickets

Each co-signer builds and signs a transaction using a different ticket. They can do this simultaneously — no ordering required.

Use a script with `xrpl-up run` to sign multi-sig transactions. Below is `scripts/multisig-sign.ts`:

```typescript
// scripts/multisig-sign.ts
import { Client, Wallet, encode } from 'xrpl';

const client = new Client('ws://localhost:6006');
await client.connect();

const treasury  = 'rTreasuryXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const dest      = 'rDestXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const aliceWallet = Wallet.fromSeed('sEdAliceSeedXXXXXXXXXXXXXXXXXXXXX');
const bobWallet   = Wallet.fromSeed('sEdBobSeedXXXXXXXXXXXXXXXXXXXXXXX');

// Tx 1: uses ticket 10 — Alice and Bob sign independently
const tx1 = {
  TransactionType: 'Payment',
  Account: treasury,
  Destination: dest,
  Amount: '5000000',    // 5 XRP in drops
  Sequence: 0,          // must be 0 when using a ticket
  TicketSequence: 10,
  Fee: '12',
  SigningPubKey: '',    // empty for multi-sig
};

// Alice signs
const aliceSig = aliceWallet.sign(tx1 as any, true);  // true = multi-sign
console.log('Alice sig:', aliceSig.tx_blob);

// Bob signs
const bobSig = bobWallet.sign(tx1 as any, true);
console.log('Bob sig:', bobSig.tx_blob);

// Combine and submit (2-of-3 quorum met)
const combined = await client.submitAndWait(encode({
  ...tx1,
  Signers: [
    { Signer: { Account: aliceWallet.address, SigningPubKey: aliceWallet.publicKey, TxnSignature: JSON.parse(Buffer.from(aliceSig.tx_blob, 'hex').toString()).TxnSignature } },
    { Signer: { Account: bobWallet.address,   SigningPubKey: bobWallet.publicKey,   TxnSignature: JSON.parse(Buffer.from(bobSig.tx_blob, 'hex').toString()).TxnSignature } },
  ],
} as any));
console.log('Tx1 result:', combined.result.meta?.TransactionResult);

await client.disconnect();
```

```bash
xrpl-up run scripts/multisig-sign.ts
# tesSUCCESS   (ticket 10 consumed)
```

---

## Part 4 — Submit Out-of-Order

With tickets, there is **no ordering requirement**. Submit Tx using ticket 12 before ticket 11:

```bash
# Tx using ticket 12 submitted first
xrpl-up run scripts/multisig-sign-t12.ts
# tesSUCCESS   (ticket 12 consumed)

# Tx using ticket 11 submitted second — still valid
xrpl-up run scripts/multisig-sign-t11.ts
# tesSUCCESS   (ticket 11 consumed)
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
