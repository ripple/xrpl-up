## wallet

Manage XRPL wallets: create, import, sign, verify, and maintain an encrypted local keystore.

> **Note for agents:** All wallet subcommands accept `--keystore <dir>` to override the keystore directory (default: `~/.xrpl/keystore/`; also via `XRPL_KEYSTORE` env var). Commands that read or write keystore files also accept `--password <password>` for non-interactive/CI use — without it in a non-TTY environment the CLI will exit with an error asking for a password interactively.

### wallet new

Generate a new random XRPL wallet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key-type <type>` | string | No | `ed25519` | Key algorithm: `ed25519` or `secp256k1` |
| `--save` | boolean | No | false | Encrypt and save the wallet to the keystore |
| `--show-secret` | boolean | No | false | Show the seed and private key (hidden by default) |
| `--alias <name>` | string | No | — | Human-readable alias when saving to keystore |
| `--password <password>` | string | No | — | Keystore encryption password for `--save` (insecure; prefer interactive prompt; **required in non-TTY**) |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet new --key-type ed25519 --save --alias alice
```

### wallet new-mnemonic

Generate a new BIP39 mnemonic wallet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key-type <type>` | string | No | `ed25519` | Key algorithm: `ed25519` or `secp256k1` |
| `--derivation-path <path>` | string | No | `m/44'/144'/0'/0/0` | BIP44 derivation path |
| `--save` | boolean | No | false | Encrypt and save the wallet to the keystore |
| `--show-secret` | boolean | No | false | Show the mnemonic and private key (hidden by default) |
| `--alias <name>` | string | No | — | Human-readable alias when saving to keystore |
| `--password <password>` | string | No | — | Keystore encryption password for `--save` (insecure; **required in non-TTY**) |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet new-mnemonic --save --alias alice-mnemonic
```

### wallet import

Import key material (seed, mnemonic, or private key) into the encrypted keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key-type <type>` | string | No | — | Key algorithm (required for unprefixed hex private keys) |
| `--alias <name>` | string | No | — | Human-readable alias for this wallet |
| `--force` | boolean | No | false | Overwrite existing keystore entry |
| `--password <password>` | string | No | — | Keystore encryption password (insecure; **required in non-TTY**) |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet import sEd... --alias bob
```

### wallet list

List accounts stored in the keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet list --json
```

### wallet address

Derive the XRPL address from key material.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--mnemonic <phrase>` | string | No | — | BIP39 mnemonic phrase |
| `--private-key <hex>` | string | No | — | Raw private key hex (ED- or 00-prefixed) |
| `--key-type <type>` | string | No | — | Key algorithm (required for unprefixed hex private keys) |
| `--derivation-path <path>` | string | No | `m/44'/144'/0'/0/0` | BIP44 derivation path (used with `--mnemonic`) |

```bash
xrpl-up wallet address --seed sEd...
```

### wallet public-key

Derive the public key from key material.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--mnemonic <phrase>` | string | No | — | BIP39 mnemonic phrase |
| `--private-key <hex>` | string | No | — | Raw private key hex |
| `--key-type <type>` | string | No | — | Key algorithm: `secp256k1` or `ed25519` |
| `--derivation-path <path>` | string | No | `m/44'/144'/0'/0/0` | BIP44 derivation path (used with `--mnemonic`) |

```bash
xrpl-up wallet public-key --seed sEd...
```

### wallet private-key

> **Secret output — see Security Rules.** Do not forward this output to other tools.

Derive the private key from a seed or mnemonic.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--mnemonic <phrase>` | string | No | — | BIP39 mnemonic phrase |
| `--key-type <type>` | string | No | — | Key algorithm: `secp256k1` or `ed25519` |
| `--derivation-path <path>` | string | No | `m/44'/144'/0'/0/0` | BIP44 derivation path (used with `--mnemonic`) |

```bash
xrpl-up wallet private-key --seed sEd...
```

### wallet sign

