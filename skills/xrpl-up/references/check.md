## check

Manage XRPL Checks: create deferred payment authorizations, cash them, cancel them, and list pending checks.

### check create

Create a Check on the XRP Ledger (CheckCreate transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address>` | string | Yes | — | Destination address that can cash the Check |
| `--send-max <amount>` | string | Yes | — | Maximum amount the Check can debit (XRP decimal or `value/CURRENCY/issuer`) |
| `--expiration <iso>` | string | No | — | Check expiration time (ISO 8601) |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--invoice-id <string>` | string | No | — | Invoice identifier (≤32 bytes UTF-8, auto hex-encoded to UInt256) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up check create --to rReceiver... --send-max 10 --seed sEd...
```

### check cash

Cash a Check on the XRP Ledger (CheckCash transaction). Exactly one of `--amount` or `--deliver-min` is required.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--check <id>` | string | Yes | — | 64-character Check ID (hex) |
| `--amount <amount>` | string | No† | — | Exact amount to cash (XRP decimal or `value/CURRENCY/issuer`) |
| `--deliver-min <amount>` | string | No† | — | Minimum amount to receive (flexible cash; sets partial delivery) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--amount` or `--deliver-min` is required; they are mutually exclusive.

```bash
xrpl-up check cash --check <64-hex-id> --amount 10 --seed sEd...
```

### check cancel

Cancel a Check on the XRP Ledger (CheckCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--check <id>` | string | Yes | — | 64-character Check ID (hex) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up check cancel --check <64-hex-id> --seed sEd...
```

### check list

List pending checks for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up check list rAccount...
```

### Example flow: Alice writes a Check for Bob, Bob cashes it; Alice cancels an unused check

```bash
# 1. Alice creates a Check — authorizing Bob to pull up to 20 XRP from her account
xrpl-up --node testnet check create \
  --to rBobXXXX... --send-max 20 \
  --seed sEdAliceXXXX... --json
# → {"checkId":"CCDDEE...64chars","result":"tesSUCCESS"}

# 2. List Bob's incoming checks
xrpl-up --node testnet check list rBobXXXX...

# 3. Bob cashes the check for exactly 15 XRP
xrpl-up --node testnet check cash \
  --check CCDDEE...64chars --amount 15 \
  --seed sEdBobXXXX...

# 4. Alternatively, if Bob doesn't cash it, Alice cancels the check to reclaim the reserve
xrpl-up --node testnet check cancel \
  --check CCDDEE...64chars --seed sEdAliceXXXX...
```

