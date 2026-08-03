#!/usr/bin/env node

const { accessSync, constants, statSync } = require('node:fs');
const { resolve } = require('node:path');

const cliRoot = resolve(__dirname, '..');
const targets = [
  ['darwin', 'arm64', 'happy'],
  ['darwin', 'x64', 'happy'],
  ['linux', 'arm64', 'happy'],
  ['linux', 'x64', 'happy'],
  ['win32', 'arm64', 'happy.exe'],
  ['win32', 'x64', 'happy.exe'],
];

const missing = [];
for (const [platform, arch, binary] of targets) {
  const path = resolve(cliRoot, 'tools', 'cli', platform + '-' + arch, binary);
  try {
    accessSync(path, constants.R_OK);
    const stats = statSync(path);
    if (!stats.isFile() || stats.size === 0) missing.push(path);
  } catch {
    missing.push(path);
  }
}

if (missing.length > 0) {
  console.error('Missing staged native CLI binaries:');
  for (const path of missing) console.error('- ' + path);
  process.exit(1);
}

console.log('All six native CLI binaries are staged.');
