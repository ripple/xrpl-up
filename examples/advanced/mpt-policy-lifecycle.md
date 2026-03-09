# MPT Policy Lifecycle: RequireAuth + Lock + Clawback

A fully-controlled MPT issuance where the issuer governs every phase: holders must be explicitly authorized, individual balances can be locked (compliance hold), and tokens can be clawed back at any time. Covers the complete lifecycle through to issuance destruction.

This guide complements [MPT](mpt.md) with a focus on the **policy controls** rather than the basic flow.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## Issuance Policy Matrix

| Policy flag | CLI flag | Effect |
|-------------|----------|--------|
| `tfMPTRequireAuth` | `--require-auth` | Issuer must approve each holder before tokens can flow |
| `tfMPTCanLock` | `--can-lock` | Issuer can freeze individual holders or the entire issuance |
| `tfMPTCanClawback` | `--can-clawback` | Issuer can reclaim tokens from any holder |
| `tfMPTCanTransfer` | `--transferable` | Holders can transfer tokens to each other (off by default) |

All policy flags are **set at issuance creation and cannot be changed afterwards**.

---

## Step 1: Create issuer and holder accounts

```bash
xrpl-up faucet --local
# → seed: sEdIssuerSeedXXX  address: rIssuerXXX

xrpl-up faucet --local
# → seed: sEdHolderASeedXXX  address: rHolderAXXX   (will be approved)

xrpl-up faucet --local
# → seed: sEdHolderBSeedXXX  address: rHolderBXXX   (will attempt to opt-in, then be rejected)

xrpl-up faucet --local
# → seed: sEdHolderCSeedXXX  address: rHolderCXXX   (approved, then locked, then clawback)

ISSUER_SEED=sEdIssuerSeedXXXXXXXXXXXXXXXXXXXXX
ISSUER=rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
HOLDER_A_SEED=sEdHolderASeedXXXXXXXXXXXXXXXXXX
HOLDER_A=rHolderAXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HOLDER_B_SEED=sEdHolderBSeedXXXXXXXXXXXXXXXXXX
HOLDER_B=rHolderBXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HOLDER_C_SEED=sEdHolderCSeedXXXXXXXXXXXXXXXXXX
HOLDER_C=rHolderCXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## Step 2: Create the MPT issuance with all policy controls

```bash
xrpl-up mpt create --local --seed $ISSUER_SEED \
  --max-amount 1000000 \
  --asset-scale 2 \
  --transfer-fee 50 \
  --metadata "Regulated MPT v1" \
  --transferable \
  --require-auth \
  --can-lock \
  --can-clawback
# ✔ MPT issuance created
#   issuance ID  00070C4495F14B0EXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   issuer       rIssuerXXX...
#   flags        transferable, require-auth, can-lock, can-clawback
#   max-amount   1000000
#   asset-scale  2
#   transfer-fee 50 (0.5%)
#   metadata     "Regulated MPT v1"

MPT_ID=00070C4495F14B0EXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## Step 3: Verify issuance details

```bash
xrpl-up mpt info $MPT_ID --local
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

With `--require-auth`, holders can opt in but tokens cannot flow until the issuer approves them:

```bash
# Holder A opts in
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_A_SEED
# ✔ MPToken holder opted in (pending issuer authorization)  rHolderAXXX...

# Holder B opts in
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_B_SEED
# ✔ MPToken holder opted in (pending issuer authorization)  rHolderBXXX...

# Holder C opts in
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_C_SEED
# ✔ MPToken holder opted in (pending issuer authorization)  rHolderCXXX...
```

---

## Step 5: Issuer authorizes Holder A and Holder C; rejects Holder B

```bash
# Authorize Holder A
xrpl-up mpt authorize $MPT_ID --local --seed $ISSUER_SEED --holder $HOLDER_A
# ✔ Holder authorized by issuer  rHolderAXXX...

# Authorize Holder C
xrpl-up mpt authorize $MPT_ID --local --seed $ISSUER_SEED --holder $HOLDER_C
# ✔ Holder authorized by issuer  rHolderCXXX...

# Holder B: NOT authorized — left pending intentionally
# Any payment attempt to Holder B will fail with tecNO_AUTH
```

---

## Step 6: Issue tokens to Holder A and Holder C

```bash
xrpl-up mpt pay $MPT_ID 5000 $HOLDER_A --local --seed $ISSUER_SEED
# ✔ MPT payment sent  5000  →  rHolderAXXX...

xrpl-up mpt pay $MPT_ID 3000 $HOLDER_C --local --seed $ISSUER_SEED
# ✔ MPT payment sent  3000  →  rHolderCXXX...
```

Verify balances:

```bash
xrpl-up mpt list $HOLDER_A --local --holdings
# MPTokenIssuanceID  00070C44...   MPTAmount 5000   locked false

xrpl-up mpt list $HOLDER_C --local --holdings
# MPTokenIssuanceID  00070C44...   MPTAmount 3000   locked false