Sign a UTF-8 message or an XRPL transaction blob.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--message <string>` | string | No | — | UTF-8 message to sign |
| `--from-hex` | boolean | No | false | Treat `--message` as hex-encoded |
| `--tx <json-or-path>` | string | No | — | Transaction JSON (inline or file path) to sign |
| `--seed <seed>` | string | No | — | Family seed for signing |
| `--mnemonic <phrase>` | string | No | — | BIP39 mnemonic for signing |
| `--account <address>` | string | No | — | Account address to load from keystore |
| `--key-type <type>` | string | No | — | Key algorithm: `secp256k1` or `ed25519` (used with `--seed` or `--mnemonic`) |
| `--password <password>` | string | No | — | Keystore decryption password (required with `--account` in non-TTY) |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet sign --message "hello xrpl" --seed sEd...
```

### wallet verify

Verify a message signature or a signed transaction blob.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--message <msg>` | string | No | — | Message to verify (UTF-8 or hex if `--from-hex`) |
| `--from-hex` | boolean | No | false | Treat `--message` as hex-encoded |
| `--signature <hex>` | string | No | — | Signature hex (used with `--message`) |
| `--public-key <hex>` | string | No | — | Signer public key hex (used with `--message`) |
| `--tx <tx_blob_hex>` | string | No | — | Signed transaction blob hex to verify |

```bash
xrpl-up wallet verify --message "hello xrpl" --signature <hex> --public-key <hex>
```

### wallet fund

Fund an address from the testnet or devnet faucet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up wallet fund rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### wallet alias

Manage human-readable aliases for keystore entries.

**wallet alias set** — Assign an alias to a keystore address.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--force` | boolean | No | false | Overwrite existing alias |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet alias set rXXX... alice
```

**wallet alias list** — List all aliases.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet alias list
```

**wallet alias remove** — Remove the alias for an address.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet alias remove rXXX...
```

### wallet change-password

Re-encrypt a keystore entry with a new password.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--password <current>` | string | No | — | Current password (insecure; prefer interactive prompt) |
| `--new-password <new>` | string | No | — | New password (insecure; prefer interactive prompt) |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet change-password rXXX...
```

### wallet decrypt-keystore

Decrypt a keystore file to retrieve the seed or private key.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--file <path>` | string | No | — | Explicit keystore file path (overrides address lookup) |
| `--password <password>` | string | No | — | Decryption password (insecure; **required in non-TTY**) |
| `--show-private-key` | boolean | No | false | Also print the private key hex |
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet decrypt-keystore rXXX... --show-private-key
```

### wallet remove

Remove a wallet from the keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--keystore <dir>` | string | No | `~/.xrpl/keystore/` | Keystore directory override |

```bash
xrpl-up wallet remove rXXX...
```

### Example flow: Alice creates a wallet, saves it to the keystore, funds it, and signs a message

```bash
# 1. Generate a new ed25519 wallet for Alice and save it to the keystore
xrpl-up wallet new --key-type ed25519 --save --alias alice
# → Address: rAliceXXXX...  (note this address)

# 2. Fund Alice's account from the testnet faucet
xrpl-up --node testnet wallet fund rAliceXXXX...

# 3. Import Bob's existing seed into the keystore under an alias
xrpl-up wallet import sEdBobSeedXXXXXXXXXXXXXXXXXXXX --alias bob

# 4. List all keystore entries to confirm both wallets are saved
xrpl-up wallet list

# 5. Sign a message as Alice — plain output is the raw hex signature
SIG=$(xrpl-up wallet sign --message "I am Alice" --seed sEdAliceXXXX...)
# → 8BD9A15AFC7F22BC2...

# 6. Get Alice's public key (use --json for clean single-value extraction)
PUBKEY=$(xrpl-up wallet public-key --seed sEdAliceXXXX... --json | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")

# 7. Verify the signature (anyone can do this without secrets)
xrpl-up wallet verify \
  --message "I am Alice" \
  --signature "$SIG" \
  --public-key "$PUBKEY"
# → ✓ Valid signature

# 8. Derive Alice's address from her seed alone
xrpl-up wallet address --seed sEdAliceXXXX...
```

