# Issued Token (IOU / Trust Line)

XRPL's native support for custom currencies. An issuer account mints tokens; holders set up trust lines to receive them; payments flow directly between accounts on the ledger's built-in pathfinding network.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## 1. Create issuer and holder accounts

```bash
# Create the token issuer
xrpl-up faucet --local
# → address: rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
# → seed:    sEdIssuerSeedXXXXXXXXXXXXXXXXXXXXX

# Create a token holder
xrpl-up faucet --local
# → address: rHolderXXXXXXXXXXXXXXXXXXXXXXXXXXX
# → seed:    sEdHolderSeedXXXXXXXXXXXXXXXXXXXXX

ISSUER_SEED=sEdIssuerSeedXXXXXXXXXXXXXXXXXXXXX
ISSUER_ADDR=rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXXX
HOLDER_SEED=sEdHolderSeedXXXXXXXXXXXXXXXXXXXXX
HOLDER_ADDR=rHolderXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 2. Enable DefaultRipple on the issuer

`DefaultRipple` lets payments ripple through the issuer's trust lines — required for most IOU payment flows.

```bash
xrpl-up trustline issuer-defaults --local --seed $ISSUER_SEED
# ✔ DefaultRipple enabled on rIssuerXXX...
```

---

## 3. Set a trust line on the holder

The holder declares they are willing to receive up to 10,000 USD from this issuer.

```bash
xrpl-up trustline set USD.$ISSUER_ADDR 10000 --local --seed $HOLDER_SEED
# ✔ Trust line set: USD / rIssuerXXX...  limit 10000
```

---

## 4. Issue tokens by sending them to the holder

On XRPL, issuers create tokens simply by sending them to a trust-line holder. The issuer's "balance" is always the negative mirror of what it has issued.

```bash
# Send 1000 USD to the holder (uses an offer or direct payment path)
xrpl-up offer create "1000.USD.$ISSUER_ADDR" "999" --local --seed $ISSUER_SEED
```

> **Simpler approach for testing:** Use `xrpl-up run` with a script that calls `client.autofill` on a Payment transaction directly.
> See the generated `scripts/example-token.ts` from `xrpl-up init`.

---

## 5. Verify trust lines

```bash
# Inspect the holder's trust lines
xrpl-up trustline list --local --account $HOLDER_ADDR
# USD  rIssuerXXX...  balance 1000  limit 10000  noRipple: false  freeze: false

# Inspect the issuer's trust lines (mirror side)
xrpl-up trustline list --local --account $ISSUER_ADDR
```

---

## 6. View transaction history

```bash
xrpl-up tx list $HOLDER_ADDR --local --limit 10
```

---

## 7. Freeze a trust line (compliance)

Issuers can freeze individual trust lines to prevent the holder from transferring tokens.

```bash
# Freeze the holder's USD trust line
xrpl-up trustline freeze USD.$HOLDER_ADDR --local --seed $ISSUER_SEED
# ✔ Trust line frozen: USD / rHolderXXX...

# Unfreeze
xrpl-up trustline freeze USD.$HOLDER_ADDR --local --seed $ISSUER_SEED --unfreeze
```

---

## 8. Enable Global Freeze (emergency)

Use `accountset` to globally freeze all trust lines at once:

```bash
xrpl-up accountset set globalFreeze --local --seed $ISSUER_SEED
# ...later, to lift:
xrpl-up accountset clear globalFreeze --local --seed $ISSUER_SEED
```

---

## 9. Enable clawback (optional — must be set before any trust line is created)

```bash
# On a fresh issuer account, before any holders exist:
xrpl-up accountset set allowClawback --local --seed $FRESH_ISSUER_SEED

# Later, reclaim 10 USD from a holder:
xrpl-up clawback iou 10 USD $HOLDER_ADDR --local --seed $ISSUER_SEED
```

> ⚠️ `allowClawback` is permanent — once set it cannot be cleared. Set it before creating any trust lines.

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Trust line** | Bilateral credit limit between two accounts for a currency. |
| **DefaultRipple** | Allows the issuer's balance to flow through its trust lines ("rippling"). |
| **NoRipple** | Prevents a specific trust line from participating in rippling. |
| **Freeze** | Issuer can individually or globally freeze token transfers. |
| **Clawback** | Issuer can reclaim tokens if `allowClawback` was enabled at account creation. |

---

## Next steps

- [DEX](dex.md) — trade your tokens on the built-in order book
- [AMM](amm.md) — provide liquidity for instant swaps
- [Clawback](clawback.md) — reclaim issued tokens
