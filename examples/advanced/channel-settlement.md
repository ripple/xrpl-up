# Payment Channel Settlement Lifecycle

A deep-dive into a full payment channel lifecycle: open, stream incremental claims off-chain, make partial on-chain settlements mid-session, observe the timing window around channel closure, and verify final state.

This guide goes beyond the quick-start [payment-channel.md](../simple/payment-channel.md) and focuses on the **partial settlement** and **close timing** behaviour.

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Step 1: Create accounts

```bash
SENDER_JSON=$(xrpl-up faucet --network local --json)
SENDER_SEED=$(echo "$SENDER_JSON" | jq -r .seed)
SENDER=$(echo "$SENDER_JSON" | jq -r .address)

RECEIVER_JSON=$(xrpl-up faucet --network local --json)
RECEIVER_SEED=$(echo "$RECEIVER_JSON" | jq -r .seed)
RECEIVER=$(echo "$RECEIVER_JSON" | jq -r .address)
```

---

## Step 2: Open a 100 XRP channel

Use a short settle delay (600 seconds = 10 minutes) so close timing is easy to observe in the sandbox:

```bash
CHANNEL_ID=$(xrpl-up channel create --to $RECEIVER --amount 100 --seed $SENDER_SEED \
  --settle-delay 600 --json | jq -r .channelId)
```

Inspect the channel:

```bash
xrpl-up channel list $SENDER
# channelID  ABCDEF1234...  amount 100 XRP  balance 0 XRP  dest rReceiverXXX...
```

> **`balance`** is how much has been claimed on-chain so far. **`amount`** is the total locked in the channel.

---

## Step 3: Sign and exchange incremental off-chain claims

The sender issues signed claims as service is delivered. Each claim covers the **cumulative total**:

`channel sign` prints only the raw signature hex (no other fields). The channel uses the sender's own key by default, so derive the public key directly from the seed:

```bash
PUBKEY=$(xrpl-up wallet address --seed $SENDER_SEED --json | jq -r .publicKey)

# After delivering unit 1 (worth 5 XRP):
SIG_5=$(xrpl-up channel sign --channel $CHANNEL_ID --amount 5 --seed $SENDER_SEED --json | jq -r .signature)

# After delivering unit 2 (cumulative: 12 XRP):
SIG_12=$(xrpl-up channel sign --channel $CHANNEL_ID --amount 12 --seed $SENDER_SEED --json | jq -r .signature)

# After delivering unit 3 (cumulative: 27 XRP):
SIG_27=$(xrpl-up channel sign --channel $CHANNEL_ID --amount 27 --seed $SENDER_SEED --json | jq -r .signature)
```

> The receiver only needs to keep the **latest (highest-value) claim** — earlier ones are superseded.

Verify a claim before accepting it:

```bash
xrpl-up channel verify --channel $CHANNEL_ID --amount 27 --signature $SIG_27 --public-key $PUBKEY
# ✔ Claim signature valid
```

---

## Step 4: First partial on-chain settlement

The receiver decides to settle 27 XRP mid-session (e.g., end-of-day batch settlement). The channel stays open for more payments:

```bash
xrpl-up channel claim --channel $CHANNEL_ID \
  --amount 27 --balance 27 --signature $SIG_27 --public-key $PUBKEY \
  --seed $RECEIVER_SEED
# ✔ Channel claim submitted
#   redeemed  27 XRP  (channel balance: 27 XRP / 100 XRP)
```

Inspect the channel — `balance` increased, `amount` unchanged:

```bash
xrpl-up channel list $SENDER
# channelID  ABCDEF1234...  amount 100 XRP  balance 27 XRP  dest rReceiverXXX...
# → 73 XRP remaining capacity
```

---

## Step 5: Continue streaming claims after partial settlement

The next batch of claims continues from the cumulative total (not from zero):

```bash
# Cumulative total after continued service: 45 XRP
SIG_45=$(xrpl-up channel sign --channel $CHANNEL_ID --amount 45 --seed $SENDER_SEED --json | jq -r .signature)

# Cumulative total: 68 XRP
SIG_68=$(xrpl-up channel sign --channel $CHANNEL_ID --amount 68 --seed $SENDER_SEED --json | jq -r .signature)
```

---

## Step 6: Second partial settlement — claim the new total

Submit the latest claim (68 XRP cumulative). The channel pays out only the **delta** since last settlement (68 − 27 = 41 XRP):

