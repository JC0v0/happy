'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const args = [
  'build',
  './sources/standalone.ts',
  '--target',
  'node',
  '--format',
  'esm',
  '--outfile',
  'dist/standalone.mjs',
];

for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  args.push('--external', dependency);
}

const result = spawnSync('bun', args, {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
