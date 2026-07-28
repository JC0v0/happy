import type { Session } from '@/sync/storageTypes';
import {
    upsertTerminalHistoryEntry,
    type PersistedTerminalHistoryEntry,
} from '@/sync/persistence';
import type { TerminalCommandBlock } from './terminalCommandState';

export function persistCompletedTerminalCommand(
    session: Session,
    block: TerminalCommandBlock,
): PersistedTerminalHistoryEntry | null {
    if (
        block.status === 'running' ||
        block.endedAt === undefined ||
        block.durationMs === undefined ||
        block.exitCode === undefined
    ) {
        return null;
    }
    const entry: PersistedTerminalHistoryEntry = {
        id: `${session.id}:${block.commandId}`,
        sessionId: session.id,
        ...(session.metadata?.machineId ? { machineId: session.metadata.machineId } : {}),
        ...(session.metadata?.host ? { host: session.metadata.host } : {}),
        command: block.command,
        ...(block.cwd ? { cwd: block.cwd } : {}),
        startedAt: block.startedAt,
        endedAt: block.endedAt,
        durationMs: block.durationMs,
        exitCode: block.exitCode,
        favorite: false,
    };
    const { favorite: _favorite, ...persisted } = entry;
    upsertTerminalHistoryEntry(persisted);
    return entry;
}
