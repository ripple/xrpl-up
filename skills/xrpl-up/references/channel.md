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
xrpl-up channel create --to rDestination... --amount 10 --settle-delay 86400 --seed sEd...
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
xrpl-up channel fund --channel <64-hex-id> --amount 5 --seed sEd...
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
xrpl-up channel sign --channel <64-hex-id> --amount 5 --seed sEd...
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
xrpl-up channel verify --channel <64-hex-id> --amount 5 --signature <hex> --public-key <hex>
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
xrpl-up channel claim --channel <64-hex-id> --amount 5 --balance 5 --signature <hex> --public-key <hex> --seed sEd...
```

### channel list

List open payment channels for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination <address>` | string | No | — | Filter channels by destination account |

```bash
xrpl-up channel list rSource...
```

### Example flow: Alice opens a payment channel to Bob, signs off-chain claims, Bob redeems the final claim

```bash
# 1. Alice opens a payment channel locking 10 XRP, with a 24 h settle delay
xrpl-up --node testnet channel create \
  --to rBobXXXX... --amount 10 --settle-delay 86400 \
  --seed sEdAliceXXXX... --json
# → {"channelId":"AABBCC...64chars","result":"tesSUCCESS"}

# 2. Get Alice's public key (needed for verify and claim steps)
ALICE_PUBKEY=$(xrpl-up wallet public-key --seed sEdAliceXXXX... --json | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")

# 3. Alice signs an off-chain claim for 3 XRP (no network call — instant)
#    plain output is the raw hex signature
SIG=$(xrpl-up channel sign --channel AABBCC...64chars --amount 3 --seed sEdAliceXXXX...)

# 4. Bob verifies the claim signature before accepting payment
xrpl-up channel verify \
  --channel AABBCC...64chars --amount 3 \
  --signature "$SIG" --public-key "$ALICE_PUBKEY"
# → valid

# 5. Alice signs a larger claim for 7 XRP later (accumulated total)
SIG2=$(xrpl-up channel sign --channel AABBCC...64chars --amount 7 --seed sEdAliceXXXX...)

# 6. Bob redeems the final 7 XRP claim on-chain (submits once, not once per payment)
xrpl-up --node testnet channel claim \
  --channel AABBCC...64chars \
  --amount 7 --balance 7 \
  --signature "$SIG2" --public-key "$ALICE_PUBKEY" \
  --seed sEdBobXXXX...

# 6. Alice tops up the channel with 5 more XRP
xrpl-up --node testnet channel fund \
  --channel AABBCC...64chars --amount 5 \
  --seed sEdAliceXXXX...

# 7. Alice requests channel closure (funds return after settle delay)
xrpl-up --node testnet channel claim \
  --channel AABBCC...64chars --close \
  --seed sEdAliceXXXX...

# 8. List all open channels for Alice
xrpl-up --node testnet channel list rAliceXXXX...
```

