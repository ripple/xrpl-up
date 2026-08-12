# Regulated Token: RequireAuth + DepositAuth + Clawback

A fully-regulated IOU token flow where the issuer controls every step: only approved holders can open a trust line, only approved senders can pay the regulated account, and the issuer can reclaim tokens at any time.

**Real-world use:** stablecoins, CBDCs, tokenised securities, regulated payment instruments.

---

## Prerequisites

```bash
xrpl-up start
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Architecture

```
Issuer (regulated)
  ├── asfRequireAuth       → must approve every trust line before tokens can flow
  ├── asfAllowClawback     → can reclaim tokens from any holder
  └── asfDepositAuth       → only whitelisted senders can pay the issuer account

Holder A (approved)        Holder B (rejected)
  └── trust line approved    └── trust line created, but NOT approved
        ↓                          ↓ payment attempt fails
  receives tokens          blocked (tecPATH_DRY)
```

---

## Step 1: Create the regulated issuer account

```bash
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)
```

---

## Step 2: Enable all compliance flags on the issuer

> ⚠️ `allowClawback` is **permanent and irreversible** — do this before any trust lines exist.

```bash
# Allow clawback of issued tokens (must come first, before any trust lines)
xrpl-up account set --allow-clawback --confirm --seed $ISSUER_SEED
# ✔ Flag set: allowClawback (permanent)

# Require issuer approval for every trust line
xrpl-up account set --set-flag requireAuth --seed $ISSUER_SEED
# ✔ Flag set: requireAuth

# Block unsolicited deposits (whitelist-only incoming payments)
xrpl-up account set --set-flag depositAuth --seed $ISSUER_SEED
# ✔ Flag set: depositAuth

# Enable DefaultRipple so tokens can ripple through the issuer's trust lines
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED
# ✔ DefaultRipple enabled
```

Verify all flags are set:

```bash
xrpl-up account info $ISSUER
# requireAuth              ✔
# depositAuth              ✔
# defaultRipple            ✔
# allowTrustLineClawback   ✔
```

---

## Step 3: Create holder accounts

```bash
HOLDER_A_JSON=$(xrpl-up faucet --network local --json)   # will be approved
HOLDER_A_SEED=$(echo "$HOLDER_A_JSON" | jq -r .seed)
HOLDER_A=$(echo "$HOLDER_A_JSON" | jq -r .address)

HOLDER_B_JSON=$(xrpl-up faucet --network local --json)   # will be rejected
HOLDER_B_SEED=$(echo "$HOLDER_B_JSON" | jq -r .seed)
HOLDER_B=$(echo "$HOLDER_B_JSON" | jq -r .address)
```

---

## Step 4: Holders request trust lines

Both holders set trust lines. With `requireAuth` active, the trust line exists but is **unauthorized** until the issuer approves it — no tokens can flow yet.

```bash
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $HOLDER_A_SEED
# ✔ Trust line set (pending issuer authorization)

xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $HOLDER_B_SEED
# ✔ Trust line set (pending issuer authorization)
```

---

## Step 5: Issuer approves Holder A only

```bash
# Approve Holder A's trust line
xrpl-up trust set --currency USD --issuer $HOLDER_A --limit 0 --auth --seed $ISSUER_SEED
# ✔ Trust line authorized: USD / rHolderAXXX...

# Holder B is NOT authorized — deliberately left pending
```

Verify:

```bash
xrpl-up account trust-lines $HOLDER_A
# USD  rIssuerXXX...  balance 0  limit 10000  authorized: true

xrpl-up account trust-lines $HOLDER_B
# USD  rIssuerXXX...  balance 0  limit 10000  authorized: false
```

---

## Step 6: Pre-authorize Holder A to send deposits to the issuer

With `depositAuth` active on the issuer, only whitelisted accounts can pay it. Pre-authorize Holder A:

```bash
xrpl-up deposit-preauth set --authorize $HOLDER_A --seed $ISSUER_SEED
# ✔ Pre-authorized: rHolderAXXX...  →  rIssuerXXX...

