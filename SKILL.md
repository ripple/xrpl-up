---
name: xrpl-up
description: Command-line interface for the XRP Ledger — send transactions, manage wallets, query accounts, and interact with AMM/NFT/DeFi features without writing scripts
version: 0.1.3

## Installation

**Requirements:** Node.js 22 or higher.

```bash
# Global install (recommended)
npm install -g xrpl-up

# Zero-install alternative (no global install required)
npx xrpl-up <command>
```

Smoke-test after install:

```bash
xrpl --version
```

## Security Rules for Agents

> **These rules are mandatory. Never bypass them.**

1. **Never log, echo, or store `--seed` / `--private-key` values.** Treat them as ephemeral secrets that must not appear in stdout, stderr, log files, or shell history.
2. **Prefer `--keystore <path> --password <pass>` over raw `--seed` in automated pipelines.** Keystores encrypt the private key at rest; raw seeds do not.
3. **Never commit seed values to version control.** If a seed appears in a file that is tracked by git, rotate it immediately.
4. **Rotate any seed that appears in shell history or logs.** Run `history -c` or equivalent, then generate a new wallet with `xrpl-up wallet new`.
5. **`wallet private-key` output must be treated as a secret.** Do not forward it to downstream tools, store it in environment variables, or include it in CI/CD output.

## Global Options

These options apply to every command:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--node <url\|mainnet\|testnet\|devnet>` | string | `testnet` | XRPL node WebSocket URL or named network shorthand |
| `--version` | — | — | Print the installed version and exit |
| `--help` | — | — | Show help for the command or subcommand and exit |

Named network shorthands:
- `mainnet` → `wss://xrplcluster.com`
- `testnet` → `wss://s.altnet.rippletest.net:51233`
- `devnet` → `wss://s.devnet.rippletest.net:51233`

### When to use each network

| Scenario | Use |
|----------|-----|
| Learning, experimenting, running tests | `testnet` (default) — free faucet funds, no real value at risk |
| Testing features only on devnet (e.g. Vault, MPT early amendments) | `devnet` — bleeding-edge amendments enabled before testnet |
| Real transactions with real XRP | `mainnet` — irreversible; double-check all parameters |
| Private or enterprise XRPL node | `--node wss://your-node.example.com:51233` — pass the full WebSocket URL |

> **Rule:** Never pass `--node mainnet` in automated agent pipelines unless the intent is explicitly to spend real XRP. Default to `testnet` for all experiments and CI runs.

**Custom endpoint example:**

```bash
xrpl --node wss://xrpl.example.com:51233 account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

**Example — query balance on testnet:**

```bash
xrpl --node testnet account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

## Common Signing Flags

Every command that submits a transaction supports these flags (omitted from individual tables below for brevity):

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--seed <seed>` | string | — | Family seed for signing (`sXXX...`) |
| `--mnemonic <phrase>` | string | — | BIP39 mnemonic for signing |
| `--account <address-or-alias>` | string | — | Account address or alias to load from keystore |
| `--password <password>` | string | — | Keystore decryption password (insecure; prefer interactive prompt) |
| `--keystore <dir>` | string | `~/.xrpl/keystore/` | Keystore directory (env: `XRPL_KEYSTORE`) |
| `--no-wait` | boolean | false | Submit without waiting for validation |
| `--json` | boolean | false | Output result as JSON |
| `--dry-run` | boolean | false | Print signed tx without submitting |

### Storing the keystore password for agent pipelines

In automated agent workflows the CLI cannot prompt interactively. The recommended approach is to store the password in a file with restricted permissions and pipe it via the `XRPL_PASSWORD` environment variable or a file read:

**Option 1 — environment variable (recommended for CI/agents):**

```bash
# Store once (chmod 600 so only your user can read it)
echo 'my-keystore-password' > ~/.xrpl/keystore.pwd
chmod 600 ~/.xrpl/keystore.pwd

# Export before running the agent session
export XRPL_PASSWORD=$(cat ~/.xrpl/keystore.pwd)

# Pass to CLI via --password
xrpl --node testnet payment \
  --account rSenderXXX \
  --destination rReceiverXXX \
  --amount 10 \
  --password "$XRPL_PASSWORD"
```

**Option 2 — inline pipe (one-off commands):**

```bash
xrpl --node testnet payment \
  --account rSenderXXX \
  --destination rReceiverXXX \
  --amount 10 \
  --password "$(cat ~/.xrpl/keystore.pwd)"
