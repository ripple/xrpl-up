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

### Workflow 3: Create and drain an AMM pool

```bash
# 1. Create AMM pool with XRP and USD
xrpl-up --node testnet amm create \
  --asset XRP \
  --asset2 USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 10000000 \
  --amount2 1000 \
  --trading-fee 500 \
  --account rOwnerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword

# 2. Withdraw all liquidity using tfWithdrawAll (auto-deletes pool when no other LP holders)
xrpl-up --node testnet amm withdraw \
  --asset XRP \
  --asset2 USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --all \
  --account rOwnerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword
```

---

