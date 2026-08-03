#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binaryName = process.platform === 'win32' ? 'happy.exe' : 'happy';
const platformDir = process.platform + '-' + process.arch;
const candidates = [
  process.env.HAPPY_CLI_BIN,
  join(packageRoot, 'tools', 'cli', platformDir, binaryName),
  join(packageRoot, 'target', 'release', binaryName),
  join(packageRoot, 'target', 'debug', binaryName),
  resolve(packageRoot, '..', 'happy-cli', 'target', 'release', binaryName),
].filter(Boolean);
const binary = candidates.find((candidate) => existsSync(candidate));

if (!binary) {
  console.error(
    'Native Happy CLI for ' + platformDir + ' was not found. ' +
    'Build it with \"pnpm --filter happy native:build\" or install a release package.',
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    HAPPY_CLI_BIN: binary,
    HAPPY_CLI_PACKAGE_ROOT: packageRoot,
  },
  windowsHide: true,
});
if (result.error) {
  console.error('Failed to start native Happy CLI: ' + result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
