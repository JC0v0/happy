/**
 * Minimal shell-integration parser used by terminal sessions.
 *
 * The shell writes standard OSC 7 (working directory) and OSC 133 prompt
 * markers into the PTY stream. We consume only the markers Happy understands
 * and preserve every other escape sequence byte-for-byte for xterm.
 */

export type TerminalShellMarker =
  | { type: 'cwd'; path: string }
  | { type: 'command-started'; command: string }
  | { type: 'command-finished'; exitCode: number }
  | { type: 'prompt' };

export type TerminalShellToken =
  | { type: 'data'; data: string }
  | { type: 'marker'; marker: TerminalShellMarker };

const OSC_PREFIX = '\u001b]';
const OSC_BEL = '\u0007';
const OSC_ST = '\u001b\\';
const MAX_PENDING_OSC_CHARS = 8 * 1024;

function appendData(tokens: TerminalShellToken[], data: string): void {
  if (!data) {
    return;
  }
  const previous = tokens[tokens.length - 1];
  if (previous?.type === 'data') {
    previous.data += data;
  } else {
    tokens.push({ type: 'data', data });
  }
}

function fileUriToPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') {
      return null;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1).replace(/\//g, '\\');
    }
    if (url.hostname && url.hostname !== 'localhost') {
      return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`;
    }
    return pathname;
  } catch {
    return null;
  }
}

function parseMarker(content: string): TerminalShellMarker | null {
  if (content === '133;A') {
    return { type: 'prompt' };
  }

  if (content.startsWith('133;C;')) {
    const encoded = content.slice('133;C;'.length);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return null;
    }
    const bytes = Buffer.from(encoded, 'base64');
    const normalized = encoded.replace(/=+$/, '');
    if (bytes.toString('base64').replace(/=+$/, '') !== normalized) {
      return null;
    }
    return { type: 'command-started', command: bytes.toString('utf8') };
  }

  const finished = /^133;D(?:;(-?\d+))?$/.exec(content);
  if (finished) {
    const parsed = Number.parseInt(finished[1] ?? '0', 10);
    return { type: 'command-finished', exitCode: Number.isFinite(parsed) ? parsed : 1 };
  }

  if (content.startsWith('7;')) {
    const path = fileUriToPath(content.slice(2));
    return path === null ? null : { type: 'cwd', path };
  }

  return null;
}

function findOscEnd(text: string, start: number): { index: number; length: number } | null {
  const belIndex = text.indexOf(OSC_BEL, start);
  const stIndex = text.indexOf(OSC_ST, start);
  if (belIndex < 0 && stIndex < 0) {
    return null;
  }
  if (belIndex >= 0 && (stIndex < 0 || belIndex < stIndex)) {
    return { index: belIndex, length: OSC_BEL.length };
  }
  return { index: stIndex, length: OSC_ST.length };
}

export class TerminalShellIntegrationParser {
  private pending = '';

  push(chunk: string): TerminalShellToken[] {
    const text = this.pending + chunk;
    this.pending = '';
    const tokens: TerminalShellToken[] = [];
    let cursor = 0;

    while (cursor < text.length) {
      const start = text.indexOf(OSC_PREFIX, cursor);
      if (start < 0) {
        // Keep a trailing ESC because it may be the first byte of a split OSC.
        const holdLastEscape = text.endsWith('\u001b');
        const end = holdLastEscape ? text.length - 1 : text.length;
        appendData(tokens, text.slice(cursor, end));
        if (holdLastEscape) {
          this.pending = '\u001b';
        }
        break;
      }

      appendData(tokens, text.slice(cursor, start));
      const end = findOscEnd(text, start + OSC_PREFIX.length);
      if (!end) {
        this.pending = text.slice(start);
        if (this.pending.length > MAX_PENDING_OSC_CHARS) {
          appendData(tokens, this.pending);
          this.pending = '';
        }
        break;
      }

      const rawEnd = end.index + end.length;
      const raw = text.slice(start, rawEnd);
      const content = text.slice(start + OSC_PREFIX.length, end.index);
      const marker = parseMarker(content);
      if (marker) {
        tokens.push({ type: 'marker', marker });
      } else {
        appendData(tokens, raw);
      }
      cursor = rawEnd;
    }

    return tokens;
  }

  /** Return an incomplete OSC sequence during teardown instead of losing it. */
  flush(): TerminalShellToken[] {
    if (!this.pending) {
      return [];
    }
    const data = this.pending;
    this.pending = '';
    return [{ type: 'data', data }];
  }
}

/**
 * Loaded after the user's PowerShell profile. It wraps (rather than replaces)
 * the existing prompt and writes standard shell-integration markers through
 * Console.Write so they never become visible prompt text.
 */
export const POWERSHELL_SHELL_INTEGRATION_SCRIPT = [
  "if ($global:__HappyShellIntegrationVersion -ne 2) {",
  "$global:__HappyOriginalPrompt = ${function:prompt}",
  'if ($null -eq ${function:PSConsoleHostReadLine}) { Import-Module PSReadLine -ErrorAction SilentlyContinue }',
  "$global:__HappyOriginalPSConsoleHostReadLine = ${function:PSConsoleHostReadLine}",
  'if ($null -ne $global:__HappyOriginalPSConsoleHostReadLine) {',
  'function global:PSConsoleHostReadLine {',
  '$happyLine = & $global:__HappyOriginalPSConsoleHostReadLine',
  '$happyLineBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$happyLine)',
  '$happyLineBase64 = [Convert]::ToBase64String($happyLineBytes)',
  '[Console]::Write("$([char]27)]133;C;$happyLineBase64$([char]7)")',
  'return $happyLine',
  '}',
  '}',
  'function global:prompt {',
  '$happySucceeded = $?',
  '$happyNativeExit = $global:LASTEXITCODE',
  '$happyExitCode = if ($happySucceeded) { 0 } elseif ($happyNativeExit -is [int] -and $happyNativeExit -ne 0) { $happyNativeExit } else { 1 }',
  "try { $happyCwdUri = [System.Uri]::new((Get-Location).Path).AbsoluteUri } catch { $happyCwdUri = '' }",
  'if ($happyCwdUri) { [Console]::Write("$([char]27)]7;$happyCwdUri$([char]7)") }',
  '[Console]::Write("$([char]27)]133;D;$happyExitCode$([char]7)")',
  '[Console]::Write("$([char]27)]133;A$([char]7)")',
  'if ($null -ne $global:__HappyOriginalPrompt) { & $global:__HappyOriginalPrompt } else { "PS $($executionContext.SessionState.Path.CurrentLocation)> " }',
  '}',
  '$global:__HappyShellIntegrationVersion = 2',
  '}',
].join('; ');
