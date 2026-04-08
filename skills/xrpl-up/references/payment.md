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
xrpl-up payment --to rDestination... --amount 1.5 --seed sEd...
```

### Example flow: Alice sends XRP to Bob, then Bob receives USD IOU, then Alice sends MPT to Bob

```bash
# 1. Alice sends 10 XRP to Bob
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 10 \
  --seed sEdAliceXXXX...

# 2. Bob sets up a USD trust line, then Alice (as issuer) sends 100 USD to Bob
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 1000 \
  --seed sEdBobXXXX...
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 100/USD/rAliceXXXX... \
  --seed sEdAliceXXXX...

# 3. Alice creates an MPToken issuance with can-transfer flag
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer --max-amount 1000000 \
  --seed sEdAliceXXXX... --json
# → {"issuanceId":"0000001AABBCC..."}

# 4. Bob opts into the MPT issuance
xrpl-up --node testnet mptoken authorize 0000001AABBCC... \
  --seed sEdBobXXXX...

# 5. Alice sends 500 MPT units to Bob
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 500/0000001AABBCC... \
  --seed sEdAliceXXXX...
```

