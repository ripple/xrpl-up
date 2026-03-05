# xrpl-up: Problem Space & Roadmap

XRPL Local Development Sandbox — what it solves today and what it could solve next.

---

## Problem Statement

- XRPL developer tooling is fragmented, and there is no unified sandbox workflow for rapid prototyping and repeatable testing.
- Community feedback repeatedly highlights unreliable/inconsistent test environments and outdated onboarding/tooling experience.
- Public Testnet/Devnet introduce resets, downtime, and rate limits that reduce confidence in test repeatability.
- Direct standalone `rippled` setup is operationally heavy (config, funding, lifecycle, resets), so app teams spend time on infrastructure mechanics instead of product logic.
- Teams need a practical way to run local `rippled` on modest hardware (without full network sync/consensus overhead) so development is feasible on typical laptops and CI runners.
- Stateful AMM/orderbook scenarios require repeated setup and manual rollback, which slows iteration and increases flakiness in both local and CI runs.

## Executive Summary

`xrpl-up` is for XRPL application developers who want fast, deterministic transaction testing without depending on shared public testnets.

Immediate Targets:

- Plug-and-play local sandbox lifecycle: start/stop/reset, funded accounts, status/logs
- Deterministic local execution controls: auto-ledger-advance, configurable cadence, persistent state
- State management: snapshot save/restore/list, rollback-friendly workflows, account-store consistency
- Developer scripting workflow: project scaffolding, script runner, named networks, local/remote faucet flows
- AMM workflow acceleration: pool auto-provision, pool inspection, reusable prepared states
- CI/CD workflow: detached startup, deterministic teardown, machine-friendly execution patterns

Target feature set (roadmap):

- Protocol fidelity controls: amendment parity/overrides and reproducible amendment sets
- Test ergonomics: built-in test runner, assertions, and CI-oriented result outputs
- Core developer track: 3-node private network mode, UNL/topology controls, fault injection, deterministic scenarios
- Core observability track: consensus diagnostics, cross-node ledger/state diffing, and failure artifacts for CI triage

## What Was Considered and Dropped


### Experiments Completed (Decided to Drop as Product Directions)

- **Fork and Replay experiments were completed and then dropped as product directions:** `xrpl-up node --local --fork` can mirror XRP balances into local state, but XRPL does not expose private keys, so mirrored accounts cannot sign and are only passive recipients. Replay was also tested by re-submitting historical mainnet blobs, but those blobs carry original sequence/signature context and fail locally (`terPRE_SEQ`) when state differs. Native `rippled --replay` additionally requires full historical state on disk, which is impractical for ephemeral developer containers.

## Immediate Feature Set

`xrpl-up` runs in two modes. **Local mode (`--local`)** starts a standalone rippled node in
Docker with deterministic ledger control and local faucet funding. **Remote mode**
(`--network testnet | devnet`) connects to public XRPL endpoints over WebSocket
without starting local infrastructure.

### Two Command Sets

`xrpl-up` has two intentional command sets:

- **Sandbox operation commands:** lifecycle, state, and environment control for local and remote developer workflows.
- **rippled API wrapper commands:** convenience wrappers for common transactions and demos (`amm`, `nft`, `channel`, `mpt`).

Wrapper commands are intentionally non-exhaustive. They are optimized for demonstration,
onboarding, and quick experimentation. For complex or production-grade flows, developers
should use `xrpl.js` directly or call `rippled` RPC endpoints.

### Command × Network Scope

| Command Set | Command | Purpose | local | remote (testnet/devnet) |
|-------------|---------|---------|:-----:|:-----------------------:|
| Sandbox operation | `node` | Start/connect to a sandbox session and provision baseline accounts | ✅ | ✅ |
| Sandbox operation | `run` | Execute scripts against the selected network with injected connection env vars | ✅ | ✅ |
| Sandbox operation | `accounts` | Show funded accounts and live balances from the account store | ✅ | ✅ |
| Sandbox operation | `status` | Show network health (ledger index, rippled version, faucet availability) | ✅ | ✅ |
| Sandbox operation | `faucet` | Fund a new or existing account and persist it to the account store | ✅ | ✅ |
| Sandbox operation | `logs` | Stream local Docker service logs (`rippled`/`faucet`) | ✅ | ❌ |
| Sandbox operation | `stop` | Stop the local Docker sandbox stack | ✅ | ❌ |
| Sandbox operation | `reset` | Wipe local containers, ledger volume, and account store | ✅ | ❌ |
| Sandbox operation | `snapshot` | Save/restore/list local ledger + account checkpoints | ✅ | ❌ |
| Sandbox operation | `config` | Validate/manage local rippled configuration | ✅ | ❌ |
| Sandbox operation | `init` | Scaffold a starter project with scripts/tests/templates | n/a | n/a |
| rippled API wrapper | `amm create` | Create an AMM pool with issuer/trust-line setup automation | ✅ | ✅ |
| rippled API wrapper | `amm info` | Inspect AMM pool state and key trading parameters | ✅ | ✅ |
| rippled API wrapper | `nft` | Convenience NFT lifecycle flows (mint/list/offers/sell/accept/burn) | ✅ | ✅ |
| rippled API wrapper | `channel` | Convenience payment-channel flows (create/fund/sign/verify/claim/list) | ✅ | ✅ |
| rippled API wrapper | `mpt` | Convenience MPT issuance flows (create/info/authorize/set/destroy) | ✅ | ✅ |

### Example Workflow

This is the intended “daily driver” loop:

