# xrpl-up — Product Specification

> **Version:** 0.1.7
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

---

## 1. Overview

### 1.1 Purpose

`xrpl-up` is a developer-facing CLI that makes it fast to set up, script against, and tear down XRPL environments. Its primary value is the **local sandbox** — a fully isolated rippled node running in Docker, pre-funded with accounts, with all modern amendments enabled, requiring no internet connectivity. A secondary role is providing ergonomic wrappers for common XRPL transaction types (AMM, NFT, MPT, DEX, escrow, channels, etc.) against local, testnet, and devnet networks.

### 1.2 Target Audience

| Audience | Primary use |
|---|---|
| XRPL dApp developer | Rapid local iteration; scripting; testing before testnet |
| Integration test author | CI/CD sandbox (deterministic start, instant ledger close, no rate limits) |
| XRPL protocol engineer | Reproducing bugs, testing amendments locally |
| Developer Experience team | Demo tooling; example scaffolding; onboarding new contributors |

### 1.3 Key Features

1. **Local sandbox** — a standalone rippled node in Docker with pre-funded accounts and all modern amendments enabled. Ephemeral by default; resets on every `start`.
2. **Local network** — a 2-node consensus network (`--local-network`) with persistent ledger state across restarts.
3. **Transaction wrappers** — 20 commands covering AMM, NFT, MPT, DEX, escrow, channels, checks, tickets, credentials, DIDs, oracles, vaults, and more. Designed for demos and quick experiments, not as a full RPC client.
4. **Multi-network support** — target local, testnet, or devnet with `--node` or `XRPL_NODE`. Custom networks can be added via config file.
5. **Snapshots** — save and restore ledger state by name (requires `--local-network`). Useful for reproducible test scenarios and rollback.
6. **Scripting** — run TypeScript/JavaScript scripts against any network via `xrpl-up run`. The CLI is also importable as a library (`src/index.ts`).
7. **Amendment management** (experimental) — list, query, and enable XRPL amendments on the local sandbox. Compare amendment status across networks with `--diff`.

### 1.4 What It Is NOT

- Not a production tool — local sandbox keys are printed to stdout; no key management or custody
- Not a complete RPC client — wraps common transaction types for convenience, not all of them

---

## 2. Architecture

### 2.1 Component Map

```
xrpl-up CLI (src/cli.ts)
    │
    ├─ Core (src/core/)
    │       config.ts        — loadConfig, DEFAULT_CONFIG, resolveNetwork, isMainnet
    │       compose.ts       — Docker Compose file generation, composeUp/Down
    │       docker.ts        — Docker availability checks
    │       standalone.ts    — Genesis wallet / standalone mode helpers
    │       network.ts       — NetworkManager (xrpl.js Client wrapper)
    │       wallet-store.ts  — WalletStore (JSON file persistence)
    │
    ├─ Sandbox commands (src/commands/)
    │       node.ts, accounts.ts, faucet.ts, run.ts, init.ts,
    │       status.ts, logs.ts, reset.ts, snapshot.ts, config.ts,
    │       amendment.ts
    │
    ├─ XRPL interaction commands (src/cli/commands/)
    │       wallet/, account/, payment.ts, trust.ts, offer.ts, amm.ts,
    │       nft.ts, mptoken.ts, escrow.ts, check.ts, channel.ts,
    │       ticket.ts, clawback.ts, credential.ts, did.ts, multisig.ts,
    │       oracle.ts, deposit-preauth.ts, permissioned-domain.ts, vault.ts
    │
    └─ Faucet server (src/faucet-server/)
            server.ts    — HTTP server that funds accounts from the genesis wallet
            Dockerfile   — Bundled and shipped with the npm package
```

### 2.2 Standalone Mode (`xrpl-up start --local`)

Default mode. A single rippled in standalone mode — no peers, no consensus, no persistence. Ledger state resets on every start.

```
Host
 ├─ ws://localhost:6006  ──── rippled (standalone, -a --start)
 └─ http://localhost:3001 ─── faucet (Node.js HTTP server)
          │
          └── connects to rippled via ws://host.docker.internal:6006
```

**Services:**

