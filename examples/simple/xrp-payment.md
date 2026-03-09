# XRP Payment

Send XRP between accounts on XRPL. This is the most basic operation and a good starting point for exploring the ledger.

---

## Prerequisites

Start a local sandbox (or skip this and use `--network testnet` instead):

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
```

---

## 1. Fund two accounts

```bash
# Fund a sender wallet via the local genesis faucet
xrpl-up faucet --local
# Output:
#   address : rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   seed    : sEdSenderSeedXXXXXXXXXXXXXXXXXXXXX
#   balance : 1000 XRP

# Fund a receiver wallet
xrpl-up faucet --local
# Output:
#   address : rReceiverXXXXXXXXXXXXXXXXXXXXXXXXXX
#   seed    : sEdReceiverSeedXXXXXXXXXXXXXXXXXXXX
#   balance : 1000 XRP
```

Save the values:

```bash
SENDER_SEED=sEdSenderSeedXXXXXXXXXXXXXXXXXXXXX
RECEIVER=rReceiverXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 2. Send XRP

```bash
# Send 10 XRP from the sender to the receiver
xrpl-up offer create "10" "10" --local   # not the right command — see below
```

Actually, XRP payments are sent with the `faucet` command for funded wallets, or directly via a script. For a direct send between two existing accounts, use:

> **Note:** xrpl-up does not have a standalone `pay` subcommand for XRP — for XRP transfers between two existing accounts, use `check create` + `check cash` (deferred), or use `escrow create` + `escrow finish` for time-locked transfers, or use a script via `xrpl-up run`. For instant XRP delivery, the `faucet` command handles funding new wallets, and the DEX can swap XRP for IOUs.

See [`checks.md`](checks.md) for a deferred XRP payment, [`escrow.md`](escrow.md) for time-locked XRP, or the quick-start script below.

---

## 3. Quick script — XRP transfer

Generate a project and run the built-in payment example:

```bash
xrpl-up init my-xrp-demo
cd my-xrp-demo
npm install
npm run node          # starts local sandbox
npm run example       # runs scripts/example-payment.ts
```

The generated `scripts/example-payment.ts` sends 10 XRP between two auto-funded wallets and prints before/after balances.

---

## 4. Check the transaction history

After any on-chain activity, inspect an account's history:

```bash
# Show the last 20 transactions for an account
xrpl-up tx list rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXXX --local

# Limit to the last 5
xrpl-up tx list rSenderXXXXXXXXXXXXXXXXXXXXXXXXXXXX --local --limit 5
```

Each row shows: date, transaction type, result (`tesSUCCESS` / error), hash, and a short summary.

---

## 5. Check balances

```bash
xrpl-up accounts --local
```

This lists all wallets xrpl-up knows about on the active network, including their XRP balance.

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **Drops** | XRP is divisible into 1,000,000 drops. xrpl-up always accepts/displays whole XRP. |
| **Reserve** | Each account must hold ≥ 10 XRP base reserve + 2 XRP per ledger object. |
| **tx list** | The `account_tx` RPC returns up to 200 results per page. Use `--limit` to narrow. |

---

## Next steps

- [Issued Token (IOU)](issued-token.md) — send custom currencies
- [Checks](checks.md) — deferred XRP/IOU payments
- [Escrow](escrow.md) — time-locked or conditional XRP