1. Start local sandbox: `xrpl-up node --local --persist --detach`
2. Do expensive setup once (AMM pool, issuers, trust lines): `xrpl-up amm create ... --local`
3. Save a checkpoint: `xrpl-up snapshot save after-setup`
4. Run scripts/tests against stable state: `xrpl-up run scripts/...`
5. Roll back quickly between runs: `xrpl-up snapshot restore after-setup`
6. Full wipe when done: `xrpl-up reset` (keeps snapshots) or `xrpl-up reset --snapshots`

### Feature Breakdown

Starting a rippled node in standalone mode involves Docker configuration, rippled.cfg tuning,
port mapping, and health checking. `xrpl-up` wraps all of this in a single command.

**Hardware requirements for local mode:** Docker Desktop, ~2 GB RAM, ~500 MB disk for the
Docker image, ~50–500 MB for ledger data. No internet after initial pull. Standalone mode
needs far less than a full rippled node — no peers, no consensus, no historical sync.

```
xrpl-up node --local
```

- Starts rippled in Docker (standalone mode, no peers, no sync)
- Generates a valid `rippled.cfg` automatically
- Waits for the node to be healthy before returning
- `--persist` to keep ledger state across restarts
- `--debug` for rippled debug logging

#### Pre-funded Test Accounts

In a fresh standalone node, only the genesis account exists with 100 billion XRP. `xrpl-up`
automatically creates and funds test accounts so developers can start writing transactions
immediately.

- Faucet server runs inside Docker alongside rippled
- Each account funded with 1,000 XRP from the genesis wallet
- Account seeds/addresses printed to terminal and persisted to `~/.xrpl-up/{network}-accounts.json`
- `xrpl-up faucet --network local|testnet|devnet` also appends to the same store, so all funded accounts appear in `xrpl-up accounts` regardless of how they were created
- Remote faucet support: `--network testnet | devnet` for public networks

#### Auto-advancing Ledger

Standalone rippled does not close ledgers automatically. `xrpl-up` auto-advances the ledger
on a configurable interval so submitted transactions confirm without manual intervention.

- Default: closes a ledger every 1,000 ms
- `--ledger-interval <ms>` to configure
- `--no-auto-advance` for manual control

#### Named Network Support

In remote mode, `xrpl-up` connects to a public XRPL node over WebSocket — no Docker, no
local rippled. Named networks are URL aliases:

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
xrpl-up status    # ledger index, rippled version, faucet health
xrpl-up accounts  # all funded accounts and their live balances
xrpl-up logs      # streams Docker Compose logs for rippled and faucet
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

`xrpl-up node --local` is a blocking interactive command. CI/CD pipelines use:

```bash
xrpl-up node --local --detach   # starts sandbox, prints ready, exits 0
npm test
xrpl-up stop                    # tears down Docker stack (use if: always() in CI)
```

- GitHub Actions compatible (Docker available on `ubuntu-latest`, `macos-latest`)
- Faucet server takes over `ledger_accept` when detached

#### AMM Pool Support

The AMM amendment (XLS-30) is enabled on the local sandbox. `xrpl-up` provides commands
to create and query pools without the manual setup friction:

```bash
xrpl-up amm create XRP USD --local        # fund issuers, trust lines, AMMCreate — one command
xrpl-up amm info XRP USD.rIssuer --local  # query pool reserves, LP tokens, fee
```

- `CURRENCY.rIssuerAddress` notation for IOU assets (e.g. `USD.rHb9...`)
- Auto-generates issuer + LP wallets, sets DefaultRipple, creates trust lines, issues tokens, calls AMMCreate

#### NFT Wrapper Support

`xrpl-up nft` wraps common XLS-20 lifecycle actions for fast experimentation:
mint, list, offers, sell, accept, and burn.

```bash
xrpl-up nft mint --local --uri https://example.com/meta.json --transferable
xrpl-up nft sell <nft_id> 10.5.USD.rIssuer --local --seed <seed>
```

- Designed for demonstration and interactive testing, not full NFT protocol coverage
- Local mode can auto-fund wallets for quick trials; remote mode expects explicit wallet control
- For advanced marketplace logic and custom flows, use `xrpl.js` or direct RPC

#### Payment Channel Wrapper Support

`xrpl-up channel` provides convenience flows for channels: create, list, fund, sign,
verify, and claim.

```bash
xrpl-up channel create <destination> 10 --local
xrpl-up channel sign <channel_id> 3 --seed <seed>
```

- Optimized for showing off-chain claim flow end-to-end in a dev sandbox
- Exposes common claim inputs, but does not replace full channel orchestration tooling
- Complex production flows should be implemented with `xrpl.js`/RPC and app-level controls

#### MPT Wrapper Support

`xrpl-up mpt` provides high-utility XLS-33 commands: create, info, authorize, set,
and destroy.

```bash
xrpl-up mpt create --local --max-amount 1000000 --asset-scale 6 --transferable
xrpl-up mpt info <issuance_id> --local
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

## Roadmap (Not Yet Implemented)

### Amendment Control

The local node starts with rippled's default amendment set, which may not match current
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
rippled build, separate from the mainline binary.

- Auto-detect if a script deploys a Hook and switch to the hooks-enabled Docker image
- `--hooks` flag to start the node with hooks amendment enabled
- Integration with the Hooks Builder toolkit

### Ledger Inspection

```
xrpl-up inspect --ledger N --network mainnet
```

Fetches ledger N, decodes all transactions, displays accounts/amounts/results. No
re-execution — pure display of what happened on mainnet.

### Core Developer Feature Set (for `rippled` protocol development)

The sections above focus on XRPL app developers. This track is for core developers working
on consensus, networking, and amendment behavior inside `rippled`.

Phase 1 — Private multi-node network:

- `xrpl-up network start --nodes 3` for a local validator cluster in Docker Compose
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
