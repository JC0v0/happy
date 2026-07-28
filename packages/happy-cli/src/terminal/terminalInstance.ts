import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { TerminalSessionState, TerminalStreamEvent } from '@slopus/happy-wire';
import {
  TerminalShellIntegrationParser,
  type TerminalShellMarker,
} from '@/terminal/terminalShellIntegration';
import { TerminalAttentionDetector } from '@/terminal/terminalAttentionDetector';

const OUTPUT_BATCH_MS = 16;
const RING_BUFFER_BYTES = 1024 * 1024;
const ATTENTION_SETTLE_MS = 700;

type BufferedEvent = {
  event: TerminalStreamEvent;
  bytes: number;
};

export type TerminalShellLaunch = {
  file: string;
  args: string[];
  shell: string;
  structuredCommands: boolean;
};

export type TerminalActiveCommand = NonNullable<TerminalSessionState['activeCommand']>;

export interface TerminalPty {
  onData: (callback: (data: string) => void) => unknown;
  onExit: (callback: (event: { exitCode: number }) => void) => unknown;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export type TerminalPtySpawner = (options: {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}) => TerminalPty;

export interface TerminalInstanceOptions {
  /** Stream scope. Omit for the session-wide shared PTY. */
  terminalId?: string;
  shellLaunch: TerminalShellLaunch;
  cwd: string;
  cols: number;
  rows: number;
  /** Continue the device sequence if its shell exited and is recreated. */
  initialSeq?: number;
  env: NodeJS.ProcessEnv;
  /** Optional native PTY backend. Defaults to node-pty for compatibility. */
  spawnPty?: TerminalPtySpawner;
  onEvent: (event: TerminalStreamEvent, reliable: boolean) => void;
  onNeedsInput: (command: TerminalActiveCommand) => void;
  onCommandFinished: (command: TerminalActiveCommand, exitCode: number, durationMs: number) => void;
  onLocalOutput?: (data: string) => void;
  onExit: (exitCode: number) => void;
}

export class TerminalInstance {
  readonly terminalId: string | undefined;
  readonly shell: string;
  readonly structuredCommands: boolean;

  private readonly term: TerminalPty;
  private readonly shellParser: TerminalShellIntegrationParser | null;
  private readonly ring: BufferedEvent[] = [];
  private readonly attentionDetector = new TerminalAttentionDetector();
  private nextSeq: number;
  private ringBytes = 0;
  private pendingData = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private attentionTimer: NodeJS.Timeout | null = null;
  private attentionNotifiedCommandId: string | undefined;
  private activeCommand: TerminalActiveCommand | undefined;
  private currentCwd: string | undefined;
  private cwdEventEmitted = false;
  private terminalStatus: TerminalSessionState['status'] = 'idle';
  private gridCols: number;
  private gridRows: number;
  private gridControllerTerminalId: string | undefined;
  private disposed = false;
  private _lastUsedAt = Date.now();

  constructor(private readonly options: TerminalInstanceOptions) {
    this.terminalId = options.terminalId;
    this.nextSeq = options.initialSeq ?? 0;
    this.shell = options.shellLaunch.shell;
    this.structuredCommands = options.shellLaunch.structuredCommands;
    this.currentCwd = options.cwd;
    this.gridCols = options.cols;
    this.gridRows = options.rows;
    this.shellParser = this.structuredCommands ? new TerminalShellIntegrationParser() : null;
    const env = { ...options.env, COLORTERM: 'truecolor' };
    this.term = options.spawnPty
      ? options.spawnPty({
          file: options.shellLaunch.file,
          args: options.shellLaunch.args,
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd,
          env,
        })
      : pty.spawn(options.shellLaunch.file, options.shellLaunch.args, {
          name: 'xterm-256color',
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd,
          env,
        });
    this.term.onData((data) => this.handleData(data));
    this.term.onExit(({ exitCode }) => {
      if (!this.disposed) {
        options.onExit(exitCode);
      }
    });
  }

  get lastUsedAt(): number {
    return this._lastUsedAt;
  }

