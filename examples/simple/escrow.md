# Escrow

Lock XRP until a time condition or cryptographic condition is met. Escrows are useful for vesting schedules, conditional payments, and trustless agreements.

Two escrow types:
- **Time-based** — unlocks after a specific time (FinishAfter) and optionally expires (CancelAfter)
- **Crypto-condition** — unlocks only when a preimage satisfying a PREIMAGE-SHA-256 condition is provided

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Time-Based Escrow

### 1. Create the escrow

Fund a sender and create an escrow to a destination:

```bash
# Fund sender
xrpl-up faucet --local
# → seed: sEdSenderSeedXXX  address: rSenderXXX

# Fund destination
xrpl-up faucet --local
# → address: rDestXXX

SENDER_SEED=sEdSenderSeedXXXXXXXXXXXXXXXXXXXXX
SENDER=rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXX
DEST=rDestXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
DEST_SEED=sEdDestSeedXXXXXXXXXXXXXXXXXXXXX
```

Create a 10 XRP escrow that can finish in 30 seconds and auto-cancels after 1 day:

```bash
xrpl-up escrow create --to $DEST --amount 10 --seed $SENDER_SEED \
  --finish-after 2024-01-01T00:00:30Z \
  --cancel-after 2024-01-02T00:00:00Z
# ✔ Escrow created
#   sequence    42
#   amount      10 XRP → rDestXXX...
#   finishAfter 2024-01-01T00:00:30Z
#   cancelAfter 2024-01-02T00:00:00Z

ESCROW_SEQ=42
```

Time expressions:

| Format | Meaning |
|--------|---------|
| `2024-01-01T00:00:30Z` | 30 seconds from epoch |
| `2024-01-01T00:30:00Z` | 30 minutes from epoch |
| `2024-01-01T01:00:00Z` | 1 hour from epoch |
| `2024-01-02T00:00:00Z` | 1 day from epoch |
| `2024-01-08T00:00:00Z` | 7 days from epoch |
| `1700000000` | Absolute Unix timestamp |

---

### 2. List escrows

```bash
xrpl-up escrow list $SENDER
# sequence  42  amount 10 XRP → rDestXXX...  finishAfter: 2024-01-01T00:00:30Z  cancelAfter: 2024-01-02T00:00:00Z
```

---

### 3. Finish the escrow (after FinishAfter)

After the `--finish-after` time passes, the destination (or any account) can release the funds:

```bash
xrpl-up escrow finish --owner $SENDER --sequence $ESCROW_SEQ --seed $DEST_SEED
# ✔ Escrow finished  10 XRP released to rDestXXX...
```

The destination receives the XRP minus a small transaction fee.

---

### 4. Cancel an expired escrow

If the escrow's `CancelAfter` time has passed and it hasn't been finished, anyone can cancel it to return the XRP to the sender:

```bash
xrpl-up escrow cancel --owner $SENDER --sequence $ESCROW_SEQ --seed $SENDER_SEED
# ✔ Escrow cancelled  10 XRP returned to rSenderXXX...
```

---

## Crypto-Condition Escrow

A crypto-condition escrow requires a secret preimage — only the party who knows the preimage can finish it.

### 1. Generate a condition and fulfillment

Use the `five-bells-condition` library (or any PREIMAGE-SHA-256 tool):

```bash
# Example using Node.js
node -e "
const cc = require('five-bells-condition');
const preimage = Buffer.from('super-secret-preimage');
const f = new cc.PreimageSha256();
f.setPreimage(preimage);
console.log('FULFILLMENT:', f.serializeBinary().toString('hex').toUpperCase());
console.log('CONDITION:  ', f.getConditionBinary().toString('hex').toUpperCase());
"
# FULFILLMENT: A0228020...
# CONDITION:   A0258020...

FULFILLMENT=A0228020XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CONDITION=A0258020XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

### 2. Create the crypto-condition escrow

The sender publishes the **condition** (not the fulfillment) on-chain:

```bash
xrpl-up escrow create --to $DEST --amount 25 --seed $SENDER_SEED \
  --condition $CONDITION \
  --cancel-after 2024-01-08T00:00:00Z
# ✔ Escrow created  sequence 43
```

---

### 3. Finish with the fulfillment

When ready, the destination submits both the condition and the fulfillment:

```bash
xrpl-up escrow finish --owner $SENDER --sequence 43 --seed $DEST_SEED \
  --condition $CONDITION \
  --fulfillment $FULFILLMENT
# ✔ Escrow finished  25 XRP released
```

> **Security:** The fulfillment is the secret. Anyone who knows it can finish the escrow — share it only with the intended recipient.

---

## Escrow for vesting (example)

Model a 1-year vesting cliff with quarterly unlocks:

```bash
# Q1: 25 XRP unlocks after 90 days
xrpl-up escrow create --to $EMPLOYEE --amount 25 --seed $COMPANY_SEED \
  --finish-after 2024-04-01T00:00:00Z --cancel-after 2025-01-01T00:00:00Z

# Q2: 25 XRP unlocks after 180 days
xrpl-up escrow create --to $EMPLOYEE --amount 25 --seed $COMPANY_SEED \
  --finish-after 2024-07-01T00:00:00Z --cancel-after 2025-01-01T00:00:00Z

# Q3, Q4: similar...
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **FinishAfter** | Earliest time the escrow can be finished. Omit for crypto-condition-only escrows. |
| **CancelAfter** | After this time the escrow can be cancelled and XRP returned to the sender. |
| **Condition** | 32-byte PREIMAGE-SHA-256 condition hash published on-chain. |
| **Fulfillment** | The secret preimage; submitted by the finisher to prove knowledge. |
| **Reserve** | XRP locked in escrow counts toward the sender's ledger objects (2 XRP reserve per escrow). |

---

## Next steps

- [Payment Channel](payment-channel.md) — off-chain micropayments with on-chain settlement
- [Checks](checks.md) — deferred payment authorization without time locking
- [XRP Payment](xrp-payment.md) — instant XRP transfers
