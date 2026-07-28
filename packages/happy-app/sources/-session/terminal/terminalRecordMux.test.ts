import { describe, expect, it, vi } from 'vitest';
import type { TerminalStreamEvent } from '@slopus/happy-wire';
import {
    TerminalRecordMux,
    terminalEventBelongsToDevice,
    type TerminalRecordMuxEvent,
} from './terminalRecordMux';

const output = (terminalId: string | undefined, seq: number, data = terminalId ?? 'legacy'): TerminalStreamEvent => ({
    t: 'output',
    ...(terminalId ? { terminalId } : {}),
    seq,
    data,
});

describe('TerminalRecordMux', () => {
    it('lets RAW consume only its own device stream plus legacy events', () => {
        expect(terminalEventBelongsToDevice(output('phone', 0), 'phone')).toBe(true);
        expect(terminalEventBelongsToDevice(output('web', 0), 'phone')).toBe(false);
        expect(terminalEventBelongsToDevice(output(undefined, 0), 'phone')).toBe(true);
    });

    it('orders and deduplicates each device independently', () => {
        const events: TerminalRecordMuxEvent[] = [];
        const mux = new TerminalRecordMux((event) => events.push(event));

        mux.push(output('phone', 0), 'local');
        mux.push(output('web', 0), 'local');
        mux.push(output('phone', 0), 'local');
        mux.settle();
        mux.push(output('phone', 1), 'local');
        mux.push(output('web', 1), 'local');

        expect(events.map(({ terminalId, event }) => [terminalId, event.type, 'seq' in event ? event.seq : null])).toEqual([
            ['phone', 'write', 0],
            ['web', 'write', 0],
            ['phone', 'write', 1],
            ['web', 'write', 1],
        ]);
    });

    it('scopes legacy events to the current device fallback', () => {
        const events: TerminalRecordMuxEvent[] = [];
        const mux = new TerminalRecordMux((event) => events.push(event));
        mux.push(output(undefined, 0), 'this-device');
        mux.settle();
        expect(events[0]?.terminalId).toBe('this-device');
    });

    it('reports a sequence gap for the affected device only', () => {
        const emit = vi.fn<(event: TerminalRecordMuxEvent) => void>();
        const mux = new TerminalRecordMux(emit, { now: () => 5000 });
        mux.settle();
        mux.push(output('phone', 0), 'local');
        mux.push(output('phone', 2), 'local');

        expect(emit.mock.calls.map(([event]) => [event.terminalId, event.event.type])).toEqual([
            ['phone', 'write'],
            ['phone', 'resync'],
            ['phone', 'write'],
        ]);
    });
});
