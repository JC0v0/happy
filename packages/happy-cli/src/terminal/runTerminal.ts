/**
 * Terminal session runner.
 *
 * Creates one session-wide node-pty shell and relays raw I/O, end-to-end
 * encrypted with the session key, through Happy to every attached app:
 *
 *   pty output -> shared ordered chunks -> ring buffer (snapshots)
 *              -> ApiSessionClient.sendTerminalOutput (encrypt + emit
 *                 `terminal-output` { sid, c } on the session socket)
 *   app input  -> session RPC `terminal-input` / `terminal-resize` /
 *                 `terminal-attach` (decrypted by RpcHandlerManager) -> pty
 *
 * Disconnect = destroy: unlike agent sessions there is nothing worth keeping
 * alive without a relay, so a socket disconnect starts a short grace timer
 * after which the shared PTY is killed and the process exits.
 *
 * @module runTerminal
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { logger } from '@/ui/logger';
import { Credentials, readSettings } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/run';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { encodeBase64 } from '@/api/encryption';
import { registerKillSessionHandler } from '@/terminal/registerKillSessionHandler';
import {
  TerminalAttachSchema,
  TerminalExecuteSchema,
  TerminalInputSchema,
  TerminalResizeSchema,
  type TerminalTheme,
} from '@slopus/happy-wire';
import {
  POWERSHELL_SHELL_INTEGRATION_SCRIPT,
} from '@/terminal/terminalShellIntegration';
import {
  TerminalInstance,
  type TerminalActiveCommand,
  type TerminalShellLaunch,
} from '@/terminal/terminalInstance';
import { TerminalGridController } from '@/terminal/terminalGridController';
import { selectHostAgentPtyBackend } from '@/terminal/hostAgentPty';

/** How long the relay socket may stay down before the session self-destructs. */
const DISCONNECT_GRACE_MS = 60_000;
const COMMAND_DONE_NOTIFICATION_THRESHOLD_MS = 10_000;
const COMMAND_FAILED_NOTIFICATION_THRESHOLD_MS = 3_000;
const SHARED_TERMINAL_COLS = 80;
const SHARED_TERMINAL_ROWS = 24;
const LEGACY_TERMINAL_ID = 'legacy-shared-client';
const LOCAL_TERMINAL_ID = 'local-cli';

function formatNotificationDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function resolveShellLaunch(): TerminalShellLaunch {
  if (process.platform === 'win32') {
    // Prefer PowerShell for richer color output (matches Windows Terminal's
    // default profile). COMSPEC (cmd.exe) emits almost no ANSI color codes.
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', POWERSHELL_SHELL_INTEGRATION_SCRIPT],
      shell: 'powershell',
      structuredCommands: true,
    };
  }
  const file = process.env.SHELL || '/bin/bash';
  return {
    file,
    args: [],
    shell: path.basename(file),
    // bash/zsh shell-integration shims are intentionally deferred. The raw
    // terminal remains fully functional and clients see this capability flag.
    structuredCommands: false,
  };
}

/**
 * Remove line (slash-slash) and block (slash-star) comments from a
 * JSON-with-comments string without touching comment-like sequences inside
 * string literals (e.g. "https://...").
 */
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (!inString && ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (!inString && ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

/**
 * Read the local terminal's color scheme from Windows Terminal settings so the
 * app can render the same palette the user sees locally. Returns undefined on
 * non-Windows hosts or when WT settings can't be found/parsed.
 */
function readLocalTerminalTheme(): TerminalTheme | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      return undefined;
    }
    const settingsPath = path.join(
      localAppData,
      'Packages',
      'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
      'LocalState',
      'settings.json',
    );
    let raw: string;
    try {
      raw = readFileSync(settingsPath, 'utf8');
    } catch {
      return undefined;
    }
    // WT settings.json allows // and /* */ comments. Strip them while
    // respecting string literals so URLs inside strings (e.g. "https://...")
    // are not mistaken for line comments.
    const cleaned = stripJsonComments(raw);
    const settings = JSON.parse(cleaned) as {
      defaultProfile?: string;
      profiles?: {
        defaults?: { colorScheme?: string };
        list?: Array<{ guid?: string; colorScheme?: string }>;
      };
      schemes?: Array<Record<string, string>>;
    };

    const defaultGuid = settings.defaultProfile;
    const profiles = settings.profiles?.list ?? [];
    const defaultProfile = profiles.find((p) => p.guid === defaultGuid) ?? {};
    const schemeName =
      defaultProfile.colorScheme ??
      settings.profiles?.defaults?.colorScheme ??
      'Campbell';
    const scheme = (settings.schemes ?? []).find((s) => s.name === schemeName);
    if (!scheme) {
      return undefined;
    }

    // Windows Terminal uses "purple"/"brightPurple"; xterm uses
    // "magenta"/"brightMagenta". Map the keys accordingly.
    return {
      background: scheme.background,
      foreground: scheme.foreground,
      cursor: scheme.cursorColor,
      selectionBackground: scheme.selectionBackground,
      black: scheme.black,
      red: scheme.red,
      green: scheme.green,
      yellow: scheme.yellow,
      blue: scheme.blue,
      magenta: scheme.purple,
      cyan: scheme.cyan,
      white: scheme.white,
      brightBlack: scheme.brightBlack,
      brightRed: scheme.brightRed,
      brightGreen: scheme.brightGreen,
      brightYellow: scheme.brightYellow,
      brightBlue: scheme.brightBlue,
      brightMagenta: scheme.brightPurple,
      brightCyan: scheme.brightCyan,
      brightWhite: scheme.brightWhite,
    };
  } catch (error) {
    logger.debug('[terminal] Failed to read Windows Terminal theme:', error);
    return undefined;
  }
}

