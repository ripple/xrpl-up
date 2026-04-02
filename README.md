# xrpl-up

CLI for XRPL local development and scripting. Spin up a local sandbox with pre-funded accounts, run scripts, manage snapshots, and interact with remote testnet/devnet endpoints from one tool.

## Prerequisites

- **Node.js** v20 or later
- **Docker** (required for `--local` mode only)

## Installation

~~**From npm (global):**~~

~~`npm install -g xrpl-up`~~

_Not available yet: package has not been published to npm._

**From source (development):**

```bash
git clone https://github.com/ripple/xrpl-up.git
cd xrpl-up
npm install
npm run build
npm link
```

## Quick Start

```bash
# Scaffold a new project (select "local" as default network)
xrpl-up init my-project
cd my-project && npm install

# Start a local sandbox with 10 pre-funded accounts (local is the default)
xrpl-up node

# In another terminal — list accounts with live balances
xrpl-up accounts

# Run a script against the local sandbox
xrpl-up run scripts/example-payment.ts

# Create an AMM pool in one command (local by default)
xrpl-up amm create XRP USD

# Mint a transferable NFT
xrpl-up nft mint --uri https://example.com/meta.json --transferable

# Create an MPT issuance (Multi-Purpose Token)
xrpl-up mptoken issuance create --node ws://localhost:6006 --max-amount 1000000 --asset-scale 6

# Open a payment channel
xrpl-up channel create rDestination... 10
```

---

## Commands

`xrpl-up` has two command sets:

- **Sandbox operation commands**: environment lifecycle and state control (`node`, `stop`, `reset`, `snapshot`, `status`, `accounts`, `logs`, `config`, `run`, `init`, `faucet`, `amendment`).
- **XRPL interaction commands**: transaction submission and account management (`wallet`, `account`, `payment`, `trust`, `offer`, `amm`, `nft`, `mptoken`, `escrow`, `check`, `channel`, `ticket`, `clawback`, `credential`, `did`, `multisig`, `oracle`, `deposit-preauth`, `permissioned-domain`, `vault`).

XRPL interaction commands are intentionally non-exhaustive. For complex or production-grade flows, use `xrpl.js` directly or call `rippled` RPC endpoints.

> **⚠️ Mainnet safety:** XRPL interaction commands (`wallet`, `account`, `payment`, `trust`, `offer`, `amm`, `nft`, `mptoken`, `escrow`, `check`, `channel`, `ticket`, `clawback`, `credential`, `did`, `multisig`, `oracle`, `deposit-preauth`, `permissioned-domain`, `vault`) have **no mainnet guard**. Passing `--node mainnet` (or a mainnet WebSocket URL) will submit real transactions. These commands are intended for local and testnet development only.

### Global flag: `--node`

All XRPL interaction commands accept a global `--node` option that sets the network target:

| Value | Connects to |
|-------|-------------|
| `local` (default) | Local sandbox (`ws://localhost:6006`) |
| `testnet` | XRPL Testnet |
| `devnet` | XRPL Devnet |
| `mainnet` | XRPL Mainnet (caution) |

```bash
# Use local sandbox (default — start first with: xrpl-up node)
xrpl-up account info rMyAddress

# Use testnet
xrpl-up wallet fund --account rMyAddress -n testnet

# Set via environment variable
export XRPL_NODE=ws://localhost:6006
xrpl-up payment --to rDest --amount 10
```

`--node` only applies to XRPL interaction commands; sandbox lifecycle commands (`node`, `stop`, `reset`, etc.) use `--network` to target remote networks (also default to local when omitted).

### `xrpl-up node`

Starts a sandbox environment and funds accounts. Supports a fully local rippled node (via Docker) or a connection to XRPL Testnet/Devnet.

```bash
# Start local Docker sandbox (default — no flag needed)
xrpl-up node

# Connect to Testnet instead
xrpl-up node --network testnet

# Connect to Devnet instead
xrpl-up node --network devnet
```

