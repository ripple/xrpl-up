# Single-Asset Vault (XLS-65 / SingleAssetVault)

A Vault is an on-ledger pooled-asset object: depositors send an asset in and receive tradeable vault shares back, proportional to their contribution. The vault owner controls the asset cap, metadata, and (for IOU/MPT assets) can claw back shares from a holder.

> **Requires the `SingleAssetVault` amendment enabled.** Check with `xrpl-up amendment info SingleAssetVault --local`. If it isn't on yet:
>
> ```bash
> xrpl-up amendment enable SingleAssetVault --local
> # This wipes and resets the sandbox, then force-enables the amendment from a fresh genesis.
>
> xrpl-up start --local-network --detach
> # Restart in --local-network mode specifically, not plain standalone — standalone wipes
> # its ledger on every restart, so you'd lose the vaults you build below the moment you
> # stop the sandbox. --local-network persists state across restarts and is what
> # `xrpl-up snapshot save`/`restore` require.
> ```

---

## Prerequisites

```bash
xrpl-up start --local-network --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Create the vault (XRP asset)

```bash
OWNER_JSON=$(xrpl-up faucet --network local --json)
OWNER_SEED=$(echo "$OWNER_JSON" | jq -r .seed)
OWNER=$(echo "$OWNER_JSON" | jq -r .address)

VAULT_ID=$(xrpl-up vault create --asset 0 --assets-maximum 1000000000 --seed $OWNER_SEED --json | jq -r .vaultId)
```

> `--asset 0` means XRP. `VaultCreate` requires a fee of 0.2 XRP (200000 drops), not the standard base fee.

### IOU vault

Needs a real issuer account first (see [Issued Token](../simple/issued-token.md) for the full walkthrough):

```bash
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)

# IOU asset: 0/CURRENCY/issuer
IOU_VAULT_ID=$(xrpl-up vault create --asset 0/USD/$ISSUER --seed $OWNER_SEED --json | jq -r .vaultId)
```

### MPT vault

Fully self-contained end-to-end flow — funds its own issuer/owner/depositor, creates the MPT issuance, creates the vault, and deposits into it (see [MPT](../simple/mpt.md) for MPT mechanics in depth):

```bash
# Issuer creates the underlying MPT
MPT_ISSUER_JSON=$(xrpl-up faucet --network local --json)
MPT_ISSUER_SEED=$(echo "$MPT_ISSUER_JSON" | jq -r .seed)
MPT_ISSUER=$(echo "$MPT_ISSUER_JSON" | jq -r .address)

MPT_ID=$(xrpl-up mptoken issuance create --flags can-transfer --seed $MPT_ISSUER_SEED --json | jq -r .issuanceId)

# Vault owner creates an MPT-backed vault
MPT_VAULT_ID=$(xrpl-up vault create --asset 0/$MPT_ID --seed $OWNER_SEED --json | jq -r .vaultId)

# Depositor must hold real MPT balance before depositing — opt in, then get funded by the issuer
MPT_DEPOSITOR_JSON=$(xrpl-up faucet --network local --json)
MPT_DEPOSITOR_SEED=$(echo "$MPT_DEPOSITOR_JSON" | jq -r .seed)
MPT_DEPOSITOR=$(echo "$MPT_DEPOSITOR_JSON" | jq -r .address)

xrpl-up mptoken authorize $MPT_ID --seed $MPT_DEPOSITOR_SEED
xrpl-up payment --to $MPT_DEPOSITOR --amount 500/$MPT_ID --seed $MPT_ISSUER_SEED

# Deposit MPT into the vault: "<amount>/<48-hex-issuance-id>"
xrpl-up vault deposit --vault-id $MPT_VAULT_ID --amount 200/$MPT_ID --seed $MPT_DEPOSITOR_SEED
# ✔ 200 tokens deposited, vault shares minted

xrpl-up account mptokens $MPT_DEPOSITOR
# MPTokenIssuanceID  00070C44...            MPTAmount  300   (500 - 200 deposited)
# MPTokenIssuanceID  <vault share MPT ID>    MPTAmount  200

# Withdraw back out
xrpl-up vault withdraw --vault-id $MPT_VAULT_ID --amount 200/$MPT_ID --seed $MPT_DEPOSITOR_SEED
```

---

## 2. Deposit assets and receive shares

```bash
DEPOSITOR_JSON=$(xrpl-up faucet --network local --json)
DEPOSITOR_SEED=$(echo "$DEPOSITOR_JSON" | jq -r .seed)
DEPOSITOR=$(echo "$DEPOSITOR_JSON" | jq -r .address)

