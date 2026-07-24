import { describe, expect, it } from 'vitest';
import { emitTerminalOutput, subscribeTerminalOutput, clearTerminalOutputBuffer } from './terminalOutputBus';
import { TerminalOrderer } from './terminalOrdering';
import type { TerminalOutput } from '@slopus/happy-wire';

// Full app-path integration for the remount/reattach flow. The bus replays
// buffered history as LIVE chunks into a fresh orderer (pending), the CLI
// answers terminal-attach by re-emitting its ring as SNAPSHOT chunks, and
// settle() flushes pending. The relative order of (snapshot arrival) vs
// (settle) and the breadth of the snapshot determine whether history survives.
// This matrix pins down every branch that loses scrollback.

const SID = 'sess-integration';

function live(seq: number): TerminalOutput {
    return { t: 'output', seq, data: `chunk-${seq}` };
}
function snap(seq: number): TerminalOutput {
    return { t: 'output', seq, data: `chunk-${seq}`, snapshot: true };
}
const FULL = Array.from({ length: 23 }, (_, i) => i); // a dir listing

// Prime the bus with the live history (as if the session streamed `dir` while
// the socket stayed connected), then run one remount scenario.
function scenario(opts: {
    liveEmitted: number[];      // chunks sync.ts pushed to the bus (and old view)
    snapshotSeqs: number[];     // what the CLI ring re-emits as snapshot
    settleBeforeSnapshot: boolean;
}) {
    clearTerminalOutputBuffer(SID);
    for (const s of opts.liveEmitted) emitTerminalOutput(SID, live(s));

    const written: number[] = [];
    const orderer = new TerminalOrderer((e) => {
        if (e.type === 'write') written.push(e.seq);
    });
    const off = subscribeTerminalOutput(SID, (c) => orderer.push(c)); // replay -> pending

    if (opts.settleBeforeSnapshot) {
        orderer.settle();                              // RPC resolved first
        for (const s of opts.snapshotSeqs) orderer.push(snap(s));
    } else {
        for (const s of opts.snapshotSeqs) orderer.push(snap(s)); // snapshot first
        orderer.settle();
    }
    off();
    return written; // preserve emission order: xterm renders chunks as written
}

describe('remount/reattach history matrix', () => {
    it('full snapshot, snapshot before settle -> all restored', () => {
        expect(scenario({ liveEmitted: FULL, snapshotSeqs: FULL, settleBeforeSnapshot: false }))
            .toEqual(FULL);
    });

    it('full snapshot, settle before snapshot -> all restored', () => {
        expect(scenario({ liveEmitted: FULL, snapshotSeqs: FULL, settleBeforeSnapshot: true }))
            .toEqual(FULL);
    });

    it('truncated snapshot (tail only), snapshot before settle -> all restored (bus fills head)', () => {
        expect(scenario({ liveEmitted: FULL, snapshotSeqs: FULL.slice(18), settleBeforeSnapshot: false }))
            .toEqual(FULL);
    });

    it('truncated snapshot (tail only), settle before snapshot -> all restored', () => {
        expect(scenario({ liveEmitted: FULL, snapshotSeqs: FULL.slice(18), settleBeforeSnapshot: true }))
            .toEqual(FULL);
    });

    it('empty snapshot, settle before snapshot -> all restored from bus replay alone', () => {
        expect(scenario({ liveEmitted: FULL, snapshotSeqs: [], settleBeforeSnapshot: true }))
            .toEqual(FULL);
    });

    it('interleaved snapshot+live arrival restores full ordered history', () => {
        clearTerminalOutputBuffer(SID);
        for (const s of FULL) emitTerminalOutput(SID, live(s));

        const written: number[] = [];
        const orderer = new TerminalOrderer((e) => {
            if (e.type === 'write') written.push(e.seq);
        });
        const off = subscribeTerminalOutput(SID, (c) => orderer.push(c)); // replay -> pending
        // Snapshot (tail 18..22) interleaves with the bus replay still pending.
        for (const s of FULL.slice(18)) orderer.push(snap(s));
        orderer.settle();
        off();

        expect(written).toEqual(FULL);
        clearTerminalOutputBuffer(SID);
    });
});
