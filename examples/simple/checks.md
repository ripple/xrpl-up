# Checks — Deferred Payments

A Check is like a paper cheque on the ledger. The sender authorizes a maximum amount; the receiver cashes it whenever they choose (up to an optional expiry). Unlike payments, Checks are non-custodial — XRP is not locked until the check is cashed.

Checks work with both **XRP** and **IOUs**.

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

A standalone sandbox's ledger clock isn't the wall clock — it advances at least 1 second per accepted ledger regardless of real elapsed time, so it can drift well ahead of `Date.now()` after a lot of activity. Compute expirations relative to the sandbox's actual current ledger time instead:

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

## 1. Set up sender and receiver

```bash
SENDER_JSON=$(xrpl-up faucet --network local --json)
SENDER_SEED=$(echo "$SENDER_JSON" | jq -r .seed)
SENDER=$(echo "$SENDER_JSON" | jq -r .address)

RECEIVER_JSON=$(xrpl-up faucet --network local --json)
RECEIVER_SEED=$(echo "$RECEIVER_JSON" | jq -r .seed)
RECEIVER=$(echo "$RECEIVER_JSON" | jq -r .address)
```

---

## 2. Create a check (XRP)

The sender creates a check for up to 10 XRP, valid for 7 days:

```bash
EXPIRY_7D=$(ledger_plus $((7*86400)))

CHECK_ID=$(xrpl-up check create --to $RECEIVER --send-max 10 --seed $SENDER_SEED \
  --expiration $EXPIRY_7D --json | jq -r .checkId)
```

---

## 3. Create an IOU check

An IOU check needs a real issuer, and the sender needs actual USD to back it once the receiver cashes it:

```bash
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED

# Sender needs a trust line + real USD balance to back the check
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $SENDER_SEED
xrpl-up payment --to $SENDER --amount 100/USD/$ISSUER --seed $ISSUER_SEED

# Receiver needs a trust line for USD to cash the check into
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $RECEIVER_SEED

EXPIRY_14D=$(ledger_plus $((14*86400)))

xrpl-up check create --to $RECEIVER --send-max 50/USD/$ISSUER --seed $SENDER_SEED \
  --expiration $EXPIRY_14D
```

---

## 4. List outstanding checks

```bash
xrpl-up check list $SENDER
xrpl-up check list $RECEIVER
# checkID  A1B2C3D4...  sendMax 10 XRP  from rSenderXXX...  expiry 7d
```

---

## 5. Cash a check — exact amount

Cashing a check always fully consumes the Check object, even for a partial amount (unlike an escrow, a check can't be drawn down incrementally) — so this uses `$CHECK_ID` from step 2 for this one demo only:

```bash
xrpl-up check cash --check $CHECK_ID --amount 5 --seed $RECEIVER_SEED
# ✔ Check cashed  received 5 XRP
```

---

## 6. Cash a check — flexible amount (deliver-min)

Instead of an exact amount, the receiver asks for "as much as possible, but at least 3 XRP". Since step 5 already consumed `$CHECK_ID`, this needs a fresh check:

```bash
EXPIRY_7D_2=$(ledger_plus $((7*86400)))
CHECK_ID_2=$(xrpl-up check create --to $RECEIVER --send-max 10 --seed $SENDER_SEED \
  --expiration $EXPIRY_7D_2 --json | jq -r .checkId)

xrpl-up check cash --check $CHECK_ID_2 --deliver-min 3 --seed $RECEIVER_SEED
# ✔ Check cashed  received 10 XRP  (full sendMax)
```

`--deliver-min` is useful when the exact available amount might vary (e.g., after partial rippling for IOU checks).

---

## 7. Cancel a check

Either the sender or the receiver can cancel — but only one cancel actually happens, since the first one deletes the Check object. Two fresh checks demonstrate both cases:

```bash
EXPIRY_7D_3=$(ledger_plus $((7*86400)))

# Sender cancels their own check
CHECK_ID_3=$(xrpl-up check create --to $RECEIVER --send-max 10 --seed $SENDER_SEED \
  --expiration $EXPIRY_7D_3 --json | jq -r .checkId)
xrpl-up check cancel --check $CHECK_ID_3 --seed $SENDER_SEED
# ✔ Check cancelled

# Receiver cancels a different check (also valid)
CHECK_ID_4=$(xrpl-up check create --to $RECEIVER --send-max 10 --seed $SENDER_SEED \
  --expiration $EXPIRY_7D_3 --json | jq -r .checkId)
xrpl-up check cancel --check $CHECK_ID_4 --seed $RECEIVER_SEED
```

---

## 8. Expiry and auto-cleanup

Checks with a past `--expiration` can be cancelled by anyone (including the sender), freeing up the 2 XRP object reserve:

```bash
# Create a check that expires 2 minutes from now (for testing)
EXPIRY_2M=$(ledger_plus 120)
EXPIRED_CHECK_ID=$(xrpl-up check create --to $RECEIVER --send-max 5 --seed $SENDER_SEED --expiration $EXPIRY_2M --json | jq -r .checkId)

# Wait for the ledger clock to pass the expiration, then cancel (anyone can do this after expiry)
sleep 130
xrpl-up check cancel --check $EXPIRED_CHECK_ID --seed $SENDER_SEED
```

---

## Use cases

| Use case | Pattern |
|----------|---------|
| **Payroll** | Issue salary checks; employees cash when they want |
| **Invoicing** | Client creates a check; vendor cashes on delivery |
| **Conditional release** | Check with expiry; cancel if contract is not fulfilled |
| **IOU disbursement** | Distribute tokens without pre-existing trust lines (receiver sets trust line, then cashes) |

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **SendMax** | Maximum amount the receiver can cash. They can cash less, never more. |
| **Non-custodial** | No XRP is locked when a check is created — the sender's balance must cover it at cash time. |
| **deliver-min** | Cash "as much as available" with a minimum threshold. If less than min is available, the transaction fails. |
| **Expiry** | Optional. After expiry anyone can cancel; before expiry only sender and receiver can cancel. |
| **Reserve** | Each check costs 2 XRP object reserve on the sender's account until cancelled or cashed. |

---

## Next steps

- [Escrow](escrow.md) — lock XRP until a time or condition (custodial)
- [Payment Channel](payment-channel.md) — streaming off-chain payments
- [Deposit Auth](deposit-auth.md) — control which senders can pay you
