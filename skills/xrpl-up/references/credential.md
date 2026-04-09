## credential

Manage on-chain credentials (XLS-70).

### credential create

Create an on-chain credential for a subject account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--subject <address>` | string | **Yes** | — | Subject account address |
| `--credential-type <string>` | string | No | — | Credential type as plain string (auto hex-encoded, max 64 bytes) |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--uri <string>` | string | No | — | URI as plain string (auto hex-encoded) |
| `--uri-hex <hex>` | string | No | — | URI as raw hex |
| `--expiration <ISO8601>` | string | No | — | Expiration date/time |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up credential create --subject rSubjectXXX... --credential-type KYCVerified --seed sIssuerEd...
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
xrpl-up credential accept --issuer rIssuerXXX... --credential-type KYCVerified --seed sSubjectEd...
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
xrpl-up credential delete --subject rSubjectXXX... --credential-type KYCVerified --seed sIssuerEd...
```

### credential list

List credentials for an account (read-only). The address is a positional argument.

```bash
xrpl-up credential list <address>
xrpl-up credential list rAccount... --json
```

### Example flow: A KYC issuer creates a credential for Alice, Alice accepts it, issuer revokes it

```bash
# 1. Issuer (KYC provider) creates a credential for Alice
xrpl-up --node testnet credential create \
  --subject rAliceXXXX... \
  --credential-type KYCVerified \
  --uri https://kyc.example.com/credentials/alice \
  --expiration 2027-01-01T00:00:00Z \
  --seed sEdIssuerXXXX... --json
# → {"credentialId":"AABB...","result":"tesSUCCESS"}

# 2. Alice accepts the credential issued to her
xrpl-up --node testnet credential accept \
  --issuer rIssuerXXXX... \
  --credential-type KYCVerified \
  --seed sEdAliceXXXX...

# 3. Issuer revokes the credential (e.g. Alice failed re-verification)
xrpl-up --node testnet credential delete \
  --subject rAliceXXXX... \
  --credential-type KYCVerified \
  --seed sEdIssuerXXXX...
```

