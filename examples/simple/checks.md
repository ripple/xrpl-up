# Checks — Deferred Payments

A Check is like a paper cheque on the ledger. The sender authorizes a maximum amount; the receiver cashes it whenever they choose (up to an optional expiry). Unlike payments, Checks are non-custodial — XRP is not locked until the check is cashed.

Checks work with both **XRP** and **IOUs**.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## 1. Set up sender and receiver

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

## 2. Create a check (XRP)

The sender creates a check for up to 10 XRP, valid for 7 days:

```bash
xrpl-up check create $RECEIVER 10 --local --seed $SENDER_SEED \
  --expiry +7d
# ✔ Check created
#   checkID  A1B2C3D4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   sendMax  10 XRP → rReceiverXXX...
#   expiry   2024-01-08T00:00:00Z

CHECK_ID=A1B2C3D4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 3. Create an IOU check

```bash
# Requires the receiver to have a trust line for USD first
xrpl-up trustline set USD.$ISSUER 10000 --local --seed $RECEIVER_SEED

xrpl-up check create $RECEIVER "50.USD.$ISSUER" --local --seed $SENDER_SEED \
  --expiry +30d
# ✔ Check created  sendMax 50 USD  checkID EFGH5678...
```

---

## 4. List outstanding checks

```bash
xrpl-up check list --local
xrpl-up check list --local --account $RECEIVER
# checkID  A1B2C3D4...  sendMax 10 XRP  from rSenderXXX...  expiry 7d
```

---

## 5. Cash a check — exact amount

The receiver cashes for exactly 5 XRP (less than the 10 XRP maximum):

```bash
xrpl-up check cash $CHECK_ID 5 --local --seed $RECEIVER_SEED
# ✔ Check cashed  received 5 XRP
```

---

## 6. Cash a check — flexible amount (deliver-min)

Instead of an exact amount, the receiver asks for "as much as possible, but at least 3 XRP":

```bash
xrpl-up check cash $CHECK_ID --deliver-min 3 --local --seed $RECEIVER_SEED
# ✔ Check cashed  received 10 XRP  (full sendMax)
```

`--deliver-min` is useful when the exact available amount might vary (e.g., after partial rippling for IOU checks).

---

## 7. Cancel a check

Either the sender or the receiver can cancel at any time. After the expiry, anyone can cancel:

```bash
# Sender cancels their own check
xrpl-up check cancel $CHECK_ID --local --seed $SENDER_SEED
# ✔ Check cancelled  A1B2C3D4...

# Receiver cancels (also valid)
xrpl-up check cancel $CHECK_ID --local --seed $RECEIVER_SEED
```

---

## 8. Expiry and auto-cleanup

Checks with a past `--expiry` can be cancelled by anyone (including the sender), freeing up the 2 XRP object reserve:

```bash
# Create a check that expires in 10 seconds (for testing)
xrpl-up check create $RECEIVER 5 --local --seed $SENDER_SEED --expiry +10s

# Wait 10 seconds, then cancel (anyone can do this after expiry)
sleep 10
xrpl-up check cancel $EXPIRED_CHECK_ID --local --seed $SENDER_SEED
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
