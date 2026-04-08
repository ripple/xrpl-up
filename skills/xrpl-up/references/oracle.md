## oracle

Manage on-chain price oracles.

### oracle set

Publish or update an on-chain price oracle (OracleSet).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--document-id <n>` | integer | **Yes** | — | Oracle document ID (UInt32) |
| `--price <json>` | string | No | — | Price data entry (repeatable) |
| `--price-data <json>` | string | No | — | JSON array of price pairs |
| `--provider <string>` | string | No | — | Oracle provider string (auto hex-encoded) |
| `--provider-hex <hex>` | string | No | — | Oracle provider as raw hex |
| `--asset-class <string>` | string | No | — | Asset class string (auto hex-encoded) |
| `--asset-class-hex <hex>` | string | No | — | Asset class as raw hex |
| `--last-update-time <ts>` | integer | No | now | Unix timestamp for LastUpdateTime |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up oracle set --document-id 1 --price-data '[{"base_asset":"XRP","quote_asset":"USD","asset_price":100,"scale":2}]' --seed sEd...
```

### oracle delete

Delete an on-chain price oracle (OracleDelete).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--document-id <n>` | integer | **Yes** | — | Oracle document ID |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up oracle delete --document-id 1 --seed sEd...
```

### oracle get

Query an on-chain price oracle (read-only). Both arguments are positional.

```bash
xrpl-up oracle get <owner-address> <document-id>
xrpl-up oracle get rOracleXXX... 1 --json
```

### Example flow: An oracle provider publishes a BTC/USD price feed and keeps it updated

```bash
# 1. Publish a BTC/USD price feed (oracle document ID = 1)
xrpl-up --node testnet oracle set \
  --document-id 1 \
  --price BTC/USD:155000:6 \
  --provider pyth \
  --asset-class currency \
  --seed sEdOracleXXXX...

# 2. Update the price — same document-id overwrites the previous entry
xrpl-up --node testnet oracle set \
  --document-id 1 \
  --price BTC/USD:160000:6 \
  --provider pyth \
  --asset-class currency \
  --seed sEdOracleXXXX...

# 3. Publish multiple pairs in one transaction using --price-data
xrpl-up --node testnet oracle set \
  --document-id 2 \
  --price-data '[{"BaseAsset":"ETH","QuoteAsset":"USD","AssetPrice":3000000,"Scale":6},{"BaseAsset":"XRP","QuoteAsset":"USD","AssetPrice":5000,"Scale":6}]' \
  --provider chainlink \
  --asset-class currency \
  --seed sEdOracleXXXX...

# 4. Delete the oracle when the feed is discontinued
xrpl-up --node testnet oracle delete \
  --document-id 1 --seed sEdOracleXXXX...
```

