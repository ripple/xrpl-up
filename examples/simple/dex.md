# DEX — Decentralized Exchange

XRPL has a fully on-chain order book built into the protocol. No smart contracts, no liquidity mining — just place an offer and let the ledger match it. Offers can trade XRP against IOUs, or IOU against IOU.

---

## Prerequisites

```bash
xrpl-up start
xrpl-up status   # wait until "healthy"
export XRPL_NETWORK=local
```

---

## 1. Set up issuer + trust lines

We need a token to trade. Skip to step 2 if you already have an IOU set up.

```bash
# Fund issuer and trader accounts
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)

TRADER_A_JSON=$(xrpl-up faucet --network local --json)
TRADER_A_SEED=$(echo "$TRADER_A_JSON" | jq -r .seed)
TRADER_A=$(echo "$TRADER_A_JSON" | jq -r .address)

TRADER_B_JSON=$(xrpl-up faucet --network local --json)
TRADER_B_SEED=$(echo "$TRADER_B_JSON" | jq -r .seed)
TRADER_B=$(echo "$TRADER_B_JSON" | jq -r .address)
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

Format: `offer create --taker-gets <gets> --taker-pays <pays>` — `--taker-gets` is what you (the offer creator) provide, `--taker-pays` is what you request back.

```bash
# Trader A provides 10 XRP and requests 20 USD in return
# (i.e. selling XRP at 2 USD per XRP)
OFFER_A_SEQ=$(xrpl-up offer create --taker-gets 10 --taker-pays 20/USD/$ISSUER --seed $TRADER_A_SEED --json | jq -r .offerSequence)
```

---

## 3. Place a matching buy offer — Trader B buys XRP with USD

Trader B needs an actual USD balance before they can offer to sell it — the issuer sends some first:

```bash
xrpl-up payment --to $TRADER_B --amount 5000/USD/$ISSUER --seed $ISSUER_SEED
```

```bash
# Trader B provides 20 USD and requests 10 XRP (matches Trader A's offer exactly)
xrpl-up offer create --taker-gets 20/USD/$ISSUER --taker-pays 10 --seed $TRADER_B_SEED
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
OFFER_A_SEQ=$(xrpl-up offer create --taker-gets 100 --taker-pays 200/USD/$ISSUER --seed $TRADER_A_SEED --json | jq -r .offerSequence)

# Place a counter-offer that only fills half
xrpl-up offer create --taker-gets 100/USD/$ISSUER --taker-pays 50 --seed $TRADER_B_SEED
# Trader A's offer is now half-filled; the remaining 50 XRP / 100 USD stays on the book
```

---

## 6. Cancel an offer

```bash
# Cancel Trader A's open offer by its sequence number
xrpl-up offer cancel --sequence $OFFER_A_SEQ --seed $TRADER_A_SEED
# ✔ Offer cancelled
```

---

## 7. Offer flags

| Flag | When to use |
|------|-------------|
| `--passive` | List price without consuming matching offers at the same price |
| `--sell` | Sell exactly `TakerGets`; accept less than `TakerPays` if that's all the market offers |
| `--immediate-or-cancel` | Fill what's available right now; cancel the rest immediately |
| `--fill-or-kill` | Fill the entire offer or cancel entirely — no partial fills |

```bash
# Immediate-or-cancel sell offer: sell 10 XRP, cancel if not fully filled
xrpl-up offer create --taker-gets 10 --taker-pays 20/USD/$ISSUER --seed $TRADER_A_SEED \
  --sell --immediate-or-cancel
```

---

## 8. View transaction history

```bash
xrpl-up account transactions $TRADER_A --limit 10
# Each row shows: ledger index, transaction type (OfferCreate / OfferCancel), result, and hash
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