**Local mode options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--local` | — | Run a local rippled node via Docker |
| `--image <image>` | `xrpllabsofficial/xrpld:latest` | rippled Docker image |
| `--persist` | off | Keep ledger state and accounts across restarts |
| `--ledger-interval <ms>` | `1000` | Auto-advance ledger every N milliseconds |
| `--no-auto-advance` | — | Disable automatic ledger closing |
| `--no-secrets` | — | Suppress seeds and private keys from stdout (auto-enabled with `--detach`) |
| `--debug` | — | Enable rippled debug logging |
| `--detach` | — | Start in background and exit (for CI/CD) |
| `--config <path>` | — | Use a custom `rippled.cfg` instead of the auto-generated one |
| `--exit-on-crash` | — | Exit with code 134 when rippled crashes (SIGABRT); disables container auto-restart |
| `-a, --accounts <n>` | `10` | Number of accounts to pre-fund |

**What `xrpl-up node` does (local mode):**

1. Generates `rippled.cfg` and `docker-compose.yml` in `~/.xrpl-up/`
2. Starts rippled in standalone mode (no peers, no sync, no internet required)
3. Starts a faucet server alongside rippled
4. Funds 10 accounts with 1,000 XRP each from the genesis wallet
5. Auto-advances the ledger every second so transactions confirm automatically
6. Prints all account addresses and seeds to the terminal

> **Note:** The local node is a clean-room environment — ledger starts at index 1 with only the genesis wallet. It is not a mirror of mainnet state. What matters is that transaction validation rules match the rippled version in use.
>
> **AMM / XLS-30 and MPT / XLS-33:** Both AMM and MPT (Multi-Purpose Token) are enabled by default in the local sandbox. xrpl-up uses the `[amendments]` section in `rippled.cfg` to force-enable the required amendments at genesis creation. No voting or ledger advancement is needed.

> **Hardware:** Standalone mode requires far less than a full rippled node. A typical developer laptop is sufficient (~2 GB RAM, ~500 MB disk for the Docker image). Standalone mode has no peers, no consensus, and no ledger sync — it only processes transactions you submit locally.

---

### `xrpl-up stop`

Stops the local Docker sandbox stack.

```bash
xrpl-up stop
```

---

### `xrpl-up reset`

Wipes all local sandbox state and starts with a clean slate. Useful after a `--persist` session or when you want to discard all ledger state and funded accounts.

```bash
# Wipe containers, ledger volume, and accounts — keep snapshots
xrpl-up reset

# Wipe everything including saved snapshots
xrpl-up reset --snapshots
```

What `xrpl-up reset` removes:
- Running Docker containers (`docker compose down`)
- The persist ledger volume (`xrpl-up-local-db`)
- `~/.xrpl-up/local-accounts.json`
- With `--snapshots`: `~/.xrpl-up/snapshots/` and all snapshot files

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

#### `xrpl-up amm create <asset1> <asset2>`

Creates a ready-to-use AMM pool with fresh funded accounts. Automatically handles issuer creation, trust lines, token issuance, and pool creation.

```bash
# XRP/USD pool with defaults (100 XRP, 100 USD, 0.5% fee)
xrpl-up amm create XRP USD --local

# Custom amounts and fee
xrpl-up amm create XRP USD --amount1 500 --amount2 1000 --fee 0.3 --local

# IOU/IOU pool (creates two separate issuers)
xrpl-up amm create USD EUR --amount1 100 --amount2 100 --local
```

| Flag | Default | Description |
|------|---------|-------------|
| `--amount1 <n>` | `100` | Amount of asset1 to deposit |
| `--amount2 <n>` | `100` | Amount of asset2 to deposit |
| `--fee <pct>` | `0.5` | Trading fee in % (max 1%) |
| `--local` | — | Use the local Docker sandbox |
| `-n, --network` | `testnet` | Target network |

The command prints the exact `amm info` query to use afterward, with the issuer address filled in.

> **Note:** For non-XRP assets, `amm create` mints a fresh token on your local ledger. The issuer address is randomly generated — it has no relation to any real-world or testnet issuer.

#### `xrpl-up amm info <asset1> <asset2>`

Shows current pool state: reserves, LP token supply, trading fee, and AMM account.

```bash
# Query by asset pair (use the issuer address printed by amm create)
xrpl-up amm info XRP USD.rIssuerAddress --local

# Query by AMM account address
xrpl-up amm info --account rAMMAccountAddress --local

# Query on testnet
xrpl-up amm info XRP USD.rHb9... --network testnet
```

Asset format: `XRP` for native currency, `CURRENCY.rIssuerAddress` for IOUs (e.g. `USD.rHb9CJ...`).

---

### `xrpl-up nft`

NFT lifecycle operations (XLS-20). Supports mint, list, buy/sell offers, and burn on local sandbox or remote networks.

#### `xrpl-up nft mint`

Mints a new NFT. When `--seed` is omitted a wallet is auto-funded — via the local genesis faucet on `--local`, or the public testnet/devnet faucet on remote networks.

```bash
# Mint a transferable NFT with a metadata URI (local, auto-funds wallet)
xrpl-up nft mint --local --uri https://example.com/nft-meta.json --transferable

# Mint on testnet — omit --seed to auto-fund via the public testnet faucet
xrpl-up nft mint --uri https://example.com/meta.json \
  --transferable --transfer-fee 5 --taxon 42
```

| Flag | Default | Description |
|------|---------|-------------|
| `--uri <uri>` | — | Metadata URI (hex-encoded automatically) |
| `--transferable` | off | Allow the NFT to be transferred (`tfTransferable`) |
| `--burnable` | off | Allow the issuer to burn it (`tfBurnable`) |
| `--taxon <n>` | `0` | NFToken taxon |
| `--transfer-fee <pct>` | `0` | Royalty fee percentage, 0–50 |
| `-s, --seed <seed>` | — | Minter wallet seed (omit to auto-fund via faucet) |

#### `xrpl-up nft list`

Lists NFTs owned by an account.

```bash
# List NFTs for the first local account
xrpl-up nft list --local

