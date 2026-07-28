import { describe, expect, it } from 'vitest';
import {
    applyTerminalAttachState,
    EMPTY_TERMINAL_COMMAND_STATE,
    latestTerminalCommandBlock,
    mergeTerminalCommandStates,
    reduceTerminalCommandState,
} from './terminalCommandState';

describe('terminal command state', () => {
    it('does not treat shared grid changes as command metadata', () => {
        const state = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'grid', seq: 0, cols: 42, rows: 28, controllerTerminalId: 'phone',
        });
        expect(state).toBe(EMPTY_TERMINAL_COMMAND_STATE);
    });

    it('builds and completes a successful command block', () => {
        let state = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'cwd', seq: 0, path: 'C:\\work',
        });
        state = reduceTerminalCommandState(state, {
            t: 'command-start', seq: 1, commandId: 'cmd-1', command: 'pnpm test', startedAt: 100,
        });
        state = reduceTerminalCommandState(state, {
            t: 'command-end', seq: 2, commandId: 'cmd-1', endedAt: 250, durationMs: 150, exitCode: 0,
        });

        expect(state.status).toBe('idle');
        expect(latestTerminalCommandBlock(state)).toEqual(expect.objectContaining({
            command: 'pnpm test',
            cwd: 'C:\\work',
            status: 'succeeded',
            exitCode: 0,
            durationMs: 150,
        }));
    });

    it('marks non-zero exit codes as failed', () => {
        let state = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'command-start', seq: 0, commandId: 'cmd-1', command: 'false', startedAt: 100,
        });
        state = reduceTerminalCommandState(state, {
            t: 'command-end', seq: 1, commandId: 'cmd-1', endedAt: 120, durationMs: 20, exitCode: 1,
        });
        expect(latestTerminalCommandBlock(state)?.status).toBe('failed');
    });

    it('surfaces waiting-for-input and returns to running after input', () => {
        let state = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'command-start', seq: 0, commandId: 'cmd-1', command: 'login', startedAt: 100,
        });
        state = reduceTerminalCommandState(state, {
            t: 'state', seq: 1, state: 'needs-input', commandId: 'cmd-1',
        });
        expect(latestTerminalCommandBlock(state)?.status).toBe('waiting');
        state = reduceTerminalCommandState(state, {
            t: 'state', seq: 2, state: 'running', commandId: 'cmd-1',
        });
        expect(latestTerminalCommandBlock(state)?.status).toBe('running');
    });

    it('hydrates an active command missed by a truncated snapshot', () => {
        const state = applyTerminalAttachState(EMPTY_TERMINAL_COMMAND_STATE, {
            capabilities: { protocolVersion: 2, structuredCommands: true, shell: 'powershell' },
            state: {
                status: 'running',
                cwd: 'C:\\work',
                activeCommand: { commandId: 'cmd-1', command: 'build', startedAt: 100 },
            },
        });
        expect(latestTerminalCommandBlock(state)).toEqual(expect.objectContaining({
            commandId: 'cmd-1',
            command: 'build',
            status: 'running',
        }));
    });

    it('keeps local status while merging blocks from every device chronologically', () => {
        const phone = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'command-start', terminalId: 'phone', seq: 0,
            commandId: 'phone-command', command: 'pwd', startedAt: 200,
        }, 'phone');
        const web = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'command-start', terminalId: 'web', seq: 0,
            commandId: 'web-command', command: 'ls', startedAt: 100,
        }, 'web');

        const merged = mergeTerminalCommandStates({ phone, web }, 'phone');
        expect(merged.status).toBe('running');
        expect(merged.blocks.map((block) => [block.terminalId, block.command])).toEqual([
            ['web', 'ls'],
            ['phone', 'pwd'],
        ]);
    });
});
