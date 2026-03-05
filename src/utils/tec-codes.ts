/**
 * Human-readable descriptions for XRPL transaction result codes.
 * Covers the most common tec, ter, and tef codes a developer will encounter.
 */
export const TEC_MESSAGES: Record<string, string> = {
  // ── Success ──────────────────────────────────────────────────────────────
  tesSUCCESS:                 'Success',

  // ── tec — claimed fee, action not performed ───────────────────────────────
  tecCLAIM:                   'Fee claimed but action not performed',
  tecDIR_FULL:                'Directory full — too many owned objects',
  tecDUPLICATE:               'Object already exists',
  tecEXPIRED:                 'Offer or escrow has expired',
  tecFAILED_PROCESSING:       'Failed to process transaction',
  tecFROZEN:                  'Asset or trust line is frozen',
  tecHAS_OBLIGATIONS:         'Cannot delete account — still has obligations',
  tecINSUF_FEE:               'Insufficient XRP to cover transaction fee',
  tecINSUFFICIENT_FUNDS:      'Insufficient funds for this operation',
  tecINSUFFICIENT_PAYMENT:    'Payment amount insufficient',
  tecINSUFFICIENT_RESERVE:    'Insufficient XRP reserve for this operation',
  tecINTERNAL:                'Internal rippled error',
  tecINVARIANT_FAILED:        'Invariant check failed',
  tecKILLED:                  'Offer killed — fill-or-kill could not fill completely',
  tecNEED_MASTER_KEY:         'Master key required for this operation',
  tecNO_ALT_DST:              'Destination requires direct XRP payment',
  tecNO_AUTH:                 'Not authorized — account requires authorization',
  tecNO_DST:                  'Destination account does not exist',
  tecNO_DST_INSUF_XRP:        'Destination account needs more XRP to meet reserve',
  tecNO_LINE:                 'No trust line exists for this asset',
  tecNO_LINE_INSUF_RESERVE:   'Insufficient XRP reserve to create trust line',
  tecNO_LINE_REDUNDANT:       'Trust line would be redundant',
  tecNO_PERMISSION:           'Not authorized to perform this action',
  tecNO_REGULAR_KEY:          'No regular key set on this account',
  tecNO_SUITABLE_NFTOKEN_PAGE:'No suitable NFToken page found',
  tecNO_TARGET:               'Target account or object does not exist',
  tecOBJECT_NOT_FOUND:        'Specified object not found',
  tecOVERSIZE:                'Transaction or ledger entry too large',
  tecOWNERS:                  'Too many owned objects (offers, trust lines, escrows, etc.)',
  tecPATH_DRY:                'No liquidity available on payment path',
  tecPATH_PARTIAL:            'Could not send full amount — use tfPartialPayment flag',
  tecTOO_SOON:                'Sequence number too soon — try again next ledger',
  tecUNFUNDED:                'Insufficient funds',
  tecUNFUNDED_ADD:            'Insufficient XRP to add to payment channel',
  tecUNFUNDED_OFFER:          'Insufficient funds to create this offer',
  tecUNFUNDED_PAYMENT:        'Sender has insufficient XRP for this payment',
  tecWRONG_NFTOKEN_ISSUER:    'NFToken issuer does not match',

  // ── ter — retry ───────────────────────────────────────────────────────────
  terFUNDS_SPENT:             'Funds already spent',
  terINSUF_FEE_B:             'Fee insufficient — raise the fee and retry',
  terLAST:                    'Last ter code',
  terNO_ACCOUNT:              'Account does not exist — fund it first',
  terNO_AUTH:                 'Not authorized — retry after authorization',
  terNO_LINE:                 'No trust line — create it and retry',
  terNO_RIPPLE:               'Path does not support rippling',
  terOWNERS:                  'Too many owned objects — retry after removing some',
  terPRE_SEQ:                 'Missing prior transaction in sequence — retry',
  terQUEUED:                  'Transaction queued — will be applied in a future ledger',
  terRETRY:                   'Transaction should be retried',
  terSUBMITTED:               'Transaction already submitted',

  // ── tef — failure, fee not charged ───────────────────────────────────────
  tefALREADY:                 'Transaction already applied',
  tefBAD_ADD_AUTH:            'Bad add authorization',
  tefBAD_AUTH:                'Invalid transaction authorization',
  tefBAD_AUTH_MASTER:         'Master key used when disabled',
  tefBAD_LEDGER:              'Ledger in unexpected state',
  tefBAD_QUORUM:              'Quorum not met for multi-signature',
  tefBAD_SIGNATURE:           'Invalid signature',
  tefCREATED:                 'Object already created',
  tefEXCEPTION:               'Unexpected exception in transaction processing',
  tefFAILURE:                 'Unknown failure',
  tefGAS_INSUFFICIENT:        'Insufficient gas for EVM transaction',
  tefINTERNAL:                'Internal error — please report',
  tefINVARIANT_FAILED:        'Invariant check failed before fee could be charged',
  tefMASTER_DISABLED:         'Master key is disabled on this account',
  tefMAX_LEDGER:              'Transaction cannot be applied — max ledger exceeded',
  tefNFTOKEN_IS_NOT_TRANSFERABLE: 'NFToken is not transferable',
  tefNO_AUTH_REQUIRED:        'Authorization not required for this account',
  tefNOT_MULTI_SIGNING:       'Transaction looks like multi-sig but is not',
  tefPAST_SEQ:                'Sequence number already used',
  tefTOO_BIG:                 'Transaction too large',
  tefWRONG_PRIOR:             'Wrong prior transaction',
};

/**
 * Returns a human-readable description for a transaction result code.
 * Falls back to the raw code if not found.
 */
export function tecMessage(code: string): string {
  return TEC_MESSAGES[code] ?? code;
}
