# Clawback — Reclaim Issued Tokens

Issuers can reclaim tokens from holders for compliance purposes (KYC/AML, sanctions, error correction). Clawback must be explicitly enabled at the account or issuance level — it cannot be added later.

Both **IOU (trust line)** and **MPT** tokens support clawback.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Part 1 — IOU Clawback

### Step 1: Enable clawback on a fresh issuer account

> ⚠️ `allowClawback` is **permanent and irreversible**. It must be set **before any trust lines are created** on the issuer. Once set, it cannot be cleared.

```bash
# Fund a brand-new issuer account
xrpl-up faucet --local
# → seed: sEdIssuerSeedXXX  address: rIssuerXXX

ISSUER_SEED=sEdIssuerSeedXXXXXXXXXXXXXXXXXXXXX
ISSUER=rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Enable clawback BEFORE creating any trust lines
xrpl-up account set --allow-clawback --seed $ISSUER_SEED
# ✔ Flag set: allowClawback  (permanent)
```

Verify the flag:

```bash
xrpl-up account info $ISSUER
# AllowTrustLineClawback  ✔
```

---

### Step 2: Set up a holder and issue tokens

```bash
# Fund a holder
xrpl-up faucet --local
# → seed: sEdHolderSeedXXX  address: rHolderXXX

HOLDER_SEED=sEdHolderSeedXXXXXXXXXXXXXXXXXXXXX
HOLDER=rHolderXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Enable DefaultRipple on the issuer
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED

# Holder sets a trust line
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $HOLDER_SEED

# Issue 500 USD to the holder
# (use xrpl-up run with a Payment script, or via the DEX)
```

---

### Step 3: Clawback IOU tokens

```bash
# Reclaim 100 USD from the holder
xrpl-up clawback --amount 100/USD/$HOLDER --seed $ISSUER_SEED
# ✔ Clawback successful
#   reclaimed  100 USD  ←  rHolderXXX...

# Reclaim the full remaining balance
xrpl-up clawback --amount 400/USD/$HOLDER --seed $ISSUER_SEED
```

After clawback the holder's trust-line balance decreases. The issuer's outstanding supply decreases correspondingly.

---

### Step 4: Verify

```bash
xrpl-up account trust-lines $HOLDER
# USD  rIssuerXXX...  balance 0  limit 10000
```

---

## Part 2 — MPT Clawback

### Step 1: Create an MPT issuance with clawback enabled

```bash
xrpl-up faucet --local
# → seed: sEdMptIssuerSeedXXX  address: rMptIssuerXXX

MPT_ISSUER_SEED=sEdMptIssuerSeedXXXXXXXXXXXXXXX
MPT_ISSUER=rMptIssuerXXXXXXXXXXXXXXXXXXXXXXXXX

xrpl-up mptoken issuance create --seed $MPT_ISSUER_SEED \
  --flags can-transfer,can-clawback \
  --max-amount 1000000
# ✔ MPT issuance created
#   issuance ID  00070C4495F14B0EXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

MPT_ID=00070C4495F14B0EXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

### Step 2: Issue tokens to a holder

```bash
xrpl-up faucet --local
# → seed: sEdMptHolderSeedXXX  address: rMptHolderXXX

MPT_HOLDER_SEED=sEdMptHolderSeedXXXXXXXXXXXXXXX
MPT_HOLDER=rMptHolderXXXXXXXXXXXXXXXXXXXXXXXXX

# Holder opts in
xrpl-up mptoken authorize $MPT_ID --seed $MPT_HOLDER_SEED

# Send 2000 MPT tokens to the holder
xrpl-up payment --to $MPT_HOLDER --amount 2000/$MPT_ID --seed $MPT_ISSUER_SEED
```

---

### Step 3: Clawback MPT tokens

```bash
# Reclaim 500 tokens from the holder
xrpl-up clawback --amount 500/$MPT_ID --holder $MPT_HOLDER --seed $MPT_ISSUER_SEED
# ✔ Clawback successful
#   reclaimed  500  ←  rMptHolderXXX...
```

---

### Step 4: Verify

```bash
xrpl-up account mptokens $MPT_HOLDER
# MPTokenIssuanceID  00070C44...
# MPTAmount          1500   ← 2000 - 500
```

---

## Comparison: IOU vs MPT clawback

| | IOU Clawback | MPT Clawback |
|--|-------------|--------------|
| **Enable** | `account set --allow-clawback` (permanent, on issuer account) | `mptoken issuance create --flags can-clawback` (per issuance) |
| **Prerequisite timing** | Must be set before any trust lines | Must be set at issuance creation |
| **Command** | `clawback --amount <amount>/<currency>/<holder>` | `clawback --amount <amount>/<issuanceId> --holder <holder>` |
| **Reversible?** | Flag is permanent; individual clawback can be partial | Partial clawback supported |

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Compliance use case** | Clawback is designed for regulated token issuers (stablecoins, CBDCs, securities). |
| **Partial clawback** | You can reclaim any amount up to the holder's current balance. |
| **Issuer only** | Only the original issuer can clawback — not exchanges, custodians, or other accounts. |
| **IOU: counterparty convention** | In a `Clawback` tx, `Amount.issuer` is set to the **holder's address** (not the issuer). This is an XRPL protocol quirk enforced by the SDK. |

---

## Next steps

- [Issued Token](issued-token.md) — IOU trust line setup
- [MPT](mpt.md) — MPT full lifecycle
- [Account Settings](accountset.md) — all account flags
