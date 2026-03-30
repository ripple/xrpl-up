import { Command } from "commander";
import { infoCommand } from "./info";
import { balanceCommand } from "./balance";
import { transactionsCommand } from "./transactions";
import { offersCommand } from "./offers";
import { trustLinesCommand } from "./trust-lines";
import { channelsCommand } from "./channels";
import { nftsCommand } from "./nfts";
import { setCommand } from "./set";
import { deleteCommand } from "./delete";
import { setRegularKeyCommand } from "./set-regular-key";
import { mptokensCommand } from "./mptokens";

export const accountCommand = new Command("account").description(
  "Account management commands"
);

accountCommand.addCommand(infoCommand);
accountCommand.addCommand(balanceCommand);
accountCommand.addCommand(transactionsCommand);
accountCommand.addCommand(offersCommand);
accountCommand.addCommand(trustLinesCommand);
accountCommand.addCommand(channelsCommand);
accountCommand.addCommand(nftsCommand);
accountCommand.addCommand(mptokensCommand);
accountCommand.addCommand(setCommand);
accountCommand.addCommand(deleteCommand);
accountCommand.addCommand(setRegularKeyCommand);