xrpl-up vault deposit --vault-id $VAULT_ID --amount 100 --seed $DEPOSITOR_SEED
# Vault ID: ABCDEF0123...
# Tx:       ABCDEF...
# Result:   tesSUCCESS
# Fee:      0.000012 XRP
# Ledger:   12346
```

Check the depositor's share balance and the vault's total:

```bash
xrpl-up account info $DEPOSITOR
# vault shares appear as an MPT balance — the vault mints a share MPT issuance internally

xrpl-up account mptokens $DEPOSITOR
# MPTokenIssuanceID  <vault's share MPT ID>   MPTAmount  100
```

---

## 3. A second depositor joins

```bash
DEPOSITOR2_JSON=$(xrpl-up faucet --network local --json)
DEPOSITOR2_SEED=$(echo "$DEPOSITOR2_JSON" | jq -r .seed)
DEPOSITOR2=$(echo "$DEPOSITOR2_JSON" | jq -r .address)

xrpl-up vault deposit --vault-id $VAULT_ID --amount 50 --seed $DEPOSITOR2_SEED
# ✔ 50 XRP deposited, shares minted proportionally
```

---

## 4. Withdraw — redeem shares for the underlying asset

```bash
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 40 --seed $DEPOSITOR_SEED
# Vault ID: ABCDEF0123...
# Tx:       ABCDEF...
# Result:   tesSUCCESS
```

Withdraw to a different destination account:

```bash
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 10 \
  --destination $DEPOSITOR2 --seed $DEPOSITOR_SEED
```

---

## 5. Update vault metadata / cap

```bash
xrpl-up vault set --vault-id $VAULT_ID --assets-maximum 2000000000 --seed $OWNER_SEED
# ✔ AssetsMaximum updated

xrpl-up vault set --vault-id $VAULT_ID --data 48656C6C6F --seed $OWNER_SEED
# ✔ Data updated (arbitrary metadata hex blob)
```

---

## 6. Clawback (IOU/MPT vaults only — cannot claw back XRP)

```bash
# Only meaningful for vaults whose underlying asset is an IOU or MPT
# where the issuer is also the vault owner
xrpl-up vault clawback --vault-id $VAULT_ID --holder $DEPOSITOR --seed $OWNER_SEED
# ✔ Clawback successful — all of the holder's shares reclaimed

# Or claw back a specific amount:
xrpl-up vault clawback --vault-id $VAULT_ID --holder $DEPOSITOR \
  --amount 100/USD/$ISSUER --seed $OWNER_SEED
```

> Attempting this against an XRP-asset vault fails client-side with "VaultClawback cannot claw back XRP" — the CLI validates this before ever submitting the transaction.

---

## 7. Delete the vault (must be empty)

```bash
# Withdraw everything first — vault must hold zero assets to delete
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 10 --seed $DEPOSITOR_SEED
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 50 --seed $DEPOSITOR2_SEED

xrpl-up vault delete --vault-id $VAULT_ID --seed $OWNER_SEED
# Deleted vault: ABCDEF0123...
# Tx:            ABCDEF...
# Result:        tesSUCCESS
```

---

## Full lifecycle at a glance

```bash
# 1. Create
VAULT_ID=$(xrpl-up vault create --asset 0 --assets-maximum 1000000000 --seed $OWNER_SEED --json | jq -r .vaultId)

# 2. Deposit
xrpl-up vault deposit --vault-id $VAULT_ID --amount 100 --seed $DEPOSITOR_SEED

# 3. Withdraw
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 40 --seed $DEPOSITOR_SEED

# 4. Delete (once empty)
xrpl-up vault delete --vault-id $VAULT_ID --seed $OWNER_SEED
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Vault shares** | Minted as an MPT issuance internally; depositors hold shares proportional to their contribution. |
| **Elevated create fee** | `VaultCreate` requires 0.2 XRP (200000 drops), not the standard base fee. |
| **Private vault** | `--private` + `--domain-id` restricts deposits to accounts in a permissioned domain. |
| **Non-transferable shares** | `--non-transferable` prevents share holders from transferring shares to each other. |
| **Clawback restriction** | Only works for IOU/MPT-backed vaults where the vault owner is also the asset issuer. XRP vaults can never be clawed back. |
| **Delete requires empty** | All depositors must withdraw before the owner can delete the vault and reclaim the reserve. |

---

## Next steps

- [MPT](../simple/mpt.md) — the share-token mechanics vaults build on
- [Regulated Token](regulated-token.md) — issuer controls (auth, freeze, clawback) for the underlying asset
- [Clawback](../simple/clawback.md) — clawback details for IOU and MPT