# List NFTs for a specific address
xrpl-up nft list --local --account rSomeAddress...
```

#### `xrpl-up nft offers <nftokenId>`

Shows all open buy and sell offers for an NFT.

```bash
xrpl-up nft offers 000800006B9C0B... --local
```

#### `xrpl-up nft sell <nftokenId> <price>`

Creates a sell offer for an NFT. Price is `"1"` for 1 XRP or `"10.USD.rIssuer"` for an IOU amount.

```bash
# Sell for 5 XRP
xrpl-up nft sell 000800006B9C0B... 5 --local --seed sn3nxiW7...

# Sell for 10 USD (IOU)
xrpl-up nft sell 000800006B9C0B... 10.USD.rHb9CJA... --seed sn3nxiW7...
```

#### `xrpl-up nft accept <offerId>`

Accepts a sell offer (or a buy offer with `--buy`). On `--local` a buyer wallet is auto-funded if `--seed` is omitted.

```bash
xrpl-up nft accept A1B2C3D4... --local

# Accept with an explicit buyer seed
xrpl-up nft accept A1B2C3D4... --local --seed sBuyerSeed...

# Accept a buy offer
xrpl-up nft accept A1B2C3D4... --local --seed sHolderSeed... --buy
```

#### `xrpl-up nft burn <nftokenId>`

Permanently destroys an NFT.

```bash
xrpl-up nft burn 000800006B9C0B... --local --seed sHolderSeed...
```

---

### `xrpl-up channel`

Payment channel operations. Payment channels allow fast, off-chain micropayments with on-chain settlement.

#### `xrpl-up channel create <destination> <amount>`

Opens a payment channel funded with `<amount>` XRP. On `--local` the source wallet is auto-funded.

```bash
# Create a 10 XRP channel to a destination (local, auto-funds source)
xrpl-up channel create rDestination... 10 --local

# Create with a custom settle delay (1 hour)
xrpl-up channel create rDestination... 10 --local --seed sSourceSeed... --settle-delay 3600
```

| Flag | Default | Description |
|------|---------|-------------|
| `--settle-delay <s>` | `86400` | Settlement delay in seconds (default: 1 day) |
| `-s, --seed <seed>` | — | Source wallet seed (omit to auto-fund on `--local`) |

#### `xrpl-up channel list`

Lists payment channels for an account.

```bash
xrpl-up channel list --local
xrpl-up channel list --local --account rSomeAddress...
```

#### `xrpl-up channel fund <channelId> <amount>`

Adds more XRP to an existing channel.

```bash
xrpl-up channel fund ABC123... 5 --local --seed sSourceSeed...
```

#### `xrpl-up channel sign <channelId> <amount>`

Signs an off-chain claim authorizing the destination to claim up to `<amount>` XRP. No on-chain transaction — prints the signature, the signer's public key, and ready-to-use `verify` and `claim` commands.

```bash
xrpl-up channel sign ABC123... 3 --seed sSourceSeed...
```

The output includes the `--public-key` value needed for `channel claim`. Pass the signature and public key to the destination out-of-band; the destination then runs the printed claim command.

#### `xrpl-up channel verify <channelId> <amount> <signature> <publicKey>`

Verifies an off-chain claim signature. Exits with code `1` if invalid.

```bash
xrpl-up channel verify ABC123... 3 <hex-signature> <public-key>
```

#### `xrpl-up channel claim <channelId>`

Submits a `PaymentChannelClaim` on-chain. Optionally redeems an off-chain claim or closes the channel.

```bash
# Close the channel (no claim amount)
xrpl-up channel claim ABC123... --local --seed sDestSeed... --close

# Redeem an off-chain claim
# --public-key is the source wallet's public key (printed by channel sign)
xrpl-up channel claim ABC123... --local --seed sDestSeed... \
  --amount 3 --signature <hex-sig> --public-key <source-public-key>
```

---

### `xrpl-up mptoken`

Multi-Purpose Token (MPT / XLS-33) operations. MPT is enabled automatically in the local sandbox. Use `--node ws://localhost:6006` to target the local sandbox, or `--node testnet` for Testnet.

#### `xrpl-up mptoken issuance create`

Creates a new MPT issuance.

```bash
# Local sandbox
xrpl-up mptoken issuance create --node ws://localhost:6006 --seed sIssuerSeed... \
  --max-amount 1000000 --asset-scale 6 --transfer-fee 100 --metadata "My Token"

# Minimal (no supply cap, non-transferable by default)
xrpl-up mptoken issuance create --node ws://localhost:6006 --seed sIssuerSeed...
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max-amount <n>` | unlimited | Maximum token supply |
| `--asset-scale <n>` | `0` | Decimal places, 0–19 |
| `--transfer-fee <n>` | `0` | Fee in hundredths of a percent, 0–50000 |
| `--metadata <string>` | — | Metadata string (hex-encoded on-chain) |
| `--seed / --mnemonic / --account` | — | Key material |

