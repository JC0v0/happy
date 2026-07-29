#!/usr/bin/env node

const { accessSync, constants, statSync } = require('node:fs');
const { resolve } = require('node:path');

const cliRoot = resolve(__dirname, '..');
const targets = [
  ['darwin', 'arm64', 'happy-host-agent'],
  ['darwin', 'x64', 'happy-host-agent'],
  ['linux', 'arm64', 'happy-host-agent'],
  ['linux', 'x64', 'happy-host-agent'],
  ['win32', 'arm64', 'happy-host-agent.exe'],
  ['win32', 'x64', 'happy-host-agent.exe'],
];

const missing = [];
for (const [platform, arch, binary] of targets) {
  const path = resolve(cliRoot, 'tools', 'host-agent', `${platform}-${arch}`, binary);
  try {
    accessSync(path, constants.R_OK);
    const stats = statSync(path);
    if (!stats.isFile() || stats.size === 0) {
      missing.push(path);
    }
  } catch {
    missing.push(path);
  }
}

if (missing.length > 0) {
  console.error('Missing staged Rust terminal binaries:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log('All six Rust terminal runtime binaries are staged.');
