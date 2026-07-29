#!/usr/bin/env node

const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const cliRoot = resolve(__dirname, '..');
const hostAgentRoot = resolve(cliRoot, '..', 'happy-host-agent');
const manifest = resolve(hostAgentRoot, 'Cargo.toml');
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const binaryName = process.platform === 'win32' ? 'happy-host-agent.exe' : 'happy-host-agent';
const cargo = process.env.CARGO
  || (existsSync(resolve(homedir(), '.cargo', 'bin', cargoName))
    ? resolve(homedir(), '.cargo', 'bin', cargoName)
    : cargoName);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const target = argumentValue('--target');
const stagePlatform = argumentValue('--platform') || process.platform;
const stageArch = argumentValue('--arch') || process.arch;
const stageBinaryName = stagePlatform === 'win32' ? 'happy-host-agent.exe' : 'happy-host-agent';
const cargoArgs = ['build', '--locked', '--release', '--manifest-path', manifest];
if (target) {
  cargoArgs.push('--target', target);
}

const result = spawnSync(cargo, cargoArgs, {
  cwd: cliRoot,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`Failed to start Cargo: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (process.argv.includes('--stage')) {
  const source = target
    ? resolve(hostAgentRoot, 'target', target, 'release', stageBinaryName)
    : resolve(hostAgentRoot, 'target', 'release', binaryName);
  const destinationDir = resolve(
    cliRoot,
    'tools',
    'host-agent',
    `${stagePlatform}-${stageArch}`,
  );
  const destination = resolve(destinationDir, stageBinaryName);
  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(source, destination);
  console.log(`Staged Rust terminal runtime: ${destination}`);
}
