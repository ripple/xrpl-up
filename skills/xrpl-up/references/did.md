## did

Manage Decentralized Identifiers (DIDs) on the XRP Ledger (XLS-40).

### did set

Publish or update a Decentralized Identifier (DID) on-chain (DIDSet).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--uri <string>` | string | No | — | URI for the DID (auto hex-encoded) |
| `--uri-hex <hex>` | string | No | — | URI as raw hex |
| `--data <string>` | string | No | — | Public attestation data (auto hex-encoded) |
| `--data-hex <hex>` | string | No | — | Data as raw hex |
| `--did-document <string>` | string | No | — | DID document (auto hex-encoded) |
| `--did-document-hex <hex>` | string | No | — | DID document as raw hex |
| `--clear-uri` | boolean | No | false | Clear the URI field |
| `--clear-data` | boolean | No | false | Clear the Data field |
| `--clear-did-document` | boolean | No | false | Clear the DIDDocument field |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up did set --uri https://example.com/did.json --seed sEd...
```

### did delete

Delete the sender's on-chain Decentralized Identifier (DIDDelete).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up did delete --seed sEd...
```

### Example flow: Alice publishes her DID, links it to a document, then deletes it

```bash
# 1. Alice publishes a DID with a URI pointing to her DID document
xrpl-up --node testnet did set \
  --uri https://alice.example.com/did.json \
  --seed sEdAliceXXXX...

# 2. Alice updates the DID to add attestation data
xrpl-up --node testnet did set \
  --uri https://alice.example.com/did-v2.json \
  --data "attestation-payload" \
  --seed sEdAliceXXXX...

# 3. Alice deletes her on-chain DID
xrpl-up --node testnet did delete --seed sEdAliceXXXX...
```

