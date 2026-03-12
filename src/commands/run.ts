import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { loadConfig, resolveNetwork } from '../core/config';
import { logger } from '../utils/logger';

export interface RunOptions {
  network?: string;
  script: string;
  scriptArgs?: string[];
}

export async function runCommand(options: RunOptions): Promise<void> {
  const config = loadConfig();
  const { name: networkName, config: networkConfig } = resolveNetwork(
    config,
    options.network
  );

  const scriptPath = path.resolve(process.cwd(), options.script);

  if (!fs.existsSync(scriptPath)) {
    logger.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  logger.info(`Running: ${options.script}`);
  logger.info(`Network: ${networkConfig.name ?? networkName} (${networkConfig.url})`);
  logger.blank();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XRPL_NETWORK: networkName,
    XRPL_NETWORK_URL: networkConfig.url,
    XRPL_NETWORK_NAME: networkConfig.name ?? networkName,
  };

  const isTs = scriptPath.endsWith('.ts');
  let command: string;
  let args: string[];

  if (isTs) {
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const tsNodeBin = path.join(process.cwd(), 'node_modules', '.bin', 'ts-node');
    // Also try globally installed tsx/ts-node
    if (fs.existsSync(tsxBin)) {
      command = tsxBin;
      args = [scriptPath, ...(options.scriptArgs ?? [])];
    } else if (fs.existsSync(tsNodeBin)) {
      command = tsNodeBin;
      args = [scriptPath, ...(options.scriptArgs ?? [])];
    } else {
      // Fall back to npx tsx
      command = 'npx';
      args = ['tsx', scriptPath, ...(options.scriptArgs ?? [])];
    }
  } else {
    command = process.execPath;
    args = [scriptPath, ...(options.scriptArgs ?? [])];
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit', env });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        logger.blank();
        logger.success('Script completed successfully.');
        resolve();
      } else {
        logger.blank();
        logger.error(`Script exited with code ${code}`);
        process.exit(code ?? 1);
      }
    });
  });
}
