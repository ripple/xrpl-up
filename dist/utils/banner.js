"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printBanner = printBanner;
const chalk_1 = __importDefault(require("chalk"));
const pkg = require('../../package.json');
const XRPL_ART = [
    '  ██╗  ██╗██████╗ ██████╗ ██╗     ',
    '  ╚██╗██╔╝██╔══██╗██╔══██╗██║     ',
    '   ╚███╔╝ ██████╔╝██████╔╝██║     ',
    '   ██╔██╗ ██╔══██╗██╔═══╝ ██║     ',
    '  ██╔╝ ██╗██║  ██║██║     ███████╗',
    '  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚══════╝',
];
function printBanner() {
    console.log();
    for (const line of XRPL_ART) {
        console.log(chalk_1.default.cyan.bold(line));
    }
    console.log();
    console.log(`  ${chalk_1.default.bold.cyan('XRPL')} ${chalk_1.default.bold.white('Sandbox')}` +
        `  ${chalk_1.default.dim('─')}  ${chalk_1.default.dim('v' + pkg.version)}`);
    console.log();
}
