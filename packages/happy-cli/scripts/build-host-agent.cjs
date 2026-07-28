#!/usr/bin/env node

const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const cliRoot = resolve(__dirname, '..');
const manifest = resolve(cliRoot, '..', 'happy-host-agent', 'Cargo.toml');
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const cargo = process.env.CARGO
  || (existsSync(resolve(homedir(), '.cargo', 'bin', cargoName))
    ? resolve(homedir(), '.cargo', 'bin', cargoName)
    : cargoName);

const result = spawnSync(cargo, ['build', '--release', '--manifest-path', manifest], {
  cwd: cliRoot,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`Failed to start Cargo: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
