# xrpl-up — Product Specification

> **Version:** 0.2.0-beta.0
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
4. **Multi-network support** — target local, testnet, or devnet with `--network` or `XRPL_NETWORK`. Custom networks can be added via config file.
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

### 2.2 Standalone Mode (`xrpl-up start`)

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
| `rippled` | xrpld pinned in `src/core/xrpld-source.json` (`--image` overrides) | `6006:6006` | Config: `~/.xrpl-up/rippled.cfg:ro`. Healthcheck: TCP 6006, 2 s interval, 20 retries. ARM64: `platform: linux/amd64` auto-injected. Runs as a non-root user (uid 999) as of the 3.3.0 image (was root in 3.2.0). |
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
- Amendments activate through the `[amendments]` genesis-forcing stanza on first `--start`, same as standalone — takes ~30–70 s (real 2-node peer discovery + consensus bootstrap) instead of standalone's near-instant boot. See §5.6.1 for a known intermittent race in this path.
- Empty volumes are created and chowned to the image's runtime uid/gid (queried via `docker run --entrypoint id`) before first start, so non-root images (3.3.0+) can write to them. rippled then builds a real genesis from `[amendments]`. There is no pre-built genesis artifact: a fresh genesis always matches this build's amendment list, including after `amendment enable`.

### 2.4 Persistent State Layout (`~/.xrpl-up/`)

```
~/.xrpl-up/
├── docker-compose.yml           # Regenerated on every start
├── rippled.cfg                  # Standalone mode config (auto-generated or custom via --config)
├── rippled-node1.cfg            # Local-network mode: node 1 config
├── rippled-node2.cfg            # Local-network mode: node 2 config
├── validators.txt               # Standalone: written once if missing (empty). Local-network: regenerated every start (validator keys)
├── genesis-amendments.txt       # Queued by `amendment enable`; merged into the config above
├── genesis-lineage.txt          # Fingerprint of the current --local-network genesis (see §5.6)
├── local-network-image.txt      # Records which --image last started the --local-network volumes
├── local-accounts.json          # WalletStore for local network
├── testnet-accounts.json        # WalletStore for testnet
├── devnet-accounts.json         # WalletStore for devnet
└── snapshots/
    ├── <name>.tar.gz            # Compressed NuDB ledger volume (--local-network mode only)
    ├── <name>-accounts.json     # Account store at snapshot time
    └── <name>-meta.json         # Snapshot metadata ({ format, lineage, amendments })
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
| `-n, --network <url\|name>` | XRPL network target: `local` (default), `testnet`, `devnet`, or a raw WebSocket URL (e.g. `ws://localhost:6006`). Set via `XRPL_NETWORK` env var. Applies to XRPL interaction commands and to any sandbox lifecycle command that has a network concept (`start`, `accounts`, `faucet`, `run`, `status`, `amendment list`/`info`) — those commands read the same global option (no per-command duplicate). Commands with no network concept (`stop`, `reset`, `logs`, `init`, `config`, `snapshot`) ignore it. **Value resolution differs by command group**: sandbox lifecycle commands resolve the value against `xrpl-up.config.js`'s `networks` map (so a custom config-defined name works), while XRPL interaction commands only recognize the literals `local`/`testnet`/`devnet` or a raw URL — a config-defined custom network name is not resolved and fails. |

Each command supports `--help` for detailed flag documentation. Run `xrpl-up <command> --help` or `xrpl-up <command> <subcommand> --help` for usage details.

---

## 5. Feature Specifications

### 5.1 Local Node Lifecycle

**`xrpl-up start`** startup sequence:
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
11. Print account addresses and seeds (unless `--no-secrets`, or unless detached — local sandboxes detach by default; pass `--foreground` to stay attached)
12. If attached (`--foreground` or `--exit-on-crash`): subscribe to ledger events and stream ledger close notifications to stdout. If `--exit-on-crash`: also start a `docker wait` watcher for exit code propagation.

**`xrpl-up stop`**: runs `docker compose down` on the project `xrpl-up-local`.

