## account

Query and configure XRPL accounts: balances, settings, trust lines, offers, channels, transactions, NFTs, and MPTs.

### account info

Get full on-ledger account information (balance, sequence, owner count, flags, reserve).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up account info rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account balance

Get the XRP balance of an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--drops` | boolean | No | false | Output raw drops as a plain integer string |

```bash
xrpl-up account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account set

Update account settings with an AccountSet transaction.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--domain <utf8-string>` | string | No | — | Domain to set (auto hex-encoded) |
| `--email-hash <32-byte-hex>` | string | No | — | Email hash (32-byte hex) |
| `--transfer-rate <integer>` | string | No | — | Transfer rate (0 or 1000000000–2000000000) |
| `--tick-size <n>` | string | No | — | Tick size (0 or 3–15) |
| `--set-flag <name>` | string | No | — | Account flag to set: `requireDestTag\|requireAuth\|disallowXRP\|disableMaster\|noFreeze\|globalFreeze\|defaultRipple\|depositAuth` |
| `--clear-flag <name>` | string | No | — | Account flag to clear (same names as `--set-flag`) |
| `--allow-clawback` | boolean | No | false | Enable clawback (irreversible — requires `--confirm`) |
| `--confirm` | boolean | No | false | Acknowledge irreversible operations |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up account set --seed sEd... --set-flag defaultRipple
```

### account delete

> **Warning:** Permanently removes the account from the ledger; requires destination and fee reserve. This operation is irreversible and costs ~2 XRP (owner reserve, non-refundable).

Submit an AccountDelete transaction to delete an account and send remaining XRP to a destination.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination <address-or-alias>` | string | Yes | — | Destination address or alias to receive remaining XRP |
| `--destination-tag <n>` | string | No | — | Destination tag for the destination account |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--confirm` | boolean | No | false | Acknowledge permanent account deletion (required unless `--dry-run`) |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up account delete --seed sEd... --destination rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX --confirm
```

### account set-regular-key

Assign or remove the regular signing key on an account (SetRegularKey).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key <address>` | string | No† | — | Base58 address of the new regular key to assign |
| `--remove` | boolean | No† | false | Remove the existing regular key |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--key` or `--remove` is required; they are mutually exclusive.

```bash
xrpl-up account set-regular-key --seed sEd... --key rRegularKeyAddress...
```

### account trust-lines

List trust lines for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--peer <address>` | string | No | — | Filter to trust lines with a specific peer |
| `--limit <n>` | string | No | — | Number of trust lines to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account trust-lines rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account offers

List open DEX offers for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | — | Number of offers to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account offers rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account channels

List payment channels for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination-account <address>` | string | No | — | Filter by destination account |
| `--limit <n>` | string | No | — | Number of channels to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account channels rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account transactions

List recent transactions for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | `20` | Number of transactions to return (max 400) |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account transactions rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh --limit 10
```

### account nfts

List NFTs owned by an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | — | Number of NFTs to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account nfts rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account mptokens

List Multi-Purpose Tokens (MPT) held by an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | `20` | Number of tokens to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account mptokens rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### Example flow: Query Alice's account, set flags, assign a regular key, inspect holdings

```bash
# 1. Check Alice's full account info and XRP balance
xrpl-up --node testnet account info rAliceXXXX...
xrpl-up --node testnet account balance rAliceXXXX...

# 2. Set Alice's domain (auto hex-encoded) and enable RequireDestTag
xrpl-up --node testnet account set \
  --domain "alice.example.com" \
  --set-flag requireDestTag \
  --seed sEdAliceXXXX...

# 3. Assign a separate regular key so the master key can stay cold
xrpl-up --node testnet account set-regular-key \
  --key rRegularKeyXXXX... --seed sEdAliceXXXX...

# 4. Inspect Alice's trust lines, open DEX offers, and recent transactions
xrpl-up --node testnet account trust-lines rAliceXXXX...
xrpl-up --node testnet account offers rAliceXXXX...
xrpl-up --node testnet account transactions rAliceXXXX... --limit 5

# 5. List NFTs and MPT balances on Alice's account
xrpl-up --node testnet account nfts rAliceXXXX...
xrpl-up --node testnet account mptokens rAliceXXXX...
```

