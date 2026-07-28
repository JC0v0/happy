import type {
    TerminalAttachResponse,
    TerminalCommandEnd,
    TerminalStreamEvent,
} from '@slopus/happy-wire';

type TerminalMetadataEvent = Exclude<TerminalStreamEvent, { t: 'output' }>;

export type TerminalCommandStatus = 'running' | 'waiting' | 'succeeded' | 'failed';

export interface TerminalCommandBlock {
    commandId: string;
    /** Device PTY that produced this block. Absent only for legacy streams. */
    terminalId?: string;
    command: string;
    cwd?: string;
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    exitCode?: number;
    status: TerminalCommandStatus;
    /** Plain terminal text captured between command-start and command-end. */
    output: string;
    outputTruncated?: boolean;
    /** The command entered an alternate screen and is best viewed in RAW mode. */
    rawPreferred?: boolean;
}

export interface TerminalCommandState {
    cwd?: string;
    status: 'idle' | 'running' | 'needs-input';
    blocks: TerminalCommandBlock[];
}

export type TerminalCommandStatesById = Record<string, TerminalCommandState>;

export const EMPTY_TERMINAL_COMMAND_STATE: TerminalCommandState = {
    status: 'idle',
    blocks: [],
};

const MAX_SESSION_BLOCKS = 100;
const MAX_BLOCK_OUTPUT_CHARS = 128 * 1024;

function finishBlock(block: TerminalCommandBlock, event: TerminalCommandEnd): TerminalCommandBlock {
    return {
        ...block,
        cwd: event.cwd ?? block.cwd,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        exitCode: event.exitCode,
        status: event.exitCode === 0 ? 'succeeded' : 'failed',
    };
}

export function reduceTerminalCommandState(
    state: TerminalCommandState,
    event: TerminalMetadataEvent,
    terminalId: string | undefined = event.terminalId,
): TerminalCommandState {
    switch (event.t) {
        case 'grid':
            return state;
        case 'cwd':
            return event.path === state.cwd ? state : { ...state, cwd: event.path };
        case 'state':
            return {
                ...state,
                status: event.state,
                blocks: event.commandId
                    ? state.blocks.map((block) => block.commandId === event.commandId && (block.status === 'running' || block.status === 'waiting')
                        ? { ...block, status: event.state === 'needs-input' ? 'waiting' : 'running' }
                        : block)
                    : state.blocks,
            };
        case 'command-start': {
            const existingIndex = state.blocks.findIndex((block) => block.commandId === event.commandId);
            const nextBlock: TerminalCommandBlock = {
                commandId: event.commandId,
                ...(terminalId ? { terminalId } : {}),
                command: event.command,
                cwd: event.cwd ?? state.cwd,
                startedAt: event.startedAt,
                status: 'running',
                output: '',
            };
            const blocks = existingIndex >= 0
                ? state.blocks.map((block, index) => index === existingIndex ? nextBlock : block)
                : [...state.blocks, nextBlock].slice(-MAX_SESSION_BLOCKS);
            return { ...state, status: 'running', blocks };
        }
        case 'command-end': {
            const blocks = state.blocks.map((block) => (
                block.commandId === event.commandId ? finishBlock(block, event) : block
            ));
            return {
                ...state,
                cwd: event.cwd ?? state.cwd,
                status: 'idle',
                blocks,
            };
        }
    }
}

/** Merge attach state without discarding blocks already reconstructed from snapshots. */
export function applyTerminalAttachState(
    state: TerminalCommandState,
    response: TerminalAttachResponse,
    terminalId?: string,
): TerminalCommandState {
    const attached = response.state;
    if (!attached) {
        return state;
    }

    let next: TerminalCommandState = {
        ...state,
        status: attached.status,
        cwd: attached.cwd ?? state.cwd,
    };
    const active = attached.activeCommand;
    if (active && !state.blocks.some((block) => block.commandId === active.commandId)) {
        const activeBlock: TerminalCommandBlock = {
            commandId: active.commandId,
            ...(terminalId ? { terminalId } : {}),
            command: active.command,
            cwd: active.cwd ?? attached.cwd,
            startedAt: active.startedAt,
            status: attached.status === 'needs-input' ? 'waiting' : 'running',
            output: '',
        };
        next = {
            ...next,
            blocks: [...next.blocks, activeBlock].slice(-MAX_SESSION_BLOCKS),
        };
    }
    return next;
}

export function appendTerminalCommandOutput(
    state: TerminalCommandState,
    text: string,
    options: { rawPreferred?: boolean } = {},
): TerminalCommandState {
    if (text.length === 0 && !options.rawPreferred) {
        return state;
    }
    let activeIndex = -1;
    for (let index = state.blocks.length - 1; index >= 0; index--) {
        if (state.blocks[index].status === 'running' || state.blocks[index].status === 'waiting') {
            activeIndex = index;
            break;
        }
    }
    if (activeIndex < 0) {
        return state;
    }
    const active = state.blocks[activeIndex];
    const combined = active.output + text;
    const outputTruncated = active.outputTruncated === true || combined.length > MAX_BLOCK_OUTPUT_CHARS;
    const output = outputTruncated ? combined.slice(-MAX_BLOCK_OUTPUT_CHARS) : combined;
    const nextBlock: TerminalCommandBlock = {
        ...active,
        output,
        ...(outputTruncated ? { outputTruncated: true } : {}),
        ...((active.rawPreferred || options.rawPreferred) ? { rawPreferred: true } : {}),
    };
    return {
        ...state,
        blocks: state.blocks.map((block, index) => index === activeIndex ? nextBlock : block),
    };
}

export function latestTerminalCommandBlock(state: TerminalCommandState): TerminalCommandBlock | undefined {
    return state.blocks[state.blocks.length - 1];
}

/** Local cwd/status plus the chronologically merged record feed from all PTYs. */
export function mergeTerminalCommandStates(
    states: TerminalCommandStatesById,
    localTerminalId: string,
): TerminalCommandState {
    const local = states[localTerminalId] ?? EMPTY_TERMINAL_COMMAND_STATE;
    const blocks = Object.values(states)
        .flatMap((state) => state.blocks)
        .sort((a, b) => a.startedAt - b.startedAt || a.commandId.localeCompare(b.commandId));
    return {
        ...local,
        blocks,
    };
}
