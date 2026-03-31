# Deposit Authorization (DepositPreauth)

When `DepositAuth` is enabled on an account, it blocks all incoming payments unless the sender is explicitly pre-authorized. This is useful for regulated accounts, exchanges, and smart-contract-style accounts that need tight control over who can deposit.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Set up accounts

```bash
# The account that will require deposit authorization
xrpl-up faucet --local
# → seed: sEdReceiverSeedXXX  address: rReceiverXXX

# An authorized sender
xrpl-up faucet --local
# → seed: sEdSenderASeedXXX  address: rSenderAXXX

# An unauthorized sender (for testing)
xrpl-up faucet --local
# → seed: sEdSenderBSeedXXX  address: rSenderBXXX

RECEIVER_SEED=sEdReceiverSeedXXXXXXXXXXXXXXXXX
RECEIVER=rReceiverXXXXXXXXXXXXXXXXXXXXXXXXXXX
SENDER_A_SEED=sEdSenderASeedXXXXXXXXXXXXXXXXX
SENDER_A=rSenderAXXXXXXXXXXXXXXXXXXXXXXXXXXX
SENDER_B=rSenderBXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 2. Enable DepositAuth on the receiver

```bash
xrpl-up account set --set-flag depositAuth --seed $RECEIVER_SEED
# ✔ Flag set: DepositAuth

# Verify
xrpl-up account info $RECEIVER
# DepositAuth  ✔
```

Once enabled, any payment not from a pre-authorized account will fail with `tecNO_PERMISSION`.

---

## 3. Pre-authorize a specific sender

```bash
xrpl-up deposit-preauth set --authorize $SENDER_A --seed $RECEIVER_SEED
# ✔ Pre-authorized: rSenderAXXX...  →  rReceiverXXX...
```

---

## 4. List pre-authorizations

```bash
xrpl-up deposit-preauth list $RECEIVER
# Pre-authorized senders for rReceiverXXX...:
#   rSenderAXXX...

# Or specify an account explicitly
xrpl-up deposit-preauth list $RECEIVER
```

---

## 5. Authorized sender can now pay (via xrpl-up run script or escrow/check)

Payments from `rSenderA` succeed; payments from `rSenderB` fail.

With Checks as a workaround (the receiver cashes the check — no deposit restriction applies):

```bash
# Sender B creates a check (anyone can create a check to an account with depositAuth)
xrpl-up check create --to $RECEIVER --send-max 5 --seed $SENDER_B_SEED

# Receiver cashes the check (receiver initiates — not a direct payment, so depositAuth does not block it)
xrpl-up check cash $CHECK_ID --amount 5 --seed $RECEIVER_SEED
```

> **Note:** DepositAuth blocks *incoming payments*, not *cashing checks* (which are receiver-initiated). Escrow finishes and channel claims are similarly receiver-initiated and bypass DepositAuth.

---

## 6. Revoke a pre-authorization

```bash
xrpl-up deposit-preauth set --unauthorize $SENDER_A --seed $RECEIVER_SEED
# ✔ Pre-authorization revoked: rSenderAXXX...

# Confirm the list is now empty
xrpl-up deposit-preauth list $RECEIVER
# (no pre-authorized senders)
```

---

## 7. Disable DepositAuth

```bash
xrpl-up account set --clear-flag depositAuth --seed $RECEIVER_SEED
# ✔ Flag cleared: DepositAuth
```

---

## Use cases

| Use case | Why DepositAuth helps |
|----------|-----------------------|
| **Regulated exchange** | Only allow deposits from KYC-verified addresses |
| **Treasury account** | Block unsolicited transfers from unknown addresses |
| **Smart-contract-like account** | Authorize only specific counterparties or protocols |
| **Dust attack prevention** | Block spam XRP sends and trust-line creation attempts |

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **DepositAuth** | Account flag that blocks all incoming payments unless the sender is pre-authorized. |
| **DepositPreauth object** | Ledger object created per authorized address. Each costs 2 XRP reserve. |
| **Check / Escrow bypass** | Receiver-initiated actions (cashing checks, finishing escrows) are not blocked by DepositAuth. |
| **Self-send** | An account can always pay itself even with DepositAuth enabled. |

---

## Next steps

- [Checks](checks.md) — deferred payments that work with DepositAuth
- [Escrow](escrow.md) — trustless conditional payments
- [Tickets](tickets.md) — parallel transaction submission
