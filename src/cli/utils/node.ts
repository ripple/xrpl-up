import { Command } from "commander";
import { resolveNodeUrl } from "./client";
import { looksLikeMainnetUrl } from "../../core/config";

let mainnetWarningShown = false;

/** Returns the resolved XRPL node WebSocket URL from the global --node option. */
export function getNodeUrl(cmd: Command): string {
  const opts = cmd.optsWithGlobals() as { node: string };
  const url = resolveNodeUrl(opts.node);
  if (!mainnetWarningShown && looksLikeMainnetUrl(url)) {
    process.stderr.write(
      "Warning: The node URL appears to be an XRPL production endpoint. " +
      "xrpl-up is intended for local and test network development only.\n"
    );
    mainnetWarningShown = true;
  }
  return url;
}