#### `xrpl-up mptoken issuance destroy <issuanceId>`

Destroys an MPT issuance. Outstanding supply must be zero.

```bash
xrpl-up mptoken issuance destroy 00070C44... --node ws://localhost:6006 --seed sIssuerSeed...
```

#### `xrpl-up mptoken authorize <issuanceId>`

Authorizes (or unauthorizes) a holder to hold the token.

```bash
# Issuer side: authorize a holder
xrpl-up mptoken authorize 00070C44... --holder rHolderAddress... \
  --node ws://localhost:6006 --seed sIssuerSeed...

# Holder side: opt in (no --holder flag)
xrpl-up mptoken authorize 00070C44... --node ws://localhost:6006 --seed sHolderSeed...

# Revoke authorization
xrpl-up mptoken authorize 00070C44... --holder rHolderAddress... --unauthorize \
  --node ws://localhost:6006 --seed sIssuerSeed...
```

#### `xrpl-up mptoken issuance set <issuanceId>`

Locks or unlocks an MPT issuance or a specific holder's balance. Requires the issuance to have been created with `--can-lock`.

```bash
xrpl-up mptoken issuance set 00070C44... --lock --node ws://localhost:6006 --seed sIssuerSeed...
xrpl-up mptoken issuance set 00070C44... --lock --holder rAddr... --node ws://localhost:6006 --seed sIssuerSeed...
xrpl-up mptoken issuance set 00070C44... --unlock --node ws://localhost:6006 --seed sIssuerSeed...
```

#### `xrpl-up mptoken issuance get <issuanceId>`

Shows on-ledger details of an MPT issuance: issuer, outstanding supply, flags, and metadata.

```bash
xrpl-up mptoken issuance get 00070C4495F14B0E... --node ws://localhost:6006
```

#### `xrpl-up mptoken issuance list <address>`

Lists MPT issuances created by an account.

```bash
xrpl-up mptoken issuance list rMyAddress... --node ws://localhost:6006
```

#### Sending MPT payments

Use the `payment` command with an MPT amount format `<amount>/<issuanceId>`:

```bash
xrpl-up payment --to rDestAddress --amount "500/00070C44..." \
  --node ws://localhost:6006 --seed sHolderSeed...
```

For querying MPT balances held by an account, use `xrpl-up account mptokens`.

---

### `xrpl-up offer`

DEX (decentralized exchange) offer operations. The XRPL DEX is a built-in order book — no smart contracts needed.

#### `xrpl-up offer create <pays> <gets>`

Creates a limit order. `<pays>` is what you put in; `<gets>` is what you want out. When `--seed` is omitted a wallet is auto-funded via faucet.

Asset format: `"5"` = 5 XRP, `"10.USD.rIssuer"` = IOU (same as AMM). Decimal values like `"10.5.USD.rIssuer"` are supported.

```bash
# Offer 10 USD for 5 XRP (local, auto-funds wallet)
xrpl-up offer create "10.USD.rHb9..." "5" --local

# Offer 5 XRP for 10 USD on testnet
xrpl-up offer create "5" "10.USD.rHb9..." --seed sn3nxiW7...

# Immediate-or-cancel sell offer
xrpl-up offer create "5" "10.USD.rHb9..." --sell --immediate-or-cancel --seed sn3nxiW7...
```

| Flag | Description |
|------|-------------|
| `--passive` | Do not consume matching offers at equal price |
| `--sell` | Sell exactly `TakerPays` regardless of `TakerGets` minimum |
| `--immediate-or-cancel` | Fill what is possible immediately, cancel the rest |
| `--fill-or-kill` | Fill the full amount or cancel entirely |

#### `xrpl-up offer cancel <sequence>`

Cancels an open offer by its sequence number (printed by `offer create`).

```bash
xrpl-up offer cancel 42 --local --seed sn3nxiW7...
```

#### `xrpl-up offer list`

Lists all open DEX offers for an account.

```bash
xrpl-up offer list --local
xrpl-up offer list --local --account rSomeAddress...
```

---

### `xrpl-up trust`

Trust line operations (renamed from `trustline`). Use `xrpl-up account trust-lines` to query existing trust lines.

#### `xrpl-up trust set`

Creates or updates a trust line.

```bash
# Set a USD trust line with a 1000 limit (local sandbox)
xrpl-up trust set --currency USD --issuer rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh \
  --limit 1000 --node ws://localhost:6006 --seed sn3nxiW7...

# With NoRipple flag
xrpl-up trust set --currency USD --issuer rHb9... --limit 1000 \
  --no-ripple --node ws://localhost:6006 --seed sn3nxiW7...

# Freeze a trust line (issuer only)
xrpl-up trust set --currency USD --issuer rHolderAddress... \
  --limit 0 --freeze --node ws://localhost:6006 --seed sIssuerSeed...

# Unfreeze
xrpl-up trust set --currency USD --issuer rHolderAddress... \
  --limit 0 --unfreeze --node ws://localhost:6006 --seed sIssuerSeed...
```

