import { describe, expect, it } from 'vitest';
import { TerminalOrderer, type TerminalOrdererEvent } from './terminalOrdering';
import type { TerminalOutput } from '@slopus/happy-wire';

function live(seq: number, data = `live-${seq}`): TerminalOutput {
    return { t: 'output', seq, data };
}

function snap(seq: number, data = `snap-${seq}`): TerminalOutput {
    return { t: 'output', seq, data, snapshot: true };
}

// A realistic Date.now() baseline. The orderer's resync cooldown initializes
// its "last resync" timestamp to 0, so a clock that also starts at 0 would
// suppress the very first gap-triggered resync - real wall clock never does.
const BASE_TIME = 1_700_000_000_000;

function makeOrderer(now: () => number = () => BASE_TIME) {
    const events: TerminalOrdererEvent[] = [];
    const orderer = new TerminalOrderer((event) => events.push(event), { now });
    return {
        orderer,
        events,
        writes: () => events.filter((e) => e.type === 'write').map((e) => (e as Extract<TerminalOrdererEvent, { type: 'write' }>).seq),
        resyncs: () => events.filter((e) => e.type === 'resync').length,
    };
}

describe('TerminalOrderer', () => {
    it('writes snapshot chunks immediately, bypassing the seq gate', () => {
        const h = makeOrderer();
        h.orderer.push(snap(5));

        expect(h.writes()).toEqual([5]);
    });

    it('buffers live chunks until settle, then flushes in seq order', () => {
        const h = makeOrderer();
        h.orderer.push(live(2));
        h.orderer.push(live(0));
        h.orderer.push(live(1));

        expect(h.writes()).toEqual([]);

        h.orderer.settle();

        expect(h.writes()).toEqual([0, 1, 2]);
    });

    it('writes live chunks in order when they arrive after settle', () => {
        const h = makeOrderer();
        h.orderer.settle();
        h.orderer.push(live(0));
        h.orderer.push(live(1));
        h.orderer.push(live(2));

        expect(h.writes()).toEqual([0, 1, 2]);
    });

    it('drops live chunks with seq <= lastSeq (dedup)', () => {
        const h = makeOrderer();
        h.orderer.settle();
        h.orderer.push(live(0));
        h.orderer.push(live(0)); // duplicate
        h.orderer.push(live(1));

        expect(h.writes()).toEqual([0, 1]);
    });

    it('emits resync (not a write) on a seq gap', () => {
        const h = makeOrderer();
        h.orderer.settle();
        h.orderer.push(live(0));
        h.orderer.push(live(5)); // gap

        expect(h.writes()).toEqual([0]);
        expect(h.resyncs()).toBe(1);
    });

    it('rate-limits resync emissions with a cooldown', () => {
        let time = BASE_TIME;
        const h = makeOrderer(() => time);
        h.orderer.settle();

        h.orderer.push(live(0));
        h.orderer.push(live(5)); // gap -> resync
        expect(h.resyncs()).toBe(1);

        h.orderer.push(live(10)); // another gap, same instant -> suppressed
        expect(h.resyncs()).toBe(1);

        time = BASE_TIME + 2000; // cooldown elapsed
        h.orderer.push(live(15)); // gap -> resync again
        expect(h.resyncs()).toBe(2);
    });

    it('advances lastSeq via snapshots so later live chunks dedup against it', () => {
        const h = makeOrderer();
        h.orderer.settle();
        h.orderer.push(snap(10)); // snapshot sets lastSeq=10
        h.orderer.push(live(9)); // 9 <= 10 -> dropped
        h.orderer.push(live(11)); // 11 > 10 -> written

        expect(h.writes()).toEqual([10, 11]);
    });

    it('drops snapshots with seq <= lastSeq', () => {
        const h = makeOrderer();
        h.orderer.push(snap(5)); // written
        h.orderer.push(snap(3)); // older -> dropped
        h.orderer.push(snap(5)); // equal -> dropped

        expect(h.writes()).toEqual([5]);
    });

    it('clears buffered and seq state on reset', () => {
        const h = makeOrderer();
        h.orderer.push(live(0)); // buffered (not settled)
        h.orderer.reset();
        h.orderer.settle(); // flushes the now-empty pending buffer

        expect(h.writes()).toEqual([]);

        // After reset the dedup state is gone, so a previously-seen seq writes again.
        h.orderer.push(live(0));
        expect(h.writes()).toEqual([0]);
    });

    it('does not treat the first live chunk after reset as a gap', () => {
        const h = makeOrderer();
        h.orderer.reset();
        h.orderer.push(live(42)); // buffered
        h.orderer.settle();

        expect(h.writes()).toEqual([42]);
        expect(h.resyncs()).toBe(0);
    });
});
