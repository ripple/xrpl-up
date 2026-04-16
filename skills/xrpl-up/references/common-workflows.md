## Common Agent Workflows

### Workflow 1: Fund a new wallet and send XRP

```bash
# 1. Generate and save a new wallet
xrpl-up --node testnet wallet new --save --alias sender

# 2. Fund from testnet faucet
xrpl-up --node testnet wallet fund rSenderXXXXXXXXXXXXXXXXXXXXXXXXX

# 3. Send XRP to another address
xrpl-up --node testnet payment \
  --to rReceiverXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 1.5 \
  --account rSenderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword
```

### Workflow 2: Create an IOU trust line and receive tokens

```bash
# 1. Set up a trust line for the token
xrpl-up --node testnet trust set \
  --currency USD \
  --issuer rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --limit 1000 \
  --account rHolderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword

# 2. Receive tokens via payment from the issuer
xrpl-up --node testnet payment \
  --to rHolderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 100/USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --account rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password issuerpassword
```

### Workflow 3: Create an XRP/USD AMM pool (full setup)

The LP account must hold both XRP and USD before creating the pool.
The issuer account must have DefaultRipple enabled or AMM creation will fail.

```bash
# 1. Enable DefaultRipple on the issuer account (REQUIRED — skipping causes AMM create to fail)
xrpl-up account set --set-flag defaultRipple --node local --seed sEdIssuer...

# 2. LP account sets a USD trust line to the issuer
xrpl-up trust set \
  --currency USD \
  --issuer rIssuer... \
  --limit 10000 \
  --node local \
  --seed sEdLP...

# 3. Issuer sends USD to the LP account
xrpl-up payment \
  --to rLP... \
  --amount 500/USD/rIssuer... \
  --node local \
  --seed sEdIssuer...

# 4. LP creates the AMM pool (100 XRP = 100000000 drops, 100 USD, 0.5% fee)
xrpl-up amm create \
  --asset XRP \
  --asset2 USD/rIssuer... \
  --amount 100000000 \
  --amount2 100 \
  --trading-fee 500 \
  --node local \
  --seed sEdLP...
# → AMM Account: rAMM...
# → LP Token: 03930D...
```

### Workflow 4: Swap XRP for USD via AMM

The trader account must have a USD trust line before receiving USD from the swap.

```bash
# 1. Trader sets USD trust line to the issuer
xrpl-up trust set \
  --currency USD \
  --issuer rIssuer... \
  --limit 10000 \
  --node local \
  --seed sEdTrader...

# 2. Cross-currency payment: spend up to 10 XRP, receive 9 USD via AMM
xrpl-up payment \
  --to rTrader... \
  --amount 9/USD/rIssuer... \
  --send-max 10 \
  --node local \
  --seed sEdTrader...

# 3. Verify balances
xrpl-up account balance rTrader... --node local
xrpl-up account trust-lines rTrader... --node local
```

> **Note:** XRP amounts for `amm create/deposit` are in **drops** (1 XRP = 1,000,000 drops).
> The `--send-max` in `payment` is in XRP (decimal), not drops.

### Workflow 5: Drain an AMM pool

```bash
# Withdraw all liquidity (auto-deletes pool when sole LP)
xrpl-up amm withdraw \
  --asset XRP \
  --asset2 USD/rIssuer... \
  --all \
  --node local \
  --seed sEdLP...
```

---

