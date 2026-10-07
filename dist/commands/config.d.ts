export interface ValidationResult {
    errors: string[];
    warnings: string[];
    recommendations: string[];
}
/**
 * Validate a rippled.cfg file for compatibility with xrpl-up.
 * Returns errors (blocking), warnings, and recommendations.
 */
export declare function validateConfig(filePath: string): ValidationResult;
/**
 * Print the validation result to the terminal.
 * Returns true if there are no blocking errors.
 */
export declare function printValidationResult(filePath: string, result: ValidationResult): boolean;
/** Validate a rippled.cfg and print results. Exits with code 1 on errors. */
export declare function configValidate(filePath: string): void;
/** Export the default rippled.cfg to stdout or a file. */
export declare function configExport(options?: {
    output?: string;
    debug?: boolean;
}): void;
//# sourceMappingURL=config.d.ts.map