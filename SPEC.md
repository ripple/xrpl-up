# xrpl-up — Product Specification

> **Version:** 0.1.0
> **Status:** Pre-release (not yet published to npm)
> **Source of truth:** This document supersedes inline comments when they conflict.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Supported Networks](#3-supported-networks)
4. [Command Reference](#4-command-reference)
5. [Feature Specifications](#5-feature-specifications)
6. [Configuration](#6-configuration)
7. [Exit Codes & Error Handling](#7-exit-codes--error-handling)
8. [Security & Privacy](#8-security--privacy)
9. [Versioning & Compatibility](#9-versioning--compatibility)
10. [1.0 Readiness Checklist](#10-10-readiness-checklist)

---

## 1. Overview

### 1.1 Purpose

`xrpl-up` is a developer-facing CLI that makes it fast to set up, script against, and tear down XRPL environments. Its primary value is the **local sandbox** — a fully isolated rippled node running in Docker, pre-funded with accounts, with all modern amendments enabled, requiring no internet connectivity. A secondary role is providing ergonomic wrappers for common XRPL transaction types (AMM, NFT, MPT, DEX, escrow, channels, etc.) against any network.

### 1.2 Target Audience

| Audience | Primary use |
|---|---|
| XRPL dApp developer | Rapid local iteration; scripting; testing before testnet |
| Integration test author | CI/CD sandbox (deterministic start, instant ledger close, no rate limits) |
| XRPL protocol engineer | Reproducing bugs, testing amendments, fork-mode balance snapshots |
| Developer Experience team | Demo tooling; example scaffolding; onboarding new contributors |

### 1.3 Design Principles

1. **Zero-config fast start** — `xrpl-up node --local` works out of the box. No config file required.
2. **Ephemerality by default** — the sandbox resets to a clean slate on every start unless `--persist` is specified.
3. **Developer trust, not production security** — keys and seeds are printed to stdout by design. Production workflows should use their own key management.
4. **Composable** — `xrpl-up` is both a CLI and a library (`src/index.ts`). Scripts run via `xrpl-up run` import from `xrpl-up` directly.
5. **Mainnet guardrails** — destructive / irreversible commands check `isMainnet()` and refuse or warn accordingly.
6. **Wrapping, not replacing** — XRPL interaction commands (`wallet`, `account`, `payment`, `mptoken`, `trust`, etc.) are convenience tooling for demos and quick experiments, not a full RPC client. Complex flows should use `xrpl.js` directly.

### 1.4 What It Is NOT

- Not a production deployment tool for rippled
- Not a key management or custody solution
- Not a full XRPL explorer or wallet
- Not a complete rippled RPC binding (many transaction types are not wrapped)
- Not a standalone test framework (no assertions, no test runner)

---

## 2. Architecture

### 2.1 Component Map

```
xrpl-up CLI (src/cli.ts)
    │
    ├─ Core utilities (src/core/)
    │       config.ts        — loadConfig, DEFAULT_CONFIG, resolveNetwork, isMainnet
    │       compose.ts       — Docker Compose file generation, composeUp/Down
    │       network.ts       — NetworkManager (xrpl.js Client wrapper)
    │       wallet-store.ts  — WalletStore (JSON file persistence)
    │
    ├─ Sandbox commands (src/commands/)
    │       node.ts, stop.ts, reset.ts, snapshot.ts, config.ts,
    │       accounts.ts, faucet.ts, run.ts, init.ts, logs.ts, status.ts,
    │       amendment.ts
    │
    ├─ XRPL interaction commands (src/cli/commands/)
    │       wallet/, account/, payment.ts, trust.ts, offer.ts, amm.ts,
    │       nft.ts, mptoken.ts, escrow.ts, check.ts, channel.ts,
    │       ticket.ts, clawback.ts, credential.ts, did.ts, multisig.ts,
    │       oracle.ts, deposit-preauth.ts, permissioned-domain.ts, vault.ts
    │
    └─ Faucet server (src/faucet-server/)
            server.ts   — HTTP server that funds accounts from the genesis wallet
            Dockerfile  — Bundled and shipped with the npm package
            package.json
```

### 2.2 Local Sandbox Stack (Docker)

When `xrpl-up node --local` is invoked, a Docker Compose stack is written to `~/.xrpl-up/docker-compose.yml` and brought up with `docker compose up --build -d`.

```
Host
 ├─ ws://localhost:6006  ──── rippled container (standalone mode, no peers)
 └─ http://localhost:3001 ─── faucet container (Node.js HTTP server)
          │
          └── connects to rippled via ws://host.docker.internal:6006
              (extra_hosts: host.docker.internal → host-gateway)
```

**Service: `rippled`**
- Image: `xrpllabsofficial/xrpld:latest` (overridable via `--image`)
- Default entrypoint: stock rippled entrypoint; starts with `-a --start`
- Ports: `6006:6006` (WebSocket, admin access)
- Config mount: `~/.xrpl-up/rippled.cfg → /config/rippled.cfg:ro`
- Validators mount: `~/.xrpl-up/validators.txt → /config/validators.txt:ro`
- Healthcheck: TCP probe on port 6006, every 2 s, up to 20 retries, 5 s start period
- Persist mode: named volume `xrpl-up-local-db` → `/var/lib/rippled/db`
- ARM64 host: `platform: linux/amd64` injected automatically (Rosetta 2)

**Service: `faucet`**
- Built from `dist/faucet-server/` at startup (`--build`)
- Port: `3001:3001`
- Depends on `rippled` healthcheck (only starts after rippled is TCP-ready)
- Connects to rippled via `host.docker.internal` (not via Docker bridge)
- Network: `xrpl-net` (bridge driver) shared with rippled

**`--exit-on-crash` mode (rippled service only)**

When `--exit-on-crash` is set, two changes are applied to the Docker Compose:

1. `restart: "no"` — Docker will not recycle the container on exit
2. Custom entrypoint:
   ```yaml
   entrypoint: ["/bin/sh", "-c",
     "/opt/ripple/bin/rippled --conf /config/rippled.cfg -a --start
      2>/tmp/rip.err & RPID=$! ;
      wait $RPID ; EC=$? ;
      cat /tmp/rip.err >&2 ;
      grep -qF 'Logic error:' /tmp/rip.err 2>/dev/null && exit 134 ;
      exit $EC"]
   ```

**Rationale for the entrypoint design** (three-layer root-cause fix):
1. The stock entrypoint uses `exec rippled`, making rippled PID 1. Linux silently drops unhandled signals (including SIGABRT) for PID 1, so `std::abort()` crashes the process internally but the container does not exit.
2. Running rippled as a child of `/bin/sh` (via `&`) fixes PID 1 immunity. However, the release build of rippled 3.1.1 exits with code 0 after `abort()` (likely an atexit handler or custom terminate handler), rather than dying via SIGABRT.
3. To work around this: rippled's stderr is redirected to `/tmp/rip.err`; after `wait`, the shell checks that file for the `Logic error:` pattern and exits 134 if found, regardless of the process exit code.

### 2.3 Persistent State Layout (`~/.xrpl-up/`)

```
~/.xrpl-up/
├── docker-compose.yml           # Regenerated on every 'xrpl-up node --local' run
├── rippled.cfg                  # Auto-generated (or custom via --config; never overwritten)
├── validators.txt               # Companion to rippled.cfg (written once if missing)
├── local-accounts.json          # WalletStore for local network
├── testnet-accounts.json        # WalletStore for testnet
├── devnet-accounts.json         # WalletStore for devnet
└── snapshots/
    ├── <name>.tar.gz            # Compressed NuDB ledger volume (--persist mode only)
    └── <name>-accounts.json     # Account store at snapshot time
```

**WalletStore file format** (`{network}-accounts.json`):
```json
[
  {
    "index": 0,
    "address": "rXXX...",
    "seed": "sXXX...",
    "privateKey": "00XXX...",
    "publicKey": "03XXX...",
    "balance": 1000,
    "forked": false
  }
]
```
- `forked: true` for accounts imported from a remote ledger (no known seed)
- File is written atomically after each `add()` call

**Named Docker volume**: `xrpl-up-local-db` (only created in `--persist` mode). Contains the NuDB ledger database at `/var/lib/rippled/db`.

### 2.4 Public Library API (`src/index.ts`)

`xrpl-up` is dual-use: CLI and importable library. Scripts run via `xrpl-up run` import from the `xrpl-up` package.

**Exports:**

| Export | Kind | Description |
|---|---|---|
| `loadConfig()` | function | Loads `xrpl-up.config.js/.json/.xrpl-up.json`; falls back to `DEFAULT_CONFIG` |
| `resolveNetwork(config, name?)` | function | Returns `{ name, config: NetworkConfig }` for a named network |
| `isMainnet(networkName, networkConfig)` | function | Returns `true` if the network is mainnet (by name or URL pattern) |
| `DEFAULT_CONFIG` | const | Built-in network definitions (local/testnet/devnet/mainnet) |
| `NetworkManager` | class | Thin wrapper over `xrpl.Client` with connect/disconnect/subscribe |
| `WalletStore` | class | JSON-backed account store; `add()`, `all()`, `clear()`, `toWallet()`, `addForked()` |
| `getRunContext()` | function | Returns `{ networkKey, networkUrl, networkName }` from injected env vars |
| `StoredAccount` | type | Shape of a stored account |
| `XrplUpConfig` | type | Full config shape |
| `NetworkConfig` | type | `{ url: string; name?: string }` |
| `AccountsConfig` | type | `{ count?: number }` |
| `ServerInfo` | type | `{ ledgerIndex, networkId?, completeLedgers?, buildVersion? }` |

**`getRunContext()` usage inside `xrpl-up run` scripts:**
```ts
import { getRunContext, WalletStore } from 'xrpl-up';
const { networkKey, networkUrl, networkName } = getRunContext();
const store = new WalletStore(networkKey);
```

---

## 3. Supported Networks

| Key | WebSocket URL | Faucet | Notes |
|---|---|---|---|
| `local` | `ws://localhost:6006` | `http://localhost:3001` (genesis wallet, no rate limit) | Requires Docker |
| `testnet` | `wss://s.altnet.rippletest.net:51233` | XRPL public testnet faucet | Rate limited |
| `devnet` | `wss://s.devnet.rippletest.net:51233` | XRPL public devnet faucet | Rate limited; may include pre-release amendments |
| `mainnet` | `wss://xrplcluster.com` | None | No faucet; most mutation commands refuse to run |

**Custom network:** Any additional named network can be added to `xrpl-up.config.js`. Custom networks behave identically to built-ins for read-only commands. Faucet commands only support `local`, `testnet`, and `devnet`.

**`isMainnet()` detection rules:**
- Network name is `"mainnet"`, **or**
- URL contains `xrplcluster.com`, `s1.ripple.com`, or `s2.ripple.com`

---

## 4. Command Reference

### 4.1 Taxonomy

`xrpl-up` has **34 top-level commands**:

| Category | Commands |
|---|---|
| Sandbox lifecycle | `node`, `stop`, `reset` |
| State inspection | `accounts`, `status`, `logs` |
| Scripting & scaffolding | `run`, `init` |
| State management | `snapshot`, `config`, `faucet` |
| Amendments | `amendment` |
| Wallets & accounts | `wallet`, `account` |
| Payments | `payment` |
| Token standards | `amm`, `nft`, `mptoken` |
| Exchange | `offer`, `trust`, `escrow`, `check`, `channel` |
| Account management | `clawback`, `ticket`, `deposit-preauth`, `multisig` |
| Identity & compliance | `credential`, `did`, `oracle`, `permissioned-domain`, `vault` |

### 4.2 Global Flags

| Flag | Description |
|---|---|
| `-v, --version` | Print version and exit |
| `--help` | Print help for any command or subcommand |
| `--node <url\|name>` | XRPL node for interaction commands: `mainnet`, `testnet` (default), `devnet`, or a raw WebSocket URL (e.g. `ws://localhost:6006`). Set via `XRPL_NODE` env var. Ignored by sandbox lifecycle commands. |

### 4.3 Command Inventory

#### `xrpl-up node`

Start an XRPL sandbox with pre-funded accounts.

| Flag | Default | Description |
|---|---|---|
| `--local` | — | Run a local rippled node via Docker |
| `-n, --network <network>` | `testnet` | Connect to testnet or devnet (ignored with `--local`) |
| `-a, --accounts <n>` | `10` | Number of accounts to pre-fund (default `0` with `--fork`) |
| `--image <image>` | `xrpllabsofficial/xrpld:latest` | rippled Docker image (local only) |
| `--ledger-interval <ms>` | `1000` | Auto-advance ledger every N ms (local only) |
| `--no-auto-advance` | — | Disable automatic ledger closing |
| `--persist` | off | Keep ledger state and accounts across restarts (local only) |
| `--fork` | — | Fork XRP balances from a remote network (requires `--local`) |
| `--fork-accounts <addrs>` | — | Comma-separated addresses to fork |
| `--add-accounts-from-ledger <n>` | — | Scan ledger N for active accounts; add them to the fork |
| `--fork-at-ledger <n>` | latest | Ledger index to snapshot balances from |
| `--fork-source <url>` | `wss://xrplcluster.com` | WebSocket URL of network to fork from |
| `--detach` | — | Start in background and exit (for CI/CD) |
| `--no-secrets` | — | Suppress seeds and private keys from stdout (auto-enabled with `--detach`) |
| `--debug` | — | Enable debug-level rippled logging |
| `--config <path>` | — | Custom `rippled.cfg` (local only; skips auto-generation) |
| `--exit-on-crash` | — | Exit with code 134 when rippled crashes; disables auto-restart |

#### `xrpl-up stop`

Stop the local Docker sandbox stack. No flags.

#### `xrpl-up reset`

Wipe all local sandbox state.

| Flag | Default | Description |
|---|---|---|
| `--snapshots` | off | Also delete all saved snapshots |

Removes: running containers (`docker compose down`), the `xrpl-up-local-db` volume, `~/.xrpl-up/local-accounts.json`. With `--snapshots`: also removes `~/.xrpl-up/snapshots/`.

#### `xrpl-up accounts`

List funded accounts with live XRP balances.

| Flag | Default | Description |
|---|---|---|
| `-n, --network <network>` | `testnet` | Network to query |
| `--local` | — | Show accounts for the local Docker sandbox |
| `--address <address>` | — | Query a specific address (bypasses wallet store) |

#### `xrpl-up faucet`

Fund a new or existing account via faucet.

| Flag | Default | Description |
|---|---|---|
| `-n, --network <network>` | `testnet` | Target network: `local`, `testnet`, `devnet` |
| `--local` | — | Deprecated alias for `--network local` |
| `-s, --seed <seed>` | — | Seed to fund (omit to generate a new wallet) |

Funded accounts are saved to `~/.xrpl-up/{network}-accounts.json`.

#### `xrpl-up run <script> [scriptArgs...]`

Run a TypeScript or JavaScript script against an XRPL network.

| Flag | Default | Description |
|---|---|---|
| `-n, --network <network>` | `testnet` | Network |
| `--local` | — | Alias for `--network local` |

TypeScript resolution order: `./node_modules/.bin/tsx` → `./node_modules/.bin/ts-node` → `npx tsx`.

Injected env vars: `XRPL_NETWORK`, `XRPL_NETWORK_URL`, `XRPL_NETWORK_NAME`.

Additional CLI arguments after the script path are forwarded to the script via `process.argv`.

#### `xrpl-up init [directory]`

Scaffold a new XRPL project. Prompts for project name and default network. No flags.

#### `xrpl-up status`

Show rippled server info and faucet health.

| Flag | Default | Description |
|---|---|---|
| `-n, --network <network>` | `testnet` | Network |
| `--local` | — | Show status for the local Docker sandbox |

#### `xrpl-up logs [service]`

Stream Docker Compose logs. `service`: `rippled` or `faucet`. Omit for all services.

#### `xrpl-up snapshot`

Subcommands: `save <name>`, `restore <name>`, `list`.

| Subcommand | Description |
|---|---|
| `save <name>` | Save current ledger state as a named snapshot |
| `restore <name>` | Restore ledger state from a named snapshot |
| `list` | List saved snapshots with size and date |

Requires `--persist` mode. Each snapshot saves both the NuDB volume and `local-accounts.json`.

#### `xrpl-up config`

Subcommands: `export`, `validate <file>`.

| Subcommand | Flags | Description |
|---|---|---|
| `export` | `--output <file>`, `--debug` | Print the default `rippled.cfg` to stdout or a file |
| `validate <file>` | — | Validate a `rippled.cfg` for xrpl-up compatibility |

#### `xrpl-up amm`

Subcommands: `create <asset1> <asset2>`, `info [asset1] [asset2]`.

Asset format: `XRP` or `CURRENCY.rIssuerAddress`.

| Subcommand | Key Flags | Description |
|---|---|---|
| `create <asset1> <asset2>` | `--amount1 <n>`, `--amount2 <n>`, `--fee <pct>`, `--local`, `-n` | Create an AMM pool with fresh funded accounts |
| `info [asset1] [asset2]` | `--account <addr>`, `--local`, `-n` | Show pool state: reserves, LP supply, fee, AMM account |

#### `xrpl-up nft`

Subcommands: `mint`, `list`, `offers <nftokenId>`, `burn <nftokenId>`, `sell <nftokenId> <price>`, `accept <offerId>`.

| Subcommand | Required | Key Flags |
|---|---|---|
| `mint` | — | `--uri`, `--transferable`, `--burnable`, `--taxon`, `--transfer-fee`, `-s` |
| `list` | — | `--account` |
| `offers <nftokenId>` | `nftokenId` | — |
| `burn <nftokenId>` | `nftokenId`, `-s` | — |
| `sell <nftokenId> <price>` | `nftokenId`, `price`, `-s` | Price format: `"1"` = 1 XRP, `"10.USD.rIssuer"` = IOU |
| `accept <offerId>` | `offerId` | `-s` (optional on local), `--buy` |

All subcommands share `--local` / `-n, --network`.

#### `xrpl-up channel`

Subcommands: `create <destination> <amount>`, `list`, `fund <channelId> <amount>`, `claim <channelId>`, `sign <channelId> <amount>`, `verify <channelId> <amount> <signature> <publicKey>`.

| Subcommand | Required | Key Flags |
|---|---|---|
| `create` | `destination`, `amount` | `--settle-delay <s>` (default 86400), `-s` |
| `list` | — | `--account` |
| `fund` | `channelId`, `amount`, `-s` | — |
| `claim` | `channelId`, `-s` | `--amount`, `--signature`, `--public-key`, `--close` |
| `sign` | `channelId`, `amount`, `-s` | — (no network call; local signing only) |
| `verify` | `channelId`, `amount`, `signature`, `publicKey` | — (no network call; local verification only) |

`sign` and `verify` have no `--local`/`--network` flag — they operate locally on the channel ID and amount.

#### `xrpl-up mptoken`

Renamed from `mpt`. Two subcommand groups: `issuance` and `authorize`.

**`mptoken issuance` subcommands:** `create`, `destroy <id>`, `set <id>`, `get <id>`, `list <address>`.

| Subcommand | Key Flags |
|---|---|
| `issuance create` | `--max-amount`, `--asset-scale`, `--transfer-fee`, `--metadata`, `--seed/--mnemonic/--account` |
| `issuance destroy <id>` | `--seed` |
| `issuance set <id>` | `--lock`, `--unlock`, `--holder` |
| `issuance get <id>` | — |
| `issuance list <address>` | — |
| `authorize <id>` | `--holder`, `--unauthorize`, `--seed` |

For sending MPT tokens use `payment --amount "<amount>/<issuanceId>"`. For querying held MPT balances use `account mptokens`.

#### `xrpl-up offer`

Subcommands: `create <pays> <gets>`, `cancel <sequence>`, `list`.

| Subcommand | Required | Key Flags |
|---|---|---|
| `create` | `pays`, `gets` | `-s`, `--passive`, `--sell`, `--immediate-or-cancel`, `--fill-or-kill` |
| `cancel` | `sequence`, `-s` | — |
| `list` | — | `--account` |

Asset format: `"5"` = 5 XRP, `"10.USD.rIssuer"` = IOU (same format as AMM).

#### `xrpl-up trust`

Renamed from `trustline`. Single subcommand `set` with explicit flag options.

| Subcommand | Required flags | Key optional flags |
|---|---|---|
| `set` | `--currency`, `--issuer`, `--limit`, key material | `--no-ripple`, `--clear-no-ripple`, `--freeze`, `--unfreeze`, `--auth` |

`trustline freeze` → `trust set --freeze`. `trustline issuer-defaults` → `account set defaultRipple`. Query: `account trust-lines <address>` (replaces `trustline list`).

#### `xrpl-up escrow`

Subcommands: `create <destination> <amount>`, `finish <owner> <sequence>`, `cancel <owner> <sequence>`, `list`.

Time format for `--finish-after` / `--cancel-after` / `--expiry`: `+30m`, `+1h`, `+1d`, `+7d`, or Unix timestamp.

| Subcommand | Required | Key Flags |
|---|---|---|
| `create` | `destination`, `amount` | `-s`, `--finish-after`, `--cancel-after`, `--condition`, `--destination-tag` |
| `finish` | `owner`, `sequence`, `-s` | `--fulfillment`, `--condition` |
| `cancel` | `owner`, `sequence`, `-s` | — |
| `list` | — | `--account` |

#### `xrpl-up check`

Subcommands: `create <destination> <sendMax>`, `cash <checkId> [amount]`, `cancel <checkId>`, `list`.

| Subcommand | Required | Key Flags |
|---|---|---|
| `create` | `destination`, `sendMax`, `-s` | `--expiry`, `--destination-tag` |
| `cash` | `checkId`, `-s` | `[amount]` or `--deliver-min` |
| `cancel` | `checkId`, `-s` | — |
| `list` | — | `--account` |

#### `xrpl-up account set`

Replaces `accountset set/clear`. Flag names unchanged: `requireDest`, `requireAuth`, `disallowXRP`, `disableMaster`, `defaultRipple`, `depositAuth`, `allowClawback`.

```bash
xrpl-up account set requireDest --node ws://localhost:6006 --seed s...
xrpl-up account set requireDest --clear --node ws://localhost:6006 --seed s...
```

`accountset signer-list` → `multisig` command. `accountset info` → `account info`.

#### Transaction history

`tx` has been removed. Use `account transactions`:

```bash
xrpl-up account transactions <address> --node ws://localhost:6006
```

#### `xrpl-up deposit-preauth`

Renamed from `depositpreauth`. Subcommands: `set`, `list <address>`.

| Subcommand | Key Flags |
|---|---|
| `set` | `--authorize <addr>` or `--unauthorize <addr>` (mutually exclusive), `--seed` |
| `list <address>` | — |

#### `xrpl-up ticket`

Subcommands: `create <count>`, `list [account]`.

| Subcommand | Key Flags |
|---|---|
| `create <count>` | `-s`, `--auto-fund` (local only, alternative to `-s`) |
| `list [account]` | — |

#### `xrpl-up clawback`

Subcommands: `iou <amount> <currency> <holder>`, `mpt <issuanceId> <holder> <amount>`.

| Subcommand | Required |
|---|---|
| `iou` | `amount`, `currency`, `holder`, `-s` |
| `mpt` | `issuanceId`, `holder`, `amount`, `-s` |

Prerequisites: for IOU clawback, issuer must have `asfAllowTrustLineClawback` set (via `account set allowClawback`). For MPT clawback, issuance must have been created with `--can-clawback`.

#### `xrpl-up wallet`

Manages local key pairs in `~/.xrpl/keystore/`. Subcommands: `new`, `new-mnemonic`, `address`, `private-key`, `public-key`, `import`, `list`, `remove`, `decrypt-keystore`, `change-password`, `sign`, `verify`, `alias`, `fund`.

Key material flags on signing subcommands: `--seed`, `--mnemonic`, `--account <alias-or-address>`, `--password`, `--keystore <dir>`.

#### `xrpl-up account` (query subcommands)

Query subcommands: `info`, `balance`, `transactions`, `offers`, `trust-lines`, `channels`, `nfts`, `mptokens`. All accept an address positional arg and `--node`.

Mutation subcommands: `set` (replaces `accountset set/clear`), `set-regular-key`, `delete`.

#### `xrpl-up payment`

Alias `send`. Sends a Payment transaction supporting XRP, IOU, and MPT amounts.

Amount formats: `"10"` = 10 XRP, `"10/USD/rIssuer"` = IOU, `"500/<48-hex-issuanceId>"` = MPT.

Required: `--to <dest>`, `--amount <amount>`. Key material: `--seed / --mnemonic / --account`.

#### `xrpl-up multisig`

Manages signer lists (replaces `accountset signer-list`).

#### `xrpl-up credential`

Manages on-ledger credentials.

#### `xrpl-up did`

Manages Decentralized Identifiers.

#### `xrpl-up oracle`

Manages price oracle objects.

#### `xrpl-up permissioned-domain`

Manages Permissioned Domain objects (XLS-80d).

#### `xrpl-up vault`

Manages vault objects.

#### `xrpl-up amendment`

Subcommands: `list`, `info <nameOrHash>`, `enable <nameOrHash>`, `disable <nameOrHash>`, `sync`.

| Subcommand | Key Flags | Local only? |
|---|---|---|
| `list` | `--diff <network>`, `--disabled` | No |
| `info <nameOrHash>` | — | No |
| `enable <nameOrHash>` | — | Yes |
| `disable <nameOrHash>` | — | Yes |

---

## 5. Feature Specifications

### 5.1 Local Node Lifecycle

**`xrpl-up node --local`** startup sequence:
1. Check Docker daemon is running (`docker info`)
2. Generate `~/.xrpl-up/rippled.cfg` (unless `--config` is provided)
3. Write `~/.xrpl-up/validators.txt` (if missing)
4. Generate and write `~/.xrpl-up/docker-compose.yml`
5. If NOT `--persist`: run `docker compose down` first (clean slate)
6. Run `docker compose up --build -d`
7. Wait for port 6006 to accept TCP connections (30 s timeout)
8. Wait for port 3001 to accept TCP connections (30 s timeout)
9. Fund N accounts (default 10) via the local faucet
10. Save accounts to `~/.xrpl-up/local-accounts.json`
11. Print account addresses and seeds (unless `--no-secrets` or `--detach`)
12. If foreground: subscribe to ledger events and stream ledger close notifications to stdout. If `--exit-on-crash`: also start a `docker wait` watcher for exit code propagation.

**`xrpl-up stop`**: runs `docker compose down` on the project `xrpl-up-local`.

**`xrpl-up reset`**: runs `docker compose down`, removes the `xrpl-up-local-db` volume, deletes `~/.xrpl-up/local-accounts.json`. With `--snapshots`, also deletes `~/.xrpl-up/snapshots/`.

### 5.2 Account Funding (Faucet / WalletStore)

**Local faucet** (`src/faucet-server/server.ts`):
- Genesis wallet: `rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh` / seed `snoPBrXtMeMyMHUVTgbuqAfg1SUTb` / 100 billion XRP
- Fund amount: 1000 XRP per request (configurable via `FUND_AMOUNT_XRP` env var)
- Endpoints:
  - `POST /faucet` — body: `{ destination?: string }`. Returns `{ address, seed?, balance }`. `seed` is omitted if `destination` was provided (caller already has it).
  - `GET /health` — returns `{ status: "ok" }`
- After funding, calls `ledger_accept` to close the ledger (auto-advance also runs independently if `LEDGER_INTERVAL_MS > 0`)
- Uses a singleton `xrpl.Client` connection; reconnects automatically on error

**Testnet/Devnet faucet**: calls the official XRPL faucet API endpoint for the target network.

**WalletStore**:
- File: `~/.xrpl-up/{networkKey}-accounts.json`
- `add(wallet, balance)` — saves a newly funded wallet
- `addForked(address, balance)` — saves a balance-only entry for fork mode (no seed)
- `toWallet(stored)` — returns an `xrpl.Wallet` or `null` for forked accounts
- `all()` — returns all stored accounts
- `clear()` — deletes the JSON file and empties in-memory array

### 5.3 Scripting (`run` command)

- TypeScript scripts are executed directly — no build step required
- TypeScript runner resolution: local `tsx` → local `ts-node` → `npx tsx`
- JavaScript scripts are run with `node`
- Three environment variables are injected: `XRPL_NETWORK`, `XRPL_NETWORK_URL`, `XRPL_NETWORK_NAME`
- Additional CLI arguments after the script path are passed through as `process.argv`
- Exit code is forwarded: non-zero exits from the script cause `xrpl-up run` to exit with the same code

### 5.4 Project Scaffolding (`init`)

Creates a project directory (defaults to current directory) with:
- `xrpl-up.config.js` — network configuration with the chosen default network
- `package.json` with `npm run node` / `npm run accounts` / `npm run stop` convenience scripts
- `tsconfig.json` with `esModuleInterop: true`, `ts-node` / `tsx` settings
- `.gitignore`
- `scripts/` containing example scripts:
  - `example-payment.ts` — XRP payment with balance verification
  - `example-token.ts` — IOU issuance (DefaultRipple + TrustSet + Payment)
  - `example-dex.ts` — DEX offer (create, list, cancel / fill depending on network)
  - `example-nft.ts` — NFT full lifecycle (mint → sell → accept → burn)
  - `example-mpt.ts` — MPT issuance, opt-in, transfer
  - `example-amm.ts` — AMM pool creation and swap (local mode only)

When `local` is the default network, example scripts use the local faucet endpoint instead of `client.fundWallet()`.

### 5.5 Snapshots

Snapshots capture the full state of a `--persist` session: ledger database + account store.

**`snapshot save <name>`**:
1. Stops the `rippled` service (via `docker compose stop rippled`)
2. Runs `docker run --rm -v xrpl-up-local-db:/data -v ... busybox tar czf /out/<name>.tar.gz -C /data .`
3. Copies `~/.xrpl-up/local-accounts.json` → `~/.xrpl-up/snapshots/<name>-accounts.json`
4. Restarts `rippled` and `faucet` services

**`snapshot restore <name>`**:
1. Stops the entire stack (`docker compose down`)
2. Removes the existing `xrpl-up-local-db` volume
3. Re-creates the volume and extracts `<name>.tar.gz` into it
4. Copies `<name>-accounts.json` → `~/.xrpl-up/local-accounts.json`
5. Restarts the stack (`docker compose up --build -d`)

**`snapshot list`**: reads `~/.xrpl-up/snapshots/`, prints name, file size, modification date, and `+accounts` tag if the sidecar JSON exists.

**Constraint**: Requires `--persist` mode. In ephemeral mode there is no named volume to snapshot.

### 5.6 Fork Mode

Fork mode seeds the local sandbox with real account balances from a remote network. Useful for reproducing mainnet state locally.

**Flags:**
- `--fork` — enables fork mode (requires `--local`)
- `--fork-accounts <addrs>` — comma-separated addresses to include
- `--add-accounts-from-ledger <n>` — scan ledger N for active accounts and include them all
- `--fork-at-ledger <n>` — ledger index to snapshot balances from (defaults to N-1 when `--add-accounts-from-ledger` is used; otherwise latest)
- `--fork-source <url>` — source network WebSocket URL (default: `wss://xrplcluster.com`)

Forked accounts have `forked: true` in the WalletStore and no known seed. The genesis wallet funds them locally to match the snapshotted balance.

### 5.7 Amendment Management

**Context**: The local sandbox's `rippled.cfg` includes an `[amendments]` stanza that force-enables amendments at genesis (first `--start`). This stanza lists all amendments known to rippled 3.1.1 by hash and name. Approximately 70+ amendments are pre-enabled.

**`amendment list`**:
- Calls `feature` RPC on the target network
- Displays each amendment: hash prefix, name, enabled/supported status
- `--disabled`: filter to only amendments that are supported but not yet enabled
- `--diff <network>`: shows a side-by-side comparison between two networks

**`amendment info <nameOrHash>`**:
- Looks up by exact name or hash prefix
- Shows: full hash, name, enabled status, supported status, vote count

**`amendment enable <nameOrHash>`** (local only):
- Appends `<hash> <name>` to `~/.xrpl-up/genesis-amendments.txt`
- Regenerates `rippled.cfg` so the amendment is present in the `[amendments]` genesis stanza
- Prompts to reset and restart (a full node reset is required for the genesis config to take effect)
- `--auto-reset`: skips the prompt and resets immediately

**`amendment disable <nameOrHash>`** (local only):
- Removes the amendment hash from `~/.xrpl-up/genesis-amendments.txt`
- Regenerates `rippled.cfg`
- Only works for amendments added via `amendment enable`; built-in genesis amendments cannot be removed
- Prompts to reset and restart (same requirement as enable)

### 5.8 AMM (XLS-30)

AMM is pre-enabled at genesis via the `[amendments]` stanza (no voting required). The `AMM` amendment hash is `8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455`.

**`amm create <asset1> <asset2>`** is a full setup wizard:
1. Funds two fresh wallets via faucet
2. If either asset is a non-XRP currency: creates an issuer wallet, sets DefaultRipple, creates trust lines on the LP wallet, issues the currency
3. Submits `AMMCreate` with the specified amounts and fee
4. Prints the resulting AMM account address and a ready-to-run `amm info` command

**`amm info`** queries `amm_info` RPC: returns pool reserves, LP token supply, trading fee, and AMM account address.

### 5.9 NFT (XLS-20)

The `NonFungibleTokensV1_1` amendment is pre-enabled (`32A122F1352A4C7B3A6D790362CC34749C5E57FCE896377BFDC6CCD14F6CD627`).

Supported operations: mint, list, offers (buy/sell), sell offer creation, offer acceptance, burn. URI values are automatically hex-encoded before submission.

**Transfer fee** is specified as a percentage (0–50); internally converted to the on-chain basis point format (0–50000 in hundredths of a percent).

### 5.10 MPT (XLS-33)

The `MPTokensV1` amendment is pre-enabled (`950AE2EA4654E47F04AA8739C0B214E242097E802FD372D24047A89AB1F5EC38`). Requires `xrpl.js` ≥ 4.1.0 (xrpl-up ships `xrpl ^4.6.0`).

Supported operations: create issuance, destroy, authorize holder, set lock/unlock, query info, pay tokens, list issuances or holdings.

**Authorization flow** (when `--require-auth` is set):
1. Issuer side: `mptoken authorize <id> --holder <addr>` — grants permission
2. Holder side: `mptoken authorize <id>` (no `--holder`) — opts in

### 5.11 DEX Offers

`offer create <pays> <gets>` submits an `OfferCreate` transaction. Supported flags map directly to XRPL offer flags: `--passive` (tfPassive), `--sell` (tfSell), `--immediate-or-cancel` (tfImmediateOrCancel), `--fill-or-kill` (tfFillOrKill).

`offer cancel <sequence>` submits `OfferCancel` by offer sequence number.

`offer list` queries `account_offers`.

### 5.12 Trust Lines

`trust set` submits `TrustSet`. `trust set --freeze/--unfreeze` sets or clears `lsfFreeze` via `TrustSet`. `account set defaultRipple` sets or clears `asfDefaultRipple` via `AccountSet`. `account trust-lines` queries `account_lines`.

### 5.13 Escrow

`escrow create` submits `EscrowCreate`. Time expressions (`+1h`, `+7d`, etc.) are parsed to XRPL ripple epoch timestamps (seconds since 2000-01-01). `escrow finish` submits `EscrowFinish`; crypto-condition escrows require `--fulfillment` and `--condition` hex strings. `escrow cancel` submits `EscrowCancel` after `CancelAfter` has elapsed.

### 5.14 Checks

`check create` submits `CheckCreate`. `sendMax` accepts both XRP amounts (`"5"`) and IOU amounts (`"10.USD.rIssuer"`). `check cash` submits `CheckCash` with either an exact amount or `DeliverMin`. `check cancel` submits `CheckCancel`.

### 5.15 Payment Channels

Full payment channel lifecycle: open (`PaymentChannelCreate`), fund (`PaymentChannelFund`), sign off-chain claims (pure local crypto, no network call), verify claim signatures, claim on-chain (`PaymentChannelClaim`), and close. The `sign` and `verify` subcommands use `xrpl.js` cryptographic utilities and produce no on-chain transactions.

Default `settle-delay`: 86400 seconds (1 day).

### 5.16 Tickets

`ticket create <count>` submits `TicketCreate` for 1–250 tickets. Returns the allocated `TicketSequence` numbers. To use a ticket: set `Sequence = 0` and `TicketSequence = <n>` in the transaction. `ticket list` queries account objects filtered to `Ticket` type.

### 5.17 DepositPreauth

Manages `DepositPreauth` ledger objects. Required when the target account has the `depositAuth` flag set (`account set depositAuth`). `deposit-preauth set --authorize` submits `DepositPreauth` with `Authorize` field; `--unauthorize` uses `Unauthorize` field. `deposit-preauth list` queries account objects filtered to `DepositPreauth` type.

### 5.18 AccountSet / Signer Lists

`account set` maps human-readable flag names to `SetFlag`/`ClearFlag` values in `AccountSet`. `multisig` submits `SignerListSet`. `account info` queries `account_info` and `account_objects` to show flags and signer list.

**Important ordering constraint**: Set a signer list *before* disabling the master key (`disableMaster`). Reversing the order permanently locks the account.

### 5.19 Clawback

`clawback iou` submits `Clawback` with an `Amount` of type IOU. The issuer must have `asfAllowTrustLineClawback` set (via `account set allowClawback`). This flag is irreversible.

`clawback mpt` submits `Clawback` with an `MPTAmount`. The issuance must have been created with `--can-clawback` (sets `tfMPTCanClawback`).

### 5.20 Transaction History

`account transactions [address]` queries `account_tx` RPC. Displays transaction type, result code, date, and ledger index. Default account: first account in the local wallet store. Default limit: 20.

---

## 6. Configuration

### 6.1 Config File Lookup

`loadConfig()` searches for config files in the current working directory in this order:

1. `xrpl-up.config.js` (CommonJS module, `module.exports` or `module.exports.default`)
2. `xrpl-up.config.json`
3. `.xrpl-up.json`

The first file found is loaded and **merged** with `DEFAULT_CONFIG`. Missing keys fall back to defaults.

### 6.2 Config Schema

```ts
interface XrplUpConfig {
  networks: Record<string, NetworkConfig>;  // merged with built-in networks
  defaultNetwork: string;                   // default: "testnet"
  accounts?: {
    count?: number;                         // default: 10
  };
}

interface NetworkConfig {
  url: string;   // WebSocket URL
  name?: string; // Display name (optional)
}
```

### 6.3 Default Values

```js
// DEFAULT_CONFIG
{
  networks: {
    local:   { url: 'ws://localhost:6006',                   name: 'Local Sandbox' },
    testnet: { url: 'wss://s.altnet.rippletest.net:51233',   name: 'XRPL Testnet' },
    devnet:  { url: 'wss://s.devnet.rippletest.net:51233',   name: 'XRPL Devnet' },
    mainnet: { url: 'wss://xrplcluster.com',                 name: 'XRPL Mainnet' },
  },
  defaultNetwork: 'testnet',
  accounts: { count: 10 },
}
```

Custom networks added in `xrpl-up.config.js` are merged in; they do not replace the built-ins.

### 6.4 Environment Variables (Faucet Server)

The faucet container reads these at startup:

| Variable | Default | Description |
|---|---|---|
| `RIPPLED_WS_URL` | `ws://rippled:80` | WebSocket URL for rippled (set to `ws://host.docker.internal:6006` by compose) |
| `FAUCET_PORT` | `3001` | HTTP port to listen on |
| `FUND_AMOUNT_XRP` | `1000` | XRP to send per funding request |
| `LEDGER_INTERVAL_MS` | `0` | Auto-advance interval; `0` disables auto-advance |

### 6.5 Custom rippled.cfg

Use `xrpl-up config export --output my.cfg` as a starting point. Validate with `xrpl-up config validate my.cfg` before use. Pass to node with `--config my.cfg`.

**Blocking validation errors** (prevent node start):
- WebSocket port must be `6006`
- WebSocket `ip` must be `0.0.0.0`
- WebSocket `admin` must include `0.0.0.0`
- `[ssl_verify]` must be `0`
- `[node_db]` and `[database_path]` must be present

Companion `validators.txt` is looked up next to the custom config file; falls back to `~/.xrpl-up/validators.txt` if not found.

---

## 7. Exit Codes & Error Handling

### 7.1 Standard Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General error (unhandled exception, CLI usage error, script exit code) |
| `1` | `config validate` — blocking errors found |

### 7.2 `--exit-on-crash` Exit Code

| Code | Meaning |
|---|---|
| `134` | rippled crashed with `Logic error:` in stderr (SIGABRT equivalent) |
| `0` | rippled exited cleanly |
| `N` | rippled exited with code N (and no `Logic error:` found) |

When `--exit-on-crash` is active and the foreground process is running, a `docker wait <container>` watcher prints:
```
✗ rippled exited — code 134 (SIGABRT — process crashed)
```

### 7.3 Error Propagation

- CLI errors from subcommands: `console.error('\n  ' + msg)` then `process.exit(1)`
- Docker availability is checked before any command that requires Docker; throws a user-readable error if Docker is not running
- Network connect failures throw with the network URL in the message
- `loadConfig()` silently falls through to `DEFAULT_CONFIG` on any parse error

---

## 8. Security & Privacy

### 8.1 Key Handling

- Seeds and private keys are **printed to stdout by default** in local mode. This is intentional — local sandbox accounts have no real value.
- `--no-secrets` suppresses all seed/private key output.
- `--detach` automatically enables `--no-secrets` (no terminal to read from in CI).
- Seeds are stored in plaintext in `~/.xrpl-up/{network}-accounts.json`.

### 8.2 Mainnet Protection

`isMainnet()` checks network name and URL patterns. Commands that could cause financial loss on mainnet:
- Mutation commands (`faucet`, `amm create`, `nft mint`, etc.) check the active network; if mainnet is detected they either refuse entirely or require confirmation.
- The local genesis seed (`snoPBrXtMeMyMHUVTgbuqAfg1SUTb`) is only usable on the local sandbox. It controls 100B XRP that exist only in the isolated Docker container.

### 8.3 Local-Only Restrictions

- `amendment enable/disable/sync` — admin WebSocket access (port 6006 with `admin = 0.0.0.0`) — only meaningful on the local sandbox
- `snapshot save/restore` — requires Docker named volume `xrpl-up-local-db`; remote networks have no Docker volume
- `logs` — streams from Docker Compose; remote networks have no Docker stack

### 8.4 Docker Socket

`xrpl-up` invokes `docker` and `docker compose` via `execSync`/`spawn`. It does not mount or access the Docker socket programmatically — all Docker interaction is via the `docker` CLI.

---

## 9. Versioning & Compatibility

### 9.1 Node.js

Minimum required: **Node.js 18** (README stated; no `engines` field in `package.json` yet — see §10).

### 9.2 Docker

Required for all `--local` commands. Any Docker Engine version that supports Compose V2 (`docker compose` plugin) is sufficient. The tool calls `docker info` to verify availability before proceeding.

### 9.3 rippled Version Pinning Strategy

- Default image: `xrpllabsofficial/xrpld:latest`
- The `[amendments]` section in `rippled.cfg` lists amendments verified against **rippled 3.1.1**.
- Pinning to a specific tag (`--image xrpllabsofficial/xrpld:3.1.1`) is supported via `--image`.
- If a new rippled release adds amendments not in the `[amendments]` stanza, use `xrpl-up amendment enable <name> --local` to queue them for the next genesis start.

### 9.4 xrpl.js Compatibility

- Ships `xrpl ^4.6.0`
- MPT operations require `xrpl ≥ 4.1.0`

### 9.5 Versioning Policy (proposed for 1.0)

- `MAJOR`: breaking CLI changes (flag renames, subcommand restructuring, state format changes)
- `MINOR`: new commands, new flags, new network support
- `PATCH`: bug fixes, documentation, config defaults

---

## 10. 1.0 Readiness Checklist

### ✅ Present

- All 25 CLI commands implemented with subcommands and flags
- Comprehensive README with examples for every command
- Public library API (`src/index.ts`) with TypeScript types exported
- npm `files` array correctly set (`dist/`, `src/faucet-server/Dockerfile`, `src/faucet-server/package.json`)
- `bin` entry points correctly configured
- `main` + `types` fields set
- MIT license declared in `package.json`
- All amendments verified against rippled 3.1.1 baked into `rippled.cfg`
- ARM64 / Apple Silicon support (`platform: linux/amd64`)
- `--exit-on-crash` with correct exit code 134 propagation
- SPEC.md (this document)

### ❌ Missing / Incomplete

| Item | Priority | Notes |
|---|---|---|
| **Tests** | P0 | No test suite at all. Minimum: unit tests for `loadConfig`, `isMainnet`, `WalletStore`; integration tests for `composeUp`/`composeDown` |
| **CI/CD pipeline** | P0 | No `.github/workflows/` directory. Should run lint + tests on every PR |
| **`engines` field in `package.json`** | P1 | Add `"engines": { "node": ">=18" }` to prevent installation on unsupported Node versions |
| **`author` field in `package.json`** | P1 | Currently empty string |
| **`repository` field in `package.json`** | P1 | Required for npm page; currently absent |
| **npm publication** | P1 | README still shows installation-from-source-only instructions |
| **`CHANGELOG.md`** | P2 | No changelog for tracking breaking changes |
| **LICENSE file** | P2 | MIT is declared in `package.json` but no `LICENSE` file exists in the repo root |
| **TypeScript strict mode** | P2 | `tsconfig.json` should enable `strict: true` before 1.0 |
| **`tsconfig.json` `engines`-aligned `target`** | P2 | Verify `target` is consistent with Node 18 minimum |
| **`xrpl-up run` TypeScript runner fallback** | P3 | If neither local `tsx`/`ts-node` nor global `npx tsx` is available, the error is unclear |
| **Rate-limit handling for testnet/devnet faucet** | P3 | HTTP 429 from the public faucet surfaces as a raw JSON error; should have a friendly message |
| **Windows support** | P3 | Path separator handling and `docker compose` invocation may have edge cases on Windows |

### Proposed 1.0 Definition of Done

- [ ] At least 80% unit test coverage on core modules (`config.ts`, `wallet-store.ts`, `compose.ts`)
- [ ] At least one integration test per command category (lifecycle, faucet, snapshot, amendment)
- [ ] CI passes on `ubuntu-latest` and `macos-latest` GitHub runners
- [ ] Package published to npm as `xrpl-up`
- [ ] `engines`, `author`, `repository` fields populated in `package.json`
- [ ] `LICENSE` file present in repo root
- [ ] No `TODO` or `FIXME` comments in `src/`
- [ ] All README installation instructions updated for npm install path
