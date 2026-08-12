# xrpl-up Demo

> `xrpl-up start` gives you pre-funded accounts and instant ledger closes with zero setup — no faucet, no waiting for consensus, no risk to real funds (see the Mainnet notice at the top of the [README](README.md)).

## Setup

```bash
git clone https://github.com/ripple/xrpl-up.git
cd xrpl-up
git checkout feat/xrpld-3.2.0
npm install
npm run build
npm link
```

Requires Node.js 22+ and Docker (for the local sandbox). Not on npm yet — this branch only, via `npm link`.

---

## New community developer learning XRPL

You don't need a testnet account, a faucet, or patience for 4-second ledger closes to learn how XRPL actually works. `xrpl-up` gives you a real `rippled`/`xrpld` node on your laptop, with 10 funded accounts, that closes ledgers instantly.

### 1. Zero-to-funded-account in one command

```bash
xrpl-up start
```

No faucet request, no rate limit, no wait. You get 10 funded accounts (1000 XRP each) printed to the terminal immediately — this is standalone mode, which wipes and restarts fresh every time, so it's safe to break things and start over. Control returns to your terminal right away so you can run the next commands in the same session; pass `--foreground` instead if you want it to stay attached with live logs.

### 2. Explore the ledger without writing code

```bash
xrpl-up accounts                          # live balances for all 10 accounts
xrpl-up account info <address>            # inspect any account
xrpl-up amendment list                     # see which XRPL amendments are active and why
```

`amendment list` in particular is a good teaching moment — it shows the actual mainnet-enabled feature set (AMM, MPT, Credentials, DID, etc.) with names and hashes, which demystifies "amendments" as a concept for someone new to XRPL.

### 3. Try real XRPL primitives, one command at a time

Two good starting walkthroughs: [XRP Payment](examples/simple/xrp-payment.md) (fund accounts, send XRP, inspect transaction history) and [MPT](examples/simple/mpt.md) (create a token issuance, opt in a holder, send, lock, clawback).

```bash
# XRP Payment
SENDER_JSON=$(xrpl-up faucet --network local --json)
SENDER_SEED=$(echo "$SENDER_JSON" | jq -r .seed)

RECEIVER_JSON=$(xrpl-up faucet --network local --json)
RECEIVER=$(echo "$RECEIVER_JSON" | jq -r .address)

xrpl-up payment --to $RECEIVER --amount 10 --seed $SENDER_SEED --node local
xrpl-up account transactions $(echo "$SENDER_JSON" | jq -r .address) --limit 5
```

```bash
# MPT
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)

MPT_ID=$(xrpl-up mptoken issuance create --flags can-transfer,can-clawback --seed $ISSUER_SEED --json | jq -r .issuanceId)

HOLDER_JSON=$(xrpl-up faucet --network local --json)
HOLDER_SEED=$(echo "$HOLDER_JSON" | jq -r .seed)
HOLDER=$(echo "$HOLDER_JSON" | jq -r .address)
xrpl-up mptoken authorize $MPT_ID --seed $HOLDER_SEED

xrpl-up payment --to $HOLDER --amount 1000/$MPT_ID --seed $ISSUER_SEED
xrpl-up account mptokens $HOLDER
xrpl-up clawback --amount 1000/$MPT_ID --holder $HOLDER --seed $ISSUER_SEED
```

Each of these is a real, signed transaction against a real rippled node — not a mock. There are many more step-by-step guides under the [`examples/`](examples/) folder, covering IOUs, checks, escrow, payment channels, NFTs, MPTs, the DEX, deposit auth, clawback, tickets, and multi-step advanced scenarios (regulated tokens, arbitrage, multi-sig).

### 4. Talk to it in plain language instead of memorizing flags

```bash
claude plugin marketplace add ripple/xrpl-up
claude plugin install xrpl-up@xrpl-up --scope user
```

Then in a Claude Code session:

```
/xrpl-up:xrpl-up start local sandbox
/xrpl-up:xrpl-up create an XRP/USD AMM trading pair on local
/xrpl-up:xrpl-up show balance for account 2
```

---

## Developer building a real feature on XRPL

Building against public Testnet/Devnet means faucet limits, shared state you don't control, and real consensus latency slowing down your iteration loop. `xrpl-up --local-network` gives you a real 2-node consensus network — not a mock, actual XRPL consensus — that you fully control, with snapshots so you can rewind to a known-good state instead of re-building it by hand every time.

### 1. Persistent, realistic environment for real dev sessions

```bash
xrpl-up start --local-network
```

Real consensus (~4s ledger close, not instant), state survives `xrpl-up stop`/restart, and snapshots are supported — this is the mode for building over hours or days, not a one-shot script.

### 2. Snapshot your setup once, iterate on code many times

Build a real AMM pool (see [AMM](examples/simple/amm.md) for the full walkthrough), snapshot it, then rewind to that exact state as many times as you want:

