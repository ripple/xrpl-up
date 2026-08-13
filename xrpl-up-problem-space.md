# xrpl-up: Problem Space & Roadmap

XRPL Local Development Sandbox — what it solves today and what it could solve next.

---

## Problem Statement

- There is no unified sandbox workflow for rapid prototyping and repeatable testing.
- Community feedback highlights unreliable/inconsistent test environments.
- Public Testnet/Devnet introduce resets, downtime, and rate limits that reduce confidence in test repeatability.
- Direct standalone `xrpld` setup is operationally heavy (config, funding, lifecycle, resets), so app teams spend time on infrastructure mechanics instead of product logic.
- Teams need a practical way to run local `xrpld` on modest hardware (without full network sync/consensus overhead) so development is feasible on typical laptops and CI runners.
- Stateful AMM/orderbook scenarios require repeated setup and manual rollback, which slows iteration and increases flakiness in both local and CI runs.

## Executive Summary

`xrpl-up` is for XRPL application developers who want fast, deterministic transaction testing without depending on shared public testnets.

Immediate Targets:

- Plug-and-play local sandbox lifecycle: start/stop/reset, funded accounts, status/logs
- Deterministic local execution controls: auto-ledger-advance, configurable cadence, persistent state
- State management: snapshot save/restore/list, rollback-friendly workflows, account-store consistency
- Developer scripting workflow: project scaffolding, script runner, named networks, local/remote faucet flows
- RPC workflow wrappers for common XRPL use cases (AMM, NFT, Channels, MPT, etc.): pool auto-provision/inspection, guided transaction flows, and reusable prepared states
- CI/CD workflow: detached startup, deterministic teardown, machine-friendly execution patterns

Target feature set (roadmap):

- Protocol fidelity controls: amendment parity/overrides and reproducible amendment sets
- Test ergonomics: built-in test runner, assertions, and CI-oriented result outputs
- Core developer track: 3-node private network mode, UNL/topology controls, fault injection, deterministic scenarios
- Core observability track: consensus diagnostics, cross-node ledger/state diffing, and failure artifacts for CI triage

## What Was Considered and Dropped


### Experiments Completed (Decided to Drop as Product Directions)

- **Fork and Replay experiments were completed and then dropped as product directions:** an experimental `--fork` flag (never shipped) could mirror XRP balances into local state, but XRPL does not expose private keys, so mirrored accounts cannot sign and are only passive recipients. Replay was also tested by re-submitting historical mainnet blobs, but those blobs carry original sequence/signature context and fail locally (`terPRE_SEQ`) when state differs. Native `xrpld --replay` additionally requires full historical state on disk, which is impractical for ephemeral developer containers.

## Immediate Feature Set

`xrpl-up` runs in two modes. **Local mode (`start`, default)** runs a standalone xrpld node in
Docker with deterministic ledger control and local faucet funding; `start --local-network` runs
a persistent 2-node consensus network instead. **Remote mode** (`--network testnet | devnet`)
connects to public XRPL endpoints over WebSocket without starting local infrastructure.

### Two Command Sets

`xrpl-up` has two intentional command sets:

- **Sandbox operation commands:** lifecycle, state, and environment control for local and remote developer workflows.
- **XRPL interaction commands:** convenience wrappers for common transactions and demos (`amm`, `nft`, `channel`, `mptoken`, and many more).

Interaction commands are intentionally non-exhaustive. They are optimized for demonstration,
onboarding, and quick experimentation. For complex or production-grade flows, developers
should use `xrpl.js` directly or call `xrpld` RPC endpoints.

### Command × Network Scope

