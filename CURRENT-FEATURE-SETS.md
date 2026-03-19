# xrpl-up: Current Available Feature Sets

This document summarizes what is implemented today and gives practical examples users can follow.


## 1. Sandbox Operations (Environment Lifecycle)

Use these commands to start, inspect, and control development environments:

- `xrpl-up node` (local sandbox or remote network connection)
- `xrpl-up stop`
- `xrpl-up reset`
- `xrpl-up status`
- `xrpl-up logs`
- `xrpl-up accounts`
- `xrpl-up faucet`

Local mode supports pre-funded accounts, configurable ledger interval, detach mode, and optional persistence/snapshots.

## 2. Reproducible State Management

These features support repeatable testing loops:

- `xrpl-up snapshot save <name>`
- `xrpl-up snapshot restore <name>`
- `xrpl-up snapshot list`
- `xrpl-up node --persist`
- `xrpl-up node --fork ...` (balance forking with read-only constraints)

## 3. Script Runner and Project Bootstrap

These commands support custom scripting workflows:

- `xrpl-up init [directory]` to scaffold a starter project
- `xrpl-up run <script> [scriptArgs...]` to run TS/JS scripts with injected network context

Injected environment variables for scripts:

- `XRPL_NETWORK`
- `XRPL_NETWORK_URL`
- `XRPL_NETWORK_NAME`

## 4. Protocol Workflow Wrappers (Convenience Commands)

These are intentionally focused wrappers for common XRPL workflows:

- AMM: `xrpl-up amm ...`
- NFT: `xrpl-up nft ...`
- MPT: `xrpl-up mpt ...`
- DEX offers: `xrpl-up offer ...`
- Trust lines: `xrpl-up trustline ...`
- Escrow: `xrpl-up escrow ...`
- Checks: `xrpl-up check ...`
- Payment channels: `xrpl-up channel ...`
- Account settings/signer list: `xrpl-up accountset ...`
- Ticketing: `xrpl-up ticket ...`
- DepositPreauth: `xrpl-up depositpreauth ...`
- Clawback: `xrpl-up clawback ...`
- Transaction history: `xrpl-up tx list ...`

Note: these wrappers are for learning, demo, and common flows. For complex production logic, use `xrpl.js` or direct RPC.

## 5. Amendment Controls (Local Sandbox Focus)

Implemented amendment operations:

- `xrpl-up amendment list`
- `xrpl-up amendment info <nameOrHash>`
- `xrpl-up amendment enable <nameOrHash> --local`
- `xrpl-up amendment disable <nameOrHash> --local`
- `xrpl-up amendment sync --from <network> --local [--dry-run]`

## 6. Supported Network Modes

- `local` (`ws://localhost:6006`) via Docker sandbox
- `testnet`
- `devnet`
- `mainnet` (read/use with caution; faucet is unavailable)

---

## Example Workflows (Copy/Paste)

### A. First Local Sandbox + Accounts

```bash
xrpl-up node --local --accounts 3
xrpl-up accounts --local
```

### B. Run a Script Against Local

```bash
xrpl-up run scripts/example-payment.ts --network local
```

### C. AMM Pool Quick Setup + Inspect

```bash
xrpl-up amm create XRP USD --local
xrpl-up amm info XRP USD --local
```

### D. NFT Lifecycle (Mint -> Sell -> Accept -> Burn)

```bash
xrpl-up nft mint --local --uri https://example.com/nft/1 --transferable
xrpl-up nft list --local
# then create and accept offer
xrpl-up nft sell <nftokenId> 1 --local --seed <seed>
xrpl-up nft accept <offerId> --local --seed <seed>
xrpl-up nft burn <nftokenId> --local --seed <seed>
```

### E. MPT Issuance + Payment

```bash
xrpl-up mpt create --local --max-amount 1000000 --asset-scale 6 --transferable --seed <issuer-seed>
xrpl-up mpt list --local
xrpl-up mpt pay <issuanceId> 100 rDestination... --local --seed <issuer-seed>
```

### F. Snapshot-Based Test Loop

```bash
xrpl-up node --local --persist
xrpl-up snapshot save baseline
# run mutations
xrpl-up snapshot restore baseline
```

### G. Compare Local Amendments to Mainnet, Then Sync

```bash
xrpl-up amendment list --local --diff mainnet
xrpl-up amendment sync --from mainnet --local --dry-run
xrpl-up amendment sync --from mainnet --local
```

---

## Practical Positioning

`xrpl-up` currently delivers two practical layers:

- Sandbox operations for deterministic local XRPL iteration.
- Convenience RPC wrappers for common XRPL use cases and onboarding demos.

This combination is what makes it useful for new users: they can start from working flows immediately, then graduate to custom logic with `xrpl-up run` + `xrpl.js`.