```bash
# Fund issuer + LP
ISSUER_JSON=$(xrpl-up faucet --network local --json)
ISSUER_SEED=$(echo "$ISSUER_JSON" | jq -r .seed)
ISSUER=$(echo "$ISSUER_JSON" | jq -r .address)

LP_JSON=$(xrpl-up faucet --network local --json)
LP_SEED=$(echo "$LP_JSON" | jq -r .seed)
LP=$(echo "$LP_JSON" | jq -r .address)

# Let the issuer's USD ripple through trust lines, then fund the LP with USD
xrpl-up account set --set-flag defaultRipple --seed $ISSUER_SEED --node local
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $LP_SEED --node local
xrpl-up payment --to $LP --amount 1000/USD/$ISSUER --seed $ISSUER_SEED --node local

# Create the pool
xrpl-up amm create --asset XRP --asset2 USD/$ISSUER \
  --amount 100 --amount2 100 --trading-fee 500 \
  --seed $LP_SEED --node local

# Snapshot this exact pool state
xrpl-up snapshot save before-my-feature

# BEFORE: pool is 100 XRP / 100 USD
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER --node local

# Iterate on your integration code — e.g. trade against the pool, shifting its balance
TRADER_JSON=$(xrpl-up faucet --network local --json)
TRADER_SEED=$(echo "$TRADER_JSON" | jq -r .seed)
TRADER=$(echo "$TRADER_JSON" | jq -r .address)
xrpl-up trust set --currency USD --issuer $ISSUER --limit 10000 --seed $TRADER_SEED --node local

# Trader sells 5 XRP into the pool (gets USD back) — price includes the 0.5% fee + slippage
xrpl-up offer create --taker-pays 4.5/USD/$ISSUER --taker-gets 5 --seed $TRADER_SEED --node local \
  --immediate-or-cancel
# The AMM fills the offer at the current pool price

# AFTER: pool has moved — no longer 100/100
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER --node local

# Rewind instantly instead of re-funding/re-creating the pool by hand:
xrpl-up snapshot restore before-my-feature

# RESTORED: pool is back to exactly 100 XRP / 100 USD — the trade never happened
xrpl-up amm info --asset XRP --asset2 USD/$ISSUER --node local
```

This is the single biggest iteration-speed win over Testnet: on a public network you can't roll back shared state. Here you can, as many times as you need.

### 3. Test against amendments before they're mainstream

The [Vault](examples/advanced/vault.md) example is a good concrete case — `SingleAssetVault` is a newer amendment your rippled image supports but that isn't enabled by default:

```bash
xrpl-up amendment info SingleAssetVault --local     # check support + mainnet status
```

**Important:** `amendment enable` queues the amendment into the genesis config and requires a reset to activate — works in both standalone and `--local-network` mode. In `--local-network`, the next start builds a real 2-node consensus genesis from scratch instead of resuming the pre-built ledger, which takes ~30-60s instead of ~5s and starts a new ledger lineage; `snapshot restore` detects that automatically and realigns the amendment config to whatever the snapshot being restored was built with, so save/restore keeps working across an `enable`.

```bash
# Force-enable from a fresh genesis (destructive — wipes ledger/accounts)
xrpl-up amendment enable SingleAssetVault --local
xrpl-up start --local-network
xrpl-up amendment info SingleAssetVault --local   # → Enabled: yes

# Enabling several amendments together is one command, one reset:
xrpl-up amendment enable SingleAssetVault DynamicMPT LendingProtocol --local
```

Then build a vault:

```bash
OWNER_JSON=$(xrpl-up faucet --network local --json)
OWNER_SEED=$(echo "$OWNER_JSON" | jq -r .seed)

VAULT_ID=$(xrpl-up vault create --asset 0 --assets-maximum 1000000000 --seed $OWNER_SEED --json | jq -r .vaultId)

DEPOSITOR_JSON=$(xrpl-up faucet --network local --json)
DEPOSITOR_SEED=$(echo "$DEPOSITOR_JSON" | jq -r .seed)

xrpl-up vault deposit --vault-id $VAULT_ID --amount 100 --seed $DEPOSITOR_SEED
xrpl-up vault withdraw --vault-id $VAULT_ID --amount 40 --seed $DEPOSITOR_SEED
xrpl-up vault delete --vault-id $VAULT_ID --seed $OWNER_SEED
```

If you're building against a feature that's still new (Vault, Lending Protocol, permissioned domains, etc.), you don't have to wait for it to land on public Testnet — `xrpl-up amendment info <name> --local` lets you check support/mainnet status without changing anything, and `amendment enable` (standalone mode) queues then activates it after a reset.

### 4. CI integration — this repo's own test suite is the reference example

```bash
xrpl-up start --local          # or --local-network for consensus-mode tests
npm run test:e2e:local                  # run your test suite against it
xrpl-up stop
```

`xrpl-up`'s own `.github/workflows/test.yml` does exactly this across `standalone`/`local-network`/`snapshot` modes — a real, working example of wiring a local rippled sandbox into GitHub Actions instead of hitting public Testnet from CI (which this project has hit real flakiness from — timeouts and `LastLedgerSequence` expiration against the real network, unrelated to any code bug — see the `testnet` mode's `--node testnet`/`--node devnet` targeted tests for what that looks like when it happens).

### 5. Early access to unmerged xrpl.js features

If you're building against something so new that `xrpl.js` itself doesn't support it yet in its stable release, `xrpl-up`'s command registration is capability-gated at runtime (`supportsTransactionType()` in `src/utils/xrpl-capability.ts`) — `npm link` an experimental `xrpl.js` branch/dist-tag locally, and any command depending on that capability activates automatically, no `xrpl-up` code change required. See `CLAUDE.md`'s "Unready-dependency features" section for the mechanism.

### Why this beats public Testnet/Devnet for real feature work

- Full control over amendments and fee/reserve config — reproduce exact conditions, including ones not yet live anywhere public
- Snapshots make "start over" a 2-second operation instead of a re-funding chore
- No shared state — nobody else's transactions interfere with your test run
- Fits into CI the same way a database fixture would, instead of depending on a flaky remote network
