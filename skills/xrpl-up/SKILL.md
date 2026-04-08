---
name: xrpl-up
description: CLI for the XRP Ledger — local sandbox management, wallets, transactions, DeFi, NFTs, and more
---

## How to use this skill

The user has made a natural language request: **$ARGUMENTS**

Your job is to translate it into one or more `xrpl-up` CLI commands, then execute them.

Steps:
1. Identify the intent (send XRP, check balance, create offer, mint NFT, etc.).
2. Pick the matching command from the Quick Reference below.
3. If required information is missing (address, amount, seed), ask before proceeding.
4. Run `xrpl-up <command> --help` or read `references/<command>.md` for full flag details.
5. Execute and explain the result in plain language.

If `$ARGUMENTS` is empty, ask the user what they'd like to do on the XRP Ledger.

---

## Security Rules

> **Mandatory. Never bypass.**

- Never log, echo, or store `--seed` / `--private-key` values in output, files, or history.
- Prefer `--account <alias> --password <pass>` over raw `--seed` in pipelines.
- Never commit seeds to version control. Rotate any seed that appears in logs or history.
- `wallet private-key` output is a secret — do not forward it to other tools.

---

## Global Flags

```
--node local|testnet|devnet|<ws://...>   default: local (ws://localhost:6006)
--help                                    flag details for any command
--version
```

Network shorthands: `local` → localhost, `testnet` → altnet.rippletest.net, `devnet` → devnet.rippletest.net

---

## Patterns

**Key material** (one required on every transaction command):
```
--seed sEd...                    family seed
--mnemonic "word word ..."       BIP39 mnemonic
--account <address-or-alias>     load from encrypted keystore (needs --password in non-TTY)
```

**Amount formats:**
```
"10"                             10 XRP (decimal)
"10/USD/rIssuerAddress..."       10 USD IOU
"500/<48-hex-issuance-id>"       500 MPT units
```

**Asset specs (AMM/vault):**
```
XRP                              native XRP
USD/rIssuerAddress...            IOU asset
```

**XRP in drops (AMM only):** `1000000` drops = 1 XRP

**Common output flags** (most TX commands):
```
--json        machine-readable output
--dry-run     print signed tx without submitting
--no-wait     submit without waiting for validation  (not available on: account set)
```

---

## Quick Reference

### Sandbox (local node)

| Command | Description |
|---------|-------------|
| `xrpl-up start` | Start local rippled Docker sandbox |
| `xrpl-up start --detach` | Start in background (CI) |
| `xrpl-up start --local-network` | 2-node consensus network with snapshot support |
| `xrpl-up stop` | Stop local sandbox |
| `xrpl-up reset` | Wipe all local state |
| `xrpl-up status` | Show node health |
| `xrpl-up logs [rippled\|faucet]` | Stream Docker logs |
| `xrpl-up accounts` | List sandbox pre-funded accounts |
| `xrpl-up snapshot save/restore/list` | Manage ledger snapshots |
| `xrpl-up amendment list/info/enable` | Inspect and enable amendments |

See `references/node-management.md` for full options.

### Wallet management

| Command | Description |
|---------|-------------|
| `wallet new` | Generate a new wallet |
| `wallet new-mnemonic` | Generate a BIP39 mnemonic wallet |
| `wallet import <key>` | Import seed/mnemonic/private-key into keystore |
| `wallet list` | List keystore entries |
| `wallet fund <address>` | Fund from testnet/devnet faucet |
| `wallet address/public-key/private-key` | Derive key material |
| `wallet sign` | Sign a message or transaction offline |
| `wallet verify` | Verify a signature |
| `wallet alias set/list/remove` | Manage keystore aliases |
| `wallet change-password` | Re-encrypt a keystore entry |
| `wallet decrypt-keystore` | Decrypt and print seed/private-key |
| `wallet remove` | Delete a keystore entry |

All wallet subcommands accept `--keystore <dir>` and (where applicable) `--password <pass>` for non-TTY use.

See `references/wallet.md` for full options.

### Account queries

