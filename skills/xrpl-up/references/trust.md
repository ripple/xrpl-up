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
xrpl-up trust set --currency USD --issuer rIssuer... --limit 1000 --seed sEd...
```

### trust delete

Remove a trust line by setting its limit to zero.

```bash
xrpl-up trust set --currency USD --issuer rIssuer... --limit 0 --seed sEd...
```

### Example flow: Alice enables DefaultRipple, Bob creates a trust line, Alice issues USD to Bob

```bash
# 1. Alice (the IOU issuer) enables DefaultRipple so her tokens can ripple between holders
xrpl-up --node testnet account set \
  --set-flag defaultRipple --seed sEdAliceXXXX...

# 2. Bob creates a USD trust line to Alice with a limit of 10,000
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 10000 \
  --seed sEdBobXXXX...

# 3. Alice sends 500 USD to Bob (direct issuance — no SendMax needed)
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 500/USD/rAliceXXXX... \
  --seed sEdAliceXXXX...

# 4. Verify Bob's trust lines
xrpl-up --node testnet account trust-lines rBobXXXX...

# 5. Bob removes the trust line after the balance reaches zero
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 0 \
  --seed sEdBobXXXX...
```

