export interface AmendmentListOptions {
    local?: boolean;
    network?: string;
    diff?: string;
    disabled?: boolean;
}
export declare function amendmentListCommand(options: AmendmentListOptions): Promise<void>;
export interface AmendmentInfoOptions {
    local?: boolean;
    network?: string;
}
export declare function amendmentInfoCommand(nameOrHash: string, options: AmendmentInfoOptions): Promise<void>;
export interface AmendmentToggleOptions {
    local?: boolean;
    autoReset?: boolean;
}
export declare function amendmentEnableCommand(namesOrHashes: string[], options: AmendmentToggleOptions): Promise<void>;
//# sourceMappingURL=amendment.d.ts.map