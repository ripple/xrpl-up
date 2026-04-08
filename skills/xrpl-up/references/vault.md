## vault

Manage single-asset vaults (XLS-65).

### vault create

Create a single-asset vault on the XRP Ledger.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | Asset: `0` for XRP, `CURRENCY/issuer` for IOU, or MPT spec |
| `--assets-maximum <n>` | string | No | — | Maximum total assets (UInt64) |
| `--data <hex>` | string | No | — | Arbitrary metadata hex (max 256 bytes) |
| `--mpt-metadata <hex>` | string | No | — | MPTokenMetadata for vault shares (max 1024 bytes) |
| `--domain-id <hash>` | string | No | — | 64-char hex DomainID for private vault |
| `--private` | boolean | No | false | Set tfVaultPrivate (requires `--domain-id`) |
| `--non-transferable` | boolean | No | false | Set tfVaultShareNonTransferable |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up vault create --asset 0 --assets-maximum 1000000 --seed sEd...
```

### vault set

Update metadata, asset cap, or domain of a vault you own (VaultSet). At least one of `--data`, `--assets-maximum`, or `--domain-id` is required.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vault-id <hash>` | string | **Yes** | — | 64-char hex VaultID to update |
| `--data <hex>` | string | No | — | Updated metadata hex blob (max 256 bytes / 512 hex chars) |
| `--assets-maximum <n>` | string | No | — | Updated maximum total assets cap (UInt64 string) |
| `--domain-id <hash>` | string | No | — | Updated 64-char hex DomainID |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up vault set --vault-id <64hexID> --assets-maximum 2000000 --seed sEd...
```

### vault deposit

Deposit assets into a vault and receive vault shares.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vault-id <hash>` | string | **Yes** | — | 64-char hex VaultID |
| `--amount <amount>` | string | **Yes** | — | Amount to deposit |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up vault deposit --vault-id <64hexID> --amount 10 --seed sEd...
```

### vault withdraw

Withdraw assets from a vault by burning vault shares.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vault-id <hash>` | string | Yes | — | 64-char hex VaultID to withdraw from |
| `--amount <amount>` | string | Yes | — | Amount to withdraw: `"10"` for XRP, `"10/USD/rIssuer"` for IOU, `"10/<48hex>"` for MPT |
| `--destination <address>` | string | No | — | Send redeemed assets to a different account |
| `--destination-tag <n>` | integer | No | — | Destination tag (requires `--destination`; 0–4294967295) |

```bash
xrpl-up vault withdraw --vault-id <64hexID> --amount 10 --seed sEd...
xrpl-up vault withdraw --vault-id <64hexID> --amount 10 --destination rRecipient... --destination-tag 1 --seed sEd...
```

### vault delete

Delete a vault you own.

```bash
xrpl-up vault delete --vault-id <64hexID> --seed sEd...
```

### vault clawback

Claw back assets from a vault (issuer only). IOU and MPT only — XRP cannot be clawed back.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vault-id <hash>` | string | Yes | — | 64-char hex VaultID |
| `--holder <address>` | string | Yes | — | Address of the account whose shares to claw back |
| `--amount <amount>` | string | No | all | Amount to claw back (omit to claw back all); IOU or MPT only |

```bash
xrpl-up vault clawback --vault-id <64hexID> --holder rHolderXXX... --seed sIssuerEd...
xrpl-up vault clawback --vault-id <64hexID> --holder rHolderXXX... --amount 50/USD/rIssuer... --seed sIssuerEd...
```

### Example flow: Alice creates an XRP vault, deposits, withdraws, and deletes it (devnet only)

> **Note:** Vault is a devnet-only feature (XLS-65 amendment not yet on testnet/mainnet).

```bash
# 1. Alice creates an XRP vault with a maximum capacity of 1,000,000 drops
#    Use --asset 0 for XRP (not --asset XRP); vault is devnet-only (XLS-65)
xrpl-up --node devnet vault create \
  --asset 0 --assets-maximum 1000000 \
  --seed sEdAliceXXXX... --json
# → {"result":"success","vaultId":"69FE309...64chars","tx":"2DE659..."}

# 2. Alice deposits 1 XRP into the vault
xrpl-up --node devnet vault deposit \
  --vault-id AABBCC...64chars --amount 1 --seed sEdAliceXXXX...

# 3. Alice withdraws 0.5 XRP from the vault
xrpl-up --node devnet vault withdraw \
  --vault-id AABBCC...64chars --amount 0.5 --seed sEdAliceXXXX...

# 4. Alice deletes the vault after withdrawing all assets
xrpl-up --node devnet vault delete \
  --vault-id AABBCC...64chars --seed sEdAliceXXXX...
```

