"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const config_1 = require("../core/config");
const logger_1 = require("../utils/logger");
async function runCommand(options) {
    const config = (0, config_1.loadConfig)();
    const { name: networkName, config: networkConfig } = (0, config_1.resolveNetwork)(config, options.network);
    const scriptPath = path_1.default.resolve(process.cwd(), options.script);
    if (!fs_1.default.existsSync(scriptPath)) {
        logger_1.logger.error(`Script not found: ${scriptPath}`);
        process.exit(1);
    }
    // Written directly to stderr (not the shared `logger`, which uses stdout) so
    // `$(xrpl-up run script.ts)` can cleanly capture only the script's own stdout
    // output (e.g. a JSON line), without these status banners mixed in.
    process.stderr.write(`  ℹ  Running: ${options.script}\n`);
    process.stderr.write(`  ℹ  Network: ${networkConfig.name ?? networkName} (${networkConfig.url})\n\n`);
    const env = {
        ...process.env,
        XRPL_NETWORK: networkName,
        XRPL_NETWORK_URL: networkConfig.url,
        XRPL_NETWORK_NAME: networkConfig.name ?? networkName,
    };
    const isTs = scriptPath.endsWith('.ts');
    let command;
    let args;
    if (isTs) {
        const tsxBin = path_1.default.join(process.cwd(), 'node_modules', '.bin', 'tsx');
        const tsNodeBin = path_1.default.join(process.cwd(), 'node_modules', '.bin', 'ts-node');
        // Also try globally installed tsx/ts-node
        if (fs_1.default.existsSync(tsxBin)) {
            command = tsxBin;
            args = [scriptPath, ...(options.scriptArgs ?? [])];
        }
        else if (fs_1.default.existsSync(tsNodeBin)) {
            command = tsNodeBin;
            args = [scriptPath, ...(options.scriptArgs ?? [])];
        }
        else {
            // Fall back to npx tsx
            command = 'npx';
            args = ['tsx', scriptPath, ...(options.scriptArgs ?? [])];
        }
    }
    else {
        command = process.execPath;
        args = [scriptPath, ...(options.scriptArgs ?? [])];
    }
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(command, args, { stdio: 'inherit', env });
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) {
                process.stderr.write(`\n  ✓  Script completed successfully.\n`);
                resolve();
            }
            else {
                process.stderr.write(`\n  ✗  Script exited with code ${code}\n`);
                process.exit(code ?? 1);
            }
        });
    });
}
