## permissioned-domain

Manage XRPL permissioned domains (XLS-80).

### permissioned-domain create

Create a new permissioned domain with a set of accepted credentials.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--credential <issuer:type>` | string | No† | — | Accepted credential as `issuer:type` (type is UTF-8, auto hex-encoded); repeatable, 1–10 total |
| `--credentials-json <json>` | string | No† | — | JSON array of `{issuer, credential_type}` objects (credential_type must be hex) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--credential` or `--credentials-json` is required; they are mutually exclusive.

```bash
xrpl-up permissioned-domain create --credentials-json '[{"issuer":"rIssuerXXX...","credential_type":"4b5943"}]' --seed sEd...
```

### permissioned-domain update

Update the accepted credentials for a permissioned domain.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--domain-id <hash>` | string | **Yes** | — | 64-char hex domain ID |
| `--credential <issuer:type>` | string | No† | — | Accepted credential as `issuer:type` (repeatable, 1–10 total); replaces entire list |
| `--credentials-json <json>` | string | No† | — | JSON array of `{issuer, credential_type}` objects (credential_type must be hex) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--credential` or `--credentials-json` is required; they are mutually exclusive.

```bash
xrpl-up permissioned-domain update --domain-id <64hexID> --credentials-json '[...]' --seed sEd...
```

### permissioned-domain delete

Delete a permissioned domain, reclaiming the reserve.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--domain-id <hash>` | string | **Yes** | — | 64-char hex domain ID |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up permissioned-domain delete --domain-id <64hexID> --seed sEd...
```

### Example flow: Alice creates a permissioned domain, updates its credentials, then deletes it

```bash
# 1. Alice creates a permissioned domain requiring KYC credentials from a trusted issuer
xrpl-up --node testnet permissioned-domain create \
  --credential rCredIssuerXXXX...:KYC \
  --seed sEdAliceXXXX...
# → Domain ID: AABB...64chars  Tx: CCDD...

# 2. Alice updates the domain to require both KYC and AML credentials
xrpl-up --node testnet permissioned-domain update \
  --domain-id AABB...64chars \
  --credentials-json '[{"issuer":"rCredIssuerXXXX...","credential_type":"4b5943"},{"issuer":"rCredIssuerXXXX...","credential_type":"414d4c"}]' \
  --seed sEdAliceXXXX...

# 3. Alice deletes the domain when no longer needed
xrpl-up --node testnet permissioned-domain delete \
  --domain-id AABB...64chars --seed sEdAliceXXXX...
```

