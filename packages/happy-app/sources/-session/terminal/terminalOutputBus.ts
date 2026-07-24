import type { TerminalOutput } from '@slopus/happy-wire';

/**
 * In-memory pub/sub for decrypted terminal output chunks.
 *
 * `sync.ts` decrypts `terminal-output` ephemeral events and emits them here;
 * the mounted SessionTerminalView subscribes. Kept deliberately tiny — there
 * is no persistence (the server relays output ephemerally, snapshot replay
 * comes from the CLI via `terminal-attach`).
 */

type TerminalOutputCallback = (chunk: TerminalOutput) => void;

const subscribers = new Map<string, Set<TerminalOutputCallback>>();

export function subscribeTerminalOutput(sessionId: string, callback: TerminalOutputCallback): () => void {
    let set = subscribers.get(sessionId);
    if (!set) {
        set = new Set();
        subscribers.set(sessionId, set);
    }
    set.add(callback);
    return () => {
        const current = subscribers.get(sessionId);
        if (current) {
            current.delete(callback);
            if (current.size === 0) {
                subscribers.delete(sessionId);
            }
        }
    };
}

export function emitTerminalOutput(sessionId: string, chunk: TerminalOutput): void {
    const set = subscribers.get(sessionId);
    if (!set) {
        return;
    }
    for (const callback of set) {
        callback(chunk);
    }
}
