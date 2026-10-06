import defaultAmendments from './default-amendments.json';

export interface Amendment {
  hash: string;
  name: string;
}

/**
 * Amendments force-enabled at genesis. Generated at build time by
 * scripts/generate-default-amendments.ts for the exact xrpld this build of
 * xrpl-up runs: enabled on mainnet, supported by that xrpld, and not retired
 * (Obsolete) in it.
 */
export const DEFAULT_AMENDMENTS: Amendment[] =
  (defaultAmendments as unknown as { amendments: Amendment[] }).amendments;
