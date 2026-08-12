# MPT Policy Lifecycle: RequireAuth + Lock + Clawback

A fully-controlled MPT issuance where the issuer governs every phase: holders must be explicitly authorized, individual balances can be locked (compliance hold), and tokens can be clawed back at any time. Covers the complete lifecycle through to issuance destruction.

This guide complements [MPT](mpt.md) with a focus on the **policy controls** rather than the basic flow.

---

## Prerequisites

```bash
xrpl-up start
xrpl-up status   # wait until "healthy"
export XRPL_NETWORK=local
```

---

## Issuance Policy Matrix

| Policy flag | CLI flag | Effect |
|-------------|----------|--------|
| `tfMPTRequireAuth` | `--flags require-auth` | Issuer must approve each holder before tokens can flow |
| `tfMPTCanLock` | `--flags can-lock` | Issuer can freeze individual holders or the entire issuance |
| `tfMPTCanClawback` | `--flags can-clawback` | Issuer can reclaim tokens from any holder |
| `tfMPTCanTransfer` | `--flags can-transfer` | Holders can transfer tokens to each other (off by default) |

All policy flags are **set at issuance creation and cannot be changed afterwards**.

---

## Step 1: Create issuer and holder accounts

```bash
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)

HOLDER_A_JSON=$(xrpl-up faucet --network local --json)   # will be approved
HOLDER_A_SEED=$(echo "$HOLDER_A_JSON" | jq -r .seed)
HOLDER_A=$(echo "$HOLDER_A_JSON" | jq -r .address)

HOLDER_B_JSON=$(xrpl-up faucet --network local --json)   # will attempt to opt-in, then be rejected
HOLDER_B_SEED=$(echo "$HOLDER_B_JSON" | jq -r .seed)
HOLDER_B=$(echo "$HOLDER_B_JSON" | jq -r .address)

HOLDER_C_JSON=$(xrpl-up faucet --network local --json)   # approved, then locked, then clawback
HOLDER_C_SEED=$(echo "$HOLDER_C_JSON" | jq -r .seed)
HOLDER_C=$(echo "$HOLDER_C_JSON" | jq -r .address)
```

---

## Step 2: Create the MPT issuance with all policy controls

```bash
MPT_ID=$(xrpl-up mptoken issuance create --seed $ISSUER_SEED \
  --max-amount 1000000 \
  --asset-scale 2 \
  --transfer-fee 50 \
  --metadata "Regulated MPT v1" \
  --flags can-transfer,require-auth,can-lock,can-clawback \
  --json | jq -r .issuanceId)
```

---

## Step 3: Verify issuance details

```bash
xrpl-up mptoken issuance get $MPT_ID
# issuer           rIssuerXXX...
# outstanding      0
# max amount       1000000
# asset scale      2
# transfer fee     50 (0.5%)
# flags            transferable, require-auth, can-lock, can-clawback
# metadata         "Regulated MPT v1"
```

---

## Step 4: Holders opt in (MPTokenAuthorize)

With `--flags require-auth`, holders can opt in but tokens cannot flow until the issuer approves them:

```bash
# Holder A opts in
xrpl-up mptoken authorize $MPT_ID --seed $HOLDER_A_SEED
# ✔ MPToken holder opted in (pending issuer authorization)  rHolderAXXX...

# Holder B opts in
xrpl-up mptoken authorize $MPT_ID --seed $HOLDER_B_SEED
# ✔ MPToken holder opted in (pending issuer authorization)  rHolderBXXX...

# Holder C opts in
xrpl-up mptoken authorize $MPT_ID --seed $HOLDER_C_SEED
# ✔ MPToken holder opted in (pending issuer authorization)  rHolderCXXX...
```

---

## Step 5: Issuer authorizes Holder A and Holder C; rejects Holder B

```bash
# Authorize Holder A
xrpl-up mptoken authorize $MPT_ID --seed $ISSUER_SEED --holder $HOLDER_A
# ✔ Holder authorized by issuer  rHolderAXXX...

# Authorize Holder C
xrpl-up mptoken authorize $MPT_ID --seed $ISSUER_SEED --holder $HOLDER_C
# ✔ Holder authorized by issuer  rHolderCXXX...

# Holder B: NOT authorized — left pending intentionally
# Any payment attempt to Holder B will fail with tecNO_AUTH
```

---

## Step 6: Issue tokens to Holder A and Holder C

```bash
xrpl-up payment --to $HOLDER_A --amount 5000/$MPT_ID --seed $ISSUER_SEED
# ✔ MPT payment sent  5000  →  rHolderAXXX...

xrpl-up payment --to $HOLDER_C --amount 3000/$MPT_ID --seed $ISSUER_SEED
# ✔ MPT payment sent  3000  →  rHolderCXXX...
```

Verify balances:

```bash
xrpl-up account mptokens $HOLDER_A
# MPTokenIssuanceID  00070C44...   MPTAmount 5000   locked false

xrpl-up account mptokens $HOLDER_C
# MPTokenIssuanceID  00070C44...   MPTAmount 3000   locked false

xrpl-up mptoken issuance get $MPT_ID
# outstanding  8000   (5000 + 3000)
```

---

## Step 7: Holder A transfers tokens to Holder C (transferable)

Since `--flags can-transfer` was set, holders can send tokens to each other:

```bash
xrpl-up payment --to $HOLDER_C --amount 1000/$MPT_ID --seed $HOLDER_A_SEED
# ✔ MPT payment sent  1000  →  rHolderCXXX...

xrpl-up account mptokens $HOLDER_A
# MPTAmount  4000   (5000 − 1000)

xrpl-up account mptokens $HOLDER_C
# MPTAmount  4000   (3000 + 1000 received)
```

