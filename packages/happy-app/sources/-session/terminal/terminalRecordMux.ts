import type { TerminalStreamEvent } from '@slopus/happy-wire';
import {
    TerminalOrderer,
    type TerminalOrdererEvent,
    type TerminalOrdererOptions,
} from './terminalOrdering';

export interface TerminalRecordMuxEvent {
    terminalId: string;
    event: TerminalOrdererEvent;
}

/** Legacy unscoped output belongs to the viewing device for compatibility. */
export function terminalEventBelongsToDevice(
    chunk: TerminalStreamEvent,
    terminalId: string,
): boolean {
    return chunk.terminalId === undefined || chunk.terminalId === terminalId;
}

/**
 * Maintains one sequence domain per device PTY. A single TerminalOrderer cannot
 * consume all devices because every PTY starts its own seq counter at zero.
 */
export class TerminalRecordMux {
    private readonly orderers = new Map<string, TerminalOrderer>();
    private settled = false;

    constructor(
        private readonly emit: (event: TerminalRecordMuxEvent) => void,
        private readonly ordererOptions: TerminalOrdererOptions = {},
    ) {}

    push(chunk: TerminalStreamEvent, fallbackTerminalId: string): void {
        const terminalId = chunk.terminalId ?? fallbackTerminalId;
        this.getOrderer(terminalId).push(chunk);
    }

    settle(): void {
        this.settled = true;
        for (const orderer of this.orderers.values()) {
            orderer.settle();
        }
    }

    reset(): void {
        this.orderers.clear();
        this.settled = false;
    }

    private getOrderer(terminalId: string): TerminalOrderer {
        const existing = this.orderers.get(terminalId);
        if (existing) {
            return existing;
        }
        const orderer = new TerminalOrderer(
            (event) => this.emit({ terminalId, event }),
            this.ordererOptions,
        );
        if (this.settled) {
            orderer.settle();
        }
        this.orderers.set(terminalId, orderer);
        return orderer;
    }
}
