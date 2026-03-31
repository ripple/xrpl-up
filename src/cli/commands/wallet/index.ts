import { Command } from "commander";
import { newWalletCommand } from "./new";
import { newMnemonicCommand } from "./new-mnemonic";
import { addressCommand } from "./address";
import { privateKeyCommand } from "./private-key";
import { publicKeyCommand } from "./public-key";
import { importCommand } from "./import";
import { listCommand } from "./list";
import { removeCommand } from "./remove";
import { decryptKeystoreCommand } from "./decrypt-keystore";
import { changePasswordCommand } from "./change-password";
import { signCommand } from "./sign";
import { verifyCommand } from "./verify";
import { aliasCommand } from "./alias";
import { fundCommand } from "./fund";

export const walletCommand = new Command("wallet").description(
  "Wallet management commands"
);

walletCommand.addCommand(newWalletCommand);
walletCommand.addCommand(newMnemonicCommand);
walletCommand.addCommand(addressCommand);
walletCommand.addCommand(privateKeyCommand);
walletCommand.addCommand(publicKeyCommand);
walletCommand.addCommand(importCommand);
walletCommand.addCommand(listCommand);
walletCommand.addCommand(removeCommand);
walletCommand.addCommand(decryptKeystoreCommand);
walletCommand.addCommand(changePasswordCommand);
walletCommand.addCommand(signCommand);
walletCommand.addCommand(verifyCommand);
walletCommand.addCommand(aliasCommand);
walletCommand.addCommand(fundCommand);