| Command Set | Command | Purpose | local | remote (testnet/devnet) |
|-------------|---------|---------|:-----:|:-----------------------:|
| Sandbox operation | `start` | Start a sandbox session (standalone or `--local-network`) and provision baseline accounts | ✅ | ✅ |
| Sandbox operation | `run` | Execute scripts against the selected network with injected connection env vars | ✅ | ✅ |
| Sandbox operation | `accounts` | Show funded accounts and live balances from the account store | ✅ | ✅ |
| Sandbox operation | `status` | Show network health (ledger index, xrpld version, faucet availability) | ✅ | ✅ |
| Sandbox operation | `faucet` | Fund a new or existing account and persist it to the account store | ✅ | ✅ |
| Sandbox operation | `logs` | Stream local Docker service logs (`xrpld`/`faucet`) | ✅ | ❌ |
| Sandbox operation | `stop` | Stop the local Docker sandbox stack | ✅ | ❌ |
| Sandbox operation | `reset` | Wipe local containers, ledger volume, and account store | ✅ | ❌ |
| Sandbox operation | `snapshot` | Save/restore/list local ledger + account checkpoints (requires `--local-network`) | ✅ | ❌ |
| Sandbox operation | `config` | Validate/manage local xrpld configuration | ✅ | ❌ |
| Sandbox operation | `amendment` | Inspect/enable XRPL amendments in the local genesis config | ✅ | ✅ (list/info only) |
| Sandbox operation | `init` | Scaffold a starter project with scripts/tests/templates | n/a | n/a |
| XRPL interaction | `amm create`/`info` | Create/inspect an AMM pool | ✅ | ✅ |
| XRPL interaction | `nft` | NFT lifecycle flows (mint/burn/modify/offer create/accept/cancel) | ✅ | ✅ |
| XRPL interaction | `channel` | Payment-channel flows (create/fund/sign/verify/claim/list) | ✅ | ✅ |
| XRPL interaction | `mptoken` | MPT issuance flows (`issuance create/destroy/set/get/list`, `authorize`) | ✅ | ✅ |

### Example Workflow

1. Start local sandbox: `xrpl-up start --local-network` (persistent, detaches by default)
2. Do expensive setup once (AMM pool, issuers, trust lines): `xrpl-up amm create --asset XRP --asset2 USD/rIssuer --amount 100 --amount2 100 --trading-fee 500 --seed <seed>`
3. Save a checkpoint: `xrpl-up snapshot save after-setup`
4. Run scripts/tests against stable state: `xrpl-up run scripts/...`
5. Roll back quickly between runs: `xrpl-up snapshot restore after-setup`
6. Full wipe when done: `xrpl-up reset` (keeps snapshots) or `xrpl-up reset --snapshots`

### Feature Breakdown

Starting a xrpld node in standalone mode involves Docker configuration, xrpld.cfg tuning,
port mapping, and health checking. `xrpl-up` wraps all of this in a single command.

**Hardware requirements for local mode:** Docker Desktop, ~2 GB RAM, ~500 MB disk for the
Docker image, ~50–500 MB for ledger data. No internet after initial pull. Standalone mode
needs far less than a full xrpld node — no peers, no consensus, no historical sync.

```
xrpl-up start --local
```

- Starts xrpld in Docker (standalone mode, no peers, no sync)
- Generates a valid `xrpld.cfg` automatically
- Waits for the node to be healthy before returning
- `--local-network` starts a persistent 2-node consensus network instead of ephemeral standalone
- `--debug` for xrpld debug logging

#### Pre-funded Test Accounts

In a fresh standalone node, only the genesis account exists with 100 billion XRP. `xrpl-up`
automatically creates and funds test accounts so developers can start writing transactions
immediately.

- Faucet server runs inside Docker alongside xrpld
- Each account funded with 1,000 XRP from the genesis wallet
- Account seeds/addresses printed to terminal and persisted to `~/.xrpl-up/{network}-accounts.json`
- `xrpl-up faucet --network local|testnet|devnet` also appends to the same store, so all funded accounts appear in `xrpl-up accounts` regardless of how they were created
- Remote faucet support: `--network testnet | devnet` for public networks

#### Auto-advancing Ledger

Standalone xrpld does not close ledgers automatically. `xrpl-up` auto-advances the ledger
on a configurable interval so submitted transactions confirm without manual intervention.

- Default: closes a ledger every 1,000 ms
- `--ledger-interval <ms>` to configure
- `--no-auto-advance` for manual control

#### Named Network Support

In remote mode, `xrpl-up` connects to a public XRPL node over WebSocket — no Docker, no
local xrpld. Named networks are URL aliases:

| Network | WebSocket URL |
|---------|---------------|
| testnet | `wss://s.altnet.rippletest.net:51233` |
| devnet  | `wss://s.devnet.rippletest.net:51233` |

> Remote mode does **not** bypass rate limits on public endpoints. For rate-limit-free
> development, use local mode (`--local`).

