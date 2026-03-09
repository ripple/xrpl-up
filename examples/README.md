# xrpl-up Examples

Step-by-step walkthroughs for common XRPL use cases using `xrpl-up` CLI commands.

Each guide starts a local sandbox (`xrpl-up node`) and walks through a complete workflow — fund accounts, run transactions, inspect results.

---

## Quick Start

```bash
# Clone the repo and link the CLI locally (package not yet on npm)
git clone https://github.com/ripple/xrpl-up.git
cd xrpl-up && npm install && npm run build && npm link

xrpl-up node          # start local XRPL sandbox
xrpl-up status        # confirm healthy
```

All examples use `--local` to target the sandbox. Replace with `--network testnet` (or `--network devnet`) to run on a public network.

---

## [`simple/`](simple/) — Core Use Cases

Start here. Each guide covers one feature end-to-end with minimal setup.

### Core Payments

| Guide | Description |
|-------|-------------|
| [XRP Payment](simple/xrp-payment.md) | Fund accounts, send XRP, inspect transaction history |
| [Issued Token (IOU)](simple/issued-token.md) | Mint and transfer custom currencies via trust lines |
| [Checks](simple/checks.md) | Deferred payment authorization — receiver cashes when ready |

### DeFi & Trading

| Guide | Description |
|-------|-------------|
| [DEX](simple/dex.md) | Place and match limit orders on the built-in order book |
| [AMM](simple/amm.md) | Create a liquidity pool and swap assets |

### Tokens & NFTs

| Guide | Description |
|-------|-------------|
| [MPT — Multi-Purpose Token](simple/mpt.md) | XLS-33 tokens with supply cap, transfer fees, clawback, and locking |
| [NFT Lifecycle](simple/nft.md) | Mint, list for sale, buy, and burn NFTs (XLS-20) |

### Advanced Payment Primitives

| Guide | Description |
|-------|-------------|
| [Escrow](simple/escrow.md) | Time-locked or crypto-condition XRP escrows |
| [Payment Channel](simple/payment-channel.md) | Off-chain micropayments with on-chain settlement |

### Compliance & Controls

| Guide | Description |
|-------|-------------|
| [Clawback](simple/clawback.md) | Issuer reclaims IOU or MPT tokens from holders |
| [Deposit Auth](simple/deposit-auth.md) | Allow-list which senders can pay your account |

### Infrastructure

| Guide | Description |
|-------|-------------|
| [Tickets](simple/tickets.md) | Reserve sequence numbers for out-of-order / parallel tx submission |

---

## [`advanced/`](advanced/) — Deep-Dive Guides

Builds on the simple guides. Each covers a multi-step workflow combining several XRPL primitives.

### Trading

| Guide | Description |
|-------|-------------|
| [AMM + DEX Arbitrage](advanced/amm-dex-arbitrage.md) | Compare pool vs order-book quotes; execute best route with IOC offers; observe price convergence |

### Tokens

| Guide | Description |
|-------|-------------|
| [MPT Policy Lifecycle](advanced/mpt-policy-lifecycle.md) | Full require-auth + lock + clawback issuance lifecycle from creation to destruction |
| [Regulated Token](advanced/regulated-token.md) | IOU compliance flow: requireAuth + depositAuth + preauth + individual/global freeze + clawback |

### Payment Primitives

| Guide | Description |
|-------|-------------|
| [Escrow with Crypto-Condition](advanced/escrow-crypto-condition.md) | HTLC pattern: generate condition/fulfillment, happy path finish, wrong-preimage rejection, expiry cancel |
| [Channel Settlement Lifecycle](advanced/channel-settlement.md) | Incremental claims, partial mid-session settlements, top-up, close timing, and force-close |

### Infrastructure

| Guide | Description |
|-------|-------------|
| [Multi-Sig + Tickets](advanced/multi-sig-tickets.md) | 2-of-3 signer list, reserve tickets, co-sign independently, submit out of order |

---

## Command Reference

For the full command reference, see the [main README](../README.md).

```bash
xrpl-up --help
xrpl-up <command> --help
```

---

## Tips

- **Save seeds and addresses** as shell variables while following a guide — most examples chain multiple commands.
- **`xrpl-up accounts --local`** shows all wallets xrpl-up knows about and their XRP balances.
- **`xrpl-up tx list <address> --local`** shows the full transaction history for any account.
- **`xrpl-up reset`** wipes the sandbox ledger back to genesis — useful for a clean slate. Add `--snapshots` to also delete saved snapshots.
- Use **`--network testnet`** instead of `--local` to test on the public Testnet (no Docker required).
