## multisig

Manage XRPL multi-signature signer lists.

### multisig set

Configure a multi-signature signer list on an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--quorum <n>` | integer | **Yes** | — | Required signature weight threshold |
| `--signer <address:weight>` | string | No | — | Signer entry in `address:weight` format (repeatable) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up multisig set --quorum 2 --signer rSigner1...:1 --signer rSigner2...:1 --seed sEd...
```

### multisig list

List the signer list for an account (read-only).

```bash
xrpl-up multisig list rAccount...
```

### multisig delete

Remove the signer list from an account (SignerListSet with empty signers).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up multisig delete --seed sEd...
```

### Example flow: Alice sets up 2-of-3 multisig; two signers authorize a payment

```bash
# 1. Alice configures a 2-of-3 signer list (signer1, signer2, signer3 are separate accounts)
xrpl-up --node testnet multisig set \
  --quorum 2 \
  --signer rSigner1XXXX...:1 \
  --signer rSigner2XXXX...:1 \
  --signer rSigner3XXXX...:1 \
  --seed sEdAliceXXXX...

# 2. Verify the signer list
xrpl-up --node testnet multisig list rAliceXXXX...
# → Quorum: 2
#   rSigner1XXXX... (weight: 1)
#   rSigner2XXXX... (weight: 1)
#   rSigner3XXXX... (weight: 1)

# 3. Remove the signer list (replace with an updated one or delete entirely)
xrpl-up --node testnet multisig delete --seed sEdAliceXXXX...
```

