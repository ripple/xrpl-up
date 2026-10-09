"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AMENDMENTS = void 0;
const default_amendments_json_1 = __importDefault(require("./default-amendments.json"));
/**
 * Amendments force-enabled at genesis. Generated at build time by
 * scripts/generate-default-amendments.ts for the exact xrpld this build of
 * xrpl-up runs: enabled on mainnet, supported by that xrpld, and not retired
 * (Obsolete) in it.
 */
exports.DEFAULT_AMENDMENTS = default_amendments_json_1.default.amendments;
