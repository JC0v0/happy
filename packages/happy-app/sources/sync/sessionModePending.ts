import type { SessionModesPatch } from './storageTypes';

/**
 * Tracks per-session mode fields that have an optimistic metadata push
 * in flight. While a push is pending, the local mirror is newer than anything
 * the server can echo back, so applySessions must not resolve those fields
 * from inbound (stale) metadata — otherwise the pick visibly bounces back and
 * a message sent in that window carries the old mode.
 *
 * Lives in its own module so both ops.ts (writer) and storage.ts (reader) can
 * use it without an import cycle. Counters (not booleans) so overlapping
 * pushes for the same field don't clear each other's pending state.
 */
export type SessionModeField = keyof SessionModesPatch;

const pendingBySession = new Map<string, Map<SessionModeField, number>>();

export function markSessionModePushPending(sessionId: string, fields: SessionModeField[]): void {
    let counters = pendingBySession.get(sessionId);
    if (!counters) {
        counters = new Map();
        pendingBySession.set(sessionId, counters);
    }
    for (const field of fields) {
        counters.set(field, (counters.get(field) ?? 0) + 1);
    }
}

export function clearSessionModePushPending(sessionId: string, fields: SessionModeField[]): void {
    const counters = pendingBySession.get(sessionId);
    if (!counters) {
        return;
    }
    for (const field of fields) {
        const count = counters.get(field) ?? 0;
        if (count <= 1) {
            counters.delete(field);
        } else {
            counters.set(field, count - 1);
        }
    }
    if (counters.size === 0) {
        pendingBySession.delete(sessionId);
    }
}

export function isSessionModePushPending(sessionId: string, field: SessionModeField): boolean {
    return (pendingBySession.get(sessionId)?.get(field) ?? 0) > 0;
}
