## escrow

Manage XRPL escrows: create time-locked or crypto-condition escrows, release funds, cancel expired escrows, and list pending escrows.

### escrow create

Create an escrow on the XRP Ledger (EscrowCreate transaction). At least one of `--finish-after`, `--cancel-after`, or `--condition` is required.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address>` | string | Yes | — | Destination address for escrowed funds |
| `--amount <xrp>` | string | Yes | — | Amount to escrow in XRP (decimal, e.g. `10`) |
| `--finish-after <iso>` | string | No† | — | Time after which funds can be released (ISO 8601) |
| `--cancel-after <iso>` | string | No† | — | Expiration; escrow can be cancelled after this (ISO 8601) |
| `--condition <hex>` | string | No† | — | PREIMAGE-SHA-256 crypto-condition hex blob |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--source-tag <n>` | string | No | — | Source tag (unsigned 32-bit integer) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† At least one of `--finish-after`, `--cancel-after`, or `--condition` must be provided.

```bash
xrpl-up escrow create --to rDestination... --amount 10 --finish-after 2030-01-01T00:00:00Z --seed sEd...
```

### escrow finish

Release funds from an escrow (EscrowFinish transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--owner <address>` | string | Yes | — | Address of the account that created the escrow |
| `--sequence <n>` | string | Yes | — | Sequence number of the EscrowCreate transaction |
| `--condition <hex>` | string | No‡ | — | PREIMAGE-SHA-256 condition hex blob |
| `--fulfillment <hex>` | string | No‡ | — | Matching crypto-condition fulfillment hex blob |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
‡ `--condition` and `--fulfillment` must be provided together (or both omitted).

```bash
xrpl-up escrow finish --owner rCreator... --sequence 12 --seed sEd...
```

### escrow cancel

Cancel an expired escrow and return funds to the owner (EscrowCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--owner <address>` | string | Yes | — | Address of the account that created the escrow |
| `--sequence <n>` | string | Yes | — | Sequence number of the EscrowCreate transaction |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up escrow cancel --owner rCreator... --sequence 12 --seed sEd...
```

### escrow list

List pending escrows for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up escrow list rAccount...
```

### Example flow: Alice creates a time-based escrow for Bob, Bob releases it; crypto-condition variant included

```bash
# 1. Alice locks 5 XRP in an escrow for Bob, releasable after 5 minutes, expires in 1 hour
xrpl-up --node testnet escrow create \
  --to rBobXXXX... --amount 5 \
  --finish-after 2030-06-01T00:05:00Z \
  --cancel-after 2030-06-01T01:00:00Z \
  --seed sEdAliceXXXX... --json
# → {"sequence":17,"result":"tesSUCCESS"}

# 2. List Alice's pending escrows to confirm
xrpl-up --node testnet escrow list rAliceXXXX...

# 3. After the finish-after time passes, Bob (or anyone) finishes the escrow
xrpl-up --node testnet escrow finish \
  --owner rAliceXXXX... --sequence 17 \
  --seed sEdBobXXXX...

# 4. If the escrow expires (after cancel-after), Alice cancels it to reclaim the XRP
xrpl-up --node testnet escrow cancel \
  --owner rAliceXXXX... --sequence 17 \
  --seed sEdAliceXXXX...

# --- Crypto-condition variant ---
# 5. Alice creates a condition-locked escrow (preimage required to release)
xrpl-up --node testnet escrow create \
  --to rBobXXXX... --amount 10 \
  --condition A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120 \
  --cancel-after 2030-12-31T00:00:00Z \
  --seed sEdAliceXXXX...

# 6. Bob (who knows the preimage) finishes the condition escrow
xrpl-up --node testnet escrow finish \
  --owner rAliceXXXX... --sequence 18 \
  --condition A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120 \
  --fulfillment A0228020000000000000000000000000000000000000000000000000000000000000000081010 \
  --seed sEdBobXXXX...
```

