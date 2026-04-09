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
xrpl-up offer create --taker-pays 10/USD/rIssuer... --taker-gets 1.5 --seed sEd...
```

### offer cancel

Cancel an existing DEX offer (OfferCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--sequence <n>` | string | Yes | — | Sequence number of the offer to cancel |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up offer cancel --sequence 12 --seed sEd...
```

### Example flow: Alice places a USD sell offer, Bob's matching offer fills it; Alice cancels a leftover offer

```bash
# Prerequisite: Alice holds USD from rIssuerXXX... and Bob has a USD trust line

# 1. Alice creates a sell offer: she pays 10 USD to get 5 XRP
#    --json output has "offerSequence" — the value needed for offer cancel
xrpl-up --node testnet offer create \
  --taker-pays 5 \
  --taker-gets 10/USD/rIssuerXXX... \
  --sell \
  --seed sEdAliceXXXX... --json
# → {"hash":"...","result":"tesSUCCESS","offerSequence":16331330}

# 2. Bob creates a matching buy offer: he pays 10 USD to get 5 XRP (crosses Alice's offer)
xrpl-up --node testnet offer create \
  --taker-pays 10/USD/rIssuerXXX... \
  --taker-gets 5 \
  --seed sEdBobXXXX...

# 3. Verify Alice's remaining open offers (should be empty if fully filled)
xrpl-up --node testnet account offers rAliceXXXX...

# 4. If Alice's offer was only partially filled, cancel using "offerSequence" from step 1
xrpl-up --node testnet offer cancel \
  --sequence 16331330 --seed sEdAliceXXXX...
```