**`xrpl-up reset`**: runs `docker compose down`, removes the `xrpl-up-local-db` volume, deletes `~/.xrpl-up/local-accounts.json`, and clears `~/.xrpl-up/genesis-amendments.txt` (then regenerates the config) so manually enabled amendments do not silently carry into the next genesis. With `--snapshots`, also deletes `~/.xrpl-up/snapshots/`. With `--keep-amendments`, preserves the amendment queue.

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
- `tsx` compiles `.ts` files to CJS unless the script's project sets `"type": "module"` in `package.json` (the `init` scaffold does; an arbitrary project may not). Top-level `await` is invalid CJS — scripts should wrap their body in an `async function` instead, as the README's example does
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

Snapshots capture the full state of a `--local-network` session: ledger database, account store, and the manually enabled amendment set (see §5.6 for why the last one matters).

**`snapshot save <name>`**:
1. Waits for every account in `~/.xrpl-up/local-accounts.json` to appear on a validated ledger (`waitForWalletStoreValidated()`, up to 30s, best-effort). Without this, saving immediately after `start`/`faucet` could archive a ledger that predates the accounts it records, so a later restore fails post-restore verification with "account ... not found."
2. Stops all services (via `docker compose stop`)
3. Runs `docker run --rm -v xrpl-up-local-db:/data -v ... alpine tar czf /out/<name>.tar.gz -C /data .`
4. Writes sidecars: `<name>-accounts.json` (copy of the account store), `<name>-meta.json` (`{ format, lineage, amendments }` — see §5.6), atomically swapped in together with the tarball
5. Restarts `rippled` and `faucet` services

**`snapshot restore <name>`**:
1. Compares the snapshot's recorded lineage (`<name>-meta.json`) against the sandbox's current lineage (`~/.xrpl-up/genesis-lineage.txt`). On a mismatch, adopts the snapshot's amendment set (`adoptGenesisLineage()`): writes it to `genesis-amendments.txt`, regenerates the config, updates the lineage marker — so the ledger about to be loaded and the running config agree.
2. Stops the entire stack (`docker compose down`)
3. Removes the existing `xrpl-up-local-db` volume
4. Re-creates the volume and extracts `<name>.tar.gz` into it
5. Copies `<name>-accounts.json` → `~/.xrpl-up/local-accounts.json`
6. Restarts the stack (`docker compose up -d`)
7. Verifies at least one account from the sidecar exists on the restored ledger; fails loudly if not, rather than leaving a silently inconsistent sandbox

**`snapshot list`**: reads `~/.xrpl-up/snapshots/`, prints name, file size, modification date, and `+accounts` tag if the sidecar JSON exists.

**Constraint**: Requires `--local-network` mode. In ephemeral mode there is no named volume to snapshot.

### 5.6 Amendment Management

**Context**: The local sandbox's `rippled.cfg` includes an `[amendments]` stanza that force-enables amendments at genesis (first `--start`). The list is not hand-maintained: it is generated for the exact xrpld a build of xrpl-up runs and stored in `src/core/default-amendments.json` (see §5.6.1).

**`amendment list`**:
- Calls `feature` RPC on the target network
- Displays each amendment: hash prefix, name, enabled/supported status
- `--disabled`: filter to only amendments that are supported but not yet enabled
- `--diff <network>`: shows a side-by-side comparison between two networks

**`amendment info <nameOrHash>`**:
- Looks up by exact name or hash prefix
- Shows: full hash, name, enabled status, supported status, vote count

**`amendment enable <nameOrHash...>`** (local only):
- Accepts one or more names/hashes in a single invocation; all are resolved up front (fails fast, before queuing anything, if any one is unknown or unsupported)
- Appends `<hash> <name>` to `~/.xrpl-up/genesis-amendments.txt` for each amendment not already enabled (already-enabled ones are reported and skipped, not re-queued)
- Regenerates `rippled.cfg` so the amendments are present in the `[amendments]` genesis stanza
- Prompts to reset and restart once for the whole batch (a full node reset is required for the genesis config to take effect)
- `--auto-reset`: skips the prompt and resets immediately

#### 5.6.1 Where the default amendments come from

An amendment is force-enabled at genesis iff it is **enabled on mainnet**, **supported** by the xrpld being run, and **not `Obsolete`** in it. `Obsolete` is rippled's marker (the `vetoed` field of the admin `feature` RPC) for an amendment retired into the binary: its behaviour is always on and the flag can no longer be enabled, so listing it does nothing. Amendments that are not on mainnet (e.g. ones new in a develop build) stay off; opt in with `xrpl-up amendment enable <name...>`.

