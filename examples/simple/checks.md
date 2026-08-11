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

The sender creates a check for up to 10 XRP, valid for 7 days. Compute the expiration relative to now instead of hardcoding a date:

```bash
EXPIRY_7D=$(node -e "console.log(new Date(Date.now()+7*86400000).toISOString())")

CHECK_ID=$(xrpl-up check create --to $RECEIVER --send-max 10 --seed $SENDER_SEED \
  --expiration $EXPIRY_7D --json | jq -r .checkId)
```

---

## 3. Create an IOU check

```bash
# Requires the receiver to have a trust line for USD first
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $RECEIVER_SEED

EXPIRY_14D=$(node -e "console.log(new Date(Date.now()+14*86400000).toISOString())")

xrpl-up check create --to $RECEIVER --send-max 50/USD/$ISSUER --seed $SENDER_SEED \
  --expiration $EXPIRY_14D
# ✔ Check created  sendMax 50 USD  checkID EFGH5678...
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

The receiver cashes for exactly 5 XRP (less than the 10 XRP maximum):

```bash
xrpl-up check cash --check $CHECK_ID --amount 5 --seed $RECEIVER_SEED
# ✔ Check cashed  received 5 XRP
```

---

## 6. Cash a check — flexible amount (deliver-min)

Instead of an exact amount, the receiver asks for "as much as possible, but at least 3 XRP":

```bash
xrpl-up check cash --check $CHECK_ID --deliver-min 3 --seed $RECEIVER_SEED
# ✔ Check cashed  received 10 XRP  (full sendMax)
```

`--deliver-min` is useful when the exact available amount might vary (e.g., after partial rippling for IOU checks).

---

## 7. Cancel a check

Either the sender or the receiver can cancel at any time. After the expiry, anyone can cancel:

```bash
# Sender cancels their own check
xrpl-up check cancel --check $CHECK_ID --seed $SENDER_SEED
# ✔ Check cancelled  A1B2C3D4...

# Receiver cancels (also valid)
xrpl-up check cancel --check $CHECK_ID --seed $RECEIVER_SEED
```

---

## 8. Expiry and auto-cleanup

Checks with a past `--expiration` can be cancelled by anyone (including the sender), freeing up the 2 XRP object reserve:

```bash
# Create a check that expires in 10 seconds (for testing)
EXPIRY_10S=$(node -e "console.log(new Date(Date.now()+10*1000).toISOString())")
EXPIRED_CHECK_ID=$(xrpl-up check create --to $RECEIVER --send-max 5 --seed $SENDER_SEED --expiration $EXPIRY_10S --json | jq -r .checkId)

# Wait 10 seconds, then cancel (anyone can do this after expiry)
sleep 10
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
