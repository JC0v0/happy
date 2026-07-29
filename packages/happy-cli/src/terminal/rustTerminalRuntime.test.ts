import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RustTerminalRuntime,
  hostAgentBinaryCandidates,
  requireHostAgentBinary,
  resolveHostAgentBinary,
} from './rustTerminalRuntime';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('authoritative Rust terminal runtime', () => {
  it('prefers an explicitly configured native binary', () => {
    const candidates = hostAgentBinaryCandidates({
      projectRoot: 'C:\\happy\\packages\\happy-cli',
      platform: 'win32',
      arch: 'x64',
      configuredPath: 'D:\\native\\happy-host-agent.exe',
    });

    expect(candidates[0]).toBe('D:\\native\\happy-host-agent.exe');
    expect(candidates[1]).toContain('tools');
    expect(candidates[2]).toContain('win32-x64');
    expect(candidates[3]).toContain('happy-host-agent');
  });

  it('fails clearly instead of silently falling back to node-pty', () => {
    expect(() => requireHostAgentBinary({
      exists: () => false,
    })).toThrow(/Rust terminal runtime is required/);

    expect(() => requireHostAgentBinary({
      configuredPath: '/tmp/old-host-agent',
      exists: (candidate) => candidate === '/tmp/old-host-agent',
      probe: () => false,
    })).toThrow(/support protocol 2/);
  });

  it('skips an incompatible stale binary when a current build is available', () => {
    const binary = requireHostAgentBinary({
      projectRoot: '/happy/packages/happy-cli',
      platform: 'linux',
      arch: 'x64',
      configuredPath: '/tmp/stale-host-agent',
      exists: () => true,
      probe: (candidate) => candidate.includes('/tools/host-agent/linux-x64/'),
    });

    expect(binary).toContain('/tools/host-agent/linux-x64/happy-host-agent');
  });

  it.skipIf(process.platform === 'win32')(
    'repairs executable mode when dependency scripts were disabled',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'happy-rust-runtime-mode-'));
      temporaryDirectories.push(root);
      const binaryPath = join(root, 'happy-host-agent');
      writeFileSync(binaryPath, 'test');
      chmodSync(binaryPath, 0o644);

      const resolved = requireHostAgentBinary({
        configuredPath: binaryPath,
        exists: (candidate) => candidate === binaryPath,
        probe: (candidate) => (
          candidate === binaryPath
          && (statSync(candidate).mode & 0o111) !== 0
        ),
      });

      expect(resolved).toBe(binaryPath);
      expect(statSync(binaryPath).mode & 0o777).toBe(0o755);
    },
  );

  const nativeBinary = resolveHostAgentBinary();
  it.runIf(nativeBinary !== undefined)(
    'runs raw I/O and snapshots through the Rust state owner',
    async () => {
      const marker = '__HAPPY_RUST_RUNTIME_OK__';
      let output = '';
      let runtimeExit: ((exitCode: number) => void) | undefined;
      const exit = new Promise<number>((resolve) => {
        runtimeExit = resolve;
      });
      const runtime = await RustTerminalRuntime.start({
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        env: process.env,
        onEvent: (event) => {
          if (event.t === 'output') {
            output += Buffer.from(event.data, 'base64').toString('utf8');
          }
        },
        onExit: (exitCode) => runtimeExit?.(exitCode),
      });

      await runtime.reportViewport('test-client', 80, 24);
      const executeMarker = '__HAPPY_RUST_EXECUTE_OK__';
      const execute = await runtime.execute(
        'test-client',
        process.platform === 'win32'
          ? `Write-Output '${executeMarker}'`
          : `printf '%s\\n' '${executeMarker}'`,
      );
      expect(execute.tracked).toBe(runtime.capabilities.structuredCommands);

      await runtime.write(
        'test-client',
        Buffer.from(
          process.platform === 'win32'
            ? `Write-Output '${marker}'\r`
            : `printf '%s\\n' '${marker}'\r`,
          'utf8',
        ),
      );

      const deadline = Date.now() + 10_000;
      while (
        (!output.includes(marker) || !output.includes(executeMarker))
        && Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(output).toContain(marker);
      expect(output).toContain(executeMarker);

      const snapshot = await runtime.snapshot();
      expect(snapshot.events.some((event) => (
        event.t === 'output'
        && Buffer.from(event.data, 'base64').toString('utf8').includes(marker)
      ))).toBe(true);

      await runtime.write('test-client', Buffer.from('exit\r', 'utf8'));
      await expect(Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Rust terminal did not exit')), 10_000);
        }),
      ])).resolves.toBe(0);
    },
    30_000,
  );
});
