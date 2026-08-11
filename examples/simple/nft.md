# NFT Lifecycle (XLS-20)

Mint, sell, buy, and burn Non-Fungible Tokens on XRPL. XRPL NFTs (XLS-20) are native protocol objects — no smart contract needed. The full lifecycle: mint → list for sale → buyer accepts → burn.

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Mint an NFT

Fund a minter account, then mint a transferable NFT with a metadata URI. `--transfer-fee` requires `--transferable`:

```bash
MINTER_JSON=$(xrpl-up faucet --network local --json)
MINTER_SEED=$(echo "$MINTER_JSON" | jq -r .seed)
MINTER=$(echo "$MINTER_JSON" | jq -r .address)

NFT_ID=$(xrpl-up nft mint \
  --uri https://example.com/nft-metadata.json \
  --transferable \
  --transfer-fee 500 \
  --taxon 1 \
  --seed $MINTER_SEED \
  --json | jq -r .nftokenId)
```

### Mint flags

| Flag | Description |
|------|-------------|
| `--uri <url>` | Metadata URI (hex-encoded on-chain) |
| `--transferable` | Allow the NFT to be transferred to other accounts |
| `--burnable` | Allow the issuer to burn the NFT even if held by another account |
| `--taxon <n>` | Group identifier for a collection (0–2147483647) |
| `--transfer-fee <bps>` | Royalty in basis points paid to the issuer on every resale (0–50000 bps, where 10000 = 100%) |

---

## 2. List NFTs for an account

```bash
xrpl-up account nfts $MINTER
# NFTokenID  000800006B9C0B...
# taxon      1    transferable: true    fee: 500 bps
# uri        https://example.com/nft-metadata.json
```

---

## 3. Create a sell offer

The owner puts the NFT up for sale. `--sell` is required — without it, `nft offer create` makes a **buy** offer instead:

```bash
# Sell for 5 XRP
OFFER_ID=$(xrpl-up nft offer create --nft $NFT_ID --amount 5 --sell --seed $MINTER_SEED --json | jq -r .offerId)
```

Sell for an IOU instead:

```bash
# Sell for 100 USD (requires buyer to have a USD trust line)
xrpl-up nft offer create --nft $NFT_ID --amount 100/USD/$ISSUER --sell --seed $MINTER_SEED
```

---

## 4. View open offers for an NFT

```bash
xrpl-up nft offer list $NFT_ID
# sell offers:
#   offerID  A1B2C3D4...  price 5 XRP  owner rMinterXXX...
```

---

## 5. Buyer accepts the sell offer

Fund a separate buyer wallet, then accept the offer:

```bash
BUYER_JSON=$(xrpl-up faucet --network local --json)
BUYER_SEED=$(echo "$BUYER_JSON" | jq -r .seed)
BUYER=$(echo "$BUYER_JSON" | jq -r .address)

xrpl-up nft offer accept --sell-offer $OFFER_ID --seed $BUYER_SEED
# ✔ Offer accepted
```

---

## 6. Verify ownership transferred

```bash
xrpl-up account nfts $BUYER
# NFTokenID  000800006B9C0B...   ← now owned by buyer

xrpl-up account nfts $MINTER
# (empty — no longer holds the NFT)
```

---

## 7. Broker a trade (optional)

A third party (broker) can match a sell offer and a buy offer simultaneously, taking a commission. `nft offer create` without `--sell` makes a buy offer instead — it needs `--owner` (the current NFT holder) since there's no NFT to transfer from the buyer's side yet:

```bash
# Buyer creates a buy offer for an NFT held by $MINTER
BUYER2_JSON=$(xrpl-up faucet --network local --json)
BUYER2_SEED=$(echo "$BUYER2_JSON" | jq -r .seed)
BUYER2=$(echo "$BUYER2_JSON" | jq -r .address)

BUY_OFFER_ID=$(xrpl-up nft offer create --nft $NFT_ID --amount 3 --owner $MINTER --seed $BUYER2_SEED --json | jq -r .offerId)

# Broker (or anyone) matches both offers, keeping the price difference as commission:
BROKER_JSON=$(xrpl-up faucet --network local --json)
BROKER_SEED=$(echo "$BROKER_JSON" | jq -r .seed)
xrpl-up nft offer accept --sell-offer $OFFER_ID --buy-offer $BUY_OFFER_ID --seed $BROKER_SEED
```

---

## 8. Burn the NFT

Only the current owner can burn (unless `--burnable` was set, in which case the issuer can too):

```bash
xrpl-up nft burn --nft $NFT_ID --seed $BUYER_SEED
# ✔ NFT burned  000800006B9C0B...
```

Confirm it's gone:

```bash
xrpl-up account nfts $BUYER
# (empty)
```

---

## Full lifecycle at a glance

```bash
# 1. Mint (minter and buyer must already be funded via `xrpl-up faucet --network local`)
NFT_ID=$(xrpl-up nft mint --taxon 1 --uri https://example.com/meta.json --transferable --transfer-fee 500 --seed $MINTER_SEED --json | jq -r .nftokenId)

# 2. List for sale
OFFER_ID=$(xrpl-up nft offer create --nft $NFT_ID --amount 5 --sell --seed $MINTER_SEED --json | jq -r .offerId)

# 3. Accept (buy)
xrpl-up nft offer accept --sell-offer $OFFER_ID --seed $BUYER_SEED

# 4. Burn
xrpl-up nft burn --nft $NFT_ID --seed $BUYER_SEED
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **NFTokenID** | 256-bit unique identifier encoding the issuer, taxon, transfer fee, and a sequence counter. |
| **Taxon** | Collection identifier. All NFTs from the same mint with the same taxon belong to one "collection". |
| **Transfer fee** | Royalty paid to the original minter on every resale, specified in basis points (0–50000 bps; 10000 bps = 100%). |
| **Burnable flag** | If set at mint time, the issuer can burn the NFT even after it has been sold. |
| **Offer** | Sell and buy offers live on-chain as ledger objects until accepted, cancelled, or expired. |

---

## Next steps

- [MPT](mpt.md) — fungible tokens for more flexible use cases (SFT-like behavior with `taxon`)
- [DEX](dex.md) — trade XRP and IOUs on the order book
- [Checks](checks.md) — deferred payments for NFT settlement flows
