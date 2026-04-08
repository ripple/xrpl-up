## xrpl-up Local Node Management

These commands are unique to xrpl-up and manage the local rippled Docker sandbox.

### `node` — Start local sandbox

```bash
# Start local rippled node with 10 pre-funded accounts
xrpl-up start --local

# Run in background (detached)
xrpl-up start --local --detach

# Persist ledger state across restarts
xrpl-up start --local --local-network

# Custom ledger interval
xrpl-up start --local --ledger-interval 500

# Use a specific Docker image
xrpl-up start --local --image xrpllabsofficial/xrpld:2.3.0
```

### `status` — Show node health

```bash
xrpl-up status --local
xrpl-up status --network testnet
```

### `accounts` — List sandbox accounts

```bash
# List all local sandbox accounts and their balances
xrpl-up accounts --local

# Query a specific address
xrpl-up accounts --local --address rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### `faucet` — Fund an account

```bash
# Fund a new random wallet on testnet
xrpl-up faucet

# Fund a specific seed on the local sandbox
xrpl-up faucet --local --seed sEdXXXXXXXXXXXXXXXXXXXXXXXXXX

# Fund on devnet
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
# List all amendments and their enabled/disabled status
xrpl-up amendment list --local

# Show details for a specific amendment
xrpl-up amendment info DynamicNFT --local
xrpl-up amendment info C1CE18F2A268E --local

# Force-enable an amendment (local sandbox only)
xrpl-up amendment enable DynamicNFT --local
```

### `run` — Run a script against an XRPL network

```bash
xrpl-up run ./my-script.ts
xrpl-up run --local ./my-script.ts
xrpl-up run --network devnet ./my-script.ts arg1 arg2
```

### `init` — Scaffold a new XRPL project

```bash
xrpl-up init
xrpl-up init my-project
```
