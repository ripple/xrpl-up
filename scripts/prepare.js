// Runs on `npm install` and, for a git install, on the installer's machine.
// Build when TypeScript is available. An install from a git ref may not have
// the dev dependencies (npm 10 skips them), so fall back to the prebuilt dist/
// that release builds commit, and fail loudly if there is neither.
const { existsSync } = require('node:fs');
const { execSync } = require('node:child_process');

let hasTsc = false;
try { require.resolve('typescript/bin/tsc'); hasTsc = true; } catch { /* not installed */ }

if (hasTsc) {
  execSync('npm run build', { stdio: 'inherit' });
} else if (existsSync('dist/cli.js')) {
  console.log('typescript is not installed; using the prebuilt dist/');
} else {
  console.error('typescript is not installed and there is no prebuilt dist/ — cannot build xrpl-up');
  process.exit(1);
}
