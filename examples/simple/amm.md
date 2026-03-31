# AMM — Automated Market Maker

XRPL's built-in AMM (XLS-30) lets you provide liquidity to a constant-product pool and earn trading fees. Unlike the DEX order book, the AMM never expires and prices adjust continuously based on the pool ratio.

> **Local sandbox only**: AMM is enabled automatically in the local Docker sandbox. On Testnet/Devnet it is available but you need your own accounts and trust lines.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Create an XRP / USD pool

`amm create` handles everything automatically: issuer creation, trust lines, token minting, and pool seeding.

```bash
# XRP / USD pool — 100 XRP and 100 USD, 0.5% trading fee
xrpl-up amm create XRP USD
# ✔ AMM pool created
#   asset1   100 XRP
#   asset2   100 USD  (issuer: rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX)
#   fee      0.5%
#   LP token rAMMXXXXX / LPToken
#
#   Hint: xrpl-up amm info XRP USD.rIssuerXXXXX
```

Save the issuer address printed in the output:

```bash
ISSUER=rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 2. Inspect the pool

```bash
xrpl-up amm info XRP USD.$ISSUER
# pool account   rAMMXXXXX...
# XRP reserve    100 XRP
# USD reserve    100 USD
# LP supply      10.000000 LPToken
# fee            0.5%
```

---

## 3. Custom amounts and fee

```bash
# 500 XRP / 1000 USD pool with a 0.3% fee
xrpl-up amm create XRP USD --amount1 500 --amount2 1000 --fee 0.3
```

---

## 4. Create a token/token pool

```bash
# USD / EUR pool (xrpl-up creates two separate issuers automatically)
xrpl-up amm create USD EUR --amount1 100 --amount2 120
# → USD issuer: rUsdIssuerXXXX
# → EUR issuer: rEurIssuerXXXX
```

---

## 5. Trade against the pool

Once the pool is live, any account can trade against it using the DEX `offer create` command — the AMM is automatically matched as a counterparty.

```bash
# Fund a trader
xrpl-up faucet --local
# → seed: sEdTraderSeedXXX  address: rTraderXXX

TRADER_SEED=sEdTraderSeedXXX
TRADER=rTraderXXX

# Trader sets a trust line for USD
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $TRADER_SEED

# Trader sells 5 XRP into the pool (gets USD back)
xrpl-up offer create --taker-pays 5 --taker-gets 4/USD/$ISSUER --seed $TRADER_SEED \
  --immediate-or-cancel
# The AMM fills the offer at the current pool price
```

---

## 6. Query the pool after a trade

After swaps the pool ratio shifts (and the price moves):

```bash
xrpl-up amm info XRP USD.$ISSUER
# XRP reserve    105 XRP   ← increased
# USD reserve    95.238...  ← decreased
```

---

## 7. Look up a pool by AMM account address

```bash
xrpl-up amm info --account rAMMXXXXXXXXXXXXXXXXXXXXXXXXXXXX
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
