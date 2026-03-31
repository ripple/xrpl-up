import { Command } from "commander";
import { resolveNodeUrl } from "./client";

/** Returns the resolved XRPL node WebSocket URL from the global --node option. */
export function getNodeUrl(cmd: Command): string {
  const opts = cmd.optsWithGlobals() as { node: string };
  return resolveNodeUrl(opts.node);
}