```

> **Security note:** Never hard-code the password string in a script file or agent prompt. Always read it from a `chmod 600` file or a secrets manager (e.g. `op read op://vault/item/password` for 1Password). The `--password` flag value is visible to all processes on the host via `ps aux` — keep the value short-lived and avoid logging the full command line.

## wallet

Manage XRPL wallets: create, import, sign, verify, and maintain an encrypted local keystore.

### wallet new

Generate a new random XRPL wallet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--save` | boolean | No | false | Encrypt and save the wallet to the keystore |
| `--show-secret` | boolean | No | false | Show the seed and private key (hidden by default) |
| `--alias <name>` | string | No | — | Human-readable alias when saving to keystore |

```bash
xrpl wallet new --key-type ed25519 --save --alias alice
```

### wallet new-mnemonic

Generate a new BIP39 mnemonic wallet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--save` | boolean | No | false | Encrypt and save the wallet to the keystore |
| `--show-secret` | boolean | No | false | Show the mnemonic and private key (hidden by default) |
| `--alias <name>` | string | No | — | Human-readable alias when saving to keystore |

```bash
xrpl wallet new-mnemonic --save --alias alice-mnemonic
```

### wallet import

Import key material (seed, mnemonic, or private key) into the encrypted keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key-type <type>` | string | No | — | Key algorithm (required for unprefixed hex private keys) |
| `--alias <name>` | string | No | — | Human-readable alias for this wallet |
| `--force` | boolean | No | false | Overwrite existing keystore entry |

```bash
xrpl wallet import sEd... --alias bob
```

### wallet list

List accounts stored in the keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl wallet list --json
```

### wallet address

Derive the XRPL address from key material.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--private-key <hex>` | string | No | — | Raw private key hex (ED- or 00-prefixed) |
| `--key-type <type>` | string | No | — | Key algorithm (required for unprefixed hex private keys) |

```bash
xrpl wallet address --seed sEd...
```

### wallet public-key

Derive the public key from key material.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--private-key <hex>` | string | No | — | Raw private key hex |

```bash
xrpl wallet public-key --seed sEd...
```

### wallet private-key

> **Secret output — see Security Rules.** Do not forward this output to other tools.

Derive the private key from a seed or mnemonic.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |

```bash
xrpl wallet private-key --seed sEd...
```

### wallet sign

Sign a UTF-8 message or an XRPL transaction blob.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--message <string>` | string | No | — | UTF-8 message to sign |
| `--from-hex` | boolean | No | false | Treat `--message` as hex-encoded |
| `--tx <json-or-path>` | string | No | — | Transaction JSON (inline or file path) to sign |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl wallet sign --message "hello xrpl" --seed sEd...
```

### wallet verify

Verify a message signature or a signed transaction blob.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--message <msg>` | string | No | — | Message to verify (UTF-8 or hex if `--from-hex`) |
| `--from-hex` | boolean | No | false | Treat `--message` as hex-encoded |
| `--signature <hex>` | string | No | — | Signature hex (used with `--message`) |
| `--public-key <hex>` | string | No | — | Signer public key hex (used with `--message`) |
| `--tx <tx_blob_hex>` | string | No | — | Signed transaction blob hex to verify |

```bash
xrpl wallet verify --message "hello xrpl" --signature <hex> --public-key <hex>
```

### wallet fund

Fund an address from the testnet or devnet faucet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl wallet fund rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### wallet alias

Manage human-readable aliases for keystore entries.

**wallet alias set** — Assign an alias to a keystore address.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--force` | boolean | No | false | Overwrite existing alias |

```bash
xrpl wallet alias set rXXX... alice
```

**wallet alias list** — List all aliases.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl wallet alias list
```

**wallet alias remove** — Remove the alias for an address.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl wallet alias remove rXXX...
```

### wallet change-password

Re-encrypt a keystore entry with a new password.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--password <current>` | string | No | — | Current password (insecure; prefer interactive prompt) |
| `--new-password <new>` | string | No | — | New password (insecure; prefer interactive prompt) |

```bash
xrpl wallet change-password rXXX...
```

### wallet decrypt-keystore

Decrypt a keystore file to retrieve the seed or private key.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--file <path>` | string | No | — | Explicit keystore file path (overrides address lookup) |
| `--show-private-key` | boolean | No | false | Also print the private key hex |

```bash
xrpl wallet decrypt-keystore rXXX... --show-private-key
```

### wallet remove