| Command | Description |
|---------|-------------|
| `account info <address>` | Full on-ledger account info |
| `account balance <address>` | XRP balance (`--drops` for raw drops) |
| `account trust-lines <address>` | List trust lines |
| `account offers <address>` | List open DEX offers |
| `account channels <address>` | List payment channels |
| `account transactions <address>` | Recent transactions |
| `account nfts <address>` | NFTs owned |
| `account mptokens <address>` | MPT balances |
| `account set` | AccountSet (domain, flags, clawback…) |
| `account delete` | Delete account (irreversible, ~2 XRP fee) |
| `account set-regular-key` | Assign/remove regular key |

See `references/account.md` for full options.

### Transactions

| Command | Description |
|---------|-------------|
| `payment` / `send` | Send XRP, IOU, or MPT |
| `trust set` | Create/update trust line |
| `offer create/cancel` | DEX offer management |
| `clawback` | Claw back IOU or MPT from holder |
| `channel create/fund/sign/verify/claim/list` | Payment channels |
| `escrow create/finish/cancel/list` | Time-locked or condition-based escrows |
| `check create/cash/cancel/list` | Deferred payment checks |
| `multisig set/list/delete` | Multi-signature signer lists |
| `ticket create/list` | Ticket sequence management |
| `deposit-preauth set/list` | Deposit preauthorization |

### Tokens & DeFi

| Command | Description |
|---------|-------------|
| `amm create/deposit/withdraw/vote/bid/delete/clawback/info` | AMM liquidity pools |
| `nft mint/burn/modify` | NFT lifecycle |
| `nft offer create/accept/cancel/list` | NFT marketplace |
| `mptoken issuance create/destroy/set/list/get` | MPT issuance management |
| `mptoken authorize` | Holder opt-in / issuer authorize |
| `vault create/set/deposit/withdraw/delete/clawback` | Single-asset vaults (devnet) |

### Identity & Credentials

| Command | Description |
|---------|-------------|
| `credential create/accept/delete/list` | On-chain credentials (XLS-70) |
| `did set/delete` | Decentralized Identifiers (XLS-40) |
| `oracle set/delete/get` | On-chain price oracles |
| `permissioned-domain create/update/delete` | Permissioned domains (XLS-80) |

---

## Key Examples

**Send XRP on testnet:**
```bash
xrpl-up --node testnet payment \
  --to rDestination... --amount 10 \
  --seed sEdAlice...
```

**Issue IOU — trust line then payment:**
```bash
# Bob sets up trust line to Alice's USD
xrpl-up --node testnet trust set \
  --currency USD --issuer rAlice... --limit 1000 \
  --seed sEdBob...

# Alice issues 100 USD to Bob
xrpl-up --node testnet payment \
  --to rBob... --amount 100/USD/rAlice... \
  --seed sEdAlice...
```

**Create and fund a keystore wallet in CI (non-interactive):**
```bash
# Generate + save (--password required in non-TTY)
xrpl-up wallet new --save --alias alice --password "$KS_PASS"

# Fund on testnet
xrpl-up --node testnet wallet fund rAlice...

# Use alias for subsequent transactions
xrpl-up --node testnet payment \
  --to rBob... --amount 5 \
  --account rAlice... --password "$KS_PASS"
```

**MPT: create issuance, opt in, send:**
```bash
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer --max-amount 1000000 \
  --seed sEdAlice... --json
# → {"issuanceId":"0000001AABBCC..."}

xrpl-up --node testnet mptoken authorize 0000001AABBCC... --seed sEdBob...

xrpl-up --node testnet payment \
  --to rBob... --amount 500/0000001AABBCC... \
  --seed sEdAlice...
```

---

## Reference Files

For complete flag tables, look up the relevant file in `references/`:

`wallet.md` · `account.md` · `payment.md` · `trust.md` · `offer.md` · `clawback.md` · `channel.md` · `escrow.md` · `check.md` · `amm.md` · `nft.md` · `multisig.md` · `oracle.md` · `ticket.md` · `credential.md` · `mptoken.md` · `permissioned-domain.md` · `vault.md` · `did.md` · `deposit-preauth.md` · `common-workflows.md` · `node-management.md`