| Service | Image / Build | Ports | Key details |
|---|---|---|---|
| `rippled` | `xrpllabsofficial/xrpld:latest` (`--image`) | `6006:6006` | Config: `~/.xrpl-up/rippled.cfg:ro`. Healthcheck: TCP 6006, 2 s interval, 20 retries. ARM64: `platform: linux/amd64` auto-injected. |
| `faucet` | Built from `dist/faucet-server/` | `3001:3001` | Depends on rippled healthcheck. Connects via `host.docker.internal`. |

Both share `xrpl-net` (bridge driver). `--exit-on-crash` disables restart and wraps rippled in a shell that detects `Logic error:` in stderr and exits 134.

### 2.3 Local Network Mode (`xrpl-up start --local-network`)

A 2-node private consensus network with persistent state. Ledger data survives restarts. Snapshots require this mode.

```
Host
 ├─ ws://localhost:6006  ──── rippled (node 1, primary — genesis on first boot)
 │                             rippled-peer (node 2 — syncs from node 1)
 └─ http://localhost:3001 ─── faucet
```

**Differences from standalone:**
- Two rippled containers (`rippled` + `rippled-peer`) with separate configs (`rippled-node1.cfg`, `rippled-node2.cfg`) and hardcoded validator keys
- Named volumes: `xrpl-up-local-db` (node 1) and `xrpl-up-local-peer-db` (node 2)
- Entrypoint checks for `ledger.db` — uses `--start` on first boot, `--load` on resume
- Amendments activate through voting (~30–60 s on first boot), not instantly
- Pre-seeded genesis DB (`src/core/genesis/*.tar.gz`) extracted into empty volumes for fast first boot

### 2.4 Persistent State Layout (`~/.xrpl-up/`)

```
~/.xrpl-up/
├── docker-compose.yml           # Regenerated on every start
├── rippled.cfg                  # Standalone mode config (auto-generated or custom via --config)
├── rippled-node1.cfg            # Local-network mode: node 1 config
├── rippled-node2.cfg            # Local-network mode: node 2 config
├── validators.txt               # Companion to rippled.cfg (written once if missing)
├── local-accounts.json          # WalletStore for local network
├── testnet-accounts.json        # WalletStore for testnet
├── devnet-accounts.json         # WalletStore for devnet
└── snapshots/
    ├── <name>.tar.gz            # Compressed NuDB ledger volume (--local-network mode only)
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
    "balance": 1000
  }
]
```
- File is written atomically after each `add()` call

**Named Docker volumes** (local-network mode only):
- `xrpl-up-local-db` — node 1 ledger database (`/var/lib/rippled/db`)
- `xrpl-up-local-peer-db` — node 2 ledger database

### 2.5 Library API (`src/index.ts`)

`xrpl-up` is dual-use: CLI and importable library. Scripts run via `xrpl-up run` can import from the `xrpl-up` package directly.

Key exports: `getRunContext()`, `WalletStore`, `NetworkManager`, `withClient`, `loadConfig`, `resolveNetwork`. See `src/index.ts` for the full list.

**Usage inside `xrpl-up run` scripts:**
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
**Custom network:** Any additional named network can be added to `xrpl-up.config.js`. Custom networks behave identically to built-ins for read-only commands. Faucet commands only support `local`, `testnet`, and `devnet`.

**`isMainnet()` detection rules (URL-based, best-effort):**
- URL contains `xrplcluster.com`, `s1.ripple.com`, or `s2.ripple.com`

---

## 4. Command Reference

### 4.1 Taxonomy

`xrpl-up` has **32 top-level commands**:

| Category | Commands |
|---|---|
| Sandbox lifecycle | `start`, `stop`, `reset` |
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
| `--node <url\|name>` | XRPL node for interaction commands: `local` (default), `testnet`, `devnet`, or a raw WebSocket URL (e.g. `ws://localhost:6006`). Set via `XRPL_NODE` env var. Ignored by sandbox lifecycle commands. |

Each command supports `--help` for detailed flag documentation. Run `xrpl-up <command> --help` or `xrpl-up <command> <subcommand> --help` for usage details.

---

## 5. Feature Specifications