Remove a wallet from the keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl wallet remove rXXX...
```

## account

Query and configure XRPL accounts: balances, settings, trust lines, offers, channels, transactions, NFTs, and MPTs.

### account info

Get full on-ledger account information (balance, sequence, owner count, flags, reserve).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl account info rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account balance

Get the XRP balance of an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--drops` | boolean | No | false | Output raw drops as a plain integer string |

```bash
xrpl account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
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
xrpl account set --seed sEd... --set-flag defaultRipple
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
xrpl account delete --seed sEd... --destination rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX --confirm
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
xrpl account set-regular-key --seed sEd... --key rRegularKeyAddress...
```

### account trust-lines

List trust lines for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--peer <address>` | string | No | — | Filter to trust lines with a specific peer |
| `--limit <n>` | string | No | — | Number of trust lines to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl account trust-lines rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account offers

List open DEX offers for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | — | Number of offers to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl account offers rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account channels

List payment channels for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination-account <address>` | string | No | — | Filter by destination account |
| `--limit <n>` | string | No | — | Number of channels to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl account channels rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account transactions

List recent transactions for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | `20` | Number of transactions to return (max 400) |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl account transactions rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh --limit 10
```

### account nfts

List NFTs owned by an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | — | Number of NFTs to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl account nfts rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account mptokens

List Multi-Purpose Tokens (MPT) held by an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | `20` | Number of tokens to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl account mptokens rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

## payment

Alias: `send`. Send a Payment transaction on the XRP Ledger.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address-or-alias>` | string | Yes | — | Destination address or alias |
| `--amount <amount>` | string | Yes | — | Amount to send: `1.5` for XRP, `10/USD/rIssuer` for IOU, `100/<48-hex>` for MPT |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--memo <text>` | string | No | — | Memo text to attach (repeatable) |
| `--memo-type <hex>` | string | No | — | MemoType hex for the last memo |
| `--memo-format <hex>` | string | No | — | MemoFormat hex for the last memo |
| `--send-max <amount>` | string | No | — | SendMax field; supports XRP, IOU, and MPT amounts |
| `--deliver-min <amount>` | string | No | — | DeliverMin field; sets `tfPartialPayment` automatically |
| `--paths <json-or-file>` | string | No | — | Payment paths as JSON array or path to a `.json` file |
| `--partial` | boolean | No | false | Set `tfPartialPayment` flag |
| `--no-ripple-direct` | boolean | No | false | Set `tfNoRippleDirect` flag |
| `--limit-quality` | boolean | No | false | Set `tfLimitQuality` flag |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl payment --to rDestination... --amount 1.5 --seed sEd...
```

## trust

Manage XRPL trust lines.

### trust set

Create or update a trust line (TrustSet transaction). Setting `--limit 0` effectively removes the trust line.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--currency <code>` | string | Yes | — | Currency code (3-char ASCII or 40-char hex) |
| `--issuer <address-or-alias>` | string | Yes | — | Issuer address or alias |
| `--limit <value>` | string | Yes | — | Trust line limit (`0` removes the trust line) |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--no-ripple` | boolean | No | false | Set `NoRipple` flag on the trust line |
| `--clear-no-ripple` | boolean | No | false | Clear `NoRipple` flag on the trust line |
| `--freeze` | boolean | No | false | Freeze the trust line |
| `--unfreeze` | boolean | No | false | Unfreeze the trust line |
| `--auth` | boolean | No | false | Authorize the trust line |
| `--quality-in <n>` | string | No | — | Set `QualityIn` (unsigned integer) |
| `--quality-out <n>` | string | No | — | Set `QualityOut` (unsigned integer) |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
`--no-ripple` and `--clear-no-ripple` are mutually exclusive. `--freeze` and `--unfreeze` are mutually exclusive.

```bash
xrpl trust set --currency USD --issuer rIssuer... --limit 1000 --seed sEd...
```

### trust delete

Remove a trust line by setting its limit to zero.

```bash
xrpl trust set --currency USD --issuer rIssuer... --limit 0 --seed sEd...
```

## offer

Manage DEX offers on the XRP Ledger.

### offer create