export async function runTerminal(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();

  const api = await ApiClient.create(opts.credentials);
  const settings = await readSettings();
  if (!settings?.machineId) {
    throw new Error('No machine ID found in settings');
  }

  await api.getOrCreateMachine({
    machineId: settings.machineId,
    metadata: initialMachineMetadata,
  });

  const { state, metadata } = createSessionMetadata({
    flavor: 'terminal',
    machineId: settings.machineId,
    startedBy: opts.startedBy,
  });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });
  if (!response) {
    // A terminal session is useless without its relay — fail fast instead of
    // running an offline stub like the agent backends do.
    throw new Error('Failed to create terminal session (server unreachable)');
  }
  console.log(`Happy Session ID: ${response.id}`);

  const session: ApiSessionClient = api.sessionSyncClient(response);

  try {
    await notifyDaemonSessionStarted(response.id, metadata, {
      encryptionKey: encodeBase64(response.encryptionKey),
      encryptionVariant: response.encryptionVariant,
      seq: response.seq,
      metadataVersion: response.metadataVersion,
      agentStateVersion: response.agentStateVersion,
    });
  } catch (error) {
    logger.debug('[terminal] Failed to report session to daemon:', error);
  }

  //
  // All devices drive one PTY. The last device that sends input owns its
  // logical grid; every client renders that grid with its own local scale.
  //
  const localTty = opts.startedBy !== 'daemon' && process.stdout.isTTY === true;
  const localTheme = readLocalTerminalTheme();
  const shellLaunch = resolveShellLaunch();
  const nativePtyBackend = selectHostAgentPtyBackend();
  const ptyBackend = nativePtyBackend?.kind ?? 'node-pty';
  logger.debug(`[terminal] PTY backend: ${ptyBackend}`);
  let sharedTerminal: TerminalInstance | null = null;

  const notifyNeedsInput = (command: TerminalActiveCommand) => {
    api.push().sendSessionNotification({
      kind: 'terminal-needs-input',
      metadata,
      title: 'Terminal needs input',
      body: 'Input is waiting in your terminal.',
      data: { sessionId: response.id, commandId: command.commandId },
    });
  };

  const notifyCommandFinished = (
    command: TerminalActiveCommand,
    exitCode: number,
    durationMs: number,
  ) => {
    const failed = exitCode !== 0;
    const threshold = failed
      ? COMMAND_FAILED_NOTIFICATION_THRESHOLD_MS
      : COMMAND_DONE_NOTIFICATION_THRESHOLD_MS;
    if (durationMs < threshold) {
      return;
    }
    const duration = formatNotificationDuration(durationMs);
    api.push().sendSessionNotification({
      kind: failed ? 'terminal-failed' : 'terminal-done',
      metadata,
      title: failed ? 'Command failed' : 'Command finished',
      body: failed ? `Exited with code ${exitCode} after ${duration}.` : `Completed in ${duration}.`,
      data: { sessionId: response.id, commandId: command.commandId, exitCode, durationMs },
    });
  };

  const createSharedTerminal = () => {
    let instance: TerminalInstance;
    instance = new TerminalInstance({
      shellLaunch,
      cwd: process.cwd(),
      cols: SHARED_TERMINAL_COLS,
      rows: SHARED_TERMINAL_ROWS,
      env: process.env,
      ...(nativePtyBackend ? { spawnPty: nativePtyBackend.spawn } : {}),
      onEvent: (event, reliable) => session.sendTerminalOutput(event, { reliable }),
      onNeedsInput: notifyNeedsInput,
      onCommandFinished: (command, exitCode, durationMs) => {
        notifyCommandFinished(command, exitCode, durationMs);
      },
      ...(localTty ? { onLocalOutput: (data: string) => process.stdout.write(data) } : {}),
      onExit: (exitCode) => {
        sharedTerminal = null;
        logger.debug(`[terminal] Shared PTY exited (code ${exitCode})`);
        void shutdown(`shared pty exited (code ${exitCode})`);
      },
    });
    sharedTerminal = instance;
    instance.setGrid(
      SHARED_TERMINAL_COLS,
      SHARED_TERMINAL_ROWS,
      undefined,
      { force: true },
    );
    return instance;
  };

  const getOrCreateSharedTerminal = () => {
    if (sharedTerminal) {
      sharedTerminal.touch();
      return sharedTerminal;
    }
    return createSharedTerminal();
  };

  const gridController = new TerminalGridController((viewport, controllerTerminalId) => {
    getOrCreateSharedTerminal().setGrid(
      viewport.cols,
      viewport.rows,
      controllerTerminalId,
    );
  });

  const terminalIdOf = (terminalId: string | undefined) => (
    terminalId ?? LEGACY_TERMINAL_ID
  );

  session.rpcHandlerManager.registerHandler('terminal-input', async (params: unknown) => {
    const parsed = TerminalInputSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-input params');
      return {};
    }
    gridController.activate(terminalIdOf(parsed.data.terminalId));
    getOrCreateSharedTerminal()
      .write(Buffer.from(parsed.data.data, 'base64').toString('utf8'));
    return {};
  });

  session.rpcHandlerManager.registerHandler('terminal-execute', async (params: unknown) => {
    const parsed = TerminalExecuteSchema.safeParse(params);
    if (!parsed.success || parsed.data.command.trim().length === 0) {
      logger.debug('[terminal] Ignoring invalid terminal-execute params');
      return { tracked: false };
    }
    gridController.activate(terminalIdOf(parsed.data.terminalId));
    return getOrCreateSharedTerminal().execute(parsed.data.command);
  });

  session.rpcHandlerManager.registerHandler('terminal-resize', async (params: unknown) => {
    const parsed = TerminalResizeSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-resize params');
      return {};
    }
    gridController.reportViewport(
      terminalIdOf(parsed.data.terminalId),
      { cols: parsed.data.cols, rows: parsed.data.rows },
    );
    return {};
  });

  session.rpcHandlerManager.registerHandler('terminal-attach', async (params: unknown) => {
    const parsed = TerminalAttachSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-attach params');
      return {};
    }
    const requested = getOrCreateSharedTerminal();
    for (const event of requested.snapshotEvents()) {
      session.sendTerminalOutput(event, { reliable: true });
    }
    return {
      ...(localTheme ? { theme: localTheme } : {}),
      capabilities: {
        protocolVersion: 4,
        structuredCommands: requested.structuredCommands,
        shell: requested.shell,
        perDevicePty: false,
        adaptiveGrid: true,
        ptyBackend,
      },
      state: requested.state,
    };
  });

  //
  // Lifecycle: disconnect = destroy, plus the usual teardown triggers
  //

  const keepAliveMode = localTty ? 'local' : 'remote';
  session.keepAlive(false, keepAliveMode);
  const keepAliveInterval = setInterval(() => {
    session.keepAlive(false, keepAliveMode);
  }, 2000);

  let disconnectTimer: NodeJS.Timeout | null = null;
  let shuttingDown = false;

  const handleLocalResize = () => {
    if (!localTty) {
      return;
    }
    gridController.reportViewport(LOCAL_TERMINAL_ID, {
      cols: Math.max(1, process.stdout.columns ?? SHARED_TERMINAL_COLS),
      rows: Math.max(1, process.stdout.rows ?? SHARED_TERMINAL_ROWS),
    });
  };

  const shutdown = async (reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.debug(`[terminal] Shutting down: ${reason}`);

    clearInterval(keepAliveInterval);
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
    sharedTerminal?.dispose();
    sharedTerminal = null;

    if (localTty) {
      process.stdout.off('resize', handleLocalResize);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Not a TTY anymore
      }
      process.stdin.pause();
    }

    try {
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason: reason,
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (error) {
      logger.debug('[terminal] Session close failed:', error);
    }
    // HTTP fallback so the session is marked dead even if the socket emit
    // did not drain before exit.
    await api.deactivateSession(response.id);
    process.exit(0);
  };

  // Smart-reconnect (already running inside ApiSessionClient) only matters
  // within this grace window — after it the pty and the process are gone.
  session.on('disconnected', () => {
    if (shuttingDown || disconnectTimer) {
      return;
    }
    logger.debug('[terminal] Relay socket disconnected, starting destroy grace timer');
    disconnectTimer = setTimeout(() => {
      void shutdown('socket disconnected');
    }, DISCONNECT_GRACE_MS);
  });
  session.on('connected', () => {
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
      logger.debug('[terminal] Relay socket reconnected within grace period');
    }
  });

  session.on('archived', () => {
    void shutdown('session archived');
  });

  registerKillSessionHandler(session.rpcHandlerManager, () => shutdown('killSession'));

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  //
  // Local interactive mode: proxy the user's real terminal to the pty so the
  // session can be driven locally and remotely at the same time.
  //

  if (localTty) {
    const localTerminal = getOrCreateSharedTerminal();
    handleLocalResize();
    gridController.activate(LOCAL_TERMINAL_ID);
    process.stdout.on('resize', handleLocalResize);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      gridController.activate(LOCAL_TERMINAL_ID);
      localTerminal.write(data.toString('utf8'));
    });
  }

  // The process stays alive on the keepAlive interval, the session socket,
  // and the pty handles; shutdown() above is the only way out.
}