  get nextSequence(): number {
    return this.nextSeq;
  }

  get state(): TerminalSessionState {
    return {
      status: this.terminalStatus,
      ...(this.currentCwd ? { cwd: this.currentCwd } : {}),
      ...(this.activeCommand ? { activeCommand: this.activeCommand } : {}),
    };
  }

  get grid(): { cols: number; rows: number; controllerTerminalId?: string } {
    return {
      cols: this.gridCols,
      rows: this.gridRows,
      ...(this.gridControllerTerminalId
        ? { controllerTerminalId: this.gridControllerTerminalId }
        : {}),
    };
  }

  touch(): void {
    this._lastUsedAt = Date.now();
  }

  write(data: string): void {
    if (!data || this.disposed) {
      return;
    }
    this.touch();
    this.markInputReceived();
    this.term.write(data);
  }

  execute(command: string): { tracked: boolean; commandId?: string } {
    this.touch();
    this.markInputReceived();
    const commandId = this.structuredCommands
      ? this.beginTrackedCommand(command)
      : undefined;
    this.term.write(`${command}\r`);
    return commandId ? { tracked: true, commandId } : { tracked: false };
  }

  /**
   * Change the shared logical grid and sequence that change ahead of the PTY
   * redraw it causes. Clients can then resize xterm before consuming redraw
   * bytes, keeping cursor coordinates and wrapping deterministic.
   */
  setGrid(
    cols: number,
    rows: number,
    controllerTerminalId?: string,
    options: { force?: boolean } = {},
  ): void {
    if (this.disposed) {
      return;
    }
    this.touch();
    const dimensionsChanged = cols !== this.gridCols || rows !== this.gridRows;
    const controllerChanged = controllerTerminalId !== this.gridControllerTerminalId;
    if (!dimensionsChanged && !controllerChanged && !options.force) {
      return;
    }

    this.gridCols = cols;
    this.gridRows = rows;
    this.gridControllerTerminalId = controllerTerminalId;
    this.recordAndSend({
      t: 'grid',
      ...(this.terminalId ? { terminalId: this.terminalId } : {}),
      seq: this.nextSeq++,
      cols,
      rows,
      ...(controllerTerminalId ? { controllerTerminalId } : {}),
    });
    if (dimensionsChanged) {
      this.term.resize(cols, rows);
    }
  }

  snapshotEvents(): TerminalStreamEvent[] {
    this.touch();
    this.flushPending();
    return this.ring.map(({ event }) => ({ ...event, snapshot: true }));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.shellParser) {
      for (const token of this.shellParser.flush()) {
        if (token.type === 'data') {
          this.pendingData += token.data;
        }
      }
    }
    this.flushPending();
    this.clearAttentionTimer();
    try {
      this.term.kill();
    } catch {
      // Already exited.
    }
  }

  private handleData(data: string): void {
    this.touch();
    this.options.onLocalOutput?.(data);
    if (!this.shellParser) {
      this.scheduleOutput(data);
      return;
    }
    for (const token of this.shellParser.push(data)) {
      if (token.type === 'data') {
        this.scheduleOutput(token.data);
      } else {
        this.handleShellMarker(token.marker);
      }
    }
  }

  private sendEvent(event: TerminalStreamEvent, reliable = false): void {
    this.options.onEvent(event, reliable);
  }

  private recordAndSend(event: TerminalStreamEvent, bytes?: number): void {
    const eventBytes = bytes ?? Buffer.byteLength(JSON.stringify(event), 'utf8');
    this.ring.push({ event, bytes: eventBytes });
    this.ringBytes += eventBytes;
    while (this.ringBytes > RING_BUFFER_BYTES && this.ring.length > 1) {
      const dropped = this.ring.shift()!;
      this.ringBytes -= dropped.bytes;
    }
    this.sendEvent(event, event.t !== 'output');
  }

  private emitState(state: TerminalSessionState['status'], commandId?: string): void {
    if (this.terminalStatus === state && (state !== 'running' || this.activeCommand?.commandId === commandId)) {
      return;
    }
    this.terminalStatus = state;
    this.recordAndSend({
      t: 'state',
      ...(this.terminalId ? { terminalId: this.terminalId } : {}),
      seq: this.nextSeq++,
      state,
      ...(commandId ? { commandId } : {}),
    });
  }