Create a DEX offer (OfferCreate transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--taker-pays <amount>` | string | Yes | — | Amount the taker pays (e.g. `1.5` for XRP, `10/USD/rIssuer` for IOU) |
| `--taker-gets <amount>` | string | Yes | — | Amount the taker gets (e.g. `1.5` for XRP, `10/USD/rIssuer` for IOU) |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--sell` | boolean | No | false | Set `tfSell` flag |
| `--passive` | boolean | No | false | Set `tfPassive` flag (do not consume matching offers) |
| `--immediate-or-cancel` | boolean | No | false | Set `tfImmediateOrCancel` flag |
| `--fill-or-kill` | boolean | No | false | Set `tfFillOrKill` flag |
| `--expiration <iso>` | string | No | — | Offer expiration as ISO 8601 string (e.g. `2030-01-01T00:00:00Z`) |
| `--replace <sequence>` | string | No | — | Cancel offer with this sequence and replace it atomically |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
`--immediate-or-cancel` and `--fill-or-kill` are mutually exclusive.

```bash
xrpl offer create --taker-pays 10/USD/rIssuer... --taker-gets 1.5 --seed sEd...
```

### offer cancel

Cancel an existing DEX offer (OfferCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--sequence <n>` | string | Yes | — | Sequence number of the offer to cancel |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl offer cancel --sequence 12 --seed sEd...
```

## clawback

Claw back issued tokens (IOU or MPT) from a holder account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--amount <amount>` | string | Yes | — | For IOU: `value/CURRENCY/holder-address`; for MPT: `value/MPT_ISSUANCE_ID` |
| `--holder <address>` | string | No† | — | Holder address to claw back from (required for MPT mode only) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† `--holder` is required when `--amount` is an MPT amount; must be omitted for IOU amounts.

```bash
# IOU clawback
xrpl clawback --amount 50/USD/rHolder... --seed sEd...

# MPT clawback
xrpl clawback --amount 100/0000000000000000000000000000000000000001 --holder rHolder... --seed sEd...
```

## channel

Manage XRPL payment channels: open, fund, sign off-chain claims, verify claims, redeem claims, and list channels.

### channel create

Open a new payment channel (PaymentChannelCreate transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address-or-alias>` | string | Yes | — | Destination address or alias |
| `--amount <xrp>` | string | Yes | — | XRP to lock in the channel (decimal, e.g. `10`) |
| `--settle-delay <seconds>` | string | Yes | — | Seconds the source must wait before closing with unclaimed funds |
| `--public-key <hex>` | string | No | derived | 33-byte public key hex (derived from key material if omitted) |
| `--cancel-after <iso8601>` | string | No | — | Hard expiry in ISO 8601 format |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl channel create --to rDestination... --amount 10 --settle-delay 86400 --seed sEd...
```

### channel fund

Add XRP to an existing payment channel (PaymentChannelFund transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | Yes | — | XRP to add (decimal, e.g. `5`) |
| `--expiration <iso8601>` | string | No | — | New soft expiry in ISO 8601 format |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl channel fund --channel <64-hex-id> --amount 5 --seed sEd...
```

### channel sign

Sign an off-chain payment channel claim (offline — no network call).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | Yes | — | XRP amount to authorize (decimal, e.g. `5`) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl channel sign --channel <64-hex-id> --amount 5 --seed sEd...
```

### channel verify

Verify an off-chain payment channel claim signature (offline — no network call).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | Yes | — | Amount in the claim (decimal) |
| `--signature <hex>` | string | Yes | — | Hex-encoded claim signature |
| `--public-key <hex>` | string | Yes | — | Hex-encoded public key of the signer |

```bash
xrpl channel verify --channel <64-hex-id> --amount 5 --signature <hex> --public-key <hex>
```

### channel claim

Redeem a signed payment channel claim or request channel closure (PaymentChannelClaim transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | No | — | XRP amount authorized by the signature |
| `--balance <xrp>` | string | No | — | Total XRP delivered by this claim |
| `--signature <hex>` | string | No | — | Hex-encoded claim signature (requires `--amount`, `--balance`, `--public-key`) |
| `--public-key <hex>` | string | No | — | Hex-encoded public key of the channel source |
| `--close` | boolean | No | false | Request channel closure (`tfClose` flag) |
| `--renew` | boolean | No | false | Clear channel expiration (`tfRenew` flag, source account only) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl channel claim --channel <64-hex-id> --amount 5 --balance 5 --signature <hex> --public-key <hex> --seed sEd...
```

### channel list

List open payment channels for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination <address>` | string | No | — | Filter channels by destination account |

```bash
xrpl channel list rSource...
```

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
xrpl escrow create --to rDestination... --amount 10 --finish-after 2030-01-01T00:00:00Z --seed sEd...
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
xrpl escrow finish --owner rCreator... --sequence 12 --seed sEd...
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
xrpl escrow cancel --owner rCreator... --sequence 12 --seed sEd...
```

### escrow list

List pending escrows for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl escrow list rAccount...
```

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
xrpl check create --to rReceiver... --send-max 10 --seed sEd...
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
xrpl check cash --check <64-hex-id> --amount 10 --seed sEd...
```

### check cancel

Cancel a Check on the XRP Ledger (CheckCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--check <id>` | string | Yes | — | 64-character Check ID (hex) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl check cancel --check <64-hex-id> --seed sEd...
```

### check list

List pending checks for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl check list rAccount...
```

## amm

Interact with Automated Market Maker (AMM) pools.

### amm create

Create a new AMM liquidity pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset: `XRP` or `CURRENCY/issuer` |
| `--asset2 <spec>` | string | **Yes** | — | Second asset: `XRP` or `CURRENCY/issuer` |
| `--amount <value>` | string | **Yes** | — | Amount of first asset |
| `--amount2 <value>` | string | **Yes** | — | Amount of second asset |
| `--trading-fee <n>` | integer | **Yes** | — | Trading fee in units of 1/100000 (0–1000, where 1000 = 1%) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl amm create --asset XRP --asset2 USD/rIssuerXXX... --amount 1000000 --amount2 100 --trading-fee 500 --seed sEd...
```

### amm deposit

Deposit assets into an AMM pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--amount <value>` | string | No | — | Amount of first asset to deposit |
| `--amount2 <value>` | string | No | — | Amount of second asset to deposit |
| `--lp-token-out <value>` | string | No | — | LP token amount to receive |
| `--ePrice <value>` | string | No | — | Maximum effective price per LP token |
| `--for-empty` | boolean | No | false | Use tfTwoAssetIfEmpty mode |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl amm deposit --asset XRP --asset2 USD/rIssuerXXX... --amount 500000 --seed sEd...
```

### amm withdraw

Withdraw assets from an AMM pool by redeeming LP tokens.

Withdraw modes (exactly one valid combination required):
- `--lp-token-in` → tfLPToken
- `--all` → tfWithdrawAll
- `--all --amount` → tfOneAssetWithdrawAll
- `--amount` → tfSingleAsset
- `--amount --amount2` → tfTwoAsset
- `--amount --lp-token-in` → tfOneAssetLPToken
- `--amount --ePrice` → tfLimitLPToken

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--lp-token-in <value>` | string | No | — | LP token amount to redeem (currency/issuer auto-fetched) |
| `--amount <value>` | string | No | — | Amount of first asset to withdraw |
| `--amount2 <value>` | string | No | — | Amount of second asset to withdraw |
| `--ePrice <value>` | string | No | — | Minimum effective price in LP tokens per unit withdrawn |
| `--all` | boolean | No | false | Withdraw all LP tokens (tfWithdrawAll or tfOneAssetWithdrawAll) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl amm withdraw --asset XRP --asset2 USD/rIssuerXXX... --all --seed sEd...
```

### amm vote

Vote on the trading fee for an AMM pool. Vote weight is proportional to LP token holdings.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--trading-fee <n>` | integer | **Yes** | — | Desired trading fee in units of 1/100000 (0–1000) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl amm vote --asset XRP --asset2 USD/rIssuerXXX... --trading-fee 300 --seed sEd...
```

### amm bid

Bid on an AMM auction slot to earn a reduced trading fee for a time window.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--bid-min <value>` | string | No | — | Minimum LP token amount to bid (currency/issuer auto-fetched) |
| `--bid-max <value>` | string | No | — | Maximum LP token amount to bid (currency/issuer auto-fetched) |
| `--auth-account <address>` | string | No | — | Address to authorize for discounted trading (repeatable, max 4) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl amm bid --asset XRP --asset2 USD/rIssuerXXX... --bid-min 100 --bid-max 200 --seed sEd...
```

### amm delete

Delete an empty AMM pool (all LP tokens must have been returned first).

> **Note:** Only succeeds when the AMM pool has >512 LP token holders and `tfWithdrawAll` returned `tecINCOMPLETE`; with few holders, `AMMWithdraw(tfWithdrawAll)` auto-deletes the pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl amm delete --asset XRP --asset2 USD/rIssuerXXX... --seed sEd...
```

### amm info

Query AMM pool state.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |

```bash
xrpl amm info --asset XRP --asset2 USD/rIssuerXXX... --json
```

## nft

Manage NFTs on the XRP Ledger.

### nft mint

Mint an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--taxon <n>` | integer | **Yes** | — | NFT taxon (UInt32) |
| `--uri <string>` | string | No | — | Metadata URI |
| `--transfer-fee <bps>` | integer | No | — | Secondary sale fee in basis points (0–50000); requires `--transferable` |
| `--burnable` | boolean | No | false | Allow issuer to burn (tfBurnable) |
| `--only-xrp` | boolean | No | false | Restrict sales to XRP (tfOnlyXRP) |
| `--transferable` | boolean | No | false | Allow peer-to-peer transfers (tfTransferable) |
| `--mutable` | boolean | No | false | Allow URI modification (tfMutable) |
| `--issuer <address>` | string | No | — | Issuer when minting on behalf of another |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl nft mint --taxon 42 --uri https://example.com/nft.json --transferable --seed sEd...
```

### nft burn

Burn (destroy) an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID to burn |
| `--owner <address>` | string | No | — | NFT owner (when issuer burns a token they don't hold) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl nft burn --nft <64hexNFTokenID> --seed sEd...
```

### nft offer create

Create a buy or sell offer for an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID |
| `--amount <amount>` | string | **Yes** | — | Offer amount (XRP decimal or `value/CURRENCY/issuer`; `0` valid for sell giveaways) |
| `--sell` | boolean | No | false | Create a sell offer (absence = buy offer) |
| `--owner <address>` | string | No† | — | NFT owner address (required for buy offers) |
| `--expiration <ISO8601>` | string | No | — | Offer expiration datetime |
| `--destination <address>` | string | No | — | Only this account may accept the offer |
| `--seed <seed>` | string | No | — | Family seed for signing |

† `--owner` is required for buy offers.

```bash
xrpl nft offer create --nft <64hexID> --amount 10 --sell --seed sEd...
```

### nft offer accept

Accept a buy or sell NFT offer (direct or brokered mode).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--sell-offer <hex>` | string | No† | — | Sell offer ID (64-char hex) |
| `--buy-offer <hex>` | string | No† | — | Buy offer ID (64-char hex) |
| `--broker-fee <amount>` | string | No | — | Broker fee; only valid with both offers present |
| `--seed <seed>` | string | No | — | Family seed for signing |

† At least one of `--sell-offer` or `--buy-offer` is required.

```bash
xrpl nft offer accept --sell-offer <64hexOfferID> --seed sEd...
```

### nft offer cancel

Cancel one or more NFT offers.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--offer <hex>` | string | **Yes** | — | NFTokenOffer ID to cancel (repeatable for multiple) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl nft offer cancel --offer <64hexOfferID> --seed sEd...
```

### nft offer list

List all buy and sell offers for an NFT (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl nft offer list <64hexNFTokenID> --json
```

## multisig

Manage XRPL multi-signature signer lists.

### multisig set

Configure a multi-signature signer list on an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--quorum <n>` | integer | **Yes** | — | Required signature weight threshold |
| `--signers <json>` | string | No | — | JSON array of `{account, weight}` signers |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl multisig set --quorum 2 --signers '[{"account":"rSigner1...","weight":1},{"account":"rSigner2...","weight":1}]' --seed sEd...
```

### multisig sign

Produce a partial multisig signature for a transaction.

```bash
xrpl multisig sign --tx tx.json --seed sSignerEd...
```

### multisig submit

Combine partial signatures and submit a multisig transaction.

```bash
xrpl multisig submit --tx tx.json --signatures '[...]'
```

## oracle

Manage on-chain price oracles.

### oracle set

Publish or update an on-chain price oracle (OracleSet).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--document-id <n>` | integer | **Yes** | — | Oracle document ID (UInt32) |
| `--price <json>` | string | No | — | Price data entry (repeatable) |
| `--price-data <json>` | string | No | — | JSON array of price pairs |
| `--provider <string>` | string | No | — | Oracle provider string |
| `--asset-class <string>` | string | No | — | Asset class string |
| `--last-update-time <ts>` | integer | No | now | Unix timestamp for LastUpdateTime |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl oracle set --document-id 1 --price-data '[{"base_asset":"XRP","quote_asset":"USD","asset_price":100,"scale":2}]' --seed sEd...
```

### oracle delete

Delete an on-chain price oracle (OracleDelete).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--document-id <n>` | integer | **Yes** | — | Oracle document ID |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl oracle delete --document-id 1 --seed sEd...
```

## ticket

Manage XRPL Tickets for sequence-independent transaction ordering.

### ticket create

Reserve ticket sequence numbers on an XRPL account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--count <n>` | integer | **Yes** | — | Number of tickets to create (1–250) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl ticket create --count 5 --seed sEd...
```

## credential

Manage on-chain credentials (XLS-70).

### credential create

Create an on-chain credential for a subject account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--subject <address>` | string | **Yes** | — | Subject account address |
| `--credential-type <string>` | string | No | — | Credential type as plain string (auto hex-encoded, max 64 bytes) |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--uri <string>` | string | No | — | URI as plain string |
| `--expiration <ISO8601>` | string | No | — | Expiration date/time |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl credential create --subject rSubjectXXX... --credential-type KYCVerified --seed sIssuerEd...
```

### credential accept

Accept an on-chain credential issued to you.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--issuer <address>` | string | **Yes** | — | Address of the credential issuer |
| `--credential-type <string>` | string | No | — | Credential type as plain string |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl credential accept --issuer rIssuerXXX... --credential-type KYCVerified --seed sSubjectEd...
```

### credential delete

Delete an on-chain credential (revoke or clean up).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--credential-type <string>` | string | No | — | Credential type as plain string |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--subject <address>` | string | No | — | Subject account address |
| `--issuer <address>` | string | No | — | Issuer account address |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl credential delete --subject rSubjectXXX... --credential-type KYCVerified --seed sIssuerEd...
```

## mptoken

Manage Multi-Purpose Tokens (MPT) — XLS-33.

### mptoken create-issuance

Create a new MPT issuance (MPTokenIssuanceCreate).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset-scale <n>` | integer | No | `0` | Decimal precision for display (0–255) |
| `--max-amount <string>` | string | No | — | Maximum token supply (UInt64 string) |
| `--transfer-fee <n>` | integer | No | — | Transfer fee in basis points × 10 (0–50000) |
| `--flags <list>` | string | No | — | Comma-separated: `can-lock,require-auth,can-escrow,can-trade,can-transfer,can-clawback` |
| `--metadata <string>` | string | No | — | Metadata as plain string (auto hex-encoded) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl mptoken create-issuance --max-amount 1000000 --flags can-transfer --seed sEd...
```

### mptoken destroy-issuance

Destroy an MPT issuance (MPTokenIssuanceDestroy).

```bash
xrpl mptoken destroy-issuance --issuance-id <hex> --seed sEd...
```

### mptoken authorize

Authorize a holder to hold an MPT (when require-auth is set).

```bash
xrpl mptoken authorize --issuance-id <hex> --holder rHolderXXX... --seed sIssuerEd...
```

### mptoken unauthorize

Revoke holder authorization for an MPT.

```bash
xrpl mptoken unauthorize --issuance-id <hex> --holder rHolderXXX... --seed sIssuerEd...
```

### mptoken mint

Opt a holder into receiving an MPT issuance.

```bash
xrpl mptoken mint --issuance-id <hex> --seed sHolderEd...
```

### mptoken burn

Opt a holder out of an MPT issuance (burn their balance).

```bash
xrpl mptoken burn --issuance-id <hex> --seed sHolderEd...
```

## permissioned-domain

Manage XRPL permissioned domains (XLS-80).

### permissioned-domain create

Create a new permissioned domain with a set of accepted credentials.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--credentials <list>` | string | No | — | Repeatable `issuer:credential_type_hex` credential specs |
| `--credentials-json <json>` | string | No | — | JSON array of `{issuer, credential_type}` objects (credential_type must be hex) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl permissioned-domain create --credentials-json '[{"issuer":"rIssuerXXX...","credential_type":"4b5943"}]' --seed sEd...
```

### permissioned-domain update

Update the accepted credentials for a permissioned domain.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--domain-id <hash>` | string | **Yes** | — | 64-char hex domain ID |
| `--credentials-json <json>` | string | No | — | Updated credential list |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl permissioned-domain update --domain-id <64hexID> --credentials-json '[...]' --seed sEd...
```

### permissioned-domain delete

Delete a permissioned domain, reclaiming the reserve.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--domain-id <hash>` | string | **Yes** | — | 64-char hex domain ID |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl permissioned-domain delete --domain-id <64hexID> --seed sEd...
```

## vault

Manage single-asset vaults (XLS-65).

### vault create

Create a single-asset vault on the XRP Ledger.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | Asset: `XRP`, `CURRENCY/issuer`, or MPT spec |
| `--assets-maximum <n>` | string | No | — | Maximum total assets (UInt64) |
| `--data <hex>` | string | No | — | Arbitrary metadata hex (max 256 bytes) |
| `--domain-id <hash>` | string | No | — | 64-char hex DomainID for private vault |
| `--private` | boolean | No | false | Set tfVaultPrivate (requires `--domain-id`) |
| `--non-transferable` | boolean | No | false | Set tfVaultShareNonTransferable |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl vault create --asset XRP --assets-maximum 1000000 --seed sEd...
```

### vault deposit

Deposit assets into a vault and receive vault shares.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vault-id <hash>` | string | **Yes** | — | 64-char hex VaultID |
| `--amount <amount>` | string | **Yes** | — | Amount to deposit |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl vault deposit --vault-id <64hexID> --amount 10 --seed sEd...
```

### vault withdraw

Withdraw assets from a vault by burning vault shares.

```bash
xrpl vault withdraw --vault-id <64hexID> --amount 10 --seed sEd...
```

### vault delete

Delete a vault you own.

```bash
xrpl vault delete --vault-id <64hexID> --seed sEd...
```

### vault clawback

Claw back assets from a vault (issuer only).

```bash
xrpl vault clawback --vault-id <64hexID> --holder rHolderXXX... --seed sIssuerEd...
```

## did

Manage Decentralized Identifiers (DIDs) on the XRP Ledger (XLS-40).

### did set

Publish or update a Decentralized Identifier (DID) on-chain (DIDSet).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--uri <string>` | string | No | — | URI for the DID (auto hex-encoded) |
| `--data <string>` | string | No | — | Public attestation data (auto hex-encoded) |
| `--did-document <string>` | string | No | — | DID document (auto hex-encoded) |
| `--clear-uri` | boolean | No | false | Clear the URI field |
| `--clear-data` | boolean | No | false | Clear the Data field |
| `--clear-did-document` | boolean | No | false | Clear the DIDDocument field |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl did set --uri https://example.com/did.json --seed sEd...
```

### did delete

Delete the sender's on-chain Decentralized Identifier (DIDDelete).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl did delete --seed sEd...
```

## deposit-preauth

Manage deposit preauthorizations on XRPL accounts.

### deposit-preauth set

Grant or revoke deposit preauthorization for an account or credential.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--authorize <address>` | string | No | — | Preauthorize an account to send payments |
| `--unauthorize <address>` | string | No | — | Revoke preauthorization from an account |
| `--authorize-credential <issuer>` | string | No | — | Preauthorize a credential by issuer address |
| `--unauthorize-credential <issuer>` | string | No | — | Revoke credential-based preauthorization |
| `--credential-type <string>` | string | No | — | Credential type as plain string (auto hex-encoded) |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl deposit-preauth set --authorize rAllowedXXX... --seed sEd...
```

### deposit-preauth list

List deposit preauthorizations for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl deposit-preauth list rXXX... --json
```

## Common Agent Workflows

### Workflow 1: Fund a new wallet and send XRP

```bash
# 1. Generate and save a new wallet
xrpl --node testnet wallet new --save --alias sender

# 2. Fund from testnet faucet
xrpl --node testnet wallet fund rSenderXXXXXXXXXXXXXXXXXXXXXXXXX

# 3. Send XRP to another address
xrpl --node testnet payment \
  --to rReceiverXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 1.5 \
  --account rSenderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword
```

### Workflow 2: Create an IOU trust line and receive tokens

```bash
# 1. Set up a trust line for the token
xrpl --node testnet trust set \
  --currency USD \
  --issuer rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --limit 1000 \
  --account rHolderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword

# 2. Receive tokens via payment from the issuer
xrpl --node testnet payment \
  --to rHolderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 100/USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --account rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password issuerpassword
```

### Workflow 3: Create and drain an AMM pool

```bash
# 1. Create AMM pool with XRP and USD
xrpl --node testnet amm create \
  --asset XRP \
  --asset2 USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 10000000 \
  --amount2 1000 \
  --trading-fee 500 \
  --account rOwnerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword

# 2. Withdraw all liquidity using tfWithdrawAll (auto-deletes pool when no other LP holders)
xrpl --node testnet amm withdraw \
  --asset XRP \
  --asset2 USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --all \
  --account rOwnerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword
```
