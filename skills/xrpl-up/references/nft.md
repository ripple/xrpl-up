## nft

Manage NFTs on the XRP Ledger.

### nft mint

Mint an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--taxon <n>` | integer | **Yes** | — | NFT taxon (UInt32) |
| `--uri <string>` | string | No | — | Metadata URI |
| `--transfer-fee <bps>` | integer | No | — | Secondary sale fee in basis points (0–50000); requires `--transferable` |
| `--burnable` | boolean | No | false | Allow issuer to burn (tfBurnable) |
| `--only-xrp` | boolean | No | false | Restrict sales to XRP (tfOnlyXRP) |
| `--transferable` | boolean | No | false | Allow peer-to-peer transfers (tfTransferable) |
| `--mutable` | boolean | No | false | Allow URI modification (tfMutable) |
| `--issuer <address>` | string | No | — | Issuer when minting on behalf of another |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up nft mint --taxon 42 --uri https://example.com/nft.json --transferable --seed sEd...
```

### nft burn

Burn (destroy) an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID to burn |
| `--owner <address>` | string | No | — | NFT owner (when issuer burns a token they don't hold) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up nft burn --nft <64hexNFTokenID> --seed sEd...
```

### nft modify

Modify the URI of a mutable NFT (NFTokenModify). The NFT must have been minted with `--mutable`.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID to modify |
| `--uri <string>` | string | No† | — | New metadata URI (plain string, auto hex-encoded) |
| `--clear-uri` | boolean | No† | false | Explicitly clear the existing URI |
| `--owner <address>` | string | No | — | NFT owner address (if different from signer) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--uri` or `--clear-uri` is required; they are mutually exclusive.

```bash
xrpl-up nft modify --nft <64hexNFTokenID> --uri https://example.com/new-meta.json --seed sEd...
```

### nft offer create

Create a buy or sell offer for an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID |
| `--amount <amount>` | string | **Yes** | — | Offer amount (XRP decimal or `value/CURRENCY/issuer`; `0` valid for sell giveaways) |
| `--sell` | boolean | No | false | Create a sell offer (absence = buy offer) |
| `--owner <address>` | string | No† | — | NFT owner address (required for buy offers) |
| `--expiration <ISO8601>` | string | No | — | Offer expiration datetime |
| `--destination <address>` | string | No | — | Only this account may accept the offer |
| `--seed <seed>` | string | No | — | Family seed for signing |

† `--owner` is required for buy offers.

```bash
xrpl-up nft offer create --nft <64hexID> --amount 10 --sell --seed sEd...
```

### nft offer accept

Accept a buy or sell NFT offer (direct or brokered mode).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--sell-offer <hex>` | string | No† | — | Sell offer ID (64-char hex) |
| `--buy-offer <hex>` | string | No† | — | Buy offer ID (64-char hex) |
| `--broker-fee <amount>` | string | No | — | Broker fee; only valid with both offers present |
| `--seed <seed>` | string | No | — | Family seed for signing |

† At least one of `--sell-offer` or `--buy-offer` is required.

```bash
xrpl-up nft offer accept --sell-offer <64hexOfferID> --seed sEd...
```

### nft offer cancel

Cancel one or more NFT offers.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--offer <hex>` | string | **Yes** | — | NFTokenOffer ID to cancel (repeatable for multiple) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up nft offer cancel --offer <64hexOfferID> --seed sEd...
```

### nft offer list

List all buy and sell offers for an NFT (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up nft offer list <64hexNFTokenID> --json
```

### Example flow: Alice mints an NFT, creates a sell offer, Bob buys it; brokered sale variant included

```bash
# 1. Alice mints a transferable NFT with a metadata URI and 1% royalty fee
xrpl-up --node testnet nft mint \
  --taxon 42 \
  --uri https://example.com/nft-metadata.json \
  --transferable \
  --transfer-fee 1000 \
  --seed sEdAliceXXXX... --json
# → {"nftokenId":"AABBCC...64chars","result":"tesSUCCESS"}

# 2. Alice creates a sell offer for 10 XRP
xrpl-up --node testnet nft offer create \
  --nft AABBCC...64chars --amount 10 --sell \
  --seed sEdAliceXXXX... --json
# → {"offerId":"DDEE...64chars","result":"tesSUCCESS"}

# 3. List all buy/sell offers for the NFT
xrpl-up --node testnet nft offer list AABBCC...64chars

# 4. Bob accepts Alice's sell offer (direct sale — Bob pays 10 XRP, receives NFT)
xrpl-up --node testnet nft offer accept \
  --sell-offer DDEE...64chars --seed sEdBobXXXX...

# 5. Verify Bob now holds the NFT
xrpl-up --node testnet account nfts rBobXXXX...

# --- Brokered sale variant ---
# Alice creates a sell offer, Carol creates a buy offer, broker executes both

# 6. Bob (now owner) creates a sell offer
xrpl-up --node testnet nft offer create \
  --nft AABBCC...64chars --amount 15 --sell \
  --seed sEdBobXXXX... --json
# → {"offerId":"SELL...64chars"}

# 7. Carol creates a buy offer for 16 XRP
xrpl-up --node testnet nft offer create \
  --nft AABBCC...64chars --amount 16 --owner rBobXXXX... \
  --seed sEdCarolXXXX... --json
# → {"offerId":"BUY...64chars"}

# 8. Broker matches both offers (keeping 0.5 XRP as fee)
xrpl-up --node testnet nft offer accept \
  --sell-offer SELL...64chars \
  --buy-offer BUY...64chars \
  --broker-fee 0.5 \
  --seed sEdBrokerXXXX...

# 9. Cancel an unused offer
xrpl-up --node testnet nft offer cancel \
  --offer DDEE...64chars --seed sEdAliceXXXX...

# 10. Burn the NFT to remove it from the ledger
xrpl-up --node testnet nft burn --nft AABBCC...64chars --seed sEdAliceXXXX...
```

