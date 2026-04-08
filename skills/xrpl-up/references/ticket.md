## ticket

Manage XRPL Tickets for sequence-independent transaction ordering.

### ticket create

Reserve ticket sequence numbers on an XRPL account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--count <n>` | integer | **Yes** | — | Number of tickets to create (1–250) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up ticket create --count 5 --seed sEd...
```

### ticket list

List ticket sequence numbers for an account (read-only). The address is a positional argument.

```bash
xrpl-up ticket list <address>
xrpl-up ticket list rAccount... --json
```

### Example flow: Alice reserves ticket sequences for parallel transaction submission

```bash
# 1. Alice creates 5 tickets (sequence numbers she can use independently of her main sequence)
xrpl-up --node testnet ticket create \
  --count 5 --seed sEdAliceXXXX... --json
# → {"hash":"...","result":"tesSUCCESS","sequences":[16331356,16331357,16331358,16331359,16331360]}

# 2. List available ticket sequences on Alice's account
xrpl-up --node testnet ticket list rAliceXXXX...
# → Ticket sequence: 12
#   Ticket sequence: 13
#   ...

# 3. Tickets let Alice submit transactions out of order or in parallel;
#    the CLI will automatically use an available ticket when --ticket <seq> is specified.
```

