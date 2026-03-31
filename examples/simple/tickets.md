# Tickets — Out-of-Order and Parallel Transactions

Tickets reserve sequence numbers, allowing you to submit transactions out-of-order or in parallel. This is essential for multi-signature workflows, batch transaction pipelines, and any scenario where multiple parties need to co-sign transactions ahead of time.

---

## Prerequisites

```bash
xrpl-up node
xrpl-up status   # wait until "healthy"
export XRPL_NODE=local
```

---

## Background: why tickets?

Normally, XRPL transactions must be submitted in strict sequence order. If you need to:
- Have multiple co-signers prepare transactions independently before submission
- Submit transactions in a non-deterministic order
- Build a transaction batch where order matters but preparation is parallel

...you need tickets. Each ticket is a reserved sequence number that can be used exactly once, in any order.

---

## 1. Reserve tickets

```bash
# Fund a wallet (or use an existing one)
xrpl-up faucet --local
# → seed: sEdUserSeedXXX  address: rUserXXX

USER_SEED=sEdUserSeedXXXXXXXXXXXXXXXXXXXXXX
USER=rUserXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Reserve 5 tickets
xrpl-up ticket create 5 --seed $USER_SEED
# ✔ 5 tickets created
#   sequences: 10, 11, 12, 13, 14
```

Or auto-fund a fresh wallet with tickets on local:

```bash
xrpl-up ticket create 3 --auto-fund
# ✔ 3 tickets created
#   address:   rNewWalletXXX...
#   seed:      sEdNewSeedXXX...
#   sequences: 4, 5, 6
```

---

## 2. List existing tickets

```bash
xrpl-up ticket list $USER
# Tickets for rUserXXX...:
#   TicketSequence  10
#   TicketSequence  11
#   TicketSequence  12
#   TicketSequence  13
#   TicketSequence  14
```

---

## 3. Use a ticket in a transaction

When using a ticket, set `Sequence = 0` and `TicketSequence = <n>` in the transaction. You can do this in a custom script via `xrpl-up run`:

```typescript
// scripts/use-ticket.ts
import { Client, Wallet } from 'xrpl';

const client = new Client('ws://localhost:6006');
await client.connect();

const wallet = Wallet.fromSeed('sEdUserSeedXXXXXXXXXXXXXXXXXXXXXX');

// Use ticket sequence 12 (out-of-order — 10 and 11 are still unused)
const tx = {
  TransactionType: 'Payment',
  Account: wallet.address,
  Destination: 'rDestXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  Amount: '1000000',   // 1 XRP in drops
  Sequence: 0,         // must be 0 when using a ticket
  TicketSequence: 12,  // the ticket to consume
};

const prepared = await client.autofill(tx as any);
const signed = wallet.sign(prepared as any);
const result = await client.submitAndWait(signed.tx_blob);
console.log(result.result.meta?.TransactionResult);

await client.disconnect();
```

```bash
xrpl-up run scripts/use-ticket.ts
# tesSUCCESS
```

After submission, ticket 12 is consumed. Tickets 10, 11, 13, 14 are still available.

---

## 4. Multi-signature workflow with tickets

Tickets shine in multi-sig scenarios where each signer prepares their transaction independently:

```bash
# 1. Reserve 3 tickets for 3 parallel transactions
xrpl-up ticket create 3 --seed $USER_SEED
# → sequences: 20, 21, 22

# 2. Signer A prepares a transaction using ticket 20
#    Signer B prepares a transaction using ticket 21
#    Signer C prepares a transaction using ticket 22
#    (all three can happen simultaneously — no ordering dependency)

# 3. Submit in any order
#    Ticket 21 can be submitted before ticket 20 — the ledger accepts both
```

---

## 5. Check ticket consumption

After using some tickets, inspect what remains:

```bash
xrpl-up ticket list $USER
# Shows only unconsumed tickets
```

---

## Key concepts

| Concept | Detail |
|---------|--------|
| **TicketCreate** | Transaction that reserves `TicketCount` (1–250) sequence numbers. |
| **TicketSequence** | The reserved sequence number to use. Set `Sequence = 0` in the tx. |
| **Out-of-order** | Ticket 22 can be used before ticket 20 — there is no ordering requirement. |
| **One-time use** | Each ticket is consumed exactly once. |
| **Reserve** | Each unconsumed ticket costs 2 XRP object reserve on the account. |
| **Expiry** | Tickets do not expire — they persist until used or the account is deleted. |

---

## When to use tickets

| Scenario | Notes |
|----------|-------|
| **Multi-sig** | Each signer builds their tx independently using different tickets |
| **Batching** | Pre-sign a set of transactions for later parallel submission |
| **Delegation** | Give a ticket to a third party to use on your behalf at a future time |
| **Offline signing** | Sign transactions in an air-gapped environment ahead of time |

---

## Next steps

- [Deposit Auth](deposit-auth.md) — control which senders can transact with your account
- [XRP Payment](xrp-payment.md) — basic payment examples
- [Escrow](escrow.md) — time-locked transactions (different from ticket-based ordering)
