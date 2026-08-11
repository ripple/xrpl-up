# AMM + DEX Arbitrage Simulation

> **Illustration only — not a real trading strategy, and not financial advice.** This example demonstrates AMM/DEX mechanics on a local sandbox, not a real, exploitable arbitrage opportunity. Live-verified testing while writing this guide found that rippled auto-bridges *any* offer that crosses an AMM's price the moment it's created — not just IOC orders from a third party — so a resting mispriced DEX order can self-arbitrage against the AMM instantly, before a separate "arbitrageur" account ever gets a turn. The three-actor narrative below (LP / market maker / arbitrageur) is a simplified teaching device for the mechanics, not a description of how real MEV/arbitrage extraction works on XRPL. Do not adapt this as a real trading bot without your own independent research — the authors take no responsibility for losses from doing so.

XRPL's AMM and DEX order book coexist on the same ledger. When their prices diverge, an arbitrageur can profit by buying from the cheaper source and selling on the more expensive one. The ledger's pathfinding also auto-bridges trades through both.

This guide:
1. Creates an AMM pool and a divergent DEX order
2. Reads quotes from both sources
3. Executes the best route with an IOC (immediate-or-cancel) offer
4. Compares the pool price before and after to see the arbitrage close the gap

---

## Prerequisites

```bash
xrpl-up start --detach
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Step 1: Create the AMM pool

`amm create` doesn't create issuers or fund the LP for you — set that up first (see [amm.md](../simple/amm.md) for the full walkthrough):

```bash
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)

LP_JSON=$(xrpl-up faucet --network local --json)
LP_SEED=$(echo "$LP_JSON" | jq -r .seed)
LP=$(echo "$LP_JSON" | jq -r .address)

xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED
xrpl-up trust set --currency USD --issuer $ISSUER --limit 50000 --seed $LP_SEED
xrpl-up payment --to $LP --amount 100/USD/$ISSUER --seed $ISSUER_SEED

# XRP/USD pool: 100 XRP, 100 USD → implicit price 1 XRP = 1 USD; 0.3% fee (300 = 0.3% in basis-points-of-a-percent)
xrpl-up amm create --asset XRP --asset2 USD/$ISSUER \
  --amount 100000000 --amount2 100 --trading-fee 300 \
  --seed $LP_SEED
```

---

## Step 2: Check the initial AMM price

```bash
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER
# Asset 1: 100 XRP
# Asset 2: 100 USD
# → implicit price: 1 XRP = 1 USD
```

---

## Step 3: Place a DEX order at a different price

Fund a market maker and post an offer selling XRP at **1 XRP = 1.25 USD** — a 25% premium over the AMM's 1:1 price:

```bash
MM_JSON=$(xrpl-up faucet --network local --json)
MM_SEED=$(echo "$MM_JSON" | jq -r .seed)
MM=$(echo "$MM_JSON" | jq -r .address)

# MM needs a USD trust line and an actual USD balance to sell (used later, in step 6, as the counterparty)
xrpl-up trust set --currency USD --issuer $ISSUER --limit 50000 --seed $MM_SEED
xrpl-up payment --to $MM --amount 50/USD/$ISSUER --seed $ISSUER_SEED

# MM requests 25 USD, gives up 20 XRP (= 1.25 USD per XRP) -- selling XRP at a premium
xrpl-up offer create --taker-pays 25/USD/$ISSUER --taker-gets 20 --seed $MM_SEED
# ✔ Offer created  sequence 5
#   pays  25 USD
#   gets  20 XRP
#   price 1.25 USD/XRP
```

---

## Step 4: Read quotes from both sources

**AMM quote** — inspect the pool state to estimate the swap output. Buying N XRP out of a pool with reserves X/Y costs `(X·Y/(X−N) − Y) / (1 − fee)` — for a *small* trade relative to pool size, this stays close to the pool's spot price; for a large trade (e.g. 20% of the pool), slippage alone can make the AMM *more* expensive than a divergent DEX offer, so this guide intentionally uses a small trade (5 XRP against a 100 XRP pool) to keep the AMM route genuinely cheaper:

```bash
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER
# XRP reserve   100 XRP
# USD reserve   100 USD
# fee           0.3%
#
# Estimate: to buy 5 XRP from AMM:
#   pre-fee  = (100×100)/(100−5) − 100 = 10000/95 − 100 ≈ 5.263 USD
#   post-fee = 5.263 / (1 − 0.003) ≈ 5.279 USD
```

**DEX quote** — check the open order book:

```bash
xrpl-up account offers $MM
# pays 25 USD  gets 20 XRP  →  1.25 USD/XRP; buying 5 XRP there costs 5 × 1.25 = 6.25 USD
```

**Comparison:**

| Source | Cost to buy 5 XRP | Price per XRP |
|--------|--------------------|---------------|
| AMM    | ~5.28 USD          | ~1.056 USD    |
| DEX    | 6.25 USD           | 1.25 USD      |

**→ The AMM is cheaper. Buy from AMM, not DEX.**

---

## Step 5: Execute the arbitrage — buy XRP from AMM

Fund an arbitrageur with USD (they set a trust line and need an actual USD balance to pay with):

```bash
ARB_JSON=$(xrpl-up faucet --network local --json)
ARB_SEED=$(echo "$ARB_JSON" | jq -r .seed)
ARB=$(echo "$ARB_JSON" | jq -r .address)

