import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { generateRippledConfig, LOCAL_WS_PORT } from '../core/compose';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  errors: string[];           // blocking — config will not work with xrpl-up
  warnings: string[];         // non-blocking but may cause issues
  recommendations: string[];  // optional improvements
}

// ── INI parser helpers ────────────────────────────────────────────────────────

interface IniSection {
  name: string;
  keys: Map<string, string>;  // key → value within the section
  raw: string[];              // raw lines (including keyless values like port names)
}

/**
 * Minimal INI parser for rippled.cfg format.
 * Sections are identified by [name]. Keys are `key = value` pairs.
 * Lines without `=` are treated as raw values (e.g. port names under [server]).
 */
function parseIni(content: string): Map<string, IniSection> {
  const sections = new Map<string, IniSection>();
  let current: IniSection | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim();
      current = { name, keys: new Map(), raw: [] };
      sections.set(name, current);
    } else if (current) {
      if (line.includes('=')) {
        const eqIdx = line.indexOf('=');
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        current.keys.set(key, val);
      } else {
        current.raw.push(line);
      }
    }
  }

  return sections;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a rippled.cfg file for compatibility with xrpl-up.
 * Returns errors (blocking), warnings, and recommendations.
 */
export function validateConfig(filePath: string): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [], recommendations: [] };

  // File must exist
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    result.errors.push(`File not found: ${resolved}`);
    return result;
  }

  let content: string;
  try {
    content = fs.readFileSync(resolved, 'utf-8');
  } catch (err) {
    result.errors.push(`Cannot read file: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const sections = parseIni(content);

  // ── Required sections ────────────────────────────────────────────────────
  if (!sections.has('node_db')) {
    result.errors.push('Missing [node_db] section — rippled will not start');
  }
  if (!sections.has('database_path')) {
    result.errors.push('Missing [database_path] section — rippled will not start');
  }

  // ── WebSocket port detection ─────────────────────────────────────────────
  // Find the port section declared under [server] that uses protocol = ws
  const serverSection = sections.get('server');
  const portNames = serverSection ? serverSection.raw : [];

  let wsPortSection: IniSection | undefined;
  for (const portName of portNames) {
    const sec = sections.get(portName);
    if (sec && sec.keys.get('protocol')?.includes('ws')) {
      wsPortSection = sec;
      break;
    }
  }

  if (!wsPortSection) {
    result.errors.push(
      'No WebSocket port section found — xrpl-up requires a [port_*] section with protocol = ws'
    );
  } else {
    const port = wsPortSection.keys.get('port');
    const ip = wsPortSection.keys.get('ip');
    const admin = wsPortSection.keys.get('admin');

    // Port must match LOCAL_WS_PORT (6006)
    if (port && port !== String(LOCAL_WS_PORT)) {
      result.errors.push(
        `WebSocket port is ${port}, but xrpl-up requires ${LOCAL_WS_PORT}. ` +
        `Change: port = ${LOCAL_WS_PORT}`
      );
    }

    // ip must be 0.0.0.0 so the faucet container can reach it
    if (ip && ip !== '0.0.0.0') {
      result.errors.push(
        `WebSocket ip is "${ip}" — must be 0.0.0.0 so the faucet container can connect. ` +
        `Change: ip = 0.0.0.0`
      );
    }

    // admin must include 0.0.0.0 for ledger_accept and submit commands
    if (admin && !admin.includes('0.0.0.0')) {
      result.errors.push(
        `WebSocket admin is "${admin}" — must include 0.0.0.0 so the faucet can use admin ` +
        `commands (ledger_accept, submit). Change: admin = 0.0.0.0`
      );
    }

    // send_queue_limit warning
    const queueLimit = wsPortSection.keys.get('send_queue_limit');
    if (!queueLimit) {
      result.recommendations.push(
        `Add send_queue_limit = 500 under [${wsPortSection.name}] to avoid throttling ` +
        `during heavy test suites (AMM setup, bulk account funding)`
      );
    } else if (parseInt(queueLimit, 10) < 100) {
      result.warnings.push(
        `send_queue_limit = ${queueLimit} is very low — heavy test suites may be throttled. ` +
        `Consider 500 or higher`
      );
    }
  }

  // ── ssl_verify ───────────────────────────────────────────────────────────
  const sslSection = sections.get('ssl_verify');
  if (!sslSection) {
    result.errors.push(
      'Missing [ssl_verify] section — add [ssl_verify] with value 0 for local dev'
    );
  } else {
    const val = sslSection.raw[0];
    if (val && val.trim() !== '0') {
      result.errors.push(
        `[ssl_verify] is ${val.trim()} — must be 0 for xrpl-up local dev`
      );
    }
  }

  // ── validators_file ──────────────────────────────────────────────────────
  if (!sections.has('validators_file')) {
    result.warnings.push(
      'Missing [validators_file] section — rippled may emit warnings at startup in standalone mode'
    );
  }

  // ── node_size ────────────────────────────────────────────────────────────
  const nodeSizeSection = sections.get('node_size');
  if (nodeSizeSection) {
    const size = nodeSizeSection.raw[0]?.trim().toLowerCase();
    if (size === 'large' || size === 'huge') {
      result.warnings.push(
        `node_size = ${size} requires 8+ GB RAM — likely to OOM on developer laptops. ` +
        `Consider: small (default) or medium`
      );
    } else if (size === 'small') {
      result.recommendations.push(
        'node_size = small is fine for development. Use medium for better throughput if RAM allows (4+ GB)'
      );
    }
  }

  // ── debug_logfile ────────────────────────────────────────────────────────
  if (!sections.has('debug_logfile')) {
    result.recommendations.push(
      'Add [debug_logfile] section (e.g. /var/log/rippled/debug.log) for easier rippled debugging'
    );
  }

  return result;
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Print the validation result to the terminal.
 * Returns true if there are no blocking errors.
 */
export function printValidationResult(filePath: string, result: ValidationResult): boolean {
  const hasErrors = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;
  const hasRecs = result.recommendations.length > 0;
  const isClean = !hasErrors && !hasWarnings && !hasRecs;

  logger.blank();
  logger.log(`${chalk.bold('Config:')} ${chalk.cyan(path.resolve(filePath))}`);
  logger.blank();

  if (isClean) {
    logger.success('No issues found — config is compatible with xrpl-up');
    logger.blank();
    return true;
  }

  if (hasErrors) {
    logger.log(`  ${chalk.red.bold('Errors')}  ${chalk.dim('(config will not work with xrpl-up)')}`);
    logger.log(chalk.dim(`  ${'─'.repeat(52)}`));
    for (const e of result.errors) {
      logger.log(`  ${chalk.red('✗')}  ${e}`);
    }
    logger.blank();
  }

  if (hasWarnings) {
    logger.log(`  ${chalk.yellow.bold('Warnings')}  ${chalk.dim('(non-blocking, may cause issues)')}`);
    logger.log(chalk.dim(`  ${'─'.repeat(52)}`));
    for (const w of result.warnings) {
      logger.log(`  ${chalk.yellow('⚠')}  ${w}`);
    }
    logger.blank();
  }

  if (hasRecs) {
    logger.log(`  ${chalk.blue.bold('Recommendations')}`);
    logger.log(chalk.dim(`  ${'─'.repeat(52)}`));
    for (const r of result.recommendations) {
      logger.log(`  ${chalk.blue('→')}  ${r}`);
    }
    logger.blank();
  }

  return !hasErrors;
}

/** Validate a rippled.cfg and print results. Exits with code 1 on errors. */
export function configValidate(filePath: string): void {
  const result = validateConfig(filePath);
  const ok = printValidationResult(filePath, result);
  if (!ok) {
    process.exit(1);
  }
}

/** Export the default rippled.cfg to stdout or a file. */
export function configExport(options: { output?: string; debug?: boolean } = {}): void {
  const content = generateRippledConfig(options.debug ?? false);

  if (options.output) {
    const dest = path.resolve(options.output);
    fs.writeFileSync(dest, content, 'utf-8');

    // Also write a companion validators.txt in the same directory so the
    // [amendments] section in the exported config can be used immediately.
    const validatorsDest = path.join(path.dirname(dest), 'validators.txt');
    if (!fs.existsSync(validatorsDest)) {
      fs.writeFileSync(validatorsDest, '[validators]\n', 'utf-8');
    }

    logger.blank();
    logger.success(`Config written to ${dest}`);
    logger.dim(`  Edit it, then validate:  xrpl-up config validate ${options.output}`);
    logger.dim(`  Use with local node:     xrpl-up node --local --config ${options.output}`);
    logger.blank();
  } else {
    // Print to stdout — pipeable
    process.stdout.write(content + '\n');
  }
}
