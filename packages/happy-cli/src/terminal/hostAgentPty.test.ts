import { describe, expect, it } from 'vitest';
import {
  hostAgentBinaryCandidates,
  resolveHostAgentBinary,
  selectHostAgentPtyBackend,
} from './hostAgentPty';

describe('host agent PTY selection', () => {
  it('prefers an explicitly configured native binary', () => {
    const candidates = hostAgentBinaryCandidates({
      projectRoot: 'C:\\happy\\packages\\happy-cli',
      platform: 'win32',
      arch: 'x64',
      configuredPath: 'D:\\native\\happy-host-agent.exe',
    });

    expect(candidates[0]).toBe('D:\\native\\happy-host-agent.exe');
    expect(candidates[1]).toContain('win32-x64');
    expect(candidates[2]).toContain('happy-host-agent');
  });

  it('returns the first existing candidate and otherwise falls back', () => {
    const expected = 'D:\\native\\happy-host-agent.exe';
    expect(resolveHostAgentBinary({
      configuredPath: expected,
      exists: (candidate) => candidate === expected,
    })).toBe(expected);
    expect(resolveHostAgentBinary({ exists: () => false })).toBeUndefined();
  });

  const nativeBackend = selectHostAgentPtyBackend();
  it.runIf(nativeBackend !== undefined)('runs a command through the native PTY bridge', async () => {
    const isWindows = process.platform === 'win32';
    const marker = '__HAPPY_RUST_BRIDGE_OK__';
    const terminal = nativeBackend!.spawn({
      file: isWindows
        ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        : (process.env.SHELL || '/bin/sh'),
      args: isWindows ? ['-NoLogo', '-NoProfile', '-NoExit'] : ['-i'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      env: process.env,
    });

    await new Promise<void>((resolve, reject) => {
      let output = '';
      let exitSent = false;
      const timeout = setTimeout(() => {
        terminal.kill();
        reject(new Error('native PTY bridge timed out'));
      }, 15_000);

      terminal.onData((data) => {
        output += data;
        if (data.includes('\u001b[6n')) {
          terminal.write('\u001b[1;1R');
        }
        if (!exitSent && output.includes(marker)) {
          exitSent = true;
          terminal.write('exit\r');
        }
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (!output.includes(marker)) {
          reject(new Error(`native PTY exited before marker (code ${exitCode})`));
          return;
        }
        resolve();
      });

      terminal.write(isWindows
        ? "Write-Output ('__HAPPY_' + 'RUST_BRIDGE_OK__')\r"
        : "printf '%s%s\\n' '__HAPPY_' 'RUST_BRIDGE_OK__'\r");
    });
  });
});