| Flag | Description |
|------|-------------|
| `--currency <code>` | Currency code (3-char ASCII or 40-char hex) |
| `--issuer <address>` | Issuer address |
| `--limit <value>` | Trust line limit (0 removes the trust line) |
| `--no-ripple` | Set NoRipple flag |
| `--clear-no-ripple` | Clear NoRipple flag |
| `--freeze` | Freeze the trust line (issuer only) |
| `--unfreeze` | Unfreeze the trust line |
| `--auth` | Authorize the trust line |

#### Query trust lines

```bash
xrpl-up account trust-lines rMyAddress... --node ws://localhost:6006
```

To enable `DefaultRipple` (rippling on all new trust lines), use `xrpl-up account set defaultRipple`.

---

### `xrpl-up escrow`

Escrow operations. Escrows lock XRP until a time condition or crypto-condition is met.

#### `xrpl-up escrow create <destination> <amount>`

Creates an escrow. At least one of `--finish-after`, `--cancel-after`, or `--condition` is required. When `--seed` is omitted a wallet is auto-funded.

Time expressions: `+30m`, `+1h`, `+1d`, `+7d` (relative from now), or an absolute Unix timestamp.

```bash
# Time-locked: can finish after 1 hour, auto-cancels after 7 days
xrpl-up escrow create rDest... 10 --local \
  --finish-after +1h --cancel-after +7d

# Crypto-condition escrow
xrpl-up escrow create rDest... 10 --local \
  --condition A0258020... --cancel-after +7d --seed sn3nxiW7...
```

#### `xrpl-up escrow finish <owner> <sequence>`

Releases the escrowed funds to the destination after the `FinishAfter` time has passed. For crypto-condition escrows, `--fulfillment` and `--condition` are required.

```bash
# Time-based finish
xrpl-up escrow finish rOwner... 42 --local --seed sDestSeed...

# Crypto-condition finish
xrpl-up escrow finish rOwner... 42 --local --seed sDestSeed... \
  --fulfillment A0228020... --condition A0258020...
```

#### `xrpl-up escrow cancel <owner> <sequence>`

Cancels an expired escrow (after `CancelAfter` time) and returns XRP to the owner.

```bash
xrpl-up escrow cancel rOwner... 42 --local --seed sn3nxiW7...
```

#### `xrpl-up escrow list`

Lists escrows for an account, showing amounts, times, and conditions.

```bash
xrpl-up escrow list --local
xrpl-up escrow list --local --account rSomeAddress...
```

---

### `xrpl-up check`

Check operations. Checks are a deferred payment mechanism — the sender authorizes a maximum amount that the destination can cash at any time before expiry.

#### `xrpl-up check create <destination> <sendMax>`

Creates a check. `<sendMax>` is the maximum the destination can receive.

```bash
# Create a 5 XRP check (valid for 7 days)
xrpl-up check create rDest... 5 --local --seed sn3nxiW7... --expiry +7d

# Create an IOU check
xrpl-up check create rDest... "10.USD.rHb9..." --local --seed sn3nxiW7...
```

#### `xrpl-up check cash <checkId> [amount]`

Cashes a check. Provide an exact `[amount]` or `--deliver-min` for a flexible minimum (the destination receives as much as possible up to `SendMax`).

```bash
# Cash exactly 5 XRP
xrpl-up check cash ABC123... 5 --local --seed sDestSeed...

# Cash flexibly — receive at least 3 XRP
xrpl-up check cash ABC123... --deliver-min 3 --local --seed sDestSeed...
```

#### `xrpl-up check cancel <checkId>`

Cancels a check (sender or destination can cancel; anyone can cancel after expiry).

```bash
xrpl-up check cancel ABC123... --local --seed sn3nxiW7...
```

#### `xrpl-up check list`

Lists outstanding checks for an account.

```bash
xrpl-up check list --local
xrpl-up check list --local --account rSomeAddress...
```

---

### `xrpl-up account set`

Enable or disable account flags (replaces the old `accountset` command).

```bash
xrpl-up account set requireDest --node ws://localhost:6006 --seed sn3nxiW7...
xrpl-up account set requireDest --clear --node ws://localhost:6006 --seed sn3nxiW7...
```

| Flag name | Description |
|-----------|-------------|
| `requireDest` | Require a destination tag on all incoming payments |
| `requireAuth` | Require the issuer to authorize all trust lines |
| `disallowXRP` | Signal that this account does not accept direct XRP payments |
| `disableMaster` | Disable the master key (use only after setting a signer list) |
| `defaultRipple` | Enable rippling on all new trust lines (issuers) |
| `depositAuth` | Only accept payments from pre-authorized senders |
| `allowClawback` | Allow the issuer to clawback IOU tokens from trust line holders (irreversible) |

> **Note:** Set a signer list before disabling the master key (`disableMaster`). For signer list management, use `xrpl-up multisig`. To query account settings, use `xrpl-up account info`.

---

### Transaction history

