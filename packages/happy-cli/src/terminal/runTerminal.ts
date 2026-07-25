/**
 * Terminal session runner.
 *
 * Spawns a local shell via node-pty and relays its raw I/O, end-to-end
 * encrypted with the session key, through the Happy server to the app:
 *
 *   pty output -> 16ms micro-batched chunks -> ring buffer (snapshots)
 *              -> ApiSessionClient.sendTerminalOutput (encrypt + emit
 *                 `terminal-output` { sid, c } on the session socket)
 *   app input  -> session RPC `terminal-input` / `terminal-resize` /
 *                 `terminal-attach` (decrypted by RpcHandlerManager) -> pty
 *
 * Disconnect = destroy: unlike agent sessions there is nothing worth keeping
 * alive without a relay, so a socket disconnect starts a short grace timer
 * after which the pty is killed and the process exits.
 *
 * @module runTerminal
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as pty from 'node-pty';

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
  TerminalInputSchema,
  TerminalResizeSchema,
  type TerminalOutput,
  type TerminalTheme,
} from '@slopus/happy-wire';

/** How long the relay socket may stay down before the session self-destructs. */
const DISCONNECT_GRACE_MS = 5_000;
/**
 * Coalescing window for pty output. Caps the emit rate at ~60 chunks/s, well
 * under the server's 200 msg/s per-socket limit, without visible lag.
 */
const OUTPUT_BATCH_MS = 16;
/** Size of the in-memory replay buffer used to answer terminal-attach. */
const RING_BUFFER_BYTES = 1024 * 1024;

type BufferedChunk = {
  seq: number;
  data: string;
};

function resolveShell(): string {
  if (process.platform === 'win32') {
    // Prefer PowerShell for richer color output (matches Windows Terminal's
    // default profile). COMSPEC (cmd.exe) emits almost no ANSI color codes.
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
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
  // Spawn the shell
  //

  const localTty = opts.startedBy !== 'daemon' && process.stdout.isTTY === true;
  const localTheme = readLocalTerminalTheme();
  const term = pty.spawn(resolveShell(), [], {
    name: 'xterm-256color',
    cols: localTty ? (process.stdout.columns || 80) : 80,
    rows: localTty ? (process.stdout.rows || 24) : 24,
    cwd: process.cwd(),
    env: { ...process.env, COLORTERM: 'truecolor' },
  });

  //
  // Output path (pty -> app)
  //

  let nextSeq = 0;
  // The ring stores the exact chunks we emitted (with their live seq
  // numbers), so terminal-attach can replay segments the app dedupes by seq.
  const ring: BufferedChunk[] = [];
  let ringBytes = 0;
  let pendingData = '';
  let flushTimer: NodeJS.Timeout | null = null;

  const sendChunk = (chunk: TerminalOutput, reliable = false) => {
    session.sendTerminalOutput(chunk, { reliable });
  };

  const flushPending = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pendingData) {
      return;
    }
    const data = pendingData;
    pendingData = '';
    const seq = nextSeq++;
    ring.push({ seq, data });
    ringBytes += data.length;
    while (ringBytes > RING_BUFFER_BYTES && ring.length > 1) {
      const dropped = ring.shift()!;
      ringBytes -= dropped.data.length;
    }
    sendChunk({ t: 'output', seq, data: Buffer.from(data, 'utf8').toString('base64') });
  };

  term.onData((data) => {
    if (localTty) {
      process.stdout.write(data);
    }
    pendingData += data;
    if (!flushTimer) {
      flushTimer = setTimeout(flushPending, OUTPUT_BATCH_MS);
    }
  });

  //
  // Input path (app -> pty). RpcHandlerManager decrypts params for us; method
  // names are registered unprefixed (the manager adds `<sessionId>:`).
  //

  session.rpcHandlerManager.registerHandler('terminal-input', async (params: unknown) => {
    const parsed = TerminalInputSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-input params');
      return {};
    }
    term.write(Buffer.from(parsed.data.data, 'base64').toString('utf8'));
    return {};
  });

  session.rpcHandlerManager.registerHandler('terminal-resize', async (params: unknown) => {
    const parsed = TerminalResizeSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-resize params');
      return {};
    }
    term.resize(parsed.data.cols, parsed.data.rows);
    return {};
  });

  session.rpcHandlerManager.registerHandler('terminal-attach', async (params: unknown) => {
    const parsed = TerminalAttachSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-attach params');
      return {};
    }
    // Flush first so every replayed seq is strictly below any future live
    // chunk; the app dedupes snapshot chunks against the live stream by seq.
    // The replay goes out reliably (not volatile) — it is a bounded burst
    // that must arrive whole, or the restored scrollback loses its tail.
    flushPending();
    for (const chunk of ring) {
      sendChunk({
        t: 'output',
        seq: chunk.seq,
        data: Buffer.from(chunk.data, 'utf8').toString('base64'),
        snapshot: true,
      }, true);
    }
    return localTheme ? { theme: localTheme } : {};
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

  const shutdown = async (reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.debug(`[terminal] Shutting down: ${reason}`);

    clearInterval(keepAliveInterval);
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }

    try {
      term.kill();
    } catch {
      // Already dead
    }

    if (localTty) {
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

  term.onExit(({ exitCode }) => {
    void shutdown(`pty exited (code ${exitCode})`);
  });

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  //
  // Local interactive mode: proxy the user's real terminal to the pty so the
  // session can be driven locally and remotely at the same time.
  //

  if (localTty) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      term.write(data.toString('utf8'));
    });
    process.stdout.on('resize', () => {
      term.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    });
  }

  // The process stays alive on the keepAlive interval, the session socket,
  // and the pty handles; shutdown() above is the only way out.
}
