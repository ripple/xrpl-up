"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const chalk_1 = __importDefault(require("chalk"));
exports.logger = {
    info: (msg) => console.log(`  ${chalk_1.default.cyan('ℹ')}  ${msg}`),
    success: (msg) => console.log(`  ${chalk_1.default.green('✓')}  ${msg}`),
    warning: (msg) => console.log(`  ${chalk_1.default.yellow('⚠')}  ${chalk_1.default.yellow(msg)}`),
    error: (msg) => console.error(`  ${chalk_1.default.red('✗')}  ${chalk_1.default.red(msg)}`),
    log: (msg) => console.log(`  ${msg}`),
    dim: (msg) => console.log(chalk_1.default.dim(`  ${msg}`)),
    blank: () => console.log(),
    section: (title) => {
        console.log(`  ${chalk_1.default.bold(title)}`);
        console.log(chalk_1.default.dim(`  ${'─'.repeat(50)}`));
    },
};