xrpl-up deposit-preauth list $ISSUER
# rHolderAXXX...
```

---

## Step 7: Issue tokens to Holder A

```bash
xrpl-up payment --to $HOLDER_A --amount 1000/USD/$ISSUER --seed $ISSUER_SEED
# tesSUCCESS
```

---

## Step 8: Verify Holder B cannot receive tokens

Holder B's trust line is unauthorized — any attempt to send USD to Holder B from the issuer fails:

```bash
# Attempting to issue to Holder B (unauthorized trust line) → fails
# Demonstrated in a script; result will be tecPATH_DRY or tecNO_AUTH
```

---

## Step 9: Compliance action — freeze Holder A

Suspending a holder while a compliance review is conducted:

```bash
xrpl-up trust set --currency USD --issuer $HOLDER_A --limit 0 --freeze --seed $ISSUER_SEED
# ✔ Trust line frozen: USD / rHolderAXXX...
# (Holder A can no longer send or receive USD)

# After review, unfreeze:
xrpl-up trust set --currency USD --issuer $HOLDER_A --limit 0 --unfreeze --seed $ISSUER_SEED
# ✔ Trust line unfrozen
```

---

## Step 10: Clawback — reclaim tokens from Holder A

```bash
# Reclaim 200 USD from Holder A (e.g. sanctions hit)
xrpl-up clawback --amount 200/USD/$HOLDER_A --seed $ISSUER_SEED
# ✔ Clawback successful  200 USD  ← rHolderAXXX...

# Verify balance dropped
xrpl-up account trust-lines $HOLDER_A
# USD  rIssuerXXX...  balance 800  (was 1000)
```

---

## Step 11: Revoke DepositPreauth and RequireAuth (if winding down)

```bash
# Revoke Holder A's deposit whitelist entry
xrpl-up deposit-preauth set --unauthorize $HOLDER_A --seed $ISSUER_SEED

# Clear requireAuth (allowed — no tokens remain to be authorized)
xrpl-up account set --clear-flag requireAuth --seed $ISSUER_SEED

# Clear depositAuth
xrpl-up account set --clear-flag depositAuth --seed $ISSUER_SEED
```

> **Note:** `allowClawback` cannot be cleared — it is permanent by design.

---

## Compliance action matrix

| Scenario | Command |
|----------|---------|
| Approve a new holder | `trust set --currency USD --issuer $HOLDER --limit 0 --auth --seed $ISSUER_SEED` |
| Suspend a holder | `trust set --currency USD --issuer $HOLDER --limit 0 --freeze --seed $ISSUER_SEED` |
| Reinstate a holder | `trust set --currency USD --issuer $HOLDER --limit 0 --unfreeze --seed $ISSUER_SEED` |
| Freeze all holders (emergency) | `account set --set-flag globalFreeze --seed $ISSUER_SEED` |
| Reclaim tokens | `clawback --amount <amount>/USD/$HOLDER --seed $ISSUER_SEED` |
| Block a sender | `deposit-preauth set --unauthorize $SENDER --seed $ISSUER_SEED` |
| Allow a sender | `deposit-preauth set --authorize $SENDER --seed $ISSUER_SEED` |

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **requireAuth** | Holders must wait for issuer approval before tokens can flow through a trust line. |
| **allowClawback** | Permanent issuer power to reclaim tokens. Must be set before any trust lines. |
| **depositAuth** | Blocks all unsolicited payments; only whitelisted senders can pay the issuer. |
| **Individual freeze** | Freeze a specific trust line without affecting others. |
| **Global freeze** | Emergency halt; freezes all token movements across all trust lines. |

---

## Next steps

- [Clawback](../simple/clawback.md) — clawback details for IOU and MPT
- [MPT Policy Lifecycle](mpt-policy-lifecycle.md) — equivalent controls for MPT tokens
- [Deposit Auth](../simple/deposit-auth.md) — DepositPreauth in depth
