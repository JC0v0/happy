import type { TerminalStreamEvent } from '@slopus/happy-wire';

export type TerminalMetadataEvent = Exclude<TerminalStreamEvent, { t: 'output' }>;

/**
 * Events emitted by {@link TerminalOrderer} as it reconciles chunks.
 *
 * - `write`: a chunk's payload (base64) is ready to render, in order.
 * - `resync`: a gap was detected; the consumer should re-issue the
 *   `terminal-attach` RPC to fetch a fresh snapshot from the CLI.
 */
export type TerminalOrdererEvent =
    | { type: 'write'; seq: number; data: string }
    | { type: 'metadata'; event: TerminalMetadataEvent }
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
 * The CLI emits chunks with a per-session monotonic `seq`. Two histories must
 * merge on attach: the bus replay (buffered live chunks) and the CLI's
 * snapshot replay (its ring, which may have evicted the oldest chunks). Either
 * may arrive first and they interleave. To render one coherent, correctly
 * ordered scrollback, NOTHING is written while the attach is in flight:
 * everything is buffered into `pending`, and {@link settle} (fired when the
 * `terminal-attach` RPC resolves, i.e. after the CLI has sent its snapshot)
 * sorts, dedupes by seq, and writes the merged history once, oldest-first.
 *
 * After settle, chunks stream live: they are written in seq order, deduped,
 * and a forward gap (`seq > lastSeq + 1`) triggers a rate-limited `resync`
 * (the snapshot from that resync arrives post-settle and writes immediately).
 *
 * Extracted from the terminal views so both the web (xterm.js) and native
 * (WebView) renderers share one ordering implementation.
 */
export class TerminalOrderer {
    private lastSeq = -1;
    private attachSettled = false;
    private pending: TerminalStreamEvent[] = [];
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
    push(chunk: TerminalStreamEvent): void {
        // Until the attach settles, buffer BOTH snapshot and live chunks so the
        // two histories can be merged and written in order by settle().
        if (!this.attachSettled) {
            this.pending.push(chunk);
            return;
        }
        // Post-settle snapshot (from a gap-triggered resync): bypass the seq
        // gate so scrollback restores immediately, dedupe by seq.
        if (chunk.snapshot) {
            if (chunk.seq > this.lastSeq) {
                this.lastSeq = chunk.seq;
                this.emitStreamEvent(chunk);
            }
            return;
        }
        this.applyLive(chunk);
    }

    /**
     * Mark the `terminal-attach` RPC as settled and write the merged history.
     * Snapshot chunks (the CLI ring's tail) and buffered live chunks (the bus
     * replay, which may carry earlier history the ring evicted) are sorted by
     * seq and deduped, then written oldest-first so xterm renders one ordered
     * scrollback instead of tail-then-head.
     */
    settle(): void {
        this.attachSettled = true;
        const buffered = this.pending;
        this.pending = [];
        buffered.sort((a, b) => a.seq - b.seq);
        for (const chunk of buffered) {
            if (chunk.seq <= this.lastSeq) {
                continue; // duplicate: the same seq arrived via both histories
            }
            this.lastSeq = chunk.seq;
            this.emitStreamEvent(chunk);
        }
    }

    /** Reset to the initial state (e.g. before a fresh attach after reconnect). */
    reset(): void {
        this.lastSeq = -1;
        this.attachSettled = false;
        this.pending = [];
        this.lastResyncAt = 0;
    }

    private applyLive(chunk: TerminalStreamEvent): void {
        if (chunk.seq <= this.lastSeq) {
            return;
        }
        if (this.lastSeq >= 0 && chunk.seq > this.lastSeq + 1) {
            // Gap - either a dropped packet or the CLI's ring buffer overflowed
            // and can no longer cover the missing range. Request a snapshot
            // replay (rate-limited) in case the ring still has some of the
            // missing data, but write this chunk and advance lastSeq regardless.
            // Dropping it would pin the orderer in an endless resync loop where
            // every live chunk is discarded - leaving the terminal frozen - when
            // the ring can't fill the gap.
            this.requestResync();
        }
        this.lastSeq = chunk.seq;
        this.emitStreamEvent(chunk);
    }

    private emitStreamEvent(event: TerminalStreamEvent): void {
        if (event.t === 'output') {
            this.emit({ type: 'write', seq: event.seq, data: event.data });
        } else {
            this.emit({ type: 'metadata', event });
        }
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
