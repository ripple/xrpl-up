# xrpl-up

CLI for XRPL local development and scripting. Spin up a local sandbox with pre-funded accounts, run scripts, manage snapshots, and interact with remote testnet/devnet endpoints from one tool.

> **This tool is intended for developer use when doing XRPL development or for users who want to try out XRPL functionality on local/Devnet/Testnet. It is NOT intended for use on the XRPL mainnet with real XRP and other tokens.** Using XRPL Mainnet requires following security best practices to protect your private key, which this tool doesn't provide. The developer of this project doesn't take any responsibility for loss of funds if this tool is used with the XRPL mainnet.

![demo](demo.gif)

## Prerequisites

- **Node.js** v22 or later
- **Docker** (required for `--local` mode only)

## Installation

**From npm (global):**

```bash
# Latest stable release
npm install -g xrpl-up

# Beta release
npm install -g xrpl-up@beta-experimental
```

**From source (development):**

```bash
git clone https://github.com/ripple/xrpl-up.git
cd xrpl-up
npm install
npm run build
npm link
```

## Claude Code Plugin

xrpl-up includes a [Claude Code](https://claude.ai/code) plugin that lets you interact with the XRP Ledger using natural language.

**Install:**

```bash
claude plugin marketplace add ripple/xrpl-up
claude plugin install xrpl-up@xrpl-up --scope user
```

**Usage:** In a Claude Code session, use `/xrpl-up:xrpl-up` followed by what you want to do:

```
/xrpl-up:xrpl-up start local sandbox
/xrpl-up:xrpl-up show status
/xrpl-up:xrpl-up list pre-funded accounts
/xrpl-up:xrpl-up create an XRP/USD AMM trading pair on local
/xrpl-up:xrpl-up swap 10 XRP for USD using account 2
/xrpl-up:xrpl-up show balance for account 2
/xrpl-up:xrpl-up stop the sandbox
```

Claude translates your request into the correct `xrpl-up` commands, executes them, and explains the result in plain language.

## Quick Start

```bash
# Scaffold a new project (select "local" as default network)
xrpl-up init my-project
cd my-project && npm install

# Start a local sandbox with 10 pre-funded accounts (local is the default)
xrpl-up start

# In another terminal — list accounts with live balances
xrpl-up accounts

# Run a script against the local sandbox
xrpl-up run scripts/example-payment.ts

# Create an XRP/USD AMM pool (100 XRP + 100 USD, 0.5% fee)
xrpl-up amm create --asset XRP --asset2 USD/rIssuer... --amount 100 --amount2 100 --trading-fee 500 --seed sEd...

# Mint a transferable NFT
xrpl-up nft mint --taxon 0 --uri https://example.com/meta.json --transferable --seed sn3nxiW7...

# Create an MPT issuance (Multi-Purpose Token)
xrpl-up mptoken issuance create --max-amount 1000000 --asset-scale 6

# Open a payment channel
xrpl-up channel create --to rDestination... --amount 10 --settle-delay 86400 --seed sSrc...
```

---

## Commands

`xrpl-up` has two command sets:

- **Sandbox operation commands**: environment lifecycle and state control (`start`, `stop`, `reset`, `snapshot`, `status`, `accounts`, `logs`, `config`, `run`, `init`, `faucet`, `amendment`).
- **XRPL interaction commands**: transaction submission and account management (`wallet`, `account`, `payment`, `trust`, `offer`, `amm`, `nft`, `mptoken`, `escrow`, `check`, `channel`, `ticket`, `clawback`, `credential`, `did`, `multisig`, `oracle`, `deposit-preauth`, `permissioned-domain`, `vault`).

XRPL interaction commands are intentionally non-exhaustive. For complex or production-grade flows, use `xrpl.js` directly or call `rippled` RPC endpoints.

### `xrpl-up start`

Starts a local sandbox (via Docker) and funds accounts.

Two modes are available:

| Mode | Command | Ledger close | State | Best for |
|------|---------|-------------|-------|----------|
| **Standalone** (default) | `xrpl-up start` | Instant | Ephemeral | CI, quick tests, scripting |
| **Local network** | `xrpl-up start --local-network` | ~4s (consensus) | Persistent | Long dev sessions, snapshots |

**Standalone** is a single rippled node with instant ledger closes. State is wiped on each start. Use this for CI pipelines, quick sanity checks, and any workflow where you don't need state to survive restarts.

**Local network** (`--local-network`) runs a 2-node private consensus network. Ledgers close via real consensus (~4s), state persists across stop/start, and snapshots are supported. Use this when you're building an app over hours or days against a stable environment — set up AMM pools, trust lines, and funded accounts once, snapshot the state, and roll back when you need to.

Once started (either mode), interaction commands default to the local sandbox — no flag needed. To target something else, pass `--network testnet`, `--network devnet`, or `--network <wss://...>`:

```bash
# Start the sandbox once (either mode)
xrpl-up start                       # standalone: fast, ephemeral
xrpl-up start --local-network       # persistent, real consensus

# `xrpl-up start` already funded 10 local accounts and printed their
# addresses — run `xrpl-up accounts` to list them again.
xrpl-up account info rMyAddress

# testnet/devnet addresses aren't auto-funded like the local sandbox —
# get one first with `xrpl-up faucet --network testnet`, then query it:
xrpl-up account info rMyTestnetAddress --network testnet
xrpl-up account info rMyDevnetAddress --network devnet

# any other rippled node you already have an account on
xrpl-up account info rMyAddress --network wss://your-own-rippled-server:6006

# Or set XRPL_NETWORK once instead of passing --network on every interaction command
export XRPL_NETWORK=testnet
xrpl-up faucet --network testnet --json   # sandbox lifecycle commands (start/faucet/accounts/status/run)
                                           # have their own --network option and don't read XRPL_NETWORK —
                                           # it must be passed explicitly here even with the env var set
xrpl-up payment --to rDest --amount 10 --seed <seed from faucet output>   # uses testnet via XRPL_NETWORK
```

Run `xrpl-up start --help` for all options.

> **Note:** The local sandbox is a clean-room environment — ledger starts at index 1 with only the genesis wallet. It is not a mirror of the public ledger. What matters is that transaction validation rules match the rippled version in use.
>
> **AMM / XLS-30 and MPT / XLS-33:** Both AMM and MPT (Multi-Purpose Token) are enabled by default in the local sandbox. xrpl-up uses the `[amendments]` section in `rippled.cfg` to force-enable the required amendments at genesis creation. No voting or ledger advancement is needed.

> **Hardware:** A typical developer laptop is sufficient (~2 GB RAM, ~500 MB disk for the Docker image). The local sandbox has no internet requirement and only processes transactions you submit locally.

---

### `xrpl-up stop`

Stops the local Docker sandbox stack.

```bash
xrpl-up stop
```

---

### `xrpl-up reset`

Wipes all local sandbox state and starts with a clean slate. Useful after a `--local-network` session or when you want to discard all ledger state and funded accounts.

```bash
# Wipe containers, ledger volume, accounts, and manually enabled amendments — keep snapshots
xrpl-up reset

# Wipe everything including saved snapshots
xrpl-up reset --snapshots

# Keep amendments you enabled with `amendment enable`
xrpl-up reset --keep-amendments
```

What `xrpl-up reset` removes:
- Running Docker containers (`docker compose down`)
- Ledger volumes (`xrpl-up-local-db` and `xrpl-up-local-peer-db` in consensus mode)
- Funded sandbox accounts
- Amendments you added with `amendment enable` — so the next start really is factory state, not silently carrying them forward. Pass `--keep-amendments` to preserve them.
- With `--snapshots`: all saved snapshots

> Snapshots are kept by default since they are the only way to recover a previous state. Use `--snapshots` only when you want a complete wipe.

---

### `xrpl-up accounts`

Lists funded accounts with their live XRP balances.

```bash
xrpl-up accounts                          # local (default)
xrpl-up accounts --network testnet

# Query any address directly
xrpl-up accounts --address rSomeAddress...
```

---

### `xrpl-up faucet`

Funds a new or existing account via the local sandbox faucet or a public testnet/devnet faucet. Funded accounts are automatically saved to `~/.xrpl-up/{network}-accounts.json` so they appear in `xrpl-up accounts`.

```bash
# Generate and fund a new wallet on the local sandbox (default)
xrpl-up faucet

# Fund an existing wallet by seed on the local sandbox
xrpl-up faucet --seed sn3nxiW7v8KXzPzAqzyHXbSSKNuN9

# Use the public Testnet faucet
xrpl-up faucet --network testnet
```

> Faucet targets supported by this command: `local` (default), `testnet`, `devnet`.

---

### `xrpl-up status`

Shows rippled server info and faucet health.

```bash
xrpl-up status                     # local (default)
xrpl-up status --network testnet
```

Displays rippled version, current ledger index, and faucet availability.

---

### `xrpl-up run <script>`

Runs a TypeScript or JavaScript script with the network URL injected as environment variables. TypeScript is executed directly via `tsx` (no build step needed).

```bash
xrpl-up run scripts/example-payment.ts --network local
xrpl-up run scripts/my-script.js --network testnet
```

**Injected environment variables:**

| Variable | Description |
|----------|-------------|
| `XRPL_NETWORK` | Network key (e.g. `local`, `testnet`) |
| `XRPL_NETWORK_URL` | WebSocket URL (e.g. `ws://localhost:6006`) |
| `XRPL_NETWORK_NAME` | Human-readable name |

**Example script:**

```ts
// scripts/send-payment.ts
import { Client, xrpToDrops, Wallet } from 'xrpl';

async function main() {
  const client = new Client(process.env.XRPL_NETWORK_URL!);
  await client.connect();

  const sender = Wallet.fromSeed('sn3nxiW7v8KXzPzAqzyHXbSSKNuN9'); // from xrpl-up accounts

  await client.submitAndWait(
    {
      TransactionType: 'Payment',
      Account: sender.address,
      Amount: xrpToDrops('10'),
      Destination: 'rDestinationAddress...',
    },
    { wallet: sender }
  );

  console.log('Payment sent!');
  await client.disconnect();
}

main().catch(console.error);
```

---

### `xrpl-up logs`

Streams Docker Compose logs from the running local sandbox.

```bash
xrpl-up logs           # all services
xrpl-up logs rippled   # rippled only (useful with --debug)
xrpl-up logs faucet    # faucet server only
```

---

### `xrpl-up amm`

Manage AMM pools (XLS-30). AMM is enabled by default in the local sandbox — no extra configuration needed.

See [AMM — Automated Market Maker](examples/simple/amm.md) for a full walkthrough.

> **Prerequisite:** Enable `DefaultRipple` on the issuer account before creating a pool (`xrpl-up account set --set-flag defaultRipple`), or `amm create` will fail.

Run `xrpl-up amm create --help` / `amm info --help` / `amm deposit --help` / `amm withdraw --help` / `amm bid --help` / `amm vote --help` / `amm delete --help` / `amm clawback --help` for options.

---

### `xrpl-up nft`

NFT lifecycle operations (XLS-20).

See [NFT Lifecycle (XLS-20)](examples/simple/nft.md) for a full walkthrough.

Run `xrpl-up nft mint --help` / `nft burn --help` / `nft modify --help` / `nft offer create --help` / `nft offer accept --help` / `nft offer cancel --help` / `nft offer list --help` for options. To list NFTs owned by an account, use `xrpl-up account nfts <address>`.

---

### `xrpl-up channel`

Payment channel operations. Payment channels allow fast, off-chain micropayments with on-chain settlement.

See [Payment Channel](examples/simple/payment-channel.md) for a full walkthrough, and [Payment Channel Settlement Lifecycle](examples/advanced/channel-settlement.md) for a deeper dive on off-chain claims and settlement.

Run `xrpl-up channel create --help` / `channel fund --help` / `channel sign --help` / `channel verify --help` / `channel claim --help` / `channel list --help` for options. `sign`/`verify` are offline (no on-chain transaction); `claim` submits the on-chain `PaymentChannelClaim`.

---

### `xrpl-up mptoken`

Multi-Purpose Token (MPT / XLS-33) operations. MPT is enabled automatically in the local sandbox (the `--network` default — no flag needed); pass `--network testnet` for Testnet.

See [MPT — Multi-Purpose Token (XLS-33)](examples/simple/mpt.md) for a full walkthrough, and [MPT Policy Lifecycle: RequireAuth + Lock + Clawback](examples/advanced/mpt-policy-lifecycle.md) for a deeper dive on authorization, locking, and clawback.

Run `xrpl-up mptoken issuance create --help` / `issuance destroy --help` / `issuance set --help` / `issuance get --help` / `issuance list --help` / `mptoken authorize --help` for options. Send MPT payments via `xrpl-up payment` with amount format `<amount>/<issuanceId>`; query holdings via `xrpl-up account mptokens`.

---

### `xrpl-up offer`

DEX (decentralized exchange) offer operations — a built-in order book, no smart contracts needed.

See [DEX — Decentralized Exchange](examples/simple/dex.md) for a full walkthrough.

Run `xrpl-up offer create --help` / `xrpl-up offer cancel --help` for options. To list open offers, use `xrpl-up account offers <address>` (there's no `offer list`).

---

### `xrpl-up trust`

Trust line operations (renamed from `trustline`). Use `xrpl-up account trust-lines` to query existing trust lines.

See [Issued Token (IOU / Trust Line)](examples/simple/issued-token.md) for a full walkthrough.

Run `xrpl-up trust set --help` for options. Query trust lines with `xrpl-up account trust-lines <address>`; enable rippling on new trust lines with `xrpl-up account set --set-flag defaultRipple`.

---

### `xrpl-up escrow`

Escrow operations. Escrows lock XRP until a time condition or crypto-condition is met.

See [Escrow](examples/simple/escrow.md) for a full walkthrough, and [Escrow with Crypto-Condition](examples/advanced/escrow-crypto-condition.md) for a deeper dive on crypto-conditions.

Run `xrpl-up escrow create --help` / `escrow finish --help` / `escrow cancel --help` / `escrow list --help` for options.

---

### `xrpl-up check`

Check operations. Checks are a deferred payment mechanism — the sender authorizes a maximum amount that the destination can cash at any time before expiry.

See [Checks — Deferred Payments](examples/simple/checks.md) for a full walkthrough.

Run `xrpl-up check create --help` / `check cash --help` / `check cancel --help` / `check list --help` for options.

---

### `xrpl-up account set`

Enable or disable account flags (replaces the old `accountset` command).

```bash
xrpl-up account set --set-flag requireDestTag --seed sn3nxiW7...
xrpl-up account set --clear-flag requireDestTag --seed sn3nxiW7...
```

| Flag name | Description |
|-----------|-------------|
| `requireDestTag` | Require a destination tag on all incoming payments |
| `requireAuth` | Require the issuer to authorize all trust lines |
| `disallowXRP` | Signal that this account does not accept direct XRP payments |
| `disableMaster` | Disable the master key (use only after setting a signer list) |
| `noFreeze` | Permanently give up the ability to freeze trust lines (irreversible) |
| `globalFreeze` | Freeze all trust lines at once (issuers) |
| `defaultRipple` | Enable rippling on all new trust lines (issuers) |
| `depositAuth` | Only accept payments from pre-authorized senders |

For IOU clawback, use `--allow-clawback --confirm` (irreversible, not a `--set-flag`).

> **Note:** Set a signer list before disabling the master key (`disableMaster`). For signer list management, use `xrpl-up multisig`. To query account settings, use `xrpl-up account info`.

---

### Transaction history

The `tx` command has been removed. Use `xrpl-up account transactions`:

```bash
xrpl-up account transactions rMyAddress...
xrpl-up account transactions rMyTestnetAddress... --network testnet   # fund one first: xrpl-up faucet --network testnet
```

---

### `xrpl-up deposit-preauth`

Manage DepositPreauth entries (renamed from `depositpreauth`). Required when an account has the `depositAuth` flag set (enable it with `xrpl-up account set --set-flag depositAuth`).

See [Deposit Authorization (DepositPreauth)](examples/simple/deposit-auth.md) for a full walkthrough.

| Subcommand | Description |
|------------|-------------|
| `set --authorize <address>` | Pre-authorize a specific sender |
| `set --unauthorize <address>` | Revoke a pre-authorization |
| `list <address>` | List all pre-authorizations for an account |

---

### `xrpl-up ticket`

Ticket operations. Tickets reserve sequence numbers, allowing transactions to be submitted out-of-order or in parallel — useful for multi-sig workflows.

See [Tickets — Out-of-Order and Parallel Transactions](examples/simple/tickets.md) for a full walkthrough, and [Multi-Sig + Tickets: Out-of-Order Parallel Signing](examples/advanced/multi-sig-tickets.md) for a deeper dive combining tickets with multi-signing.

#### `xrpl-up ticket create --count <n>`

Reserves 1–250 sequence numbers as tickets. Returns the allocated TicketSequence numbers.

#### `xrpl-up ticket list <address>`

Lists existing tickets (reserved sequence numbers) for an account. `<address>` is required.

> **Usage:** To use a ticket in a transaction, set `Sequence = 0` and `TicketSequence = <n>`.

---

### `xrpl-up clawback`

Issuer clawback operations. The issuer account must have clawback enabled before use.

> **Prerequisites:**
> - **IOU clawback:** Enable `asfAllowTrustLineClawback` with `xrpl-up account set --allow-clawback --confirm --network local --seed <issuer-seed>`
> - **MPT clawback:** The issuance must have been created with `xrpl-up mptoken issuance create --flags can-clawback`

See [Clawback — Reclaim Issued Tokens](examples/simple/clawback.md) for a full walkthrough.

Run `xrpl-up clawback --help` for options. The signing wallet must be the token issuer.

---

### `xrpl-up wallet`

Wallet management — create, import, and manage XRPL key pairs in a local keystore (`~/.xrpl/keystore/` by default).

| Subcommand | Description |
|------------|-------------|
| `new` | Generate a new random wallet |
| `new-mnemonic` | Generate a wallet from a BIP39 mnemonic |
| `import` | Import a wallet by seed or mnemonic |
| `list` | List all wallets in the keystore |
| `address` | Print the address for a wallet |
| `private-key` | Print the private key (requires password) |
| `public-key` | Print the public key |
| `sign` | Sign arbitrary data |
| `verify` | Verify a signature |
| `alias` | Set or clear a human-readable alias for a wallet |
| `fund` | Fund a wallet from the testnet or devnet faucet |
| `change-password` | Change keystore encryption password |
| `decrypt-keystore` | Export keystore contents (decrypt to plaintext) |
| `remove` | Remove a wallet from the keystore |

```bash
xrpl-up wallet new
xrpl-up wallet fund rMyAddress
xrpl-up wallet list
```

---

### `xrpl-up account`

Account query and management. The `account` command provides both query subcommands and mutation subcommands.

| Subcommand | Description |
|------------|-------------|
| `info` | Account flags, sequence, balance, signer list |
| `balance` | XRP and IOU balances |
| `transactions` | Recent transaction history (replaces `tx list`) |
| `offers` | Open offers on the DEX |
| `trust-lines` | Trust lines (replaces `trustline list`) |
| `channels` | Open payment channels |
| `nfts` | NFTs owned by the account |
| `mptokens` | MPT balances held by the account |
| `set` | Enable/disable account flags (replaces `accountset set/clear`) |
| `set-regular-key` | Set or remove the regular key |
| `delete` | Delete the account |

```bash
xrpl-up account info rMyAddress --network local
xrpl-up account transactions rMyAddress --network local
xrpl-up account trust-lines rMyAddress --network local
xrpl-up account balance rMyAddress --network testnet
```

---

### `xrpl-up payment`

Send a Payment transaction. Alias: `xrpl-up send`.

See [XRP Payment](examples/simple/xrp-payment.md) for a full walkthrough.

Run `xrpl-up payment --help` for all options.

---

### `xrpl-up multisig`

Multi-signature signer list management (replaces `accountset signer-list`).

See [Multi-Sig + Tickets: Out-of-Order Parallel Signing](examples/advanced/multi-sig-tickets.md) for a full walkthrough.

Run `xrpl-up multisig set --help` / `multisig delete --help` / `multisig list --help` for options.

---

### `xrpl-up credential`

Manage DID-based credentials on the XRP Ledger.

```bash
xrpl-up credential --help
```

---

### `xrpl-up did`

Manage Decentralized Identifiers (DID) on the XRP Ledger.

```bash
xrpl-up did --help
```

---

### `xrpl-up oracle`

Price oracle management on the XRP Ledger.

```bash
xrpl-up oracle --help
```

---

### `xrpl-up permissioned-domain`

Manage Permissioned Domains on the XRP Ledger (XLS-80d).

```bash
xrpl-up permissioned-domain --help
```

---

### `xrpl-up vault`

Manage vaults on the XRP Ledger.

See [Single-Asset Vault (XLS-65 / SingleAssetVault)](examples/advanced/vault.md) for a full walkthrough.

Run `xrpl-up vault create --help` / `vault set --help` / `vault deposit --help` / `vault withdraw --help` / `vault delete --help` / `vault clawback --help` for options.

---

### `xrpl-up amendment`

Inspect and manage XRPL amendments in the local sandbox. The local sandbox starts with a set of amendments baked into its genesis config; use `enable` to queue additional amendments (takes effect after `xrpl-up reset && xrpl-up start`).

> **Devnet compatibility:** XRPL Devnet may enable pre-release amendments that are not yet supported by the rippled version bundled with this tool. If you encounter unsupported transaction types or behaviors on devnet, check whether the amendment is available in the local sandbox with `xrpl-up amendment list --local --diff devnet`.

> **Local only for mutations:** `enable` writes to the genesis config and only applies to the local sandbox. `list` and `info` work on any network.

#### `xrpl-up amendment list`

Lists all amendments known to the target node with their enabled/supported status.

```bash
# List amendments on the local sandbox
xrpl-up amendment list --local

# List disabled amendments only
xrpl-up amendment list --local --disabled

# Side-by-side diff: local vs testnet
xrpl-up amendment list --local --diff testnet

# List amendments on testnet
xrpl-up amendment list --network testnet
```

#### `xrpl-up amendment info <nameOrHash>`

Shows full details for a single amendment. Accepts the amendment name or a hash prefix.

```bash
xrpl-up amendment info PermissionedDomains --local
xrpl-up amendment info AMM --network testnet
xrpl-up amendment info A730EB18 --local   # hash prefix lookup
```

#### `xrpl-up amendment enable <nameOrHash...>`

Queues one or more amendments for genesis activation on the local sandbox. Requires a reset to take effect — you'll be prompted automatically (once, for the whole batch), or pass `--auto-reset` to skip the prompt.

```bash
xrpl-up amendment enable PermissionedDomains --local
# ⚠  Activating this amendment requires a full node reset.
#    Ledger data and funded accounts will be wiped. Saved snapshots are kept.
#  Reset and restart the local node now? [y/N]

# Enable multiple amendments together — one queue, one reset:
xrpl-up amendment enable SingleAssetVault DynamicMPT LendingProtocol --local

# Skip the prompt and reset automatically:
xrpl-up amendment enable PermissionedDomains --local --auto-reset
```

Amendments you enable stay in effect across restarts until you `xrpl-up reset` (which clears them — use `reset --keep-amendments` to keep them).

> **Works in both modes, but takes longer under `--local-network`.** `enable` changes the genesis config, which only takes effect when a genesis ledger is created. In standalone mode, `xrpl-up reset && xrpl-up start --local` picks it up in seconds. In `--local-network` mode, queuing an amendment makes the next start build a real 2-node consensus genesis from scratch instead of resuming the pre-built ledger — this takes roughly a minute (real peer discovery + consensus bootstrap) instead of ~5s, and it starts a **new ledger lineage**.
>
> That lineage change is why `xrpl-up snapshot save`/`restore` records which amendment set each snapshot's genesis was built with: restoring a snapshot taken before an `amendment enable` automatically reverts the sandbox's amendment config to match it (and vice versa) — the ledger and the config always agree after a restore. See `xrpl-up reset` above for undoing an `enable` without a snapshot.

> **Some amendments always report `Enabled: ✗ no` — this is cosmetic, not a failure.** rippled compiles the long-standing amendments (`Checks`, `Escrow`, `PayChan`, `MultiSign`, `DepositAuth`, `Clawback`, the old `fix*` set, …) in as permanently active, so they work even though they never appear in a freshly created genesis ledger's amendment set. Live-verified: `check create`, `escrow create`, and `account set --set-flag depositAuth` all succeed while `amendment list` shows those amendments disabled. Only newer amendments (AMM, MPT, Credentials, DID, PermissionedDEX, SingleAssetVault, …) reflect their real state in that column, and those are the ones `amendment enable` affects.

---

### `xrpl-up init [directory]`

Scaffolds a new project with config, TypeScript setup, and example scripts. Prompts for a default network; choose `local` for local-sandbox-ready scripts out of the box.

> **Prerequisite:** `xrpl-up` must be available on PATH. Install globally via `npm install -g xrpl-up` or from source with `npm link` (see [Installation](#installation)). The generated `package.json` scripts (`npm run start`, `npm run accounts`) call `xrpl-up` from PATH and do not re-install it locally.

```bash
xrpl-up init
xrpl-up init my-project
```

**Generated files:**

```
my-project/
├── xrpl-up.config.js          # Network configuration defaults + custom network support
├── package.json
├── tsconfig.json
├── .gitignore
└── scripts/
    ├── example-payment.ts     # Send XRP + verify sender/receiver balances
    ├── example-token.ts       # Issue a custom IOU token (DefaultRipple + TrustSet + Payment)
    ├── example-dex.ts         # Place a DEX order, list it, cancel it (⚠ needs counterparty to fill)
    ├── example-nft.ts         # Full NFT lifecycle: mint → sell offer → accept → burn
    ├── example-mpt.ts         # Issue a Multi-Purpose Token: create issuance → opt in → transfer
    └── example-amm.ts         # Create an AMM pool and execute a swap (local only)
```

When `local` is selected as the default network, the example scripts use the local faucet (`http://localhost:3001`) instead of `client.fundWallet()`. `example-amm.ts` is only scaffolded for local mode since AMM is enabled by default there. The local `example-dex.ts` controls both sides of the trade so the order fills immediately; the remote variant places the order, lists it, then cancels it with a note that a real counterparty is required for fills.

---

### `xrpl-up snapshot`

Save and restore ledger state checkpoints. Useful for complex test setups (AMM pools, issued currencies, multi-step escrows) where re-running setup from scratch is expensive.

> **Requires `--local-network` mode.** Snapshots tar the named Docker volume (`xrpl-up-local-db`) into a self-contained `.tar.gz` file. Restore recreates the volume from that tarball — the volume does not need to have survived between runs. In standalone mode (default), there is no persistent volume to snapshot.

```bash
# Save the current ledger state
xrpl-up snapshot save before-amm

# List saved snapshots
xrpl-up snapshot list

# Restore to a previous checkpoint (~5–10s: rippled + faucet stop, volume restored, both restart)
xrpl-up snapshot restore before-amm
```

Each snapshot saves the ledger volume, a copy of the account store (`local-accounts.json`), and the manually enabled amendments (`amendment enable`) the ledger's genesis was built with. `snapshot save` waits for every account in the store to appear on a validated ledger before archiving, so the tarball and the account sidecar always agree — `xrpl-up accounts` reflects exactly the accounts that existed at snapshot time. `snapshot restore` verifies this after restoring and fails loudly if an account is missing, rather than leaving a silently inconsistent sandbox. The `snapshot list` output shows `+accounts` for any snapshot that includes the account sidecar.

**Restoring across an `amendment enable`:** enabling an amendment rebuilds the genesis ledger (see `amendment enable` above), which starts a new ledger lineage — a snapshot taken before that change belongs to a different lineage than the sandbox now running. `snapshot restore` detects this automatically and reverts the amendment config to match the snapshot being restored, so the ledger and the config always agree afterward. No special handling needed on your part — just restore.

**Typical workflow:**

```bash
xrpl-up start --local-network

# Run expensive setup (fund accounts, create AMM pool, set trust lines...)
xrpl-up faucet --network local
# `snapshot save` waits for accounts to be validated before archiving — no manual wait needed.
xrpl-up snapshot save after-setup

# Run tests, mutate state...

# Roll back to known-good state and run again
xrpl-up snapshot restore after-setup
xrpl-up accounts --local    # shows accounts as of snapshot time
```

**Fresh start from a snapshot after reset:**

```bash
xrpl-up reset                                    # wipe everything
xrpl-up start --local-network          # start sandbox (creates new volume)
xrpl-up snapshot restore after-setup             # restore saved state
xrpl-up accounts --local                         # snapshot accounts restored
```

Snapshots are stored at `~/.xrpl-up/snapshots/` and are portable — copy them to any machine and restore. Each snapshot produces three files:
- `<name>.tar.gz` — compressed node DB volume (typically 5–100 MB)
- `<name>-accounts.json` — account store at snapshot time
- `<name>-meta.json` — snapshot metadata (format version)

---

### `xrpl-up config`

Manage and validate rippled configuration.

#### `xrpl-up config export`

Prints the auto-generated `rippled.cfg` to stdout, or writes it to a file. Use this as a starting point for a custom config.

```bash
# Print to stdout
xrpl-up config export

# Save to file
xrpl-up config export --output my-rippled.cfg

# Export with debug log level
xrpl-up config export --debug --output my-rippled.cfg
```

#### `xrpl-up config validate <file>`

Validates a `rippled.cfg` for compatibility with xrpl-up before you use it. Checks for blocking errors, warnings, and prints recommendations.

```bash
xrpl-up config validate my-rippled.cfg
```

**What is checked:**

| Severity | Check |
|----------|-------|
| Error | WebSocket port must be `6006` (hardcoded by xrpl-up) |
| Error | WebSocket `ip` must be `0.0.0.0` (faucet container access) |
| Error | WebSocket `admin` must include `0.0.0.0` (admin commands) |
| Error | `[ssl_verify]` must be `0` |
| Error | `[node_db]` and `[database_path]` must be present |
| Warning | `node_size = large/huge` risks OOM on developer laptops |
| Warning | `send_queue_limit < 100` may throttle heavy test suites |
| Recommendation | Add `send_queue_limit = 500` for AMM testing |

Exit code `1` if any errors are found, `0` otherwise.

**Custom config workflow:**

```bash
# 1. Export the default as a starting point
xrpl-up config export --output my-rippled.cfg

# 2. Edit — e.g. change node_size, send_queue_limit, log level
$EDITOR my-rippled.cfg

# 3. Validate before starting
xrpl-up config validate my-rippled.cfg

# 4. Start with the custom config
xrpl-up start --local --config my-rippled.cfg
```

Validation also runs automatically when `--config` is passed to `xrpl-up start --local` — the sandbox will not start if there are blocking errors.

> **`--config` always runs standalone.** A custom `rippled.cfg` replaces the generated config entirely, including the 2-node consensus setup — `--config` and `--local-network` cannot be combined, and `xrpl-up start` rejects that combination with an error.

---

## CI/CD

Docker is available on all GitHub-hosted runners (`ubuntu-latest`, `macos-latest`).

Standalone mode (the default) is recommended for CI — it starts in seconds, has instant ledger closes, and needs no volume management.

```yaml
# .github/workflows/test.yml
steps:
  - run: xrpl-up start --local
  - run: npm test
  - run: xrpl-up stop
    if: always()
```

> **First run:** `xrpl-up start` automatically pulls the rippled Docker image (~1 GB) on first run and shows download progress. Subsequent runs reuse the cached image.

---

## Configuration

`xrpl-up.config.js` in your project root defines named networks used by `run`, `accounts`, `status`, and remote `start`/`faucet` flows:

```js
// xrpl-up.config.js
export default {
  networks: {
    local: {
      url: 'ws://localhost:6006',
      name: 'Local rippled (Docker)',
    },
    testnet: {
      url: 'wss://s.altnet.rippletest.net:51233',
      name: 'XRPL Testnet',
    },
    devnet: {
      url: 'wss://s.devnet.rippletest.net:51233',
      name: 'XRPL Devnet',
    },
  },
  defaultNetwork: 'local',
  accounts: {
    count: 10,
  },
};
```

Requires `"type": "module"` in your project's `package.json` (the config `xrpl-up init` scaffolds already has this).

Add any custom WebSocket endpoint as a named network and use it with `--network <name>`.

---

## Supported Networks

| Key | Endpoint | Faucet |
|-----|----------|--------|
| `local` | `ws://localhost:6006` | Yes (genesis wallet, no limits) |
| `testnet` | `wss://s.altnet.rippletest.net:51233` | Yes (rate limited) |
| `devnet` | `wss://s.devnet.rippletest.net:51233` | Yes (rate limited) |

> **Local vs Testnet:** The local sandbox is designed to cover most development workflows without needing testnet. Local mode has no transaction throttling, no faucet rate limits, and full reset control. Standalone mode (default) has instant ledger closes; `--local-network` has ~4s consensus closes but adds persistence and snapshot support. Use testnet for final validation against real network state.

---

## Data Storage

Account seeds, generated configs, and snapshots are stored at:

```
~/.xrpl-up/
  local-accounts.json         # funded account seeds (local mode)
  testnet-accounts.json       # funded account seeds (testnet)
  devnet-accounts.json        # funded account seeds (devnet)
  docker-compose.yml          # generated on each start
  rippled.cfg                 # standalone mode only (or custom via --config)
  rippled-node1.cfg           # --local-network mode only
  rippled-node2.cfg           # --local-network mode only
  validators.txt              # generated on each start (empty in standalone, validator keys in --local-network)
  genesis-amendments.txt      # queued by `amendment enable`, merged into the config above
  snapshots/
    before-amm.tar.gz         # node DB volume snapshot (--local-network mode)
    before-amm-accounts.json  # account store at snapshot time
    before-amm-meta.json      # snapshot metadata
    after-setup.tar.gz
    after-setup-accounts.json
    after-setup-meta.json
```

`xrpl-up start` always recreates accounts fresh unless `--local-network` is used. `xrpl-up faucet` appends to the account store regardless of mode. `xrpl-up reset` clears the account store and Docker volume in one command.

---

## License

MIT
