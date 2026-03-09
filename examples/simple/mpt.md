# MPT — Multi-Purpose Token (XLS-33)

MPT is XRPL's next-generation fungible token standard. Unlike IOU trust lines, MPTs live directly on the ledger as first-class objects — no rippling, no counterparty risk, and optional built-in controls (transfer fees, clawback, per-holder locking, authorized holding).

> **Requires xrpl.js ≥ 4.1.0** (included in xrpl-up). MPT is enabled by default in the local sandbox.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## 1. Create an MPT issuance

Auto-fund a wallet and mint a new token:

```bash
# Minimal — just a transferable token
xrpl-up mpt create --local --transferable
# ✔ MPT issuance created
#   issuance ID  00070C4495F14B0EXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   issuer       rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   seed         sEdIssuerSeedXXXXXXXXXXXXXXXXXXXXX
#
#   Hint: xrpl-up mpt authorize 00070C44... --local --seed <holder-seed>

MPT_ID=00070C4495F14B0EXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ISSUER_SEED=sEdIssuerSeedXXXXXXXXXXXXXXXXXXXXX
ISSUER=rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Full issuance with all controls

```bash
xrpl-up mpt create --local --seed $ISSUER_SEED \
  --max-amount 1000000 \
  --asset-scale 6 \
  --transfer-fee 100 \
  --metadata "My Token v1" \
  --transferable \
  --can-clawback \
  --can-lock \
  --require-auth
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max-amount <n>` | unlimited | Hard cap on total supply |
| `--asset-scale <n>` | `0` | Decimal places (0–19). `6` = values in millionths |
| `--transfer-fee <n>` | `0` | Fee in hundredths of a percent (e.g. `100` = 1%) |
| `--metadata <string>` | — | Freeform metadata, hex-encoded on-chain |
| `--transferable` | off | Holders can transfer tokens to other accounts |
| `--require-auth` | off | Issuer must explicitly authorize each holder |
| `--can-lock` | off | Issuer can freeze individual holders |
| `--can-clawback` | off | Issuer can reclaim tokens from holders |

---

## 2. Inspect the issuance

```bash
xrpl-up mpt info $MPT_ID --local
# issuer           rIssuerXXX...
# outstanding      0
# max amount       1000000
# asset scale      6
# transfer fee     100 (1%)
# flags            transferable, can-clawback
# metadata         "My Token v1"
```

---

## 3. Holder opts in (MPTokenAuthorize)

Before a holder can receive MPTs they must opt in by running `mpt authorize` from their own account. This reserves a small amount of XRP (the MPToken ledger object reserve).

```bash
# Fund a holder wallet
xrpl-up faucet --local
# → seed: sEdHolderSeedXXX  address: rHolderXXX

HOLDER_SEED=sEdHolderSeedXXXXXXXXXXXXXXXXXXXXX
HOLDER=rHolderXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Holder opts in (no --holder flag means "this account is opting in for itself")
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_SEED
# ✔ MPToken holder authorized  rHolderXXX...
```

### When `--require-auth` is set

If the issuance requires authorization, the issuer must also authorize the holder:

```bash
# Issuer authorizes the holder
xrpl-up mpt authorize $MPT_ID --local --seed $ISSUER_SEED --holder $HOLDER
# ✔ MPToken holder authorized by issuer
```

Both sides must run `authorize` before the holder can receive tokens.

---

## 4. Send MPT tokens

```bash
xrpl-up mpt pay $MPT_ID 1000 $HOLDER --local --seed $ISSUER_SEED
# ✔ MPT payment sent
#   amount  1000  →  rHolderXXX...
#   hash    ABCDEF...
```

> **Note:** The issuer sends tokens directly (no trust-line "issuing" trick like IOU). The `OutstandingAmount` on the issuance increases.

---

## 5. Check holder balances

```bash
# Issuances created by the default account
xrpl-up mpt list --local

# MPT balances held by an account
xrpl-up mpt list $HOLDER --local --holdings
# MPTokenIssuanceID  00070C44...
# MPTAmount          1000
# locked             false
```

---

## 6. Transfer between holders

```bash
# Fund a second holder
xrpl-up faucet --local
# → seed: sEdHolder2SeedXXX  address: rHolder2XXX

HOLDER2_SEED=sEdHolder2SeedXXXXXXXXXXXXXXXXXXXXX
HOLDER2=rHolder2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Holder 2 opts in
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER2_SEED

# Holder 1 sends 250 tokens to Holder 2
xrpl-up mpt pay $MPT_ID 250 $HOLDER2 --local --seed $HOLDER_SEED
```

---

## 7. Lock a holder (optional — requires `--can-lock`)

```bash
# Lock Holder 1's balance
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --lock --holder $HOLDER
# ✔ MPToken locked  rHolderXXX...

# Unlock
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --unlock --holder $HOLDER
```

Lock the entire issuance at once:

```bash
xrpl-up mpt set $MPT_ID --local --seed $ISSUER_SEED --lock
```

---

## 8. Clawback tokens (requires `--can-clawback`)

```bash
xrpl-up clawback mpt $MPT_ID $HOLDER 500 --local --seed $ISSUER_SEED
# ✔ Clawback successful  500 ← rHolderXXX...
```

---

## 9. Unauthorize a holder

```bash
# Holder opts back out (balance must be zero first)
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_SEED --unauthorize
```

---

## 10. Destroy the issuance

Outstanding supply must be zero before you can destroy:

```bash
xrpl-up mpt destroy $MPT_ID --local --seed $ISSUER_SEED
# ✔ MPT issuance destroyed  00070C44...
```

---

## Full lifecycle at a glance

```bash
# 1. Create
xrpl-up mpt create --local --transferable --can-clawback
# → MPT_ID, ISSUER_SEED, ISSUER

# 2. Holder opts in
xrpl-up faucet --local    # → HOLDER, HOLDER_SEED
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_SEED

# 3. Send tokens
xrpl-up mpt pay $MPT_ID 1000 $HOLDER --local --seed $ISSUER_SEED

# 4. Check balances
xrpl-up mpt list $HOLDER --local --holdings

# 5. Clawback
xrpl-up clawback mpt $MPT_ID $HOLDER 1000 --local --seed $ISSUER_SEED

# 6. Holder opts out
xrpl-up mpt authorize $MPT_ID --local --seed $HOLDER_SEED --unauthorize

# 7. Destroy
xrpl-up mpt destroy $MPT_ID --local --seed $ISSUER_SEED
```

---

## MPT vs IOU comparison

| Feature | IOU (Trust Line) | MPT |
|---------|-----------------|-----|
| **Holder opt-in** | Set trust line | `mpt authorize` |
| **Rippling** | Supported (DefaultRipple) | Not applicable |
| **Transfer fee** | Not built-in | Built-in (`--transfer-fee`) |
| **Clawback** | Requires account flag | Requires `--can-clawback` at issuance |
| **Per-holder lock** | Individual freeze | `mpt set --lock --holder` |
| **Supply cap** | No | `--max-amount` |
| **Metadata** | No | `--metadata` |

---

## Next steps

- [Clawback](clawback.md) — reclaim IOU or MPT tokens from holders
- [Issued Token](issued-token.md) — classic IOU / trust line approach
- [DEX](dex.md) — trade MPTs on the order book (if transferable)