xrpl-up trust set --currency USD --issuer $ISSUER --limit 50000 --seed $ARB_SEED
xrpl-up payment --to $ARB --amount 10/USD/$ISSUER --seed $ISSUER_SEED
```

Place an IOC offer to buy XRP by paying USD — the ledger routes through the cheapest source (AMM first). Real XRPL semantics: `--taker-pays` is what *you* (the offer creator) want to receive, `--taker-gets` is what you give up — to buy 5 XRP paying up to 6 USD, you're requesting 5 XRP and giving up to 6 USD:

```bash
xrpl-up offer create --taker-pays 5 --taker-gets 6/USD/$ISSUER --seed $ARB_SEED \
  --immediate-or-cancel
# ✔ Offer filled via AMM
#   paid  ~5.28 USD
#   got   5 XRP
#   route AMM pool
```

---

## Step 6: Sell the acquired XRP on the DEX at the higher price

The DEX still has the MM's order at 1.25 USD/XRP (partially fillable — MM offered 20 XRP total, this only takes 5). To sell 5 XRP receiving up to 6.25 USD, request 6.25 USD and give up 5 XRP:

```bash
xrpl-up offer create --taker-pays 6.25/USD/$ISSUER --taker-gets 5 --seed $ARB_SEED \
  --immediate-or-cancel
# ✔ Offer filled via DEX order book
#   paid  5 XRP
#   got   6.25 USD
```

---

## Step 7: Calculate profit and verify pool shift

```bash
# Arbitrageur P&L:
#   Spent  ~5.28 USD  (AMM buy)
#   Got     6.25 USD  (DEX sell)
#   Profit ~0.97 USD

# Check the AMM pool — it shifted toward the DEX price
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER
# XRP reserve   95 XRP     ← decreased (sold 5 XRP to arb)
# USD reserve  ~105.28 USD ← increased (received ~5.28 USD from arb)
# → new price: 105.28/95 ≈ 1.108 USD/XRP  (moved toward DEX price of 1.25)
```

---

## Step 8: View full transaction history

```bash
xrpl-up account transactions $ARB --limit 5
# OfferCreate  tesSUCCESS  buy 5 XRP for ~5.28 USD  (AMM route)
# OfferCreate  tesSUCCESS  sell 5 XRP for 6.25 USD  (DEX route)
```

---

## Price convergence visualization

```
Before arb:
  AMM price  1.00 USD/XRP   ◄── cheap
  DEX price  1.25 USD/XRP   ◄── expensive

After arb (5 XRP bought from AMM, sold to DEX):
  AMM price  1.108 USD/XRP  ◄── pushed up
  DEX price  1.25 USD/XRP   ◄── MM's offer partially consumed (15 XRP still resting)

Prices converge as arbitrage activity eliminates the gap.
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **AMM price formula** | `x × y = k` constant product. Buying XRP from the pool reduces XRP reserves, raising the price. |
| **IOC offer** | `--immediate-or-cancel` executes what it can immediately and cancels the rest — no resting order on the book. |
| **Auto-bridging** | The XRPL pathfinder automatically routes through AMM or DEX for the best effective price. |
| **LP fee drag** | The AMM charges a fee per swap. Arbitrage is only profitable when the price gap exceeds the fee. |
| **Offer quality** | DEX offers sorted by price quality; AMM provides liquidity at a sliding price curve. |

---

## Next steps

- [AMM](../simple/amm.md) — create and inspect liquidity pools
- [DEX](../simple/dex.md) — place limit orders on the order book
- [Issued Token](../simple/issued-token.md) — the tokens being traded
