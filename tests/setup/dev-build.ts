import { Client } from "xrpl";
import { normalizeDevBuildVersion } from "../../src/utils/dev-build";

// Tests construct their own xrpl Client in ~40 files and call connect()
// directly. Normalize a `0.0.0-dev` build's version after every connect so
// xrpl.js still adds NetworkID (see src/utils/dev-build.ts).
const originalConnect = Client.prototype.connect;
Client.prototype.connect = async function (this: Client) {
  await originalConnect.call(this);
  normalizeDevBuildVersion(this);
};