- Networks are configured in a project-local file (`xrpl-up.config.js`, `xrpl-up.config.json`, or `.xrpl-up.json`) read from the current working directory
- Faucet integration for testnet/devnet
- Consistent CLI interface regardless of network

#### Script Runner

`xrpl-up run <script>` executes a TypeScript or JavaScript script with the network URL
injected as environment variables. TypeScript is run directly via `tsx` — no build step needed.

- Looks up `--network <name>` in `xrpl-up.config.js` and resolves the WebSocket URL
- Injects `XRPL_NETWORK`, `XRPL_NETWORK_URL`, `XRPL_NETWORK_NAME` into the child process
- Detects `.ts` files and uses `tsx` automatically

#### Live Status & Logs

```
xrpl-up status    # ledger index, xrpld version, faucet health
xrpl-up accounts  # all funded accounts and their live balances
xrpl-up logs      # streams Docker Compose logs for xrpld and faucet
```

#### Project Scaffolding

`xrpl-up init <dir>` scaffolds a new project with `package.json`, `tsconfig.json`,
`xrpl-up.config.js`, `.gitignore`, and example scripts.

- **Local mode:** `example-payment.ts`, `example-nft.ts`, `example-amm.ts` — all use the
  local faucet (`http://localhost:3001`) via `fetch`
- **Remote mode:** same scripts use `client.fundWallet()` (public faucet); `example-amm.ts`
  not included (AMM not available on testnet/devnet)
- All 4 networks pre-configured in `xrpl-up.config.js`

#### CI/CD Pipeline Support

`xrpl-up start --local` detaches (backgrounds) by default, which is what CI/CD pipelines want:

```bash
xrpl-up start --local  # starts sandbox, prints ready, exits 0
npm test
xrpl-up stop           # tears down Docker stack (use if: always() in CI)
```

Pass `--foreground` instead to keep it blocking/interactive with live logs.

- GitHub Actions compatible (Docker available on `ubuntu-latest`, `macos-latest`)
- Faucet server takes over `ledger_accept` when detached

#### AMM Pool Support

The AMM amendment (XLS-30) is enabled on the local sandbox. `xrpl-up` provides commands
to create and query pools without the manual setup friction:

```bash
xrpl-up amm create --asset XRP --asset2 USD/rIssuer --amount 100 --amount2 100 --trading-fee 500 --seed <lp-seed>
xrpl-up amm info --asset XRP --asset2 USD/rIssuer
```

- `CURRENCY/issuer` notation for IOU assets (e.g. `USD/rHb9...`)
- Requires the issuer's trust line/`DefaultRipple` setup to already exist — `amm create` submits a single `AMMCreate` transaction, it does not auto-provision issuers or trust lines

#### NFT Wrapper Support

`xrpl-up nft` wraps common XLS-20 lifecycle actions for fast experimentation:
mint, burn, modify, and offer create/accept/cancel/list.

```bash
xrpl-up nft mint --uri https://example.com/meta.json --transferable --seed <seed>
xrpl-up nft offer create --nft <nft_id> --amount 10.5/USD/rIssuer --sell --seed <seed>
```

- Designed for demonstration and interactive testing, not full NFT protocol coverage
- For advanced marketplace logic and custom flows, use `xrpl.js` or direct RPC

#### Payment Channel Wrapper Support

`xrpl-up channel` provides convenience flows for channels: create, fund, sign,
verify, claim, and list.

```bash
xrpl-up channel create --to <destination> --amount 10 --settle-delay 86400 --seed <src-seed>
xrpl-up channel sign --channel <channel_id> --amount 3 --seed <seed>
```

- Optimized for showing off-chain claim flow end-to-end in a dev sandbox
- Exposes common claim inputs, but does not replace full channel orchestration tooling
- Complex production flows should be implemented with `xrpl.js`/RPC and app-level controls

#### MPT Wrapper Support

`xrpl-up mptoken` provides high-utility XLS-33 commands: issuance create/destroy/set/get/list,
and authorize.

```bash
xrpl-up mptoken issuance create --max-amount 1000000 --asset-scale 6 --flags can-transfer --seed <seed>
xrpl-up mptoken issuance get <issuance_id>
```

- Intended for quick issuance experiments and feature demonstrations
- Covers common flag/config paths, not the full MPT lifecycle surface
- Advanced issuance policy and integration logic should use `xrpl.js` or direct RPC

#### Ledger Snapshots

