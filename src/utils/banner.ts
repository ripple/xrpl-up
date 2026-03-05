import chalk from 'chalk';

const pkg = require('../../package.json') as { version: string };

const XRPL_ART = [
  '  ██╗  ██╗██████╗ ██████╗ ██╗     ',
  '  ╚██╗██╔╝██╔══██╗██╔══██╗██║     ',
  '   ╚███╔╝ ██████╔╝██████╔╝██║     ',
  '   ██╔██╗ ██╔══██╗██╔═══╝ ██║     ',
  '  ██╔╝ ██╗██║  ██║██║     ███████╗',
  '  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚══════╝',
];

export function printBanner(): void {
  console.log();
  for (const line of XRPL_ART) {
    console.log(chalk.cyan.bold(line));
  }
  console.log();
  console.log(
    `  ${chalk.bold.cyan('XRPL')} ${chalk.bold.white('Sandbox')}` +
    `  ${chalk.dim('─')}  ${chalk.dim('v' + pkg.version)}`
  );
  console.log();
}
