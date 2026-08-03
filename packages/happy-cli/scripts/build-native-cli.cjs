#!/usr/bin/env node

const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
} = require('node:fs');
const { homedir } = require('node:os');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const cliRoot = resolve(__dirname, '..');
const manifest = resolve(cliRoot, 'Cargo.toml');
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const cargo = process.env.CARGO
  || (existsSync(resolve(homedir(), '.cargo', 'bin', cargoName))
    ? resolve(homedir(), '.cargo', 'bin', cargoName)
    : cargoName);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'happy.exe' : 'happy';
}

function targetPath(target) {
  return target
    ? resolve(cliRoot, 'target', target, 'release', executableName(platformForTarget(target)))
    : resolve(cliRoot, 'target', 'release', executableName());
}

function platformForTarget(target) {
  if (!target) return process.platform;
  if (target.includes('apple-darwin')) return 'darwin';
  if (target.includes('linux')) return 'linux';
  if (target.includes('windows')) return 'win32';
  throw new Error('Cannot infer platform from Rust target ' + target);
}

function archForTarget(target) {
  if (!target) return process.arch;
  if (target.startsWith('aarch64')) return 'arm64';
  if (target.startsWith('x86_64')) return 'x64';
  throw new Error('Cannot infer architecture from Rust target ' + target);
}

const target = argumentValue('--target') || process.env.RUST_TARGET;
const cargoArgs = ['build', '--locked', '--release', '--manifest-path', manifest];
if (target) cargoArgs.push('--target', target);

const result = spawnSync(cargo, cargoArgs, {
  cwd: cliRoot,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error('Failed to start Cargo: ' + result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const source = targetPath(target);
if (!existsSync(source)) {
  console.error('Cargo completed but native CLI was not found at ' + source);
  process.exit(1);
}

if (process.argv.includes('--stage')) {
  const platform = argumentValue('--platform') || platformForTarget(target);
  const arch = argumentValue('--arch') || archForTarget(target);
  const destinationDir = resolve(cliRoot, 'tools', 'cli', platform + '-' + arch);
  const destination = resolve(destinationDir, executableName(platform));
  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(source, destination);
  if (platform !== 'win32') chmodSync(destination, 0o755);
  console.log('Staged native Happy CLI: ' + destination);
}
