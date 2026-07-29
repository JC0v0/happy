/**
 * Terminal session control plane.
 *
 * Rust owns the complete host-local terminal runtime: PTY lifecycle, raw I/O,
 * sequencing, replay snapshots, command metadata, attention detection, and the
 * controller-owned shared grid. TypeScript owns only account/session setup,
 * end-to-end encrypted network transport, push delivery, and process lifecycle.
 */

import { randomUUID } from 'node:crypto';

import {
  TerminalAttachSchema,
  TerminalExecuteSchema,
  TerminalInputSchema,
  TerminalResizeSchema,
  type TerminalSessionState,
  type TerminalStreamEvent,
} from '@slopus/happy-wire';

import { ApiClient } from '@/api/api';
import { encodeBase64 } from '@/api/encryption';
import type { ApiSessionClient } from '@/api/apiSession';
import { Credentials, readSettings } from '@/persistence';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { initialMachineMetadata } from '@/daemon/run';
import { registerKillSessionHandler } from '@/terminal/registerKillSessionHandler';
import { RustTerminalRuntime } from '@/terminal/rustTerminalRuntime';
import { logger } from '@/ui/logger';
import { createSessionMetadata } from '@/utils/createSessionMetadata';

const DISCONNECT_GRACE_MS = 60_000;
const COMMAND_DONE_NOTIFICATION_THRESHOLD_MS = 10_000;
const COMMAND_FAILED_NOTIFICATION_THRESHOLD_MS = 3_000;
const SHARED_TERMINAL_COLS = 80;
const SHARED_TERMINAL_ROWS = 24;
const LEGACY_TERMINAL_ID = 'legacy-shared-client';
const LOCAL_TERMINAL_ID = 'local-cli';

type TerminalActiveCommand = NonNullable<TerminalSessionState['activeCommand']>;

function formatNotificationDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
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

  const activeCommands = new Map<string, TerminalActiveCommand>();
  const attentionNotifiedCommands = new Set<string>();

  const notifyNeedsInput = (command: TerminalActiveCommand) => {
    if (attentionNotifiedCommands.has(command.commandId)) {
      return;
    }
    attentionNotifiedCommands.add(command.commandId);
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
      body: failed
        ? `Exited with code ${exitCode} after ${duration}.`
        : `Completed in ${duration}.`,
      data: {
        sessionId: response.id,
        commandId: command.commandId,
        exitCode,
        durationMs,
      },
    });
  };

  const handleRuntimeEvent = (event: TerminalStreamEvent, reliable: boolean) => {
    session.sendTerminalOutput(event, { reliable });
    if (event.t === 'command-start') {
      activeCommands.set(event.commandId, {
        commandId: event.commandId,
        command: event.command,
        startedAt: event.startedAt,
        ...(event.cwd ? { cwd: event.cwd } : {}),
      });
      return;
    }
    if (event.t === 'state' && event.state === 'needs-input' && event.commandId) {
      const command = activeCommands.get(event.commandId);
      if (command) {
        notifyNeedsInput(command);
      }
      return;
    }
    if (event.t === 'command-end') {
      const command = activeCommands.get(event.commandId);
      if (command) {
        notifyCommandFinished(command, event.exitCode, event.durationMs);
      }
      activeCommands.delete(event.commandId);
      attentionNotifiedCommands.delete(event.commandId);
    }
  };

  const localTty = opts.startedBy !== 'daemon' && process.stdout.isTTY === true;
  let pendingRuntimeExit: number | undefined;
  let runtimeExitHandler = (exitCode: number) => {
    pendingRuntimeExit = exitCode;
  };

  let terminal: RustTerminalRuntime;
  try {
    terminal = await RustTerminalRuntime.start({
      cwd: process.cwd(),
      cols: SHARED_TERMINAL_COLS,
      rows: SHARED_TERMINAL_ROWS,
      env: process.env,
      onEvent: handleRuntimeEvent,
      ...(localTty ? { onLocalOutput: (data: string) => process.stdout.write(data) } : {}),
      onExit: (exitCode) => runtimeExitHandler(exitCode),
      onError: (error) => logger.debug('[terminal] Rust runtime error:', error),
    });
  } catch (error) {
    await api.deactivateSession(response.id);
    throw error;
  }

  logger.debug('[terminal] PTY backend: rust-host-agent');
  const terminalIdOf = (terminalId: string | undefined) => (
    terminalId ?? LEGACY_TERMINAL_ID
  );

  session.rpcHandlerManager.registerHandler('terminal-input', async (params: unknown) => {
    const parsed = TerminalInputSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-input params');
      return {};
    }
    await terminal.write(
      terminalIdOf(parsed.data.terminalId),
      Buffer.from(parsed.data.data, 'base64'),
    );
    return {};
  });

  session.rpcHandlerManager.registerHandler('terminal-execute', async (params: unknown) => {
    const parsed = TerminalExecuteSchema.safeParse(params);
    if (!parsed.success || parsed.data.command.trim().length === 0) {
      logger.debug('[terminal] Ignoring invalid terminal-execute params');
      return { tracked: false };
    }
    return terminal.execute(
      terminalIdOf(parsed.data.terminalId),
      parsed.data.command,
    );
  });

  session.rpcHandlerManager.registerHandler('terminal-resize', async (params: unknown) => {
    const parsed = TerminalResizeSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-resize params');
      return {};
    }
    await terminal.reportViewport(
      terminalIdOf(parsed.data.terminalId),
      parsed.data.cols,
      parsed.data.rows,
    );
    return {};
  });

  session.rpcHandlerManager.registerHandler('terminal-attach', async (params: unknown) => {
    const parsed = TerminalAttachSchema.safeParse(params);
    if (!parsed.success) {
      logger.debug('[terminal] Ignoring invalid terminal-attach params');
      return {};
    }
    const snapshot = await terminal.snapshot();
    for (const event of snapshot.events) {
      session.sendTerminalOutput(event, { reliable: true });
    }
    return {
      ...(terminal.capabilities.theme ? { theme: terminal.capabilities.theme } : {}),
      capabilities: {
        protocolVersion: 4,
        structuredCommands: terminal.capabilities.structuredCommands,
        shell: terminal.capabilities.shell,
        perDevicePty: false,
        adaptiveGrid: true,
        ptyBackend: terminal.capabilities.ptyBackend,
      },
      state: snapshot.state,
    };
  });

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
    void terminal.reportViewport(
      LOCAL_TERMINAL_ID,
      Math.max(1, process.stdout.columns ?? SHARED_TERMINAL_COLS),
      Math.max(1, process.stdout.rows ?? SHARED_TERMINAL_ROWS),
    ).catch((error) => {
      logger.debug('[terminal] Failed to report local viewport:', error);
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

    if (localTty) {
      process.stdout.off('resize', handleLocalResize);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // stdin is no longer a TTY.
      }
      process.stdin.pause();
    }
    await terminal.dispose();

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
    await api.deactivateSession(response.id);
    process.exit(0);
  };

  runtimeExitHandler = (exitCode: number) => {
    void shutdown(`rust terminal runtime exited (code ${exitCode})`);
  };
  if (pendingRuntimeExit !== undefined) {
    await shutdown(`rust terminal runtime exited (code ${pendingRuntimeExit})`);
    return;
  }

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

  if (localTty) {
    handleLocalResize();
    process.stdout.on('resize', handleLocalResize);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      void terminal.write(LOCAL_TERMINAL_ID, data).catch((error) => {
        logger.debug('[terminal] Failed to write local input:', error);
        void shutdown('local terminal input failed');
      });
    });
  }
}
