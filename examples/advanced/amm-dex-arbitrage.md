# AMM + DEX Arbitrage Simulation

XRPL's AMM and DEX order book coexist on the same ledger. When their prices diverge, an arbitrageur can profit by buying from the cheaper source and selling on the more expensive one. The ledger's pathfinding also auto-bridges trades through both.

This guide:
1. Creates an AMM pool and a divergent DEX order
2. Reads quotes from both sources
3. Executes the best route with an IOC (immediate-or-cancel) offer
4. Compares the pool price before and after to see the arbitrage close the gap

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## Step 1: Create the AMM pool

```bash
# XRP/USD pool: 100 XRP, 100 USD → implicit price 1 XRP = 1 USD
xrpl-up amm create XRP USD --local --amount1 100 --amount2 100 --fee 0.3
# ✔ AMM pool created
#   XRP reserve  100
#   USD reserve  100
#   fee          0.3%
#   issuer       rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX

ISSUER=rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## Step 2: Check the initial AMM price

```bash
xrpl-up amm info XRP USD.$ISSUER --local
# XRP reserve   100 XRP
# USD reserve   100 USD
# → implicit price: 1 XRP = 1 USD
```

---

## Step 3: Place a DEX order at a different price

Fund a market maker and post an offer at **1 XRP = 1.25 USD** (i.e., selling USD cheaply compared to the AMM):

```bash
xrpl-up faucet --local
# → seed: sEdMMSeedXXX  address: rMMXXX

MM_SEED=sEdMMSeedXXXXXXXXXXXXXXXXXXXXXXXX
MM=rMMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# MM needs a USD trust line
xrpl-up trustline set USD.$ISSUER 50000 --local --seed $MM_SEED

# MM places an offer: pay 25 USD, get 20 XRP (= 1.25 USD per XRP)
# i.e. MM is willing to sell USD at a 25% premium over AMM price
xrpl-up offer create "25.USD.$ISSUER" "20" --local --seed $MM_SEED
# ✔ Offer created  sequence 5
#   pays  25 USD
#   gets  20 XRP
#   price 1.25 USD/XRP
```

---

## Step 4: Read quotes from both sources

**AMM quote** — inspect the pool state to estimate the swap output:

```bash
xrpl-up amm info XRP USD.$ISSUER --local
# XRP reserve   100 XRP
# USD reserve   100 USD
# fee           0.3%
#
# Estimate: to buy 20 XRP from AMM:
#   output = 100 - (100×100)/(100+20) = 100 - 8333/120 ≈ 16.67 USD (plus 0.3% fee ≈ 16.72 USD)
```

**DEX quote** — check the open order book:

```bash
xrpl-up offer list --local --account $MM
# pays 25 USD  gets 20 XRP  →  costs 25 USD to acquire 20 XRP on DEX
```

**Comparison:**

| Source | Cost to buy 20 XRP | Price per XRP |
|--------|--------------------|---------------|
| AMM    | ~16.72 USD         | ~0.836 USD    |
| DEX    | 25 USD             | 1.25 USD      |

**→ The AMM is cheaper. Buy from AMM, not DEX.**

---

## Step 5: Execute the arbitrage — buy XRP from AMM

Fund an arbitrageur with USD (they set a trust line and receive USD from the MM first):

```bash
xrpl-up faucet --local
# → seed: sEdArbitragerSeedXXX  address: rArbitragerXXX

ARB_SEED=sEdArbitragerSeedXXXXXXXXXXXXXXXX
ARB=rArbitragerXXXXXXXXXXXXXXXXXXXXXXXXXX

xrpl-up trustline set USD.$ISSUER 50000 --local --seed $ARB_SEED
```

Place an IOC offer to buy XRP by paying USD — the ledger routes through the cheapest source (AMM first):

```bash
# Buy up to 20 XRP by paying at most 20 USD — immediate-or-cancel
xrpl-up offer create "20.USD.$ISSUER" "20" --local --seed $ARB_SEED \
  --immediate-or-cancel
# ✔ Offer filled via AMM
#   paid  ~16.77 USD
#   got   20 XRP
#   route AMM pool
```

---

## Step 6: Sell the acquired XRP on the DEX at the higher price

The DEX still has the MM's order at 1.25 USD/XRP. The arbitrageur sells their XRP there:

```bash
# Sell 20 XRP into the MM's open offer, get 25 USD back
xrpl-up offer create "20" "25.USD.$ISSUER" --local --seed $ARB_SEED \
  --immediate-or-cancel
# ✔ Offer filled via DEX order book
#   paid  20 XRP
#   got   25 USD
```

---

## Step 7: Calculate profit and verify pool shift

```bash
# Arbitrageur P&L:
#   Spent  ~16.77 USD  (AMM buy)
#   Got     25 USD     (DEX sell)
#   Profit ~8.23 USD

# Check the AMM pool — it shifted toward the DEX price
xrpl-up amm info XRP USD.$ISSUER --local
# XRP reserve   80 XRP   ← decreased (sold 20 XRP to arb)
# USD reserve  125 USD   ← increased (received ~16.77 USD from arb)
# → new price: 125/80 = 1.5625 USD/XRP  (moved toward DEX price of 1.25)
```

---

## Step 8: View full transaction history

```bash
xrpl-up tx list $ARB --local --limit 5
# OfferCreate  tesSUCCESS  buy 20 XRP for ~16.77 USD  (AMM route)
# OfferCreate  tesSUCCESS  sell 20 XRP for 25 USD     (DEX route)
```

---

## Price convergence visualization

```
Before arb:
  AMM price  1.00 USD/XRP   ◄── cheap
  DEX price  1.25 USD/XRP   ◄── expensive

After arb (20 XRP bought from AMM, sold to DEX):
  AMM price  1.56 USD/XRP   ◄── pushed up
  DEX price  1.25 USD/XRP   ◄── MM's offer consumed

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
