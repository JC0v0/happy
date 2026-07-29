/**
 * Typed adapter for the authoritative Rust terminal runtime.
 *
 * The local IPC protocol uses a four-byte big-endian length followed by one
 * kind byte and a bounded payload. PTY input/output stays binary on this
 * boundary; only low-frequency control and metadata frames use JSON.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  TerminalSessionStateSchema,
  TerminalStreamEventSchema,
  TerminalThemeSchema,
  type TerminalSessionState,
  type TerminalStreamEvent,
  type TerminalTheme,
} from '@slopus/happy-wire';
import * as z from 'zod';

import { projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';

const HOST_AGENT_PROTOCOL_VERSION = 2;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_QUEUE_BYTES = 1024 * 1024;
const READY_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 1_000;

const REQUEST_SPAWN = 0x01;
const REQUEST_WRITE = 0x02;
const REQUEST_EXECUTE = 0x03;
const REQUEST_RESIZE = 0x04;
const REQUEST_SNAPSHOT = 0x05;
const REQUEST_KILL = 0x06;

const EVENT_READY = 0x81;
const EVENT_OUTPUT = 0x82;
const EVENT_METADATA = 0x83;
const EVENT_EXECUTE_RESULT = 0x84;
const EVENT_SNAPSHOT_END = 0x85;
const EVENT_EXIT = 0x86;
const EVENT_ERROR = 0x87;

const HostAgentProbeSchema = z.object({
  type: z.literal('probe'),
  protocolVersion: z.literal(HOST_AGENT_PROTOCOL_VERSION),
  pty: z.literal(true),
  framing: z.literal('length-prefixed-binary'),
  authoritativeState: z.literal(true),
});

const ReadyEventSchema = z.object({
  protocolVersion: z.literal(HOST_AGENT_PROTOCOL_VERSION),
  shell: z.string(),
  structuredCommands: z.boolean(),
  theme: TerminalThemeSchema.optional(),
});

const MetadataEnvelopeSchema = z.object({
  requestId: z.number().int().positive().optional(),
  event: TerminalStreamEventSchema,
});

const ExecuteResultSchema = z.object({
  requestId: z.number().int().positive(),
  tracked: z.boolean(),
  commandId: z.string().optional(),
});

const SnapshotEndSchema = z.object({
  requestId: z.number().int().positive(),
  state: TerminalSessionStateSchema,
});

const ExitEventSchema = z.object({
  exitCode: z.number().int().nonnegative(),
});

const ErrorEventSchema = z.object({
  message: z.string(),
  fatal: z.boolean(),
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
    resolve(root, 'tools', 'unpacked', filename),
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
    logger.debug('[host-agent] Rust runtime probe failed:', result.error ?? result.stderr);
    return false;
  }
  try {
    return HostAgentProbeSchema.safeParse(JSON.parse(result.stdout.trim())).success;
  } catch (error) {
    logger.debug('[host-agent] Rust runtime probe returned invalid JSON:', error);
    return false;
  }
}

export function requireHostAgentBinary(options: {
  projectRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  configuredPath?: string;
  exists?: (path: string) => boolean;
  probe?: (path: string) => boolean;
} = {}): string {
  const candidates = hostAgentBinaryCandidates({
    projectRoot: options.projectRoot,
    platform: options.platform,
    arch: options.arch,
    configuredPath: options.configuredPath,
  });
  const exists = options.exists ?? existsSync;
  const existingCandidates = candidates.filter(exists);
  if (existingCandidates.length === 0) {
    throw new Error(
      `Rust terminal runtime is required but was not found. Run "pnpm --filter happy host-agent:build". Tried: ${candidates.join(', ')}`,
    );
  }
  const probe = options.probe ?? probeHostAgent;
  const platform = options.platform ?? process.platform;
  for (const binaryPath of existingCandidates) {
    if (platform !== 'win32') {
      try {
        // npm/pnpm may normalize packaged regular files to 0644, and some
        // installers disable postinstall scripts. Repair the current native
        // binary lazily before probing it.
        chmodSync(binaryPath, 0o755);
      } catch (error) {
        logger.debug(`[host-agent] Failed to restore executable mode for ${binaryPath}:`, error);
      }
    }
    if (probe(binaryPath)) {
      return binaryPath;
    }
  }
  throw new Error(
    `Installed Rust terminal runtimes do not support protocol ${HOST_AGENT_PROTOCOL_VERSION}. Rebuild with "pnpm --filter happy host-agent:build". Checked: ${existingCandidates.join(', ')}`,
  );
}

export interface RustTerminalRuntimeOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  onEvent: (event: TerminalStreamEvent, reliable: boolean) => void;
  onLocalOutput?: (data: string) => void;
  onExit: (exitCode: number) => void;
  onError?: (error: Error) => void;
}

export interface RustTerminalSnapshot {
  events: TerminalStreamEvent[];
  state: TerminalSessionState;
}

export interface RustTerminalCapabilities {
  protocolVersion: number;
  shell: string;
  structuredCommands: boolean;
  ptyBackend: 'rust-host-agent';
  theme?: TerminalTheme;
}

interface PendingSnapshot {
  events: TerminalStreamEvent[];
  deferred: Deferred<RustTerminalSnapshot>;
}

export class RustTerminalRuntime {
  static async start(options: RustTerminalRuntimeOptions): Promise<RustTerminalRuntime> {
    const binaryPath = requireHostAgentBinary({
      configuredPath: process.env.HAPPY_HOST_AGENT_BIN,
    });
    const runtime = new RustTerminalRuntime(binaryPath, options);
    try {
      await runtime.sendJson(REQUEST_SPAWN, {
        cwd: options.cwd,
        cols: options.cols,
        rows: options.rows,
        env: Object.fromEntries(
          Object.entries(options.env).filter((entry): entry is [string, string] => (
            typeof entry[1] === 'string'
          )),
        ),
      });
      await runtime.waitUntilReady();
      return runtime;
    } catch (error) {
      await runtime.dispose();
      throw error;
    }
  }

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly ready = deferred<RustTerminalCapabilities>();
  private readonly executeRequests = new Map<number, Deferred<{ tracked: boolean; commandId?: string }>>();
  private readonly snapshotRequests = new Map<number, PendingSnapshot>();
  private readonly localOutputDecoder = new StringDecoder('utf8');
  private stdoutBuffer = Buffer.alloc(0);
  private writeChain = Promise.resolve();
  private queuedWriteBytes = 0;
  private nextRequestId = 1;
  private exited = false;
  private exitEmitted = false;
  private capabilitiesValue: RustTerminalCapabilities | undefined;

  private constructor(
    binaryPath: string,
    private readonly options: RustTerminalRuntimeOptions,
  ) {
    this.child = spawn(binaryPath, ['terminal'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (data: string) => {
      logger.debug(`[host-agent] ${data.trim()}`);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => this.handleProcessExit(code ?? 1));
  }

  get capabilities(): RustTerminalCapabilities {
    if (!this.capabilitiesValue) {
      throw new Error('Rust terminal runtime is not ready');
    }
    return this.capabilitiesValue;
  }

  async write(terminalId: string, data: Uint8Array): Promise<void> {
    if (data.byteLength === 0) {
      return;
    }
    const terminalIdBytes = Buffer.from(terminalId, 'utf8');
    if (terminalIdBytes.byteLength === 0 || terminalIdBytes.byteLength > 128) {
      throw new Error('Terminal id must contain 1-128 bytes');
    }
    const payload = Buffer.allocUnsafe(2 + terminalIdBytes.byteLength + data.byteLength);
    payload.writeUInt16BE(terminalIdBytes.byteLength, 0);
    terminalIdBytes.copy(payload, 2);
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(
      payload,
      2 + terminalIdBytes.byteLength,
    );
    await this.sendFrame(REQUEST_WRITE, payload);
  }

  async execute(
    terminalId: string,
    command: string,
  ): Promise<{ tracked: boolean; commandId?: string }> {
    const requestId = this.allocateRequestId();
    const request = deferred<{ tracked: boolean; commandId?: string }>();
    this.executeRequests.set(requestId, request);
    try {
      await this.sendJson(REQUEST_EXECUTE, { requestId, terminalId, command });
      return await request.promise;
    } catch (error) {
      this.executeRequests.delete(requestId);
      throw error;
    }
  }

  async reportViewport(
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    await this.sendJson(REQUEST_RESIZE, { terminalId, cols, rows });
  }

  async snapshot(): Promise<RustTerminalSnapshot> {
    const requestId = this.allocateRequestId();
    const request: PendingSnapshot = {
      events: [],
      deferred: deferred<RustTerminalSnapshot>(),
    };
    this.snapshotRequests.set(requestId, request);
    try {
      await this.sendJson(REQUEST_SNAPSHOT, { requestId });
      return await request.deferred.promise;
    } catch (error) {
      this.snapshotRequests.delete(requestId);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.exited) {
      return;
    }
    try {
      await this.sendFrame(REQUEST_KILL, Buffer.alloc(0));
    } catch {
      // The process may already be exiting.
    }
    const forceKill = setTimeout(() => {
      if (!this.exited) {
        this.child.kill();
      }
    }, KILL_TIMEOUT_MS);
    forceKill.unref();
  }

  private async waitUntilReady(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.ready.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Rust terminal runtime did not become ready in time')),
            READY_TIMEOUT_MS,
          );
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId = this.nextRequestId === 0xffff_ffff
      ? 1
      : this.nextRequestId + 1;
    return requestId;
  }

  private sendJson(kind: number, value: unknown): Promise<void> {
    return this.sendFrame(kind, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  private sendFrame(kind: number, payload: Buffer): Promise<void> {
    if (this.exited) {
      return Promise.reject(new Error('Rust terminal runtime has exited'));
    }
    const length = payload.byteLength + 1;
    if (length <= 0 || length > MAX_FRAME_BYTES) {
      return Promise.reject(new Error(`Host-agent frame is too large: ${length} bytes`));
    }
    const frame = Buffer.allocUnsafe(4 + length);
    frame.writeUInt32BE(length, 0);
    frame[4] = kind;
    payload.copy(frame, 5);
    if (this.queuedWriteBytes + frame.byteLength > MAX_WRITE_QUEUE_BYTES) {
      return Promise.reject(new Error('Rust terminal input queue is full'));
    }

    this.queuedWriteBytes += frame.byteLength;
    const write = this.writeChain.then(() => new Promise<void>((resolveWrite, rejectWrite) => {
      if (this.exited || this.child.stdin.destroyed || !this.child.stdin.writable) {
        rejectWrite(new Error('Rust terminal runtime stdin is closed'));
        return;
      }
      this.child.stdin.write(frame, (error) => {
        if (error) {
          rejectWrite(error);
        } else {
          resolveWrite();
        }
      });
    }));
    this.writeChain = write.catch(() => undefined);
    return write.finally(() => {
      this.queuedWriteBytes = Math.max(0, this.queuedWriteBytes - frame.byteLength);
    });
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = this.stdoutBuffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.stdoutBuffer, chunk]);

    while (this.stdoutBuffer.length >= 4) {
      const length = this.stdoutBuffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        this.fail(new Error(`Rust terminal runtime sent invalid frame length ${length}`));
        return;
      }
      if (this.stdoutBuffer.length < 4 + length) {
        return;
      }
      const kind = this.stdoutBuffer[4];
      const payload = this.stdoutBuffer.subarray(5, 4 + length);
      this.stdoutBuffer = this.stdoutBuffer.subarray(4 + length);
      try {
        this.handleFrame(kind, payload);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }

  private handleFrame(kind: number, payload: Buffer): void {
    if (kind === EVENT_READY) {
      const ready = ReadyEventSchema.parse(this.parseJson(payload));
      const capabilities: RustTerminalCapabilities = {
        protocolVersion: ready.protocolVersion,
        shell: ready.shell,
        structuredCommands: ready.structuredCommands,
        ptyBackend: 'rust-host-agent',
        ...(ready.theme ? { theme: ready.theme } : {}),
      };
      this.capabilitiesValue = capabilities;
      this.ready.resolve(capabilities);
      logger.debug('[host-agent] Authoritative Rust terminal runtime ready');
      return;
    }

    if (kind === EVENT_OUTPUT) {
      if (payload.byteLength < 12) {
        throw new Error('Rust terminal output frame is truncated');
      }
      const requestId = payload.readUInt32BE(0);
      const seqValue = payload.readBigUInt64BE(4);
      if (seqValue > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Rust terminal sequence exceeds JavaScript safe range: ${seqValue}`);
      }
      const bytes = payload.subarray(12);
      const event: TerminalStreamEvent = {
        t: 'output',
        seq: Number(seqValue),
        data: bytes.toString('base64'),
        ...(requestId !== 0 ? { snapshot: true } : {}),
      };
      if (requestId !== 0) {
        this.appendSnapshotEvent(requestId, event);
      } else {
        const localOutput = this.localOutputDecoder.write(bytes);
        if (localOutput) {
          this.options.onLocalOutput?.(localOutput);
        }
        this.options.onEvent(event, false);
      }
      return;
    }

    if (kind === EVENT_METADATA) {
      const envelope = MetadataEnvelopeSchema.parse(this.parseJson(payload));
      if (envelope.requestId !== undefined) {
        this.appendSnapshotEvent(envelope.requestId, envelope.event);
      } else {
        this.options.onEvent(envelope.event, true);
      }
      return;
    }

    if (kind === EVENT_EXECUTE_RESULT) {
      const result = ExecuteResultSchema.parse(this.parseJson(payload));
      const request = this.executeRequests.get(result.requestId);
      if (!request) {
        throw new Error(`Unexpected execute result ${result.requestId}`);
      }
      this.executeRequests.delete(result.requestId);
      request.resolve({
        tracked: result.tracked,
        ...(result.commandId ? { commandId: result.commandId } : {}),
      });
      return;
    }

    if (kind === EVENT_SNAPSHOT_END) {
      const result = SnapshotEndSchema.parse(this.parseJson(payload));
      const request = this.snapshotRequests.get(result.requestId);
      if (!request) {
        throw new Error(`Unexpected snapshot result ${result.requestId}`);
      }
      this.snapshotRequests.delete(result.requestId);
      request.deferred.resolve({ events: request.events, state: result.state });
      return;
    }

    if (kind === EVENT_EXIT) {
      const result = ExitEventSchema.parse(this.parseJson(payload));
      this.emitExit(result.exitCode);
      return;
    }

    if (kind === EVENT_ERROR) {
      const result = ErrorEventSchema.parse(this.parseJson(payload));
      const error = new Error(`Rust terminal runtime: ${result.message}`);
      if (result.fatal) {
        this.fail(error);
      } else {
        this.options.onError?.(error);
        logger.debug(`[host-agent] ${error.message}`);
      }
      return;
    }

    throw new Error(`Rust terminal runtime sent unknown frame kind 0x${kind.toString(16)}`);
  }

  private parseJson(payload: Buffer): unknown {
    return JSON.parse(payload.toString('utf8'));
  }

  private appendSnapshotEvent(requestId: number, event: TerminalStreamEvent): void {
    const request = this.snapshotRequests.get(requestId);
    if (!request) {
      throw new Error(`Unexpected snapshot event ${requestId}`);
    }
    request.events.push(event);
  }

  private handleProcessExit(exitCode: number): void {
    this.exited = true;
    const tail = this.localOutputDecoder.end();
    if (tail) {
      this.options.onLocalOutput?.(tail);
    }
    if (!this.capabilitiesValue) {
      this.ready.reject(new Error(`Rust terminal runtime exited before ready (code ${exitCode})`));
    }
    this.rejectPending(new Error(`Rust terminal runtime exited (code ${exitCode})`));
    this.emitExit(exitCode);
  }

  private emitExit(exitCode: number): void {
    if (this.exitEmitted) {
      return;
    }
    this.exitEmitted = true;
    this.options.onExit(exitCode);
  }

  private fail(error: Error): void {
    this.options.onError?.(error);
    logger.debug('[host-agent] Rust terminal runtime failure:', error);
    this.ready.reject(error);
    this.rejectPending(error);
    if (!this.exited) {
      this.child.kill();
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.executeRequests.values()) {
      request.reject(error);
    }
    this.executeRequests.clear();
    for (const request of this.snapshotRequests.values()) {
      request.deferred.reject(error);
    }
    this.snapshotRequests.clear();
  }
}
