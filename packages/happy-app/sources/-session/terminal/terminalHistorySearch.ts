import Fuse from 'fuse.js';
import type { PersistedTerminalHistoryEntry } from '@/sync/persistence';

export interface TerminalHistoryQuery {
    text?: string;
    machineId?: string;
    favoritesOnly?: boolean;
}

export function queryTerminalHistory(
    entries: PersistedTerminalHistoryEntry[],
    query: TerminalHistoryQuery,
): PersistedTerminalHistoryEntry[] {
    let filtered = entries.filter((entry) => (
        (!query.machineId || entry.machineId === query.machineId) &&
        (!query.favoritesOnly || entry.favorite)
    ));
    const text = query.text?.trim();
    if (text) {
        filtered = new Fuse(filtered, {
            keys: ['command', 'cwd', 'host'],
            threshold: 0.35,
            ignoreLocation: true,
        }).search(text).map((result) => result.item);
    }
    return filtered;
}
