export interface XRPAmount {
    type: "xrp";
    drops: string;
}
export interface IssuedTokenAmount {
    type: "iou";
    value: string;
    currency: string;
    issuer: string;
}
export interface MPTAmount {
    type: "mpt";
    value: string;
    mpt_issuance_id: string;
}
export type ParsedAmount = XRPAmount | IssuedTokenAmount | MPTAmount;
export declare function parseAmount(input: string): ParsedAmount;
export declare function toXrplAmount(parsed: ParsedAmount): string | {
    value: string;
    currency: string;
    issuer: string;
} | {
    value: string;
    mpt_issuance_id: string;
};
export declare function formatAmount(parsed: ParsedAmount): string;
//# sourceMappingURL=amount.d.ts.map