The `tx` command has been removed. Use `xrpl-up account transactions`:

```bash
xrpl-up account transactions rMyAddress... --node ws://localhost:6006
xrpl-up account transactions rMyAddress... --node testnet
```

---

### `xrpl-up deposit-preauth`

Manage DepositPreauth entries (renamed from `depositpreauth`). Required when an account has the `depositAuth` flag set.

```bash
# Enable deposit authorization on your account first
xrpl-up account set depositAuth --node ws://localhost:6006 --seed sn3nxiW7...

# Pre-authorize a specific sender
xrpl-up deposit-preauth set --authorize rSender... \
  --node ws://localhost:6006 --seed sn3nxiW7...

# Revoke a pre-authorization
xrpl-up deposit-preauth set --unauthorize rSender... \
  --node ws://localhost:6006 --seed sn3nxiW7...

# List all pre-authorizations
xrpl-up deposit-preauth list rMyAddress... --node ws://localhost:6006
```

---

### `xrpl-up ticket`

Ticket operations. Tickets reserve sequence numbers, allowing transactions to be submitted out-of-order or in parallel — useful for multi-sig workflows.

#### `xrpl-up ticket create <count>`

Reserves 1–250 sequence numbers as tickets. Returns the allocated TicketSequence numbers.

#### `xrpl-up ticket list [account]`

Lists existing tickets (reserved sequence numbers) for an account.

```bash
# Reserve 5 ticket sequences
xrpl-up ticket create 5 --local --seed sn3nxiW7...

# Auto-fund a new wallet and reserve tickets (local only)
xrpl-up ticket create 3 --local --auto-fund

# List existing tickets
xrpl-up ticket list --local
xrpl-up ticket list rSomeAddress... --local
```

> **Usage:** To use a ticket in a transaction, set `Sequence = 0` and `TicketSequence = <n>`.

---

### `xrpl-up clawback`

Issuer clawback operations. The issuer account must have clawback enabled before use.

> **Prerequisites:**
> - **IOU clawback:** Enable `asfAllowTrustLineClawback` with `xrpl-up account set allowClawback --node ws://localhost:6006 --seed <issuer-seed>`
> - **MPT clawback:** The issuance must have been created with `xrpl-up mptoken issuance create --can-clawback`

#### `xrpl-up clawback iou <amount> <currency> <holder>`

Reclaims IOU tokens from a trust line holder. The signing wallet must be the token issuer.

#### `xrpl-up clawback mpt <issuanceId> <holder> <amount>`

Reclaims MPT tokens from a holder. The signing wallet must be the MPT issuer.

```bash
# Clawback 10 USD from a holder trust line
xrpl-up clawback iou 10 USD rHolder... --local --seed sIssuerSeed...

# Clawback 500 units of an MPT
xrpl-up clawback mpt 00000001AABBCCDD... rHolder... 500 --local --seed sIssuerSeed...
```

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
| `fund` | Fund a wallet from the testnet faucet |
| `change-password` | Change keystore encryption password |
| `decrypt-keystore` | Export keystore contents (decrypt to plaintext) |
| `remove` | Remove a wallet from the keystore |

```bash
xrpl-up wallet new
xrpl-up wallet fund --account rMyAddress
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
xrpl-up account info rMyAddress --node ws://localhost:6006
xrpl-up account transactions rMyAddress --node ws://localhost:6006
xrpl-up account trust-lines rMyAddress --node ws://localhost:6006
xrpl-up account balance rMyAddress --node testnet
```

---

### `xrpl-up payment`

Send a Payment transaction. Alias: `xrpl-up send`.

```bash
# Send XRP
xrpl-up payment --to rDest... --amount 10 --node ws://localhost:6006 --seed sSrc...

# Send IOU
xrpl-up payment --to rDest... --amount "10/USD/rIssuer..." \
  --node ws://localhost:6006 --seed sSrc...

# Send MPT
xrpl-up payment --to rDest... --amount "500/00070C44..." \
  --node ws://localhost:6006 --seed sSrc...
```

| Flag | Description |
|------|-------------|
| `--to <address>` | Destination address or alias |
| `--amount <amount>` | Amount: `10` = XRP, `10/USD/rIssuer` = IOU, `500/<issuanceId>` = MPT |
| `--destination-tag <n>` | Destination tag |
| `--memo <text>` | Memo to attach (repeatable) |
| `--send-max <amount>` | SendMax for cross-currency payments |
| `--deliver-min <amount>` | Minimum delivery (enables partial payments) |
| `--partial` | Set tfPartialPayment flag |
| `--dry-run` | Print signed transaction without submitting |

---

### `xrpl-up multisig`

Multi-signature signer list management (replaces `accountset signer-list`).

```bash
xrpl-up multisig --help
```

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

```bash
xrpl-up vault --help
```

---

### `xrpl-up amendment`

Inspect and manage XRPL amendments in the local sandbox. The local sandbox starts with a set of amendments baked into its genesis config; use `enable` to queue additional amendments (takes effect after `xrpl-up reset && xrpl-up node`).

