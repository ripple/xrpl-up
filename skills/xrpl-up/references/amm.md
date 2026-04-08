## amm

Interact with Automated Market Maker (AMM) pools.

### amm create

Create a new AMM liquidity pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset: `XRP` or `CURRENCY/issuer` |
| `--asset2 <spec>` | string | **Yes** | — | Second asset: `XRP` or `CURRENCY/issuer` |
| `--amount <value>` | string | **Yes** | — | Amount of first asset (XRP: drops integer, IOU: decimal) |
| `--amount2 <value>` | string | **Yes** | — | Amount of second asset (XRP: drops integer, IOU: decimal) |
| `--trading-fee <n>` | integer | **Yes** | — | Trading fee in units of 1/100000 (0–1000, where 1000 = 1%) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm create --asset XRP --asset2 USD/rIssuerXXX... --amount 1000000 --amount2 100 --trading-fee 500 --seed sEd...
```

### amm deposit

Deposit assets into an AMM pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--amount <value>` | string | No | — | Amount of first asset to deposit (XRP: drops integer, IOU: decimal) |
| `--amount2 <value>` | string | No | — | Amount of second asset to deposit (XRP: drops integer, IOU: decimal) |
| `--lp-token-out <value>` | string | No | — | LP token amount to receive |
| `--ePrice <value>` | string | No | — | Maximum effective price per LP token |
| `--for-empty` | boolean | No | false | Use tfTwoAssetIfEmpty mode |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm deposit --asset XRP --asset2 USD/rIssuerXXX... --amount 500000 --seed sEd...
```

### amm withdraw

Withdraw assets from an AMM pool by redeeming LP tokens.

Withdraw modes (exactly one valid combination required):
- `--lp-token-in` → tfLPToken
- `--all` → tfWithdrawAll
- `--all --amount` → tfOneAssetWithdrawAll
- `--amount` → tfSingleAsset
- `--amount --amount2` → tfTwoAsset
- `--amount --lp-token-in` → tfOneAssetLPToken
- `--amount --ePrice` → tfLimitLPToken

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--lp-token-in <value>` | string | No | — | LP token amount to redeem (currency/issuer auto-fetched) |
| `--amount <value>` | string | No | — | Amount of first asset to withdraw |
| `--amount2 <value>` | string | No | — | Amount of second asset to withdraw |
| `--ePrice <value>` | string | No | — | Minimum effective price in LP tokens per unit withdrawn |
| `--all` | boolean | No | false | Withdraw all LP tokens (tfWithdrawAll or tfOneAssetWithdrawAll) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm withdraw --asset XRP --asset2 USD/rIssuerXXX... --all --seed sEd...
```

### amm vote

Vote on the trading fee for an AMM pool. Vote weight is proportional to LP token holdings.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--trading-fee <n>` | integer | **Yes** | — | Desired trading fee in units of 1/100000 (0–1000) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm vote --asset XRP --asset2 USD/rIssuerXXX... --trading-fee 300 --seed sEd...
```

### amm bid

Bid on an AMM auction slot to earn a reduced trading fee for a time window.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--bid-min <value>` | string | No | — | Minimum LP token amount to bid (currency/issuer auto-fetched) |
| `--bid-max <value>` | string | No | — | Maximum LP token amount to bid (currency/issuer auto-fetched) |
| `--auth-account <address>` | string | No | — | Address to authorize for discounted trading (repeatable, max 4) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm bid --asset XRP --asset2 USD/rIssuerXXX... --bid-min 100 --bid-max 200 --seed sEd...
```

### amm delete

Delete an empty AMM pool (all LP tokens must have been returned first).

> **Note:** Only succeeds when the AMM pool has >512 LP token holders and `tfWithdrawAll` returned `tecINCOMPLETE`; with few holders, `AMMWithdraw(tfWithdrawAll)` auto-deletes the pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm delete --asset XRP --asset2 USD/rIssuerXXX... --seed sEd...
```

### amm clawback

Claw back IOU assets from an AMM pool (issuer only). The signing account must be the issuer of `--asset`.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | IOU asset to claw back: `CURRENCY/issuer` (issuer must match signer) |
| `--asset2 <spec>` | string | **Yes** | — | Other asset in the pool: `XRP` or `CURRENCY/issuer` |
| `--holder <address>` | string | **Yes** | — | Account holding the asset to be clawed back |
| `--amount <value>` | string | No | all | Maximum amount to claw back |
| `--both-assets` | boolean | No | false | Claw back both assets proportionally (tfClawTwoAssets) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up amm clawback --asset USD/rIssuer... --asset2 XRP --holder rHolder... --seed sIssuerEd...
```

### amm info

Query AMM pool state.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |

```bash
xrpl-up amm info --asset XRP --asset2 USD/rIssuerXXX... --json
```

### Example flow: Alice creates an XRP/USD AMM pool, deposits liquidity, votes on fee, withdraws all

```bash
# Prerequisite: Alice holds USD issued by rIssuerXXX... and has set up a trust line

# 1. Alice creates an XRP/USD AMM pool with 1,000,000 drops (1 XRP) and 100 USD, fee = 0.3%
xrpl-up --node testnet amm create \
  --asset XRP \
  --asset2 USD/rIssuerXXX... \
  --amount 1000000 \
  --amount2 100 \
  --trading-fee 300 \
  --seed sEdAliceXXXX... --json
# → {"ammAccount":"rAMMXXXX...","lpTokenCurrency":"03...","result":"tesSUCCESS"}

# 2. Query the pool state (balances, LP token supply, current fee)
xrpl-up --node testnet amm info --asset XRP --asset2 USD/rIssuerXXX...

# 3. Alice deposits an additional 500,000 drops of XRP (single-asset deposit)
xrpl-up --node testnet amm deposit \
  --asset XRP --asset2 USD/rIssuerXXX... \
  --amount 500000 \
  --seed sEdAliceXXXX...

# 4. Alice votes to lower the trading fee to 0.1%
xrpl-up --node testnet amm vote \
  --asset XRP --asset2 USD/rIssuerXXX... \
  --trading-fee 100 \
  --seed sEdAliceXXXX...

# 5. Alice withdraws all liquidity (auto-deletes the pool when she is the sole LP)
xrpl-up --node testnet amm withdraw \
  --asset XRP --asset2 USD/rIssuerXXX... \
  --all \
  --seed sEdAliceXXXX...
```

