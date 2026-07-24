import { describe, expect, it, vi } from 'vitest';
import { emitTerminalOutput, subscribeTerminalOutput } from './terminalOutputBus';
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
});