> Live-verified: this holder-to-holder transfer moved the full 1000 with no fee deducted, and the issuance's `OutstandingAmount` was unchanged — despite `--transfer-fee 50` being set at issuance creation. This may be a gap in this rippled build's MPT transfer-fee enforcement rather than anything `xrpl-up`-specific; don't rely on transfer fees actually being charged until you've confirmed it against your own target network.

---

## Step 8: Compliance hold — lock Holder C's balance

Issuer places a hold on Holder C (e.g., pending compliance review):

```bash
xrpl-up mptoken issuance set $MPT_ID --seed $ISSUER_SEED --lock --holder $HOLDER_C
# ✔ MPToken locked  rHolderCXXX...

xrpl-up account mptokens $HOLDER_C
# MPTAmount 4000   locked  ✔
```

While locked, Holder C cannot send or receive tokens:

```bash
# Attempt to send from Holder C → fails
xrpl-up payment --to $HOLDER_A --amount 100/$MPT_ID --seed $HOLDER_C_SEED
# ✗  tecLOCKED  (holder is locked)

# Attempt to send TO Holder C → also fails
xrpl-up payment --to $HOLDER_C --amount 100/$MPT_ID --seed $HOLDER_A_SEED
# ✗  tecLOCKED
```

---

## Step 9: Lock the entire issuance (emergency freeze)

```bash
xrpl-up mptoken issuance set $MPT_ID --seed $ISSUER_SEED --lock
# ✔ Issuance locked (all holder-to-holder transfers frozen)

# Holder-to-holder transfers fail during global lock...
xrpl-up payment --to $HOLDER_A --amount 100/$MPT_ID --seed $HOLDER_C_SEED
# ✗  tecLOCKED

# ...but the issuer can still distribute new tokens even while locked —
# global lock freezes trading between holders, not issuance/minting.
# Live-verified: this succeeds tesSUCCESS despite the lock being active.
xrpl-up payment --to $HOLDER_A --amount 100/$MPT_ID --seed $ISSUER_SEED
# ✔ MPT payment sent  100  →  rHolderAXXX...
```

---

## Step 10: Unlock the issuance (resume trading)

```bash
xrpl-up mptoken issuance set $MPT_ID --seed $ISSUER_SEED --unlock
# ✔ Issuance unlocked

# Holder C remains individually locked — unlock them separately
xrpl-up mptoken issuance set $MPT_ID --seed $ISSUER_SEED --unlock --holder $HOLDER_C
# ✔ MPToken unlocked  rHolderCXXX...
```

---

## Step 11: Clawback tokens from Holder C

```bash
# Reclaim all of Holder C's balance (e.g. sanctions enforcement)
xrpl-up clawback --amount 4000/$MPT_ID --holder $HOLDER_C --seed $ISSUER_SEED
# ✔ Clawback successful  4000  ← rHolderCXXX...

xrpl-up account mptokens $HOLDER_C
# MPTAmount  0

xrpl-up mptoken issuance get $MPT_ID
# outstanding  4000   (only Holder A remains)
```

---

## Step 12: Unauthorize Holder C and Holder B

```bash
# Holder C opts out (balance is now 0)
xrpl-up mptoken authorize $MPT_ID --seed $HOLDER_C_SEED --unauthorize
# ✔ MPToken holder removed  rHolderCXXX...

# Issuer revokes Holder B's pending opt-in (they were never authorized)
xrpl-up mptoken authorize $MPT_ID --seed $ISSUER_SEED --holder $HOLDER_B --unauthorize
# ✔ Holder authorization revoked  rHolderBXXX...
```

---

## Step 13: Reclaim remaining supply and destroy the issuance

```bash
# Clawback all remaining tokens from Holder A
xrpl-up clawback --amount 4000/$MPT_ID --holder $HOLDER_A --seed $ISSUER_SEED

# Holder A opts out
xrpl-up mptoken authorize $MPT_ID --seed $HOLDER_A_SEED --unauthorize

# Outstanding supply is now 0 — destroy the issuance
xrpl-up mptoken issuance destroy $MPT_ID --seed $ISSUER_SEED
# ✔ MPT issuance destroyed  00070C44...

# Confirm gone
xrpl-up mptoken issuance list $ISSUER
# (empty)
```

---

## Full policy lifecycle at a glance

```
Create issuance (require-auth + can-lock + can-clawback + can-transfer)
    ↓
Holders opt in → issuer approves selectively
    ↓
Issue tokens to approved holders
    ↓
Holders transfer to each other
    ↓
Compliance hold: lock individual holder
    ↓
Emergency: lock entire issuance → resume: unlock
    ↓
Enforcement: clawback from holder
    ↓
Wind down: clawback all → holders opt out → destroy
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **require-auth** | Two-step opt-in: holder opts in, issuer approves. Both sides must run `mptoken authorize`. |
| **can-lock** | Issuer can freeze an individual holder OR the entire issuance. Individual unlock is independent of global unlock. |
| **can-clawback** | Issuer reclaims any amount from any holder. Partial clawback supported. |
| **can-transfer** | Required for holder-to-holder payments. Without it, only issuer↔holder transfers work. |
| **transfer-fee** | Documented to deduct from the sender side on each holder-to-holder transfer and burn the fee (reducing outstanding supply) — not observed taking effect in live testing against this rippled build; verify against your own target network before relying on it. |
| **asset-scale** | Number of decimal places. Scale 2 means `100` represents `1.00`. |

---

## Next steps

- [MPT](../simple/mpt.md) — MPT basics without the policy controls
- [Regulated Token](regulated-token.md) — equivalent IOU/trust-line controlled flow
- [Clawback](../simple/clawback.md) — IOU and MPT clawback details