> **Local only for mutations:** `enable` and `disable` write to the genesis config and only apply to the local sandbox. `list` and `info` work on any network.

#### `xrpl-up amendment list`

Lists all amendments known to the target node with their enabled/supported status.

```bash
# List amendments on the local sandbox
xrpl-up amendment list --local

# List disabled amendments only
xrpl-up amendment list --local --disabled

# Side-by-side diff: local vs mainnet
xrpl-up amendment list --local --diff mainnet

# List amendments on testnet
xrpl-up amendment list --network testnet
```

#### `xrpl-up amendment info <nameOrHash>`

Shows full details for a single amendment. Accepts the amendment name or a hash prefix.

```bash
xrpl-up amendment info PermissionedDomains --local
xrpl-up amendment info AMM --network mainnet
xrpl-up amendment info A730EB18 --local   # hash prefix lookup
```

#### `xrpl-up amendment enable <nameOrHash>`

Queues an amendment for activation in the local sandbox genesis config. Because the local node runs in standalone mode (no consensus), amendments cannot be activated via validator voting — they must be present in the genesis config from the very first ledger. The command writes the amendment hash to `~/.xrpl-up/genesis-amendments.txt`, regenerates `rippled.cfg`, then prompts you to reset and restart.

```bash
xrpl-up amendment enable PermissionedDomains --local
# ⚠  Activating this amendment requires a full node reset.
#    All ledger data, funded accounts, and snapshots will be wiped.
#  Reset and restart the local node now? [y/N]

# Skip the prompt and reset automatically:
xrpl-up amendment enable PermissionedDomains --local --auto-reset
```

> **Local only.** Only works with `--local`; the genesis config approach requires direct filesystem access.

#### `xrpl-up amendment disable <nameOrHash>`

Removes a previously user-enabled amendment from `~/.xrpl-up/genesis-amendments.txt`. Only amendments added via `amendment enable` can be disabled — built-in genesis amendments cannot be removed. Prompts to reset and restart (same requirement as enable).

```bash
xrpl-up amendment disable PermissionedDomains --local
xrpl-up amendment disable PermissionedDomains --local --auto-reset
```

---

### `xrpl-up init [directory]`

Scaffolds a new project with config, TypeScript setup, and example scripts. Prompts for a default network; choose `local` for local-sandbox-ready scripts out of the box.

