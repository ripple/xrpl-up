# DEX — Decentralized Exchange

XRPL has a fully on-chain order book built into the protocol. No smart contracts, no liquidity mining — just place an offer and let the ledger match it. Offers can trade XRP against IOUs, or IOU against IOU.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## 1. Set up issuer + trust lines

We need a token to trade. Skip to step 2 if you already have an IOU set up.

```bash
# Fund issuer and trader accounts
xrpl-up faucet --local
# → seed: sEdIssuerSeedXXX   address: rIssuerXXX

xrpl-up faucet --local
# → seed: sEdTraderASeedXXX  address: rTraderAXXX

xrpl-up faucet --local
# → seed: sEdTraderBSeedXXX  address: rTraderBXXX

ISSUER_SEED=sEdIssuerSeedXXX
ISSUER=rIssuerXXX
TRADER_A_SEED=sEdTraderASeedXXX
TRADER_A=rTraderAXXX
TRADER_B_SEED=sEdTraderBSeedXXX
TRADER_B=rTraderBXXX
```

Enable DefaultRipple so tokens can flow between accounts:

```bash
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED
```

Both traders set trust lines for USD:

```bash
xrpl-up trust set --currency USD --issuer $ISSUER --limit 50000 --seed $TRADER_A_SEED
xrpl-up trust set --currency USD --issuer $ISSUER --limit 50000 --seed $TRADER_B_SEED
```

---

## 2. Place a sell offer — Trader A sells XRP for USD

Format: `offer create --taker-pays <pays> --taker-gets <gets>` — `pays` is what you put in, `gets` is what you want back.

```bash
# Trader A offers 10 XRP in exchange for 20 USD
# (i.e. selling XRP at 2 USD per XRP)
xrpl-up offer create --taker-pays 10 --taker-gets 20/USD/$ISSUER --seed $TRADER_A_SEED
# ✔ Offer created  sequence 5
#   pays  10 XRP
#   gets  20 USD (rIssuerXXX...)
```

---

## 3. Place a matching buy offer — Trader B buys XRP with USD

```bash
# Trader B offers 20 USD to get 10 XRP (matches Trader A's offer exactly)
xrpl-up offer create --taker-pays 20/USD/$ISSUER --taker-gets 10 --seed $TRADER_B_SEED
# ✔ Offer filled immediately (matched Trader A)
```

---

## 4. List open offers

```bash
xrpl-up account offers $TRADER_A
# Lists all open offers for Trader A
```

---

## 5. Partially fill an offer

```bash
# Place an offer that is too large to fill right away
xrpl-up offer create --taker-pays 100 --taker-gets 200/USD/$ISSUER --seed $TRADER_A_SEED
# → sequence: 7

# Place a counter-offer that only fills half
xrpl-up offer create --taker-pays 100/USD/$ISSUER --taker-gets 50 --seed $TRADER_B_SEED
# Trader A's offer is now half-filled; the remaining 50 XRP / 100 USD stays on the book
```

---

## 6. Cancel an offer

```bash
# Cancel Trader A's open offer by its sequence number
xrpl-up offer cancel 7 --seed $TRADER_A_SEED
# ✔ Offer 7 cancelled
```

---

## 7. Offer flags

| Flag | When to use |
|------|-------------|
| `--passive` | List price without consuming matching offers at the same price |
| `--sell` | Sell exactly `TakerPays`; ledger won't give you more than `TakerGets` |
| `--immediate-or-cancel` | Fill what's available right now; cancel the rest immediately |
| `--fill-or-kill` | Fill the entire offer or cancel entirely — no partial fills |

```bash
# Immediate-or-cancel sell offer: sell 10 XRP, cancel if not fully filled
xrpl-up offer create --taker-pays 10 --taker-gets 20/USD/$ISSUER --seed $TRADER_A_SEED \
  --sell --immediate-or-cancel
```

---

## 8. View transaction history

```bash
xrpl-up account transactions $TRADER_A --limit 10
# Each row shows type OfferCreate / OfferCancel, result, and a summary like "buy 10 XRP for 20 USD"
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Offer** | An on-chain limit order. Stays on the book until matched, cancelled, or expired (if `Expiration` is set). |
| **Auto-bridge** | The ledger can route XRP→IOU→IOU trades through XRP as an intermediate to improve prices. |
| **Quality** | Offers are sorted by price; best price executes first. |
| **Rippling** | IOU payments can flow through multiple trust lines — the ledger finds the best path automatically. |

---

## Next steps

- [AMM](amm.md) — provide passive liquidity instead of limit orders
- [Issued Token](issued-token.md) — create the tokens you're trading
- [Checks](checks.md) — deferred token payments without an order book
