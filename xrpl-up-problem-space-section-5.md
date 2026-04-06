# Suggested User / Problem Section

Insert this after `Background` and before `What "High-Fidelity" Means Here`.

## Who This Is For

The primary user is an XRPL application developer who needs deterministic transaction testing without depending on a shared network. This includes engineers building payments, NFTs, AMM flows, or Hooks-adjacent features who want fast feedback and a controlled ledger state during local development, not often reset.

This is not primarily a blockchain explorer, mainnet analytics tool, or production validator operator tool. Its core value is giving product engineers a repeatable place to develop and test transaction behavior.

## The Core Problem

Today, XRPL developers usually choose between two poor options:

- Use Testnet or Devnet, where ledger state is shared, faucet capacity is variable, and resets or downtime can break local workflows.
- Run `rippled` in standalone mode manually, which gives control but requires Docker setup, config tuning, manual ledger closing, and knowledge that most app developers should not need.
- Often get rate limited for test cases

The result is slow iteration, inconsistent test conditions, and extra time spent managing infrastructure instead of validating application logic.

## Jobs To Be Done

`xrpl-up` should help developers do three things well:

1. Test transaction behavior quickly. Submit XRPL transactions and see deterministic results without waiting on a shared public network.
2. Create known account state easily. Start from funded accounts and predictable balances so scripts and tests can focus on business logic.
3. Reset or preserve local state on demand. Wipe the ledger when starting fresh, or keep state across restarts when debugging a longer flow.

## Product Framing

In one sentence: `xrpl-up` is a local XRPL sandbox for developers who need fast, repeatable transaction testing.

That framing keeps the scope clear. The tool is most valuable when it reduces setup friction, shortens feedback loops, and makes XRPL behavior easier to test in a controlled environment.
