import { describe, expect, it, vi } from 'vitest';
import { clearTerminalOutputBuffer, emitTerminalOutput, subscribeTerminalOutput } from './terminalOutputBus';
import type { TerminalOutput } from '@slopus/happy-wire';

function chunk(seq: number, data = 'x', snapshot?: boolean): TerminalOutput {
    return snapshot ? { t: 'output', seq, data, snapshot: true } : { t: 'output', seq, data };
}

describe('terminalOutputBus', () => {
    it('delivers emitted chunks to a subscriber', () => {
        const cb = vi.fn();
        const off = subscribeTerminalOutput('sess-deliver', cb);

        emitTerminalOutput('sess-deliver', chunk(1, 'a'));

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(chunk(1, 'a'));
        off();
    });

    it('fans out to multiple subscribers', () => {
        const a = vi.fn();
        const b = vi.fn();
        const offA = subscribeTerminalOutput('sess-fanout', a);
        const offB = subscribeTerminalOutput('sess-fanout', b);

        emitTerminalOutput('sess-fanout', chunk(2, 'b'));

        expect(a).toHaveBeenCalledWith(chunk(2, 'b'));
        expect(b).toHaveBeenCalledWith(chunk(2, 'b'));
        offA();
        offB();
    });

    it('stops delivering after unsubscribe', () => {
        const cb = vi.fn();
        const off = subscribeTerminalOutput('sess-off', cb);

        off();
        emitTerminalOutput('sess-off', chunk(3, 'c'));

        expect(cb).not.toHaveBeenCalled();
    });

    it('only removes the unsubscribed callback, leaving others intact', () => {
        const keep = vi.fn();
        const drop = vi.fn();
        const offKeep = subscribeTerminalOutput('sess-partial', keep);
        const offDrop = subscribeTerminalOutput('sess-partial', drop);

        offDrop();
        emitTerminalOutput('sess-partial', chunk(4, 'd'));

        expect(drop).not.toHaveBeenCalled();
        expect(keep).toHaveBeenCalledWith(chunk(4, 'd'));
        offKeep();
    });

    it('is a no-op when there are no subscribers', () => {
        expect(() => emitTerminalOutput('sess-empty', chunk(5, 'e'))).not.toThrow();
    });

    it('passes snapshot chunks through unchanged', () => {
        const cb = vi.fn();
        const off = subscribeTerminalOutput('sess-snapshot', cb);

        emitTerminalOutput('sess-snapshot', chunk(6, 'f', true));

        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ seq: 6, snapshot: true }));
        off();
    });

    it('replays buffered chunks to a late subscriber', () => {
        // Emit with no subscriber - chunks should be buffered, not dropped.
        emitTerminalOutput('sess-replay', chunk(1, 'a'));
        emitTerminalOutput('sess-replay', chunk(2, 'b'));

        const cb = vi.fn();
        const off = subscribeTerminalOutput('sess-replay', cb);

        // Both buffered chunks are replayed on subscribe, in order.
        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenNthCalledWith(1, chunk(1, 'a'));
        expect(cb).toHaveBeenNthCalledWith(2, chunk(2, 'b'));
        off();
        clearTerminalOutputBuffer('sess-replay');
    });

    it('evicts oldest chunks when the buffer exceeds the size limit', () => {
        // Fill the buffer well past the 512 KB limit so old chunks are evicted.
        // Each chunk's data is ~1 KB of base64.
        const big = 'x'.repeat(1024);
        for (let i = 0; i < 700; i++) {
            emitTerminalOutput('sess-evict', chunk(i, big));
        }

        const cb = vi.fn();
        const off = subscribeTerminalOutput('sess-evict', cb);

        // The first call is the oldest surviving chunk; earlier ones were evicted.
        const firstSeq = cb.mock.calls[0]?.[0]?.seq;
        expect(firstSeq).toBeGreaterThan(0);
        expect(firstSeq).toBeLessThan(700);
        off();
        clearTerminalOutputBuffer('sess-evict');
    });

    it('clears the buffer when requested', () => {
        emitTerminalOutput('sess-clear', chunk(1, 'a'));
        clearTerminalOutputBuffer('sess-clear');

        const cb = vi.fn();
        const off = subscribeTerminalOutput('sess-clear', cb);

        expect(cb).not.toHaveBeenCalled();
        off();
    });
});
