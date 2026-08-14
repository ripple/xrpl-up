# Single-Asset Vault (XLS-65 / SingleAssetVault)

A Vault is an on-ledger pooled-asset object: depositors send an asset in and receive tradeable vault shares back, proportional to their contribution. The vault owner controls the asset cap, metadata, and (for IOU/MPT assets) can claw back shares from a holder.

> **Requires the `SingleAssetVault` amendment enabled.** Check with `xrpl-up amendment info SingleAssetVault`. If it isn't on yet:
>
> ```bash
> xrpl-up amendment enable SingleAssetVault
> # Wipes and resets the sandbox, then force-enables the amendment from a fresh genesis.
>
> xrpl-up start
> ```
>
> Works in `--local-network` mode too (`xrpl-up start --local-network` in place of the last line
> above) — the next start there builds a real consensus genesis instead of resuming the pre-built
> ledger, which takes ~30-60s instead of ~5s. If you're already using `--local-network` with saved
> snapshots, `snapshot restore` automatically realigns the amendment config to whatever each
> snapshot was built with, so save/restore keeps working across this change.

---

## Prerequisites

```bash
xrpl-up start
xrpl-up status   # wait until "healthy"
export XRPL_NETWORK=local
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

Needs a real issuer account first (see [Issued Token](../simple/issued-token.md) for the full walkthrough). Live-verified: `vault create` for a completely fresh currency/issuer pair that no account has ever held a trust line to fails silently (`transaction expired`) — the owner needs to already hold a trust line and balance in that asset first:

```bash
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED

# Owner needs to already hold this asset before creating a vault for it
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $OWNER_SEED
xrpl-up payment --to $OWNER --amount 100/USD/$ISSUER --seed $ISSUER_SEED

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
# MPTokenIssuanceID  <vault's share MPT ID>   MPTAmount  100000000
```

> Live-verified: for an XRP-asset vault, shares are minted 1:1 with **drops**, not whole XRP — a 100 XRP deposit mints `100000000` shares, not `100`.

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

Only meaningful for vaults whose underlying asset is an IOU or MPT **issued by the vault owner themselves** — self-contained example, since neither `$VAULT_ID` (XRP) nor `$IOU_VAULT_ID` (asset issued by a separate `$ISSUER`, not `$OWNER`) above qualify:

```bash
CB_OWNER_JSON=$(xrpl-up faucet --network local --json)
CB_OWNER_SEED=$(echo "$CB_OWNER_JSON" | jq -r .seed)

CB_MPT_ID=$(xrpl-up mptoken issuance create --flags can-transfer,can-clawback --seed $CB_OWNER_SEED --json | jq -r .issuanceId)
CB_VAULT_ID=$(xrpl-up vault create --asset 0/$CB_MPT_ID --seed $CB_OWNER_SEED --json | jq -r .vaultId)

CB_DEPOSITOR_JSON=$(xrpl-up faucet --network local --json)
CB_DEPOSITOR_SEED=$(echo "$CB_DEPOSITOR_JSON" | jq -r .seed)
CB_DEPOSITOR=$(echo "$CB_DEPOSITOR_JSON" | jq -r .address)

xrpl-up mptoken authorize $CB_MPT_ID --seed $CB_DEPOSITOR_SEED
xrpl-up payment --to $CB_DEPOSITOR --amount 500/$CB_MPT_ID --seed $CB_OWNER_SEED
xrpl-up vault deposit --vault-id $CB_VAULT_ID --amount 200/$CB_MPT_ID --seed $CB_DEPOSITOR_SEED

# --amount is required here in practice — omitting it (to mean "claw back everything",
# per --amount's own help text) fails with tecWRONG_ASSET on this rippled build.
xrpl-up vault clawback --vault-id $CB_VAULT_ID --holder $CB_DEPOSITOR \
  --amount 200/$CB_MPT_ID --seed $CB_OWNER_SEED
# ✔ Clawback successful — all of the holder's shares reclaimed
```

> Attempting this against an XRP-asset vault fails client-side with "VaultClawback cannot claw back XRP" — the CLI validates this before ever submitting the transaction.

---

## 7. Delete the vault (must be empty)

```bash
# Withdraw everything first — vault must hold zero assets to delete.
# Depositor put in 100 and already withdrew 40 + 10 (the second one sent to depositor2's
# address in step 4, but still drawn from depositor's own shares) — 50 remains, not 60.
# Depositor2 never withdrew, so their full 50 remains.
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 50 --seed $DEPOSITOR_SEED
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
