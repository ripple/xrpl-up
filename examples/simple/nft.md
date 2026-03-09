# NFT Lifecycle (XLS-20)

Mint, sell, buy, and burn Non-Fungible Tokens on XRPL. XRPL NFTs (XLS-20) are native protocol objects — no smart contract needed. The full lifecycle: mint → list for sale → buyer accepts → burn.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## 1. Mint an NFT

Auto-funds a new wallet and mints a transferable NFT with a metadata URI:

```bash
xrpl-up nft mint --local \
  --uri https://example.com/nft-metadata.json \
  --transferable \
  --transfer-fee 5 \
  --taxon 1
# ✔ NFT minted
#   NFTokenID  000800006B9C0BXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   issuer     rMinterXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   taxon      1
#   fee        5%
#
#   Hint: xrpl-up nft sell 000800006B9C0B... 5 --local --seed <seed>
```

Save values:

```bash
NFT_ID=000800006B9C0BXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
MINTER_SEED=sEdMinterSeedXXXXXXXXXXXXXXXXXXXXX
MINTER=rMinterXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Mint flags

| Flag | Description |
|------|-------------|
| `--uri <url>` | Metadata URI (hex-encoded on-chain) |
| `--transferable` | Allow the NFT to be transferred to other accounts |
| `--burnable` | Allow the issuer to burn the NFT even if held by another account |
| `--taxon <n>` | Group identifier for a collection (0–2147483647) |
| `--transfer-fee <pct>` | Royalty percentage paid to the issuer on every resale (0–50%) |

---

## 2. List NFTs for an account

```bash
xrpl-up nft list --local
# Shows NFTs owned by the first stored local account

xrpl-up nft list --local --account $MINTER
# NFTokenID  000800006B9C0B...
# taxon      1    transferable: true    fee: 5%
# uri        https://example.com/nft-metadata.json
```

---

## 3. Create a sell offer

The owner puts the NFT up for sale:

```bash
# Sell for 5 XRP
xrpl-up nft sell $NFT_ID 5 --local --seed $MINTER_SEED
# ✔ Sell offer created
#   offerID  A1B2C3D4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   price    5 XRP

OFFER_ID=A1B2C3D4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Sell for an IOU instead:

```bash
# Sell for 100 USD (requires buyer to have a USD trust line)
xrpl-up nft sell $NFT_ID "100.USD.$ISSUER" --local --seed $MINTER_SEED
```

---

## 4. View open offers for an NFT

```bash
xrpl-up nft offers $NFT_ID --local
# sell offers:
#   offerID  A1B2C3D4...  price 5 XRP  owner rMinterXXX...
```

---

## 5. Buyer accepts the sell offer

A different wallet accepts the offer and pays the price:

```bash
# Auto-fund a buyer wallet and accept the offer
xrpl-up nft accept $OFFER_ID --local
# ✔ Offer accepted
#   buyer    rBuyerXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   price    5 XRP
#   royalty  0.25 XRP → rMinterXXX...

BUYER_SEED=sEdBuyerSeedXXXXXXXXXXXXXXXXXXXXX
BUYER=rBuyerXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Provide a specific buyer seed:

```bash
xrpl-up nft accept $OFFER_ID --local --seed $BUYER_SEED
```

---

## 6. Verify ownership transferred

```bash
xrpl-up nft list --local --account $BUYER
# NFTokenID  000800006B9C0B...   ← now owned by buyer

xrpl-up nft list --local --account $MINTER
# (empty — no longer holds the NFT)
```

---

## 7. Broker a trade (optional)

A third party (broker) can match a sell offer and a buy offer simultaneously, taking a commission:

```bash
# Buyer creates a buy offer
xrpl-up faucet --local
# → seed: sEdBuyer2SeedXXX  address: rBuyer2XXX

# (Create buy offer via xrpl-up run script — xrpl-up does not have a dedicated `nft buy-offer` subcommand)
```

---

## 8. Burn the NFT

Only the current owner can burn (unless `--burnable` was set, in which case the issuer can too):

```bash
xrpl-up nft burn $NFT_ID --local --seed $BUYER_SEED
# ✔ NFT burned  000800006B9C0B...
```

Confirm it's gone:

```bash
xrpl-up nft list --local --account $BUYER
# (empty)
```

---

## Full lifecycle at a glance

```bash
# 1. Mint
xrpl-up nft mint --local --uri https://example.com/meta.json --transferable --transfer-fee 5
# → NFT_ID, MINTER_SEED

# 2. List for sale
xrpl-up nft sell $NFT_ID 5 --local --seed $MINTER_SEED
# → OFFER_ID

# 3. Accept (buy)
xrpl-up nft accept $OFFER_ID --local
# → BUYER_SEED

# 4. Burn
xrpl-up nft burn $NFT_ID --local --seed $BUYER_SEED
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **NFTokenID** | 256-bit unique identifier encoding the issuer, taxon, transfer fee, and a sequence counter. |
| **Taxon** | Collection identifier. All NFTs from the same mint with the same taxon belong to one "collection". |
| **Transfer fee** | Royalty paid to the original minter on every resale (1/1000ths of a percent, 0–50%). |
| **Burnable flag** | If set at mint time, the issuer can burn the NFT even after it has been sold. |
| **Offer** | Sell and buy offers live on-chain as ledger objects until accepted, cancelled, or expired. |

---

## Next steps

- [MPT](mpt.md) — fungible tokens for more flexible use cases (SFT-like behavior with `taxon`)
- [DEX](dex.md) — trade XRP and IOUs on the order book
- [Checks](checks.md) — deferred payments for NFT settlement flows
