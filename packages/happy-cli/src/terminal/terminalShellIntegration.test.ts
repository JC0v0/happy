import { describe, expect, it } from 'vitest';
import {
  POWERSHELL_SHELL_INTEGRATION_SCRIPT,
  TerminalShellIntegrationParser,
  type TerminalShellToken,
} from './terminalShellIntegration';

function simplify(tokens: TerminalShellToken[]) {
  return tokens.map((token) => token.type === 'data' ? token.data : token.marker);
}

describe('TerminalShellIntegrationParser', () => {
  it('extracts command, cwd, completion and prompt markers while preserving visible data', () => {
    const parser = new TerminalShellIntegrationParser();
    const command = Buffer.from('Write-Output 你好', 'utf8').toString('base64');
    const tokens = parser.push(
      `before\u001b]133;C;${command}\u0007` +
      `\u001b]7;file:///C:/Users/Administrator\u0007` +
      `\u001b]133;D;7\u0007\u001b]133;A\u0007PS> `,
    );

    expect(simplify(tokens)).toEqual([
      'before',
      { type: 'command-started', command: 'Write-Output 你好' },
      { type: 'cwd', path: 'C:\\Users\\Administrator' },
      { type: 'command-finished', exitCode: 7 },
      { type: 'prompt' },
      'PS> ',
    ]);
  });

  it('handles OSC sequences split across PTY chunks', () => {
    const parser = new TerminalShellIntegrationParser();
    expect(simplify(parser.push('one\u001b]133;D'))).toEqual(['one']);
    expect(simplify(parser.push(';0\u0007two'))).toEqual([
      { type: 'command-finished', exitCode: 0 },
      'two',
    ]);
  });

  it('supports ST terminators and Unix file URIs', () => {
    const parser = new TerminalShellIntegrationParser();
    expect(simplify(parser.push('\u001b]7;file:///home/me/work\u001b\\'))).toEqual([
      { type: 'cwd', path: '/home/me/work' },
    ]);
  });

  it('passes unknown OSC controls through byte-for-byte', () => {
    const parser = new TerminalShellIntegrationParser();
    const title = '\u001b]0;project title\u0007';
    expect(simplify(parser.push(title))).toEqual([title]);
  });

  it('passes malformed command markers through instead of inventing a command', () => {
    const parser = new TerminalShellIntegrationParser();
    const malformed = '\u001b]133;C;not base64!\u0007';
    expect(simplify(parser.push(malformed))).toEqual([malformed]);
  });

  it('flushes an incomplete control sequence without dropping data', () => {
    const parser = new TerminalShellIntegrationParser();
    expect(parser.push('\u001b]133')).toEqual([]);
    expect(simplify(parser.flush())).toEqual(['\u001b]133']);
  });
});

describe('PowerShell shell integration script', () => {
  it('wraps the existing prompt and emits OSC 7 and OSC 133 markers', () => {
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain('${function:prompt}');
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain('Import-Module PSReadLine');
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain('${function:PSConsoleHostReadLine}');
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain(']133;C;');
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain(']7;');
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain(']133;D;');
    expect(POWERSHELL_SHELL_INTEGRATION_SCRIPT).toContain(']133;A');
  });
});
