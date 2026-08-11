# AMM — Automated Market Maker

XRPL's built-in AMM (XLS-30) lets you provide liquidity to a constant-product pool and earn trading fees. Unlike the DEX order book, the AMM never expires and prices adjust continuously based on the pool ratio.

> **Local sandbox only**: AMM is enabled automatically in the local Docker sandbox. On Testnet/Devnet it is available but you need your own accounts and trust lines.

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Set up an issuer and fund the liquidity provider with USD

`amm create` submits a single `AMMCreate` transaction — it does **not** create issuers, trust lines, or mint tokens for you. For an XRP/USD pool, the LP account needs a real USD balance first:

```bash
# Fund an issuer and a liquidity-provider account
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)

LP_JSON=$(xrpl-up faucet --network local --json)
LP_SEED=$(echo "$LP_JSON" | jq -r .seed)
LP=$(echo "$LP_JSON" | jq -r .address)

# Let the issuer's USD ripple through trust lines (needed for it to settle payments)
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED --node local

# LP trusts the issuer for USD, then the issuer sends USD to the LP
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $LP_SEED --node local
xrpl-up payment --to $LP --amount 1000/USD/$ISSUER --seed $ISSUER_SEED --node local
```

---

## 2. Create an XRP / USD pool

```bash
# 100 XRP / 100 USD pool, 0.5% trading fee (amounts: XRP in drops, IOU as decimal)
xrpl-up amm create --asset XRP --asset2 USD/$ISSUER \
  --amount 100000000 --amount2 100 --trading-fee 500 \
  --seed $LP_SEED --node local
```

---

## 3. Inspect the pool

```bash
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER --node local
```

---

## 4. Trade against the pool

Once the pool is live, any account can trade against it using the DEX `offer create` command — the AMM is automatically matched as a counterparty.

```bash
# Fund a trader and give it a USD trust line
TRADER_JSON=$(xrpl-up faucet --network local --json)
TRADER_SEED=$(echo "$TRADER_JSON" | jq -r .seed)
TRADER=$(echo "$TRADER_JSON" | jq -r .address)
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $TRADER_SEED --node local

# Trader sells 5 XRP into the pool (gets USD back) — price includes the 0.5% fee + slippage
xrpl-up offer create --taker-pays 4.5/USD/$ISSUER --taker-gets 5 --seed $TRADER_SEED --node local \
  --immediate-or-cancel
# The AMM fills the offer at the current pool price
```

---

## 5. Query the pool after a trade

After swaps the pool ratio shifts (and the price moves):

```bash
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER --node local
# Asset 1: 104.735721 XRP   ← increased
# Asset 2: 95.5 USD         ← decreased
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Constant product** | The pool enforces `reserve1 × reserve2 = k`. Price adjusts automatically. |
| **LP token** | Liquidity providers receive LP tokens representing their pool share. Redeem them to withdraw. |
| **Trading fee** | Charged on every swap; distributed to LP token holders. |
| **Auto-bridging** | The XRPL DEX can route trades through an AMM pool as an intermediate step. |
| **Pool account** | Each AMM has a special ledger account that holds the reserves. |

---

## Next steps

- [DEX](dex.md) — place limit orders on the built-in order book
- [Issued Token](issued-token.md) — understand the tokens powering the pool
- [MPT](mpt.md) — next-generation token type that can also be pooled
