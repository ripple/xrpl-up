"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logsCommand = logsCommand;
const chalk_1 = __importDefault(require("chalk"));
const node_fs_1 = __importDefault(require("node:fs"));
const compose_1 = require("../core/compose");
const logger_1 = require("../utils/logger");
async function logsCommand(options = {}) {
    if (!node_fs_1.default.existsSync(compose_1.COMPOSE_FILE)) {
        logger_1.logger.error(`No local stack found. Run \`${(0, compose_1.startCommandHint)()}\` first to start the stack.`);
        process.exit(1);
    }
    const service = options.service;
    const label = service ? chalk_1.default.cyan(service) : chalk_1.default.cyan('all services');
    logger_1.logger.info(`Streaming logs for ${label}  ${chalk_1.default.dim('· Ctrl+C to stop')}`);
    logger_1.logger.blank();
    const child = (0, compose_1.composeLogs)(service);
    child.on('error', (err) => {
        logger_1.logger.error(`Failed to stream logs: ${err.message}`);
        process.exit(1);
    });
    child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            process.exit(code);
        }
    });
    // Forward Ctrl+C to the child process only
    process.on('SIGINT', () => {
        child.kill('SIGINT');
    });
}