> **Prerequisite:** `xrpl-up` must be available on PATH. Until the package is published to npm, install from source with `npm link` (see [Installation](#installation)). The generated `package.json` scripts (`npm run node`, `npm run accounts`) call `xrpl-up` from PATH and do not re-install it locally.

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

> **Requires `--persist` mode.** Snapshots tar the named Docker volume (`xrpl-up-local-db`) into a self-contained `.tar.gz` file. Restore recreates the volume from that tarball — the volume does not need to have survived between runs. In ephemeral mode (default), there is no persistent volume to snapshot.

```bash
# Save the current ledger state
xrpl-up snapshot save before-amm

# List saved snapshots
xrpl-up snapshot list

# Restore to a previous checkpoint (~5–10s: rippled + faucet stop, volume restored, both restart)
xrpl-up snapshot restore before-amm
```

Each snapshot saves both the ledger volume **and** the account store (`local-accounts.json`), so `xrpl-up accounts` reflects the correct set of accounts after a restore. The `snapshot list` output shows `+accounts` for any snapshot that includes the account sidecar.

**Typical workflow:**

```bash
xrpl-up node --local --persist --detach

# Run expensive setup (fund accounts, create AMM pool, set trust lines...)
xrpl-up faucet --network local
xrpl-up snapshot save after-setup

# Run tests, mutate state...

# Roll back to known-good state and run again
xrpl-up snapshot restore after-setup
xrpl-up accounts --local    # shows accounts as of snapshot time
```

**Fresh start from a snapshot after reset:**

```bash
xrpl-up reset                                    # wipe everything
xrpl-up node --local --persist --detach          # start sandbox (creates new volume)
xrpl-up snapshot restore after-setup             # restore saved state
xrpl-up accounts --local                         # snapshot accounts restored
```

Snapshots are stored at `~/.xrpl-up/snapshots/`. Each snapshot is a pair of files:
- `<name>.tar.gz` — compressed NuDB ledger volume (typically 5–100 MB)
- `<name>-accounts.json` — account store at snapshot time

**Using snapshots in CI / GitHub Actions:**

GitHub-hosted runners are ephemeral — the `~/.xrpl-up/snapshots/` directory disappears after each job. Snapshots work natively within a single job. For cross-job or cross-run use, treat the snapshot files as portable artifacts.

*Within one job* — save state after setup, restore between test suites (no extra configuration):

```yaml
steps:
  - run: xrpl-up node --local --persist --detach
  - run: |
      xrpl-up faucet --network local
      xrpl-up amm create XRP USD --local
      xrpl-up snapshot save after-setup
  - run: npm test -- --suite=suite-a
  - run: xrpl-up snapshot restore after-setup
  - run: npm test -- --suite=suite-b
  - run: xrpl-up stop
    if: always()
```

*Across jobs* — upload snapshot as an artifact in a setup job, download and restore in parallel test jobs:

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: xrpl-up node --local --persist --detach
      - run: |
          xrpl-up faucet --network local
          xrpl-up amm create XRP USD --local
          xrpl-up snapshot save after-setup
      - uses: actions/upload-artifact@v4
        with:
          name: xrpl-snapshots
          path: ~/.xrpl-up/snapshots/
      - run: xrpl-up stop

  test-suite-a:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: xrpl-snapshots
          path: ~/.xrpl-up/snapshots/
      - run: xrpl-up node --local --persist --detach
      - run: xrpl-up snapshot restore after-setup
      - run: npm test -- --suite=suite-a
      - run: xrpl-up stop
        if: always()

  test-suite-b:
    needs: setup
    runs-on: ubuntu-latest      # different VM, doesn't matter
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: xrpl-snapshots
          path: ~/.xrpl-up/snapshots/
      - run: xrpl-up node --local --persist --detach
      - run: xrpl-up snapshot restore after-setup
      - run: npm test -- --suite=suite-b
      - run: xrpl-up stop
        if: always()
```

*Across runs* — cache the snapshot directory so expensive setup only runs once:

```yaml
steps:
  - uses: actions/cache@v4
    with:
      path: ~/.xrpl-up/snapshots
      key: xrpl-snapshot-v1          # bump to force regeneration when setup changes

  - run: xrpl-up node --local --persist --detach
  - run: |
      if ! xrpl-up snapshot restore after-setup; then
        xrpl-up faucet --network local
        xrpl-up amm create XRP USD --local
        xrpl-up snapshot save after-setup
      fi
  - run: npm test
  - run: xrpl-up stop
    if: always()
```

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
xrpl-up node --local --config my-rippled.cfg
```

Validation also runs automatically when `--config` is passed to `xrpl-up node --local` — the node will not start if there are blocking errors.

---

## CI/CD

Docker is available on all GitHub-hosted runners (`ubuntu-latest`, `macos-latest`).

**Minimal setup** — start the sandbox, run tests, tear down:

```yaml
# .github/workflows/test.yml
steps:
  - run: xrpl-up node --local --detach
  - run: npm test
  - run: xrpl-up stop
    if: always()
```

**With snapshots** — do expensive setup once, restore before each test suite:

```yaml
steps:
  - run: xrpl-up node --local --persist --detach
  - run: |
      xrpl-up faucet --network local
      xrpl-up amm create XRP USD --local
      xrpl-up snapshot save after-setup
  - run: npm test -- --suite=suite-a
  - run: xrpl-up snapshot restore after-setup
  - run: npm test -- --suite=suite-b
  - run: xrpl-up stop
    if: always()
```

**Parallel jobs sharing a snapshot** — run test suites concurrently against identical ledger state. See the [snapshot section](#xrpl-up-snapshot) for the full `upload-artifact` / `download-artifact` pattern.

**Cross-run snapshot cache** — skip setup on subsequent runs using `actions/cache`. See the [snapshot section](#xrpl-up-snapshot) for details.

The faucet server handles ledger auto-advance while the sandbox runs in the background.

---

## Configuration

`xrpl-up.config.js` in your project root defines named networks used by `run`, `accounts`, `status`, and remote `node`/`faucet` flows:

```js
module.exports = {
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
};
```

Add any custom WebSocket endpoint as a named network and use it with `--network <name>`.

---

## Supported Networks

| Key | Endpoint | Faucet |
|-----|----------|--------|
| `local` | `ws://localhost:6006` | Yes (genesis wallet, no limits) |
| `testnet` | `wss://s.altnet.rippletest.net:51233` | Yes (rate limited) |
| `devnet` | `wss://s.devnet.rippletest.net:51233` | Yes (rate limited) |

> **Local vs Testnet:** The local sandbox is designed to cover most development workflows without needing testnet. Local mode has no transaction throttling, no faucet rate limits, instant ledger closes, and full reset control. Use testnet for final validation against real network state.

---

## Data Storage

Account seeds, generated configs, and snapshots are stored at:

```
~/.xrpl-up/
  local-accounts.json         # funded account seeds (local mode)
  testnet-accounts.json       # funded account seeds (testnet)
  devnet-accounts.json        # funded account seeds (devnet)
  docker-compose.yml          # generated on each node start
  rippled.cfg                 # generated on each node start (or custom via --config)
  snapshots/
    before-amm.tar.gz         # ledger volume snapshot (--persist mode)
    before-amm-accounts.json  # account store at snapshot time
    after-setup.tar.gz
    after-setup-accounts.json
```

`xrpl-up node` always recreates accounts fresh unless `--persist` is used. `xrpl-up faucet` appends to the account store regardless of persist mode. `xrpl-up reset` clears the account store and Docker volume in one command.

---

## License

MIT
