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
xrpl-up clawback --amount 50/USD/rHolder... --seed sEd...

# MPT clawback
xrpl-up clawback --amount 100/0000000000000000000000000000000000000001 --holder rHolder... --seed sEd...
```

### Example flow: Alice enables clawback, issues USD to Bob, then claws back 50 USD

```bash
# 1. Alice enables AllowTrustLineClawback on her account (irreversible)
xrpl-up --node testnet account set \
  --allow-clawback --confirm --seed sEdAliceXXXX...

# 2. Bob creates a USD trust line to Alice
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 1000 \
  --seed sEdBobXXXX...

# 3. Alice issues 100 USD to Bob
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 100/USD/rAliceXXXX... \
  --seed sEdAliceXXXX...

# 4. Alice claws back 50 USD from Bob (IOU clawback)
xrpl-up --node testnet clawback \
  --amount 50/USD/rBobXXXX... \
  --seed sEdAliceXXXX...

# --- MPT clawback variant ---
# 5. Alice creates an MPT issuance with can-clawback flag
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer,can-clawback \
  --seed sEdAliceXXXX... --json
# → {"issuanceId":"0000002CCDDEE..."}

# 6. Bob opts in and Alice sends 500 MPT units
xrpl-up --node testnet mptoken authorize 0000002CCDDEE... --seed sEdBobXXXX...
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 500/0000002CCDDEE... --seed sEdAliceXXXX...

# 7. Alice claws back 200 MPT units from Bob
xrpl-up --node testnet clawback \
  --amount 200/0000002CCDDEE... --holder rBobXXXX... \
  --seed sEdAliceXXXX...
```