xrpl-up mpt info $MPT_ID --local
# outstanding  8000   (5000 + 3000)
```

---

## Step 7: Holder A transfers tokens to Holder C (transferable)

Since `--transferable` was set, holders can send tokens to each other:

```bash
xrpl-up mpt pay $MPT_ID 1000 $HOLDER_C --local --seed $HOLDER_A_SEED
# ✔ MPT payment sent  1000  →  rHolderCXXX...
# Transfer fee: 5 tokens (0.5% of 1000) deducted and burned

xrpl-up mpt list $HOLDER_A --local --holdings
# MPTAmount  3995   (5000 − 1000 − 5 fee)

xrpl-up mpt list $HOLDER_C --local --holdings
# MPTAmount  4000   (3000 + 1000 received)
```

---

## Step 8: Compliance hold — lock Holder C's balance

Issuer places a hold on Holder C (e.g., pending compliance review):

```bash
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --lock --holder $HOLDER_C
# ✔ MPToken locked  rHolderCXXX...

xrpl-up mpt list $HOLDER_C --local --holdings
# MPTAmount 4000   locked  ✔
```

While locked, Holder C cannot send or receive tokens:

```bash
# Attempt to send from Holder C → fails
xrpl-up mpt pay $MPT_ID 100 $HOLDER_A --local --seed $HOLDER_C_SEED
# ✗  tecLOCKED  (holder is locked)

# Attempt to send TO Holder C → also fails
xrpl-up mpt pay $MPT_ID 100 $HOLDER_C --local --seed $HOLDER_A_SEED
# ✗  tecLOCKED
```

---

## Step 9: Lock the entire issuance (emergency freeze)

```bash
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --lock
# ✔ Issuance locked (all holders frozen)

# All payments fail during global lock, even for Holder A
xrpl-up mpt pay $MPT_ID 100 $HOLDER_A --local --seed $ISSUER_SEED
# ✗  tecLOCKED
```

---

## Step 10: Unlock the issuance (resume trading)

```bash
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --unlock
# ✔ Issuance unlocked

# Holder C remains individually locked — unlock them separately
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --unlock --holder $HOLDER_C
# ✔ MPToken unlocked  rHolderCXXX...
```

---

## Step 11: Clawback tokens from Holder C

```bash
# Reclaim all of Holder C's balance (e.g. sanctions enforcement)
xrpl-up clawback mpt $MPT_ID $HOLDER_C 4000 --local --seed $ISSUER_SEED
# ✔ Clawback successful  4000  ← rHolderCXXX...

xrpl-up mpt list $HOLDER_C --local --holdings
# MPTAmount  0

xrpl-up mpt info $MPT_ID --local
# outstanding  3995   (only Holder A remains)
```

---

## Step 12: Unauthorize Holder C and Holder B

```bash
# Holder C opts out (balance is now 0)
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_C_SEED --unauthorize
# ✔ MPToken holder removed  rHolderCXXX...

# Issuer revokes Holder B's pending opt-in (they were never authorized)
xrpl-up mpt authorize $MPT_ID --local --seed $ISSUER_SEED --holder $HOLDER_B --unauthorize
# ✔ Holder authorization revoked  rHolderBXXX...
```

---

## Step 13: Reclaim remaining supply and destroy the issuance

```bash
# Clawback all remaining tokens from Holder A
xrpl-up clawback mpt $MPT_ID $HOLDER_A 3995 --local --seed $ISSUER_SEED

# Holder A opts out
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_A_SEED --unauthorize

# Outstanding supply is now 0 — destroy the issuance
xrpl-up mpt destroy $MPT_ID --local --seed $ISSUER_SEED
# ✔ MPT issuance destroyed  00070C44...

# Confirm gone
xrpl-up mpt list --local
# (empty)
```

---

## Full policy lifecycle at a glance

```
Create issuance (require-auth + can-lock + can-clawback + transferable)
    ↓
Holders opt in → issuer approves selectively
    ↓
Issue tokens to approved holders
    ↓
Holders transfer (fee deducted at each hop)
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
| **require-auth** | Two-step opt-in: holder opts in, issuer approves. Both sides must run `mpt authorize`. |
| **can-lock** | Issuer can freeze an individual holder OR the entire issuance. Individual unlock is independent of global unlock. |
| **can-clawback** | Issuer reclaims any amount from any holder. Partial clawback supported. |
| **transferable** | Required for holder-to-holder payments. Without it, only issuer↔holder transfers work. |
| **transfer-fee** | Deducted from the **sender** side on each holder-to-holder transfer. Burned (reduces outstanding supply). |
| **asset-scale** | Number of decimal places. Scale 2 means `100` represents `1.00`. |

---

## Next steps

- [MPT](../simple/mpt.md) — MPT basics without the policy controls
- [Regulated Token](regulated-token.md) — equivalent IOU/trust-line controlled flow
- [Clawback](../simple/clawback.md) — IOU and MPT clawback details
