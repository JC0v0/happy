import { describe, expect, it } from 'vitest';
import type { PersistedTerminalHistoryEntry } from '@/sync/persistence';
import { queryTerminalHistory } from './terminalHistorySearch';

function entry(overrides: Partial<PersistedTerminalHistoryEntry>): PersistedTerminalHistoryEntry {
    return {
        id: '1',
        sessionId: 'session',
        command: 'git status',
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        exitCode: 0,
        favorite: false,
        ...overrides,
    };
}

describe('terminal history search', () => {
    const entries = [
        entry({ id: '1', command: 'git status', cwd: 'C:\\work\\happy', machineId: 'pc', favorite: true }),
        entry({ id: '2', command: 'pnpm test', cwd: 'C:\\work\\happy', machineId: 'pc' }),
        entry({ id: '3', command: 'docker logs api', cwd: '/srv/api', machineId: 'server' }),
    ];

    it('fuzzy-searches command, cwd and host metadata', () => {
        expect(queryTerminalHistory(entries, { text: 'dokcer log' }).map((item) => item.id)).toEqual(['3']);
        expect(queryTerminalHistory(entries, { text: 'happy' }).map((item) => item.id)).toEqual(['1', '2']);
    });

    it('filters by machine and favorites', () => {
        expect(queryTerminalHistory(entries, { machineId: 'pc' }).map((item) => item.id)).toEqual(['1', '2']);
        expect(queryTerminalHistory(entries, { favoritesOnly: true }).map((item) => item.id)).toEqual(['1']);
    });
});
