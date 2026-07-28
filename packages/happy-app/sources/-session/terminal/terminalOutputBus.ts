import type { TerminalStreamEvent } from '@slopus/happy-wire';

/**
 * In-memory pub/sub for decrypted terminal output chunks.
 *
 * `sync.ts` decrypts `terminal-output` ephemeral events and emits them here;
 * the mounted SessionTerminalView subscribes. Snapshot replay comes from the
 * CLI via `terminal-attach`, but chunks that arrive while no view is mounted
 * (e.g. the user switched to another session) are buffered here so the history
 * survives the round-trip. The CLI's 64 KB ring buffer may have evicted them
 * or the CLI process may have exited entirely.
 */

type TerminalOutputCallback = (chunk: TerminalStreamEvent) => void;

/** Max replay buffer per session (~512 KB of base64 data). */
const MAX_BUFFER_BYTES = 512 * 1024;

interface SessionBuffer {
    chunks: TerminalStreamEvent[];
    bytes: number;
}

const subscribers = new Map<string, Set<TerminalOutputCallback>>();
const buffers = new Map<string, SessionBuffer>();

function eventSize(chunk: TerminalStreamEvent): number {
    return chunk.t === 'output' ? chunk.data.length : JSON.stringify(chunk).length;
}

function addToBuffer(sessionId: string, chunk: TerminalStreamEvent): void {
    let buf = buffers.get(sessionId);
    if (!buf) {
        buf = { chunks: [], bytes: 0 };
        buffers.set(sessionId, buf);
    }
    buf.chunks.push(chunk);
    buf.bytes += eventSize(chunk);
    while (buf.bytes > MAX_BUFFER_BYTES && buf.chunks.length > 1) {
        const dropped = buf.chunks.shift()!;
        buf.bytes -= eventSize(dropped);
    }
}

export function subscribeTerminalOutput(sessionId: string, callback: TerminalOutputCallback): () => void {
    let set = subscribers.get(sessionId);
    if (!set) {
        set = new Set();
        subscribers.set(sessionId, set);
    }
    set.add(callback);

    // Replay buffered chunks so a freshly mounted view recovers history that
    // arrived while it was unmounted. These arrive as live (non-snapshot)
    // chunks; the TerminalOrderer buffers them in `pending` until
    // `terminal-attach` settles, then dedupes against the CLI snapshot by seq.
    const buf = buffers.get(sessionId);
    if (buf) {
        for (const chunk of buf.chunks) {
            callback(chunk);
        }
    }

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

export function emitTerminalOutput(sessionId: string, chunk: TerminalStreamEvent): void {
    // Always buffer so history survives view unmount/remount cycles.
    addToBuffer(sessionId, chunk);

    const set = subscribers.get(sessionId);
    if (!set) {
        return;
    }
    for (const callback of set) {
        callback(chunk);
    }
}

/** Discard the replay buffer for a session (e.g. after it is archived). */
export function clearTerminalOutputBuffer(sessionId: string): void {
    buffers.delete(sessionId);
}
