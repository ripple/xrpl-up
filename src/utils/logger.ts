import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(`  ${chalk.cyan('ℹ')}  ${msg}`),
  success: (msg: string) => console.log(`  ${chalk.green('✓')}  ${msg}`),
  warning: (msg: string) => console.log(`  ${chalk.yellow('⚠')}  ${chalk.yellow(msg)}`),
  error: (msg: string) => console.error(`  ${chalk.red('✗')}  ${chalk.red(msg)}`),
  log: (msg: string) => console.log(`  ${msg}`),
  dim: (msg: string) => console.log(chalk.dim(`  ${msg}`)),
  blank: () => console.log(),
  section: (title: string) => {
    console.log(`  ${chalk.bold(title)}`);
    console.log(chalk.dim(`  ${'─'.repeat(50)}`));
  },
};
