# Escrow with Crypto-Condition

A PREIMAGE-SHA-256 crypto-condition escrow lets you lock XRP behind a secret. Only the party who knows the **fulfillment** (preimage) can release the funds — not even the sender. This enables trustless atomic swaps, hash time-lock contracts (HTLC), and conditional payment flows.

This guide covers:
- Generating a condition/fulfillment pair
- Creating the conditional escrow
- Happy path: finish with the correct fulfillment
- Failure path: wrong fulfillment is rejected; expired escrow is cancelled

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local

# Install five-bells-condition for condition generation
npm install -g five-bells-condition
# or in a project: npm install five-bells-condition
```

---

## Step 1: Generate a condition/fulfillment pair

The **fulfillment** is the secret preimage. The **condition** is its hash — safe to publish on-chain.

```typescript
// scripts/gen-condition.ts
import * as cc from 'five-bells-condition';

// Any secret bytes — in production use crypto.randomBytes(32)
const preimage = Buffer.from('my-super-secret-preimage-32-bytes!');
const fulfillment = new cc.PreimageSha256();
fulfillment.setPreimage(preimage);

const fulfillmentHex  = fulfillment.serializeBinary().toString('hex').toUpperCase();
const conditionHex    = fulfillment.getConditionBinary().toString('hex').toUpperCase();

console.log('FULFILLMENT:', fulfillmentHex);
console.log('CONDITION:  ', conditionHex);
```

```bash
xrpl-up run scripts/gen-condition.ts
# FULFILLMENT: A0228020...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# CONDITION:   A0258020...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

FULFILLMENT=A0228020...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CONDITION=A0258020...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

> The **condition** is published on-chain. The **fulfillment** is shared only with the intended recipient — keep it secret until you want the escrow released.

---

## Step 2: Create accounts

```bash
xrpl-up faucet --local
# → seed: sEdSenderSeedXXX  address: rSenderXXX

xrpl-up faucet --local
# → seed: sEdReceiverSeedXXX  address: rReceiverXXX

SENDER_SEED=sEdSenderSeedXXXXXXXXXXXXXXXXXXXXX
SENDER=rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXX
RECEIVER_SEED=sEdReceiverSeedXXXXXXXXXXXXXXXXX
RECEIVER=rReceiverXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## Step 3: Create the conditional escrow

The sender locks 25 XRP behind the condition. The escrow auto-cancels after 7 days if not finished:

```bash
xrpl-up escrow create --to $RECEIVER --amount 25 --seed $SENDER_SEED \
  --condition $CONDITION \
  --cancel-after 2024-01-08T00:00:00Z
# ✔ Escrow created
#   sequence    42
#   amount      25 XRP  →  rReceiverXXX...
#   condition   A0258020...
#   cancelAfter 2024-01-08T00:00:00Z

ESCROW_OWNER=$SENDER
ESCROW_SEQ=42
```

Note: `--finish-after` is intentionally omitted — the condition alone gates release. No time restriction on when it can be finished (within the cancel window).

---

## Step 4: Inspect the escrow

```bash
xrpl-up escrow list $SENDER
# sequence  42  amount 25 XRP → rReceiverXXX...
# condition A0258020...  cancelAfter 2024-01-08T00:00:00Z
```

---

## Happy Path — Finish with the correct fulfillment

The receiver now presents the fulfillment (received out-of-band from the sender):

```bash
xrpl-up escrow finish --owner $ESCROW_OWNER --sequence $ESCROW_SEQ --seed $RECEIVER_SEED \
  --condition $CONDITION \
  --fulfillment $FULFILLMENT
# ✔ Escrow finished
#   25 XRP released to rReceiverXXX...
#   hash  ABCDEF...
```

Verify the escrow is gone and the receiver has the XRP:

```bash
xrpl-up escrow list $SENDER
# (empty)

xrpl-up accounts --local
# rReceiverXXX...  1025 XRP   ← original 1000 + 25 from escrow
```

---

## Failure Path A — Wrong fulfillment is rejected

If the wrong preimage is presented, the ledger rejects the transaction:

```typescript
// scripts/wrong-fulfillment.ts
import { Client, Wallet } from 'xrpl';
const client = new Client('ws://localhost:6006');
await client.connect();
const receiver = Wallet.fromSeed('sEdReceiverSeedXXXXXXXXXXXXXXXXXXX');
const tx = {
  TransactionType: 'EscrowFinish',
  Account: receiver.address,
  Owner: 'rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  OfferSequence: 42,
  Condition:   'A0258020...CORRECT',
  Fulfillment: 'A0228020...WRONG',   // wrong preimage
};
const prepared = await client.autofill(tx as any);
const signed = receiver.sign(prepared as any);
const result = await client.submitAndWait(signed.tx_blob);
console.log(result.result.meta?.TransactionResult);
// tecCRYPTOCONDITION_ERROR  ← ledger rejects wrong fulfillment
await client.disconnect();
```

```bash
xrpl-up run scripts/wrong-fulfillment.ts
# tecCRYPTOCONDITION_ERROR
```

The XRP stays locked — wrong preimage has no effect.

---

## Failure Path B — Cancel an expired escrow

If the receiver never presents the fulfillment and `CancelAfter` passes, anyone can cancel and return the XRP to the sender:

```bash
# (after CancelAfter time has passed — in the sandbox you can advance time
#  by waiting, or create a short --cancel-after for testing)

xrpl-up escrow create --to $RECEIVER --amount 10 --seed $SENDER_SEED \
  --condition $CONDITION \
  --cancel-after 2024-01-01T00:00:30Z
# → ESCROW_SEQ_SHORT=43

sleep 35

# Cancel the expired escrow (sender or anyone else can do this)
xrpl-up escrow cancel --owner $SENDER --sequence 43 --seed $SENDER_SEED
# ✔ Escrow cancelled  10 XRP returned to rSenderXXX...
```

---

## Using a crypto-condition for atomic swap (HTLC pattern)

The same condition/fulfillment pair can guard two simultaneous escrows — one on each "leg" of a cross-asset swap:

```
Leg A: Alice escrows 100 USD-equivalent to Bob's address   condition = C
Leg B: Bob   escrows 1 BTC-equivalent to Alice's address  condition = C

Alice reveals fulfillment F → claims Bob's leg
Bob uses same F to claim Alice's leg

Both legs finish or neither does (within cancel window)
```

On XRPL this is done with two `EscrowCreate` transactions using the same condition, then two `EscrowFinish` transactions using the same fulfillment.

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **PREIMAGE-SHA-256** | The only crypto-condition type XRPL supports. SHA-256 hash of a secret preimage. |
| **Condition** | The hash commitment — safe to publish on-chain. 32-byte fingerprint. |
| **Fulfillment** | The secret preimage — reveals knowledge, unlocks the escrow. |
| **tecCRYPTOCONDITION_ERROR** | Ledger error code for wrong fulfillment. Tx fee is still charged. |
| **CancelAfter** | After this time the escrow is expired; anyone can cancel it. |
| **HTLC** | Hash Time-Lock Contract pattern: same condition used on two cross-chain legs. |

---

## Next steps

- [Escrow](../simple/escrow.md) — time-based escrow (simpler, no condition)
- [Payment Channel](../simple/payment-channel.md) — off-chain micropayments with channel claims
- [Multi-Sig + Tickets](multi-sig-tickets.md) — require multiple approvers to finish an escrow
