## xrpl-up Local Node Management

These commands manage the local rippled Docker sandbox. They use their own
`--network` / `--local-network` flags — **not** the global `--node` flag used by
transaction commands (payment, trust, amm, etc.).

### `start` — Start local sandbox

By default `start` launches a local rippled node. Use `--network` only to
connect to testnet/devnet instead.

```bash
# Start local rippled node (default — no flags needed)
xrpl-up start

# Run in background (detached)
xrpl-up start --detach

# 2-node consensus network with persistent state and snapshot support
xrpl-up start --local-network

# Custom ledger interval
xrpl-up start --ledger-interval 500

# Use a specific Docker image
xrpl-up start --image xrpllabsofficial/xrpld:2.3.0
```

### `status` — Show node health

```bash
xrpl-up status                    # local sandbox (default)
xrpl-up status --network testnet  # remote network
```

### `accounts` — List sandbox accounts

```bash
# List all local sandbox accounts and their balances
xrpl-up accounts

# Query a specific address
xrpl-up accounts --address rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Remote network
xrpl-up accounts --network testnet
```

### `faucet` — Fund an account

```bash
# Fund a new random wallet on the local sandbox (default)
xrpl-up faucet

# Fund a specific seed
xrpl-up faucet --seed sEdXXXXXXXXXXXXXXXXXXXXXXXXXX

# Fund on testnet or devnet
xrpl-up faucet --network testnet
xrpl-up faucet --network devnet
```

### `logs` — Stream Docker logs

```bash
xrpl-up logs
xrpl-up logs rippled
xrpl-up logs faucet
```

### `stop` — Stop the sandbox

```bash
xrpl-up stop
```

### `reset` — Wipe all sandbox state

```bash
xrpl-up reset
xrpl-up reset --snapshots   # also delete saved snapshots
```

### `snapshot` — Save/restore ledger state

Requires `--local-network` mode.

```bash
xrpl-up snapshot save my-state
xrpl-up snapshot restore my-state
xrpl-up snapshot list
```

### `config` — Manage rippled configuration

```bash
# Print the generated rippled.cfg
xrpl-up config export

# Save to file
xrpl-up config export --output ./rippled.cfg

# Validate a custom config
xrpl-up config validate ./rippled.cfg
```

### `amendment` — Inspect and manage amendments

```bash
# List all amendments and their enabled/disabled status (local sandbox, default)
xrpl-up amendment list

# Query a remote network
xrpl-up amendment list --network testnet

# Compare local vs testnet amendments
xrpl-up amendment list --diff testnet

# Show only disabled amendments
xrpl-up amendment list --disabled

# Show details for a specific amendment
xrpl-up amendment info DynamicNFT
xrpl-up amendment info C1CE18F2A268E

# Force-enable an amendment (local sandbox only)
xrpl-up amendment enable DynamicNFT
```

### `run` — Run a script against an XRPL network

```bash
xrpl-up run ./my-script.ts
xrpl-up run --network devnet ./my-script.ts arg1 arg2
```

### `init` — Scaffold a new XRPL project

```bash
xrpl-up init
xrpl-up init my-project
```