  private clearAttentionTimer(): void {
    if (this.attentionTimer) {
      clearTimeout(this.attentionTimer);
      this.attentionTimer = null;
    }
  }

  private detectAttention(data: string): void {
    if (!this.activeCommand) {
      return;
    }
    const needsInput = this.attentionDetector.push(data);
    this.clearAttentionTimer();
    if (!needsInput) {
      return;
    }
    const command = this.activeCommand;
    this.attentionTimer = setTimeout(() => {
      this.attentionTimer = null;
      if (this.activeCommand?.commandId !== command.commandId) {
        return;
      }
      this.emitState('needs-input', command.commandId);
      if (this.attentionNotifiedCommandId !== command.commandId) {
        this.attentionNotifiedCommandId = command.commandId;
        this.options.onNeedsInput(command);
      }
    }, ATTENTION_SETTLE_MS);
  }

  private markInputReceived(): void {
    this.clearAttentionTimer();
    this.attentionDetector.reset();
    if (this.activeCommand && this.terminalStatus === 'needs-input') {
      this.emitState('running', this.activeCommand.commandId);
    }
  }

  private beginTrackedCommand(command: string): string | undefined {
    if (this.activeCommand || command.trim().length === 0) {
      return undefined;
    }
    this.flushPending();
    const commandId = randomUUID();
    this.activeCommand = {
      commandId,
      command,
      startedAt: Date.now(),
      ...(this.currentCwd ? { cwd: this.currentCwd } : {}),
    };
    this.attentionNotifiedCommandId = undefined;
    this.recordAndSend({
      t: 'command-start',
      ...(this.terminalId ? { terminalId: this.terminalId } : {}),
      seq: this.nextSeq++,
      ...this.activeCommand,
    });
    this.emitState('running', commandId);
    return commandId;
  }

  private flushPending(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pendingData) {
      return;
    }
    const data = this.pendingData;
    this.pendingData = '';
    this.recordAndSend({
      t: 'output',
      ...(this.terminalId ? { terminalId: this.terminalId } : {}),
      seq: this.nextSeq++,
      data: Buffer.from(data, 'utf8').toString('base64'),
    }, Buffer.byteLength(data, 'utf8'));
  }

  private scheduleOutput(data: string): void {
    if (!data) {
      return;
    }
    this.pendingData += data;
    this.detectAttention(data);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushPending(), OUTPUT_BATCH_MS);
    }
  }

  private handleShellMarker(marker: TerminalShellMarker): void {
    this.flushPending();
    if (marker.type === 'command-started') {
      this.beginTrackedCommand(marker.command);
      return;
    }
    if (marker.type === 'cwd') {
      if (!this.cwdEventEmitted || marker.path !== this.currentCwd) {
        this.currentCwd = marker.path;
        this.cwdEventEmitted = true;
        this.recordAndSend({
          t: 'cwd',
          ...(this.terminalId ? { terminalId: this.terminalId } : {}),
          seq: this.nextSeq++,
          path: marker.path,
        });
      }
      return;
    }
    if (marker.type === 'command-finished' && this.activeCommand) {
      const endedAt = Date.now();
      const completedCommand = this.activeCommand;
      const durationMs = Math.max(0, endedAt - completedCommand.startedAt);
      this.clearAttentionTimer();
      this.attentionDetector.reset();
      this.recordAndSend({
        t: 'command-end',
        ...(this.terminalId ? { terminalId: this.terminalId } : {}),
        seq: this.nextSeq++,
        commandId: completedCommand.commandId,
        endedAt,
        durationMs,
        exitCode: marker.exitCode,
        ...(this.currentCwd ? { cwd: this.currentCwd } : {}),
      });
      this.activeCommand = undefined;
      this.emitState('idle');
      this.options.onCommandFinished(completedCommand, marker.exitCode, durationMs);
    }
  }
}