Two generated files define a build, and nothing else carries a version or an amendment name:

| File | Holds | Written by |
|---|---|---|
| `src/core/xrpld-source.json` | which xrpld to run: a registry `image`, or a `deb` (`{ channel, version }` from packages.xrplf.org) | the develop-build workflow, or by hand for a release |
| `src/core/default-amendments.json` | the derived amendment list for that xrpld | `npm run generate:amendments` (`scripts/generate-default-amendments.ts`) |

`generate:amendments` builds/pulls the pinned xrpld, boots it standalone with no `[amendments]`, reads its `feature` table, intersects with live mainnet, and writes the file. It refuses to write an empty list.

**A deb build has no registry image.** `src/xrpld-image/Dockerfile` installs the pinned deb into a plain Ubuntu image, built locally on first `start` (same pattern as the faucet image), tagged `xrpl-up/xrpld:<version with ~ → ->`. The image name must end in `/xrpld`: xrpl-up picks the binary path (`/usr/bin/xrpld`) from the name. The image must use `ENTRYPOINT`, not `CMD`, for the binary: standalone passes `command: ["-a", "--start"]`, which would otherwise replace it.

**Develop build versions.** Develop packages are `<xrpld version>-<CI run number>.<date>git<sha>`. Builds off plain `develop` report `0.0.0~dev` (rippled's placeholder, sorting below every release); builds on a release line report e.g. `3.5.0~b0`. The version prefix therefore does not identify a build; the run number (monotonic) and sha do. `scripts/new-xrpld-debs.ts` lists the builds newer than the last tagged one by run number.

**`0.0.0` builds and xrpl.js.** xrpl.js adds the required `NetworkID` only when the server's build version is >= 1.11.0, and `0.0.0-dev+<sha>` compares as older, so against such a build every transaction on this sandbox's custom network id is rejected with `telREQUIRES_NETWORK_ID`. `normalizeDevBuildVersion` (`src/utils/dev-build.ts`) reports a `0.0.0` build as recent after each connect; the tests apply it through `tests/setup/dev-build.ts`. Scripts scaffolded by `xrpl-up init` create their own clients and are not covered.

**Automation**: `.github/workflows/xrpld-poll.yml` polls every 20 minutes (and on demand) and lists the newest 30 `deb-develop` builds that are not yet done, at most 4 per poll, oldest first. packages.xrplf.org cannot notify us, so this is polling. For each one it calls the reusable `.github/workflows/xrpld-tag.yml`, which handles a single build: pin the deb, run `generate:amendments` (boots the pinned xrpld and reads its amendments), run the e2e suites, install the build from its git ref the way a user does on Node 22 and 24 and start it (checking the default amendments are enabled, then enabling one more), and only if all of that passes tag `xrpld-<slug>` and publish `xrpl-up-<ver>-xrpld-<slug>.tgz` as a release asset. So every tag is tested. `xrpld-tag.yml` can also be dispatched by hand with a version, and never runs twice at once for the same version. A failed attempt (tests, pin or packaging) adds a numbered tag `xrpld-failed-<n>-<slug>`; a build is retried until it has 3, then skipped. Failures are mostly temporary (package server, Docker, the mainnet node the amendment step queries), so a single failure is never final. A poll does nothing while another poll is still running. No npm or Docker registry is involved.

**Building from another repo.** `xrpld-tag.yml` can be called from another repo's workflow. `source-repo`/`source-ref` say which repo holds the xrpl-up code to build, the build branch, tags and releases are created in the calling repo, and `image` pins a prebuilt registry image (name ending in `/xrpld`) instead of an apt deb. `new-xrpld-debs.ts` reads a channel that needs a login from `APT_USERNAME`/`APT_PASSWORD`, and orders release-line versions like dpkg does (X.Y.Z, then a pre-release before its final, then the revision), since they carry no CI run number.

**Installing a build.** `npm install -g --install-links github:ripple/xrpl-up#xrpld-<slug>`. The tagged commit contains the built `dist/`, so nothing is built on the user's machine (npm 10 does not install the dev dependencies a build needs, which used to fail with `sh: tsc: command not found`). The `--install-links` flag is required: without it npm 10 and 11 link the global install to a temporary clone that is deleted afterwards, print `added N packages`, and leave no `xrpl-up` on PATH (reproduced locally and in CI on Node 22 and 24). The release tarball also works: `npm install -g https://github.com/ripple/xrpl-up/releases/download/<tag>/<file>.tgz`.

**Why the list is generated.** rippled retires old amendments over time, and a retired amendment listed in `[amendments]` silently stays disabled with no error. A hand-curated list therefore rots on every rippled upgrade (it shrank 77 → 37 over two upgrades before being replaced). A build-time derivation cannot drift from the binary it ships with. `Vetoed: yes` in `amendment info` is *not* evidence an amendment can't be enabled — it is trivially true for anything not in `[amendments]`; only `"Obsolete"` is definitive.

**Enabling extra amendments.** `xrpl-up amendment enable A B C` queues them in `~/.xrpl-up/genesis-amendments.txt` and resets; they are merged into `[amendments]` at the next genesis. A flipped flag does not mean the feature works: `LendingProtocolV1_1` alone leaves `LoanBrokerSet` returning `temDISABLED`; it also needs `LendingProtocol` and `SingleAssetVault`. Submit a transaction and read the engine result.

**Genesis formation: both nodes use `--start`.** On first boot node1 and node2 both run `--start`, so each builds ledger 1 locally with `[amendments]` written into it. The genesis ledger does not depend on the clock or the node, so two nodes with the same `[amendments]` build the identical ledger 1 and have nothing to race on. On resume both use `--load`.

The peer must not use `--net` ("get the initial ledger from the network"), which was tried first. A lone node1 never closes a ledger until a peer connects (it stays `disconnected`: "too few peers"), so node2 has nothing to fetch. After about 30s it gives up and builds its own default genesis, with none of the forced amendments, and the two nodes' chains compete; whichever wins decides whether the amendments are active. With the peer on `--net`, about 2 in 18 fresh boots came up with 0 amendments enabled; with both on `--start`, 16 of 16 came up with every default amendment, in about 68s. `--start` and `--net` must never be combined: xrpld handles `--net` last, so it silently wins and no genesis is formed.

As a safety net, `start --local-network` checks a *fresh* genesis for the default amendments and rebuilds it once if they are missing (`missingDefaultAmendments` in `src/core/compose.ts`), printing `Genesis came up without N default amendment(s); rebuilding it once…`. It only ever redoes a genesis it just created: a resumed network holds the user's ledger and is never touched. If the second genesis is also bad it warns instead of failing.

**Genesis lineage.** A genesis built from the default list is lineage `base`; one built with extra amendments is a different lineage, fingerprinted by those amendments (`~/.xrpl-up/genesis-lineage.txt`). `snapshot save` records it and `snapshot restore` compares it, adopting the snapshot's amendment set on mismatch so the restored ledger and the config agree. `xrpl-up reset` clears the queue and the lineage marker (`--keep-amendments` keeps the queue).

**Tests can pass by skipping.** `tests/e2e/sandbox/amendment.activate.test.ts` skips when no candidate amendment is currently disabled. Check per-test duration (a real activation takes tens of seconds) before trusting a green run.

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

- Seeds and private keys are printed to stdout when the sandbox stays attached (`--foreground`); local sandbox accounts have no real value, so this is intentional.
- `--no-secrets` suppresses all seed/private key output.
- Local sandboxes detach by default, which automatically enables `--no-secrets` too (no terminal to read from in CI).
- Seeds are stored in plaintext in `~/.xrpl-up/{network}-accounts.json`.

### 8.2 Production URL Detection

`isMainnet()` detects known production URLs (`xrplcluster.com`, `s1.ripple.com`, `s2.ripple.com`). "Mainnet" is not a named network — users cannot pass `--network mainnet`. However, if a user provides a raw production URL (e.g. `--network wss://xrplcluster.com`), the CLI detects this and:
- `faucet` and `start` commands refuse to proceed.
- Wrapper commands (e.g. `payment`, `nft mint`) print a stderr warning: "xrpl-up is intended for local and test network development only."
- The local genesis seed (`snoPBrXtMeMyMHUVTgbuqAfg1SUTb`) is only usable on the local sandbox. It controls 100B XRP that exist only in the isolated Docker container.

**Hard block at connection time (`cli/utils/client.ts`'s `withClientOnce`/`shouldBlockMainnet`).** The `isMainnet()` heuristic above is a URL-string allowlist of three known hostnames — it does not catch a mainnet-connected node with any other hostname (e.g. `wss://xrpl.ws`, a self-hosted full-history server, an internal proxy). `withClient` — the shared connection wrapper used by every built-in transaction/query command, and exported from the `xrpl-up` package for use in `xrpl-up run` scripts — additionally checks the connected server's own `networkID` (populated by xrpl.js from `server_info`; `0` is mainnet by xrpl.js's convention) immediately after connecting, before running the command's own logic (and therefore before any `autofill`/`sign`/`submit`). If `networkID === 0` and the target isn't the local sandbox, it disconnects and throws `MainnetBlockedError` unconditionally — blocks, not just warns, matching `start`/`faucet`'s existing behavior, since this tool is not designed or supported for Mainnet at all. Live-verified against a real mainnet node not in the hostname allowlist (`wss://xrpl.ws`): blocked with no warning line (the URL heuristic didn't fire), only the network_id check. No override exists — this is deliberate, decided after an initial version shipped with an `XRPL_UP_ALLOW_MAINNET=1` env var escape hatch that was then explicitly rejected in favor of a hard, unconditional block.

`status` and `accounts` connect via a separate path — `NetworkManager` (`src/core/network.ts`), not `withClient` — so `NetworkManager.connect()` carries its own copy of the same `shouldBlockMainnet`/`MainnetBlockedError` gate (imported from `cli/utils/client.ts`, not reimplemented). `faucet` and `node.ts`/`start` also use `NetworkManager` but already had their own independent `isMainnet()` hostname gate before ever constructing one, so the new gate is redundant-but-harmless for those two. Live-verified against a custom `xrpl-up.config.js` network entry pointing at `wss://xrpl.ws` (a real mainnet node, not in the hostname allowlist): both `status --network <name>` and `accounts --network <name> --address <addr>` correctly blocked; `--network testnet` through the same config file unaffected.

Known gap, not covered — connects via its own direct `new Client(...)` rather than `withClient` or `NetworkManager`, so it gets neither gate (accepted as-is, not planned to be fixed):
- The scaffolded example scripts generated by `xrpl-up init` (`src/commands/init.ts`) construct `new Client(process.env.XRPL_NETWORK_URL ?? ...)` directly, so they bypass this check if run standalone (not via `xrpl-up run`) with `XRPL_NETWORK_URL` pointed at mainnet.
- `amendment list --diff <network>` / `--network <url>` (`fetchFeatures()` in `src/commands/amendment.ts`) — zero gating at all, not even the hostname heuristic.

### 8.3 Local-Only Restrictions

- `amendment enable` — admin WebSocket access (port 6006 with `admin = 0.0.0.0`) — only meaningful on the local sandbox
- `snapshot save/restore` — requires `--local-network` mode (persistent named volume `xrpl-up-local-db`); not available in ephemeral standalone mode or on remote networks
- `logs` — streams from Docker Compose; remote networks have no Docker stack

---

## 9. Versioning & Compatibility

### 9.1 Node.js

Minimum required: **Node.js 22** (`engines.node` in `package.json`: `>=22.0.0`; runtime guard in `src/cli.ts`). Node 20 was dropped after reaching its own upstream end-of-life (2026-04-30) and after its bundled `undici` (Node's native `fetch()` implementation) proved less reliable than Node 22/24's under the concurrent real-network load these e2e tests generate.

### 9.2 Docker

Required for the local sandbox. Any Docker Engine version that supports Compose V2 (`docker compose` plugin) is sufficient. The tool calls `docker info` to verify availability before proceeding.

### 9.3 rippled Version Pinning Strategy

- The xrpld a build runs is pinned in `src/core/xrpld-source.json` (§5.6.1); `--image` overrides it for one start.
- The default amendment list is generated for that xrpld, not hand-maintained.
- A deb-pinned xrpld is built into a local image on first `start`; a registry image is pulled.
- rippled 3.3.0+ runs as a non-root user (uid 999); volumes are chowned to the image's runtime uid/gid before first start (§2.3).
- Amendments new in a build but not yet on mainnet stay off; use `xrpl-up amendment enable <name...>`.
- **Devnet compatibility:** XRPL Devnet may enable pre-release amendments ahead of the rippled version bundled with this tool. Transactions relying on such amendments may fail on the local sandbox. Use `xrpl-up amendment list --diff devnet` to identify gaps.

---

