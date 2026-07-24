import type { TerminalOutput } from '@slopus/happy-wire';

/**
 * Events emitted by {@link TerminalOrderer} as it reconciles chunks.
 *
 * - `write`: a chunk's payload (base64) is ready to render, in order.
 * - `resync`: a gap was detected; the consumer should re-issue the
 *   `terminal-attach` RPC to fetch a fresh snapshot from the CLI.
 */
export type TerminalOrdererEvent =
    | { type: 'write'; seq: number; data: string }
    | { type: 'resync' };

export interface TerminalOrdererOptions {
    /** Cooldown between resync emissions, ms. Defaults to 2000. */
    resyncCooldownMs?: number;
    /** Injectable clock for tests. Defaults to `Date.now`. */
    now?: () => number;
}

/**
 * Orders terminal output chunks into a coherent stream.
 *
 * The CLI emits chunks with a per-session monotonic `seq`. Live chunks that
 * arrive before the `terminal-attach` RPC settles are buffered; on
 * {@link settle} they flush in seq order. Snapshot chunks (replayed by the
 * CLI on attach) bypass the seq gate so scrollback restores immediately. A
 * gap in the live seq (`seq > lastSeq + 1`) triggers a rate-limited `resync`
 * rather than writing out-of-order data.
 *
 * Extracted from the terminal views so both the web (xterm.js) and native
 * (WebView) renderers share one ordering implementation.
 */
export class TerminalOrderer {
    private lastSeq = -1;
    private attachSettled = false;
    private pending: TerminalOutput[] = [];
    private lastResyncAt = 0;
    private readonly resyncCooldownMs: number;
    private readonly now: () => number;

    constructor(
        private readonly emit: (event: TerminalOrdererEvent) => void,
        options: TerminalOrdererOptions = {},
    ) {
        this.resyncCooldownMs = options.resyncCooldownMs ?? 2000;
        this.now = options.now ?? (() => Date.now());
    }

    /** Feed a decrypted chunk from the output bus. */
    push(chunk: TerminalOutput): void {
        if (chunk.snapshot) {
            if (chunk.seq > this.lastSeq) {
                this.lastSeq = chunk.seq;
                this.emit({ type: 'write', seq: chunk.seq, data: chunk.data });
            }
            return;
        }
        if (!this.attachSettled) {
            this.pending.push(chunk);
            return;
        }
        this.applyLive(chunk);
    }

    /** Mark the `terminal-attach` RPC as settled and flush buffered live chunks. */
    settle(): void {
        this.attachSettled = true;
        const buffered = this.pending;
        this.pending = [];
        buffered.sort((a, b) => a.seq - b.seq);
        for (const chunk of buffered) {
            this.applyLive(chunk);
        }
    }

    /** Reset to the initial state (e.g. before a fresh attach after reconnect). */
    reset(): void {
        this.lastSeq = -1;
        this.attachSettled = false;
        this.pending = [];
        this.lastResyncAt = 0;
    }

    private applyLive(chunk: TerminalOutput): void {
        if (chunk.seq <= this.lastSeq) {
            return;
        }
        if (this.lastSeq >= 0 && chunk.seq > this.lastSeq + 1) {
            // Gap - drop the out-of-order chunk and request a snapshot replay.
            this.requestResync();
            return;
        }
        this.lastSeq = chunk.seq;
        this.emit({ type: 'write', seq: chunk.seq, data: chunk.data });
    }

    private requestResync(): void {
        const now = this.now();
        if (now - this.lastResyncAt < this.resyncCooldownMs) {
            return;
        }
        this.lastResyncAt = now;
        this.emit({ type: 'resync' });
    }
}
