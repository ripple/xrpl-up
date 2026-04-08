## mptoken

Manage Multi-Purpose Tokens (MPT) — XLS-33.

### mptoken issuance create

Create a new MPT issuance (MPTokenIssuanceCreate).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset-scale <n>` | integer | No | `0` | Decimal precision for display (0–255) |
| `--max-amount <string>` | string | No | — | Maximum token supply (UInt64 string) |
| `--transfer-fee <n>` | integer | No | — | Transfer fee in basis points × 10 (0–50000); requires `can-transfer` flag |
| `--flags <list>` | string | No | — | Comma-separated: `can-lock,require-auth,can-escrow,can-trade,can-transfer,can-clawback` |
| `--metadata <string>` | string | No | — | Metadata as plain string (auto hex-encoded, max 1024 bytes) |
| `--metadata-hex <hex>` | string | No | — | Metadata as raw hex |
| `--metadata-file <path>` | string | No | — | Path to file whose contents are hex-encoded as metadata |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
`--metadata`, `--metadata-hex`, and `--metadata-file` are mutually exclusive.

```bash
xrpl-up mptoken issuance create --max-amount 1000000 --flags can-transfer --seed sEd...
```

### mptoken issuance destroy

Destroy an MPT issuance (MPTokenIssuanceDestroy). The issuance ID is a positional argument.

```bash
xrpl-up mptoken issuance destroy <issuance-id> --seed sEd...
```

### mptoken issuance set

Lock or unlock an MPT issuance or a specific holder's balance (MPTokenIssuanceSet). The issuance ID is a positional argument.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--lock` | boolean | No† | false | Lock the issuance (or holder's balance) |
| `--unlock` | boolean | No† | false | Unlock the issuance (or holder's balance) |
| `--holder <address>` | string | No | — | Holder address for per-holder lock/unlock |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--lock` or `--unlock` is required.

```bash
xrpl-up mptoken issuance set <issuance-id> --lock --holder rBob... --seed sEd...
```

### mptoken issuance list

List MPT issuances for an account (read-only). The address is a positional argument.

```bash
xrpl-up mptoken issuance list rAccount...
```

### mptoken issuance get

Get MPT issuance details by ID (read-only). The issuance ID is a positional argument.

```bash
xrpl-up mptoken issuance get <issuance-id>
```

### mptoken authorize

Opt in to hold an MPT issuance, or grant/revoke holder authorization (MPTokenAuthorize). The issuance ID is a positional argument.

- **Holder opt-in**: sign as the holder, no `--holder` flag
- **Issuer authorize holder**: sign as issuer, add `--holder <address>`
- **Unauthorize / opt-out**: add `--unauthorize`

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--holder <address>` | string | No | — | Holder address (issuer-side: authorize/unauthorize a specific holder) |
| `--unauthorize` | boolean | No | false | Revoke authorization instead of granting (also used for holder opt-out) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
# Holder opts in
xrpl-up mptoken authorize <issuance-id> --seed sHolderEd...

# Issuer authorizes a holder (require-auth issuances)
xrpl-up mptoken authorize <issuance-id> --holder rHolder... --seed sIssuerEd...

# Issuer revokes holder authorization
xrpl-up mptoken authorize <issuance-id> --holder rHolder... --unauthorize --seed sIssuerEd...

# Holder opts out
xrpl-up mptoken authorize <issuance-id> --unauthorize --seed sHolderEd...
```

### Example flow: Alice issues an MPToken, Bob opts in and receives tokens, Alice locks Bob's balance

```bash
# 1. Alice creates an MPToken issuance with can-transfer and can-lock flags
#    Note: --metadata must be a valid JSON string; plain strings produce a warning on stdout.
#    Use --json and tail -1 to parse the output if warnings are present.
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer,can-lock \
  --max-amount 1000000000 \
  --seed sEdAliceXXXX... --json
# → {"hash":"...","result":"tesSUCCESS","issuanceId":"00F93262CC0FE0E07B010597BD7364690BE2B042C62003D9"}

# 2. Bob opts into the issuance (MPTokenAuthorize — holds his slot open for this token)
xrpl-up --node testnet mptoken authorize 0000001AABBCC... \
  --seed sEdBobXXXX...

# 3. Alice sends 1000 tokens to Bob via payment
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 1000/0000001AABBCC... \
  --seed sEdAliceXXXX...

# 4. Alice locks Bob's token balance (freezes his specific holding)
xrpl-up --node testnet mptoken issuance set 0000001AABBCC... \
  --lock --holder rBobXXXX... --seed sEdAliceXXXX...

# 5. Alice unlocks Bob's balance
xrpl-up --node testnet mptoken issuance set 0000001AABBCC... \
  --unlock --holder rBobXXXX... --seed sEdAliceXXXX...

# 6. Bob opts out after his balance reaches zero
xrpl-up --node testnet mptoken authorize 0000001AABBCC... \
  --unauthorize --seed sEdBobXXXX...

# 7. Alice destroys the issuance when there is no outstanding supply
xrpl-up --node testnet mptoken issuance destroy 0000001AABBCC... \
  --seed sEdAliceXXXX...
```