### 5.1 Local Node Lifecycle

**`xrpl-up start --local`** startup sequence:
1. Check Docker daemon is running (`docker info`)
2. Generate `~/.xrpl-up/rippled.cfg` (unless `--config` is provided)
3. Write `~/.xrpl-up/validators.txt` (if missing)
4. Generate and write `~/.xrpl-up/docker-compose.yml`
5. If NOT `--local-network`: run `docker compose down` first (clean slate)
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
- `toWallet(stored)` — returns an `xrpl.Wallet`
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
- `package.json` with `npm start` / `npm run accounts` convenience scripts
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

Snapshots capture the full state of a `--local-network` session: ledger database + account store.

**`snapshot save <name>`**:
1. Stops all services (via `docker compose stop`)
2. Runs `docker run --rm -v xrpl-up-local-db:/data -v ... busybox tar czf /out/<name>.tar.gz -C /data .`
3. Copies `~/.xrpl-up/local-accounts.json` → `~/.xrpl-up/snapshots/<name>-accounts.json`
4. Restarts `rippled` and `faucet` services

**`snapshot restore <name>`**:
1. Stops the entire stack (`docker compose down`)
2. Removes the existing `xrpl-up-local-db` volume
3. Re-creates the volume and extracts `<name>.tar.gz` into it
4. Copies `<name>-accounts.json` → `~/.xrpl-up/local-accounts.json`
5. Restarts the stack (`docker compose up -d`)

**`snapshot list`**: reads `~/.xrpl-up/snapshots/`, prints name, file size, modification date, and `+accounts` tag if the sidecar JSON exists.

**Constraint**: Requires `--local-network` mode. In ephemeral mode there is no named volume to snapshot.

### 5.6 Amendment Management

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

To undo an `enable`, run `xrpl-up reset` without re-enabling the amendment — the next start will use the default genesis config.

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

### 8.2 Production URL Detection

`isMainnet()` detects known production URLs (`xrplcluster.com`, `s1.ripple.com`, `s2.ripple.com`). "Mainnet" is not a named network — users cannot pass `--network mainnet`. However, if a user provides a raw production URL (e.g. `--node wss://xrplcluster.com`), the CLI detects this and:
- `faucet` and `start` commands refuse to proceed.
- Wrapper commands (e.g. `payment`, `nft mint`) print a stderr warning: "xrpl-up is intended for local and test network development only."
- The local genesis seed (`snoPBrXtMeMyMHUVTgbuqAfg1SUTb`) is only usable on the local sandbox. It controls 100B XRP that exist only in the isolated Docker container.

### 8.3 Local-Only Restrictions

- `amendment enable` — admin WebSocket access (port 6006 with `admin = 0.0.0.0`) — only meaningful on the local sandbox
- `snapshot save/restore` — requires `--local-network` mode (persistent named volume `xrpl-up-local-db`); not available in ephemeral standalone mode or on remote networks
- `logs` — streams from Docker Compose; remote networks have no Docker stack

---

## 9. Versioning & Compatibility

### 9.1 Node.js

Minimum required: **Node.js 20** (`engines.node` in `package.json`: `>=20.0.0`; runtime guard in `src/cli.ts`).

### 9.2 Docker

Required for all `--local` commands. Any Docker Engine version that supports Compose V2 (`docker compose` plugin) is sufficient. The tool calls `docker info` to verify availability before proceeding.

### 9.3 rippled Version Pinning Strategy

- Default image: `xrpllabsofficial/xrpld:latest`
- The `[amendments]` section in `rippled.cfg` lists amendments verified against **rippled 3.1.1**.
- Pinning to a specific tag (`--image xrpllabsofficial/xrpld:3.1.1`) is supported via `--image`.
- If a new rippled release adds amendments not in the `[amendments]` stanza, use `xrpl-up amendment enable <name> --local` to queue them for the next genesis start.
- **Devnet compatibility:** XRPL Devnet may enable pre-release amendments ahead of the rippled version bundled with this tool. Transactions relying on such amendments may fail on the local sandbox. Use `xrpl-up amendment list --local --diff devnet` to identify gaps.

---