```bash
xrpl-up channel claim --channel $CHANNEL_ID \
  --amount 68 --balance 68 --signature $SIG_68 --public-key $PUBKEY \
  --seed $RECEIVER_SEED
# ✔ Channel claim submitted
#   total claimed  68 XRP  (delta: 41 XRP this settlement)
#   channel balance: 68 / 100 XRP
```

> **Important:** Always submit the **cumulative** total (68), not the delta (41). The ledger tracks what has already been paid and only transfers the difference.

---

## Step 7: Top up the channel

If the sender wants to extend the session beyond the original 100 XRP cap:

```bash
xrpl-up channel fund --channel $CHANNEL_ID --amount 50 --seed $SENDER_SEED
# ✔ Channel funded  +50 XRP  (total: 150 XRP)

xrpl-up channel list $SENDER
# amount 150 XRP  balance 68 XRP  → 82 XRP remaining capacity
```

---

## Step 8: Sender requests channel closure (settle delay begins)

When the sender wants to stop the session, they request closure. The settle delay gives the receiver time to submit their final claim:

```bash
xrpl-up channel claim --channel $CHANNEL_ID --close --seed $SENDER_SEED
# ✔ Close requested
# ⏳ Receiver has 600 s to submit final claim
#    After that, sender can close and recover remaining XRP
```

---

## Step 9: Receiver submits final claim before the deadline

The receiver still has claims in-hand (say, SIG_90 for 90 XRP cumulative). They submit the final settlement:

```bash
SIG_90=$(xrpl-up channel sign --channel $CHANNEL_ID --amount 90 --seed $SENDER_SEED --json | jq -r .signature)

xrpl-up channel claim --channel $CHANNEL_ID \
  --amount 90 --balance 90 --signature $SIG_90 --public-key $PUBKEY \
  --close --seed $RECEIVER_SEED
# ✔ Final settlement + channel closed
#   total claimed  90 XRP  (delta: 22 XRP this settlement)
#   channel closed
#   remaining 60 XRP returned to rSenderXXX...
```

Passing `--close` alongside the claim amount performs the final settlement and closes the channel in a single transaction.

---

## Failure path: receiver misses the settle-delay window

If the receiver does **not** submit within the settle delay after the sender requests closure:

```bash
# After settle-delay expires (600 s in this example):
xrpl-up channel claim --channel $CHANNEL_ID --close --seed $SENDER_SEED
# ✔ Channel force-closed
#   No pending receiver claim — all remaining XRP returned to sender
```

> The sender recovers all unclaimed funds. Any signed claims the receiver held are now worthless — they expired with the channel.

---

## Final state verification

```bash
xrpl-up channel list $SENDER
# (empty — channel closed)

xrpl-up account transactions $SENDER --limit 10
# PaymentChannelCreate   tesSUCCESS  open 100 XRP channel
# PaymentChannelFund     tesSUCCESS  +50 XRP
# PaymentChannelClaim    tesSUCCESS  close requested

xrpl-up account transactions $RECEIVER --limit 10
# PaymentChannelClaim    tesSUCCESS  27 XRP  (first settlement)
# PaymentChannelClaim    tesSUCCESS  68 XRP  (second settlement)
# PaymentChannelClaim    tesSUCCESS  90 XRP  (final + close)
```

---

## Settlement patterns summary

| Pattern | When to use | Command |
|---------|-------------|---------|
| **Mid-session settlement** | Periodic batching (daily, weekly) | `channel claim --amount X --signature S --public-key K` |
| **Final settlement + close** | End of session (receiver-initiated) | `channel claim --amount X --signature S --public-key K --close` |
| **Receiver-only close** | No pending claims, channel empty | `channel claim --close` |
| **Sender close request** | Start settle-delay countdown | `channel claim --close` (sender seed) |
| **Force close** | After settle-delay expired, no receiver claim | `channel claim --close` (sender seed, second call) |

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Cumulative claims** | Each claim is for the total from open, not an increment. Submit the highest one. |
| **Channel balance** | On-chain settled total. `amount − balance` = remaining claimable capacity. |
| **Settle delay** | Grace period after sender requests close. Receiver must claim within this window. |
| **Partial settlement** | Claim mid-session; channel stays open. Ledger pays only the delta since last claim. |
| **Top-up** | `channel fund` increases `amount` without closing. Useful for long-running sessions. |

---

## Next steps

- [Payment Channel](../simple/payment-channel.md) — basic channel quickstart
- [Escrow](../simple/escrow.md) — time-locked on-chain settlement alternative
- [Tickets](../simple/tickets.md) — parallel transaction submission patterns
