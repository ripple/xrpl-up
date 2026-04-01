#!/usr/bin/env node
// ── Node.js version guard ─────────────────────────────────────────────────────
// Must run before any import so the error is readable rather than a cryptic
// crash inside a dependency.  package.json engines.node mirrors this value.
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 20) {
  process.stderr.write(
    `xrpl requires Node.js 20 or later.\n` +
    `You are running Node.js ${process.versions.node}.\n` +
    `Please upgrade: https://nodejs.org/en/download\n`,
  );
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from "commander";
import { accountCommand, ammCommand, walletCommand, paymentCommand, trustCommand, offerCommand, channelCommand, escrowCommand, checkCommand, clawbackCommand, credentialCommand, nftCommand, multisigCommand, oracleCommand, ticketCommand, depositPreauthCommand, mptokenCommand, permissionedDomainCommand, vaultCommand, didCommand } from "./commands/index";

const VERSION = "0.1.3";

const BANNER = `             _         _ _             
 _ _ ___ ___| |___ ___| |_|___ ___ ___ 
|_'_|  _| . | |___|  _| | |___|   | . |
|_,_|_| |  _|_|   |___|_|_|   |_|_|_  |
        |_|                       |___|
v${VERSION}
`;

const program = new Command();

program
  .name("xrpl")
  .description("CLI for interacting with the XRP Ledger")
  .version(VERSION)
  .addHelpText("beforeAll", BANNER)
  .option(
    "-n, --node <url>",
    "XRPL node URL or network name (mainnet|testnet|devnet)",
    process.env.XRPL_NODE ?? "testnet"
  );

program.addCommand(accountCommand);
program.addCommand(walletCommand);
program.addCommand(paymentCommand);
program.addCommand(trustCommand);
program.addCommand(offerCommand);
program.addCommand(channelCommand);
program.addCommand(escrowCommand);
program.addCommand(checkCommand);
program.addCommand(clawbackCommand);
program.addCommand(credentialCommand);
program.addCommand(nftCommand);
program.addCommand(multisigCommand);
program.addCommand(oracleCommand);
program.addCommand(ticketCommand);
program.addCommand(depositPreauthCommand);
program.addCommand(mptokenCommand);
program.addCommand(permissionedDomainCommand);
program.addCommand(vaultCommand);
program.addCommand(didCommand);
program.addCommand(ammCommand);

program.parse();
