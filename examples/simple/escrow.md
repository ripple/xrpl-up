# Escrow

Lock XRP until a time condition or cryptographic condition is met. Escrows are useful for vesting schedules, conditional payments, and trustless agreements.

Two escrow types:
- **Time-based** — unlocks after a specific time (FinishAfter) and optionally expires (CancelAfter)
- **Crypto-condition** — unlocks only when a preimage satisfying a PREIMAGE-SHA-256 condition is provided

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

A standalone sandbox's ledger clock isn't the wall clock — it advances at least 1 second per accepted ledger regardless of real elapsed time, so it can drift well ahead of `Date.now()` after a lot of activity. Compute `--finish-after`/`--cancel-after` relative to the sandbox's actual current ledger time instead:

```bash
ledger_plus() {
  SECS=$1 node -e "
    const { Client } = require('xrpl');
    (async () => {
      const client = new Client('ws://localhost:6006');
      await client.connect();
      const r = await client.request({ command: 'ledger', ledger_index: 'validated' });
      console.log(new Date((r.result.ledger.close_time + 946684800 + Number(process.env.SECS)) * 1000).toISOString());
      await client.disconnect();
    })();
  "
}
```

---

## Time-Based Escrow

### 1. Create the escrow

Fund a sender and create an escrow to a destination:

```bash
# Fund sender
SENDER_JSON=$(xrpl-up faucet --network local --json)
SENDER_SEED=$(echo "$SENDER_JSON" | jq -r .seed)
SENDER=$(echo "$SENDER_JSON" | jq -r .address)

# Fund destination
DEST_JSON=$(xrpl-up faucet --network local --json)
DEST_SEED=$(echo "$DEST_JSON" | jq -r .seed)
DEST=$(echo "$DEST_JSON" | jq -r .address)
```

Create a 10 XRP escrow that can finish in 2 minutes and auto-cancels after 1 day:

```bash
FINISH_AFTER=$(ledger_plus 120)
CANCEL_AFTER=$(ledger_plus $((1*86400)))

ESCROW_SEQ=$(xrpl-up escrow create --to $DEST --amount 10 --seed $SENDER_SEED \
  --finish-after $FINISH_AFTER \
  --cancel-after $CANCEL_AFTER \
  --json | jq -r .sequence)
```

`--finish-after`/`--cancel-after` accept an ISO-8601 timestamp or a raw Unix timestamp — always compute them relative to the current time rather than hardcoding a specific date, since a fixed past date fails immediately with `tecEXPIRED`/`tecNO_PERMISSION`.

---

### 2. List escrows

```bash
xrpl-up escrow list $SENDER
# sequence  42  amount 10 XRP → rDestXXX...  finishAfter/cancelAfter: whatever you computed above
```

---

### 3. Finish the escrow (after FinishAfter)

After the `--finish-after` time passes, the destination (or any account) can release the funds:

```bash
sleep 130   # wait for the ledger clock to pass FINISH_AFTER (2 min + margin)
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
# Example using Node.js — print as JSON so it can be captured directly, no manual copying
CC_JSON=$(node -e "
const cc = require('five-bells-condition');
const preimage = Buffer.from('super-secret-preimage');
const f = new cc.PreimageSha256();
f.setPreimage(preimage);
console.log(JSON.stringify({
  fulfillment: f.serializeBinary().toString('hex').toUpperCase(),
  condition: f.getConditionBinary().toString('hex').toUpperCase(),
}));
")
FULFILLMENT=$(echo "$CC_JSON" | jq -r .fulfillment)
CONDITION=$(echo "$CC_JSON" | jq -r .condition)
```

---

### 2. Create the crypto-condition escrow

The sender publishes the **condition** (not the fulfillment) on-chain:

```bash
CC_CANCEL_AFTER=$(ledger_plus $((7*86400)))

CC_ESCROW_SEQ=$(xrpl-up escrow create --to $DEST --amount 25 --seed $SENDER_SEED \
  --condition $CONDITION \
  --cancel-after $CC_CANCEL_AFTER \
  --json | jq -r .sequence)
```

---

### 3. Finish with the fulfillment

When ready, the destination submits both the condition and the fulfillment:

```bash
xrpl-up escrow finish --owner $SENDER --sequence $CC_ESCROW_SEQ --seed $DEST_SEED \
  --condition $CONDITION \
  --fulfillment $FULFILLMENT
# ✔ Escrow finished  25 XRP released
```

> **Security:** The fulfillment is the secret. Anyone who knows it can finish the escrow — share it only with the intended recipient.

---

## Escrow for vesting (example)

Model a 1-year vesting cliff with quarterly unlocks:

```bash
COMPANY_JSON=$(xrpl-up faucet --network local --json)
COMPANY_SEED=$(echo "$COMPANY_JSON" | jq -r .seed)

EMPLOYEE_JSON=$(xrpl-up faucet --network local --json)
EMPLOYEE=$(echo "$EMPLOYEE_JSON" | jq -r .address)

VEST_CANCEL_AFTER=$(ledger_plus $((365*86400)))

# Q1: 25 XRP unlocks after 90 days
Q1_FINISH_AFTER=$(ledger_plus $((90*86400)))
xrpl-up escrow create --to $EMPLOYEE --amount 25 --seed $COMPANY_SEED \
  --finish-after $Q1_FINISH_AFTER --cancel-after $VEST_CANCEL_AFTER

# Q2: 25 XRP unlocks after 180 days
Q2_FINISH_AFTER=$(ledger_plus $((180*86400)))
xrpl-up escrow create --to $EMPLOYEE --amount 25 --seed $COMPANY_SEED \
  --finish-after $Q2_FINISH_AFTER --cancel-after $VEST_CANCEL_AFTER

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
