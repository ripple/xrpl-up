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
xrpl-up deposit-preauth set --authorize rAllowedXXX... --seed sEd...
```

### deposit-preauth list

List deposit preauthorizations for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up deposit-preauth list rXXX... --json
```

### Example flow: Alice enables DepositAuth, pre-authorizes Bob, Bob sends a payment

```bash
# 1. Alice enables DepositAuth on her account (requires preauthorization to receive payments)
xrpl-up --node testnet account set \
  --set-flag depositAuth --seed sEdAliceXXXX...

# 2. Alice pre-authorizes Bob to send payments directly to her
xrpl-up --node testnet deposit-preauth set \
  --authorize rBobXXXX... --seed sEdAliceXXXX...

# 3. List Alice's preauthorizations
xrpl-up --node testnet deposit-preauth list rAliceXXXX...

# 4. Bob can now send XRP to Alice (bypasses DepositAuth)
xrpl-up --node testnet payment \
  --to rAliceXXXX... --amount 5 --seed sEdBobXXXX...

# 5. Alice revokes Bob's preauthorization
xrpl-up --node testnet deposit-preauth set \
  --unauthorize rBobXXXX... --seed sEdAliceXXXX...
```