```bash
xrpl-up snapshot save <name>     # copy NuDB volume + account store to named snapshot
xrpl-up snapshot restore <name>  # restore ledger state and account store together
xrpl-up snapshot list            # list snapshots with size, date, and +accounts marker
```

Each snapshot is a pair: `<name>.tar.gz` (NuDB ledger volume) and `<name>-accounts.json`
(account store at snapshot time). Both are restored together so `xrpl-up accounts` always
reflects the correct set of accounts after a restore.

```bash
xrpl-up reset          # wipe all local state (containers, volume, accounts)
xrpl-up reset --snapshots  # also delete all saved snapshots
```

---

## Roadmap (To Be Discussed)

### Amendment Control

The local node starts with xrpld's default amendment set, which may not match current
mainnet. A `temDISABLED` error locally means the amendment isn't active.

- Fetch live mainnet amendment set at startup for automatic parity
- `--amendments` flag to enable/disable specific amendments

### Test Runner

The biggest gap compared to Hardhat. Without a test runner, `xrpl-up` is a node launcher,
not a development framework.

This is not just about injecting environment variables. The value is automated lifecycle
control: starting a sandbox for the suite, resetting to a deterministic baseline between
tests (for example via snapshot restore), provisioning fresh accounts, and returning
reliable pass/fail signals for CI.

```
xrpl-up test
```

- Discovers and runs test files against the local sandbox
- Each test gets a fresh account set (no snapshot needed for most cases)
- Pass/fail output, CI-friendly exit codes
- Built-in assertion helpers: `expectBalance`, `expectTxSuccess`, `expectLedgerClose`

### Hooks Development Environment

XRPL Hooks are WebAssembly smart contracts. Developing hooks requires a hooks-enabled
xrpld build, separate from the mainline binary.

- Auto-detect if a script deploys a Hook and switch to the hooks-enabled Docker image
- `--hooks` flag to start the node with hooks amendment enabled
- Integration with the Hooks Builder toolkit

### Ledger Inspection

```
xrpl-up inspect --ledger N --network mainnet
```

Fetches ledger N, decodes all transactions, displays accounts/amounts/results. No
re-execution — pure display of what happened on mainnet.

### Core Developer Feature Set (for `xrpld` protocol development)

The sections above focus on XRPL app developers. This track is for core developers working
on consensus, networking, and amendment behavior inside `xrpld`.

Phase 1 — Private multi-node network:

- `xrpl-up network start --networks 3` for a local validator cluster in Docker Compose
- Configurable validator keys, UNL, and amendment voting settings
- Topology controls for peer links between nodes

Phase 2 — Fault injection and reproducibility:

- Built-in network fault profiles (latency, packet loss, partitions, node pause/restart)
- Deterministic scenario runner (`xrpl-up scenario run <file>`) for repeatable experiments
- Cluster-wide snapshots and restore for fast rollback across all nodes

Example fault commands:

```bash
xrpl-up fault apply high-latency
xrpl-up fault apply packet-loss
xrpl-up fault apply partition-a-b
xrpl-up fault apply pause-node-2
xrpl-up fault clear
```

Example scenario file (`scenarios/consensus-edge.yaml`):

```yaml
name: consensus-edge
seed: 42
network: local-3node
steps:
  - at: 0s
    action: fault.apply
    profile: high-latency
  - at: 10s
    action: fault.apply
    profile: packet-loss
  - at: 20s
    action: fault.apply
    profile: partition-a-b
  - at: 35s
    action: fault.apply
    profile: pause-node-2
  - at: 50s
    action: fault.clear
  - at: 65s
    action: assert.convergence
    max_ledger_gap: 0
```

Run it:

```bash
xrpl-up scenario run scenarios/consensus-edge.yaml
```

Phase 3 — Protocol observability and CI:

- Consensus diagnostics: proposal timing, close time, validation convergence, peer churn
- Ledger/state diff tools across nodes for debugging divergence
- CI mode with machine-readable outputs (JSON/JUnit) and failure artifact bundles

---

## Next Steps

Collect feedback from these groups:

- XRPL application developers (day-to-day users of local mode, faucet, AMM, snapshots)
- DevOps/CI maintainers running `xrpl-up` in pipelines
- New XRPL developers onboarding from other ecosystems
- Community contributors filing issues or feature requests
