# Payment Channel

Payment channels enable fast, low-cost, off-chain micropayments between two parties. The sender locks XRP on-chain once; then both parties can exchange signed claims off-chain (no transaction fee per claim); the receiver settles the final accumulated amount on-chain at the end.

**Ideal for:** streaming payments, pay-per-use APIs, metered services, gaming micropayments.

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Set up sender and receiver accounts

```bash
xrpl-up faucet --network local
# → seed: sEdSenderSeedXXX  address: rSenderXXX

xrpl-up faucet --network local
# → seed: sEdReceiverSeedXXX  address: rReceiverXXX

SENDER_SEED=sEdSenderSeedXXXXXXXXXXXXXXXXXXXXX
SENDER=rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXX
RECEIVER_SEED=sEdReceiverSeedXXXXXXXXXXXXXXXXX
RECEIVER=rReceiverXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 2. Open a payment channel

The sender locks XRP in the channel. The receiver can claim up to this amount over the channel's lifetime.

```bash
# Open a 50 XRP channel with a 1-hour settle delay
xrpl-up channel create --to $RECEIVER --amount 50 --seed $SENDER_SEED \
  --settle-delay 3600
# Transaction: D248064691A00691899A8A11F3568F4A56FBBAB99F5DA2483A27EB63F07AC470
# Result:      tesSUCCESS
# Fee:         0.000012 XRP
# Ledger:      37
# Channel ID:  ABCDEF1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

CHANNEL_ID=ABCDEF1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

`--settle-delay` is required (no default) — it's how long the receiver has to submit a final claim after the sender requests closure.

---

## 3. List open channels

The `Public Key` field here is what the receiver needs to verify/claim signed off-chain claims later:

```bash
xrpl-up channel list $SENDER
# Channel ID:   ABCDEF1234...
# Amount:       50.000000 XRP
# Balance:      0.000000 XRP
# Destination:  rReceiverXXX...
# Settle Delay: 3600 seconds
# Public Key:   ED1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

PUBKEY=ED1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 4. Sign off-chain claims (sender)

The sender generates signed payment authorizations off-chain — no on-chain transaction, no fee. `channel sign` prints only the raw signature hex (nothing else) — the receiver already has the public key from step 3:

```bash
# Authorize the receiver to claim up to 1 XRP
xrpl-up channel sign --channel $CHANNEL_ID --amount 1 --seed $SENDER_SEED
# 3045...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

SIG_1XRP=3045...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Send the signature to the receiver out-of-band (e.g., over a WebSocket, HTTP, or message queue) — they already have the channel's public key from `channel list`.

---

## 5. Sign incremental claims

Each new claim covers the cumulative total, not the increment. Always sign for the running total:

```bash
# After delivering more service, authorize up to 3 XRP total
xrpl-up channel sign --channel $CHANNEL_ID --amount 3 --seed $SENDER_SEED
# → SIG_3XRP=...

# After more, authorize up to 7 XRP total
xrpl-up channel sign --channel $CHANNEL_ID --amount 7 --seed $SENDER_SEED
# → SIG_7XRP=...
```

The receiver only needs to redeem the latest (highest-value) claim.

---

## 6. Verify a claim (receiver)

Before accepting a claim as payment, the receiver can verify its signature:

```bash
xrpl-up channel verify --channel $CHANNEL_ID --amount 7 --signature $SIG_7XRP --public-key $PUBKEY
# ✔ Claim signature valid
```

Exit code `1` if invalid — useful in automated systems.

---

## 7. Claim on-chain (receiver)

When the receiver wants to settle, they submit the best claim on-chain:

`--signature` requires both `--amount` (what the signature authorizes) and `--balance` (total XRP delivered by this claim — the same value for a single claim):

```bash
xrpl-up channel claim \
  --channel $CHANNEL_ID \
  --amount 7 \
  --balance 7 \
  --signature $SIG_7XRP \
  --public-key $PUBKEY \
  --seed $RECEIVER_SEED
# ✔ Channel claim submitted
#   redeemed  7 XRP
```

The receiver now holds 7 XRP; 43 XRP remains in the channel for future use.

---

## 8. Add more funds to the channel

If the channel is running low, the sender can top it up:

```bash
xrpl-up channel fund --channel $CHANNEL_ID --amount 20 --seed $SENDER_SEED
# ✔ Channel funded  +20 XRP  (total: 70 XRP)
```

---

## 9. Close the channel

### Option A: Receiver requests closure (immediate, if no pending balance)

```bash
xrpl-up channel claim --channel $CHANNEL_ID --close --seed $RECEIVER_SEED
# ✔ Channel closed
```

### Option B: Sender requests closure (with settle delay)

```bash
xrpl-up channel claim --channel $CHANNEL_ID --close --seed $SENDER_SEED
# ✔ Close requested — receiver has 3600 s to submit final claim
```

After the settle delay passes without a receiver claim, the sender can close the channel and recover remaining XRP:

```bash
# After settle delay expires:
xrpl-up channel claim --channel $CHANNEL_ID --close --seed $SENDER_SEED
# ✔ Channel closed  remaining 43 XRP returned to sender
```

---

## Full flow at a glance

```bash
# 1. Open channel
xrpl-up channel create --to $RECEIVER --amount 50 --settle-delay 3600 --seed $SENDER_SEED
# → CHANNEL_ID

# 2. Off-chain: sign claims as service is delivered (no fee)
xrpl-up channel sign --channel $CHANNEL_ID --amount 1  --seed $SENDER_SEED   # → SIG_1
xrpl-up channel sign --channel $CHANNEL_ID --amount 5  --seed $SENDER_SEED   # → SIG_5
xrpl-up channel sign --channel $CHANNEL_ID --amount 12 --seed $SENDER_SEED   # → SIG_12

# 3. Receiver verifies latest claim
xrpl-up channel verify --channel $CHANNEL_ID --amount 12 --signature $SIG_12 --public-key $PUBKEY

# 4. On-chain settlement (once)
xrpl-up channel claim --channel $CHANNEL_ID --amount 12 --balance 12 --signature $SIG_12 \
  --public-key $PUBKEY --seed $RECEIVER_SEED

# 5. Close
xrpl-up channel claim --channel $CHANNEL_ID --close --seed $RECEIVER_SEED
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Channel balance** | XRP locked by the sender. Not transferred until a claim is submitted. |
| **Claim** | An off-chain signed authorization for the receiver to claim up to `amount` XRP. |
| **Cumulative amount** | Each claim covers the *total* amount from channel open, not the increment. Always submit the highest claim. |
| **Settle delay** | Grace period after the sender requests closure — gives the receiver time to submit their final claim. |
| **Public key** | The channel source's Ed25519 / SECP256k1 public key, from the channel's own ledger data (`channel list`). Required by `channel verify`/`channel claim`. |

---

## Next steps

- [Escrow](escrow.md) — time-locked or conditional XRP (not off-chain)
- [Checks](checks.md) — deferred payment authorization
- [XRP Payment](xrp-payment.md) — simple on-chain transfers
