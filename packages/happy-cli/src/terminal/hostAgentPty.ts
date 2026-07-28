import { existsSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import * as z from 'zod';

import { projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';
import type { TerminalPty, TerminalPtySpawner } from '@/terminal/terminalInstance';

const HOST_AGENT_PROTOCOL_VERSION = 1;
const PROBE_TIMEOUT_MS = 2_000;
const KILL_TIMEOUT_MS = 1_000;

const HostAgentProbeSchema = z.object({
  type: z.literal('probe'),
  protocol_version: z.literal(HOST_AGENT_PROTOCOL_VERSION),
  pty: z.literal(true),
});

const HostAgentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    protocol_version: z.literal(HOST_AGENT_PROTOCOL_VERSION),
  }),
  z.object({ type: z.literal('output'), data: z.string() }),
  z.object({ type: z.literal('exit'), exit_code: z.number().int().nonnegative() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

type HostAgentEvent = z.infer<typeof HostAgentEventSchema>;

export type HostAgentPtyBackend = {
  kind: 'rust-host-agent';
  binaryPath: string;
  spawn: TerminalPtySpawner;
};

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'happy-host-agent.exe' : 'happy-host-agent';
}

export function hostAgentBinaryCandidates(options: {
  projectRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  configuredPath?: string;
} = {}): string[] {
  const root = options.projectRoot ?? projectPath();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const filename = executableName(platform);
  return [
    options.configuredPath,
    resolve(root, 'tools', 'host-agent', `${platform}-${arch}`, filename),
    resolve(root, '..', 'happy-host-agent', 'target', 'release', filename),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function resolveHostAgentBinary(options: {
  projectRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  configuredPath?: string;
  exists?: (path: string) => boolean;
} = {}): string | undefined {
  const exists = options.exists ?? existsSync;
  return hostAgentBinaryCandidates(options).find(exists);
}

export function probeHostAgent(binaryPath: string): boolean {
  const result = spawnSync(binaryPath, ['--probe'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) {
    logger.debug('[host-agent] Native probe failed:', result.error ?? result.stderr);
    return false;
  }
  try {
    return HostAgentProbeSchema.safeParse(JSON.parse(result.stdout.trim())).success;
  } catch (error) {
    logger.debug('[host-agent] Native probe returned invalid JSON:', error);
    return false;
  }
}

class RustHostAgentPty implements TerminalPty {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly decoder = new StringDecoder('utf8');
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number }) => void>();
  private exited = false;
  private ready = false;

  constructor(binaryPath: string, options: Parameters<TerminalPtySpawner>[0]) {
    this.child = spawn(binaryPath, ['pty'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (data: string) => {
      logger.debug(`[host-agent] ${data.trim()}`);
    });
    this.child.on('error', (error) => {
      logger.debug('[host-agent] Native PTY process error:', error);
      this.emitExit(1);
    });
    this.child.on('exit', (code) => {
      this.emitExit(code ?? 1);
    });

    this.send({
      type: 'spawn',
      file: options.file,
      args: options.args,
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      env: Object.fromEntries(
        Object.entries(options.env).filter((entry): entry is [string, string] => (
          typeof entry[1] === 'string'
        )),
      ),
    });
  }

  onData(callback: (data: string) => void): { dispose: () => void } {
    this.dataListeners.add(callback);
    return { dispose: () => this.dataListeners.delete(callback) };
  }

  onExit(callback: (event: { exitCode: number }) => void): { dispose: () => void } {
    this.exitListeners.add(callback);
    return { dispose: () => this.exitListeners.delete(callback) };
  }

  write(data: string): void {
    if (!data || this.exited) {
      return;
    }
    this.send({ type: 'write', data: Buffer.from(data, 'utf8').toString('base64') });
  }

  resize(cols: number, rows: number): void {
    if (this.exited) {
      return;
    }
    this.send({ type: 'resize', cols, rows });
  }

  kill(): void {
    if (this.exited) {
      return;
    }
    this.send({ type: 'kill' });
    const forceKill = setTimeout(() => {
      if (!this.exited) {
        this.child.kill();
      }
    }, KILL_TIMEOUT_MS);
    forceKill.unref();
  }

  private send(message: unknown): void {
    if (this.child.stdin.destroyed || !this.child.stdin.writable) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch (error) {
      logger.debug('[host-agent] Ignoring malformed native event:', error);
      return;
    }
    const parsed = HostAgentEventSchema.safeParse(decoded);
    if (!parsed.success) {
      logger.debug('[host-agent] Ignoring invalid native event:', parsed.error);
      return;
    }
    this.handleEvent(parsed.data);
  }

  private handleEvent(event: HostAgentEvent): void {
    if (event.type === 'ready') {
      this.ready = true;
      logger.debug('[host-agent] Native PTY ready');
      return;
    }
    if (event.type === 'output') {
      const data = this.decoder.write(Buffer.from(event.data, 'base64'));
      if (data) {
        for (const listener of this.dataListeners) {
          listener(data);
        }
      }
      return;
    }
    if (event.type === 'error') {
      logger.debug(`[host-agent] Native PTY error: ${event.message}`);
      return;
    }
    this.emitExit(event.exit_code);
  }

  private emitExit(exitCode: number): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    const tail = this.decoder.end();
    if (tail) {
      for (const listener of this.dataListeners) {
        listener(tail);
      }
    }
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
    this.dataListeners.clear();
    this.exitListeners.clear();
    if (this.ready) {
      logger.debug(`[host-agent] Native PTY exited (code ${exitCode})`);
    }
  }
}

export function selectHostAgentPtyBackend(): HostAgentPtyBackend | undefined {
  if (process.env.HAPPY_HOST_AGENT_DISABLED === '1') {
    logger.debug('[host-agent] Native PTY disabled by environment');
    return undefined;
  }
  const binaryPath = resolveHostAgentBinary({
    configuredPath: process.env.HAPPY_HOST_AGENT_BIN,
  });
  if (!binaryPath || !probeHostAgent(binaryPath)) {
    logger.debug('[host-agent] Native PTY unavailable; using node-pty');
    return undefined;
  }
  return {
    kind: 'rust-host-agent',
    binaryPath,
    spawn: (options) => new RustHostAgentPty(binaryPath, options),
  };
}
