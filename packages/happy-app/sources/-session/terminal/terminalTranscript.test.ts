import { describe, expect, it } from 'vitest';
import { appendTerminalCommandOutput, EMPTY_TERMINAL_COMMAND_STATE, reduceTerminalCommandState } from './terminalCommandState';
import { TerminalTranscriptDecoder, terminalBlockOutputText, terminalTranscriptText } from './terminalTranscript';

describe('terminal transcript', () => {
    it('decodes split ANSI sequences and detects alternate-screen applications', () => {
        const decoder = new TerminalTranscriptDecoder();
        const first = decoder.push(new TextEncoder().encode('\u001b[31'));
        const second = decoder.push(new TextEncoder().encode('mred\u001b[0m\r\n\u001b[?1049h'));
        expect(first.text).toBe('');
        expect(second.text).toBe('red\r\n');
        expect(second.rawPreferred).toBe(true);
    });

    it('associates output with the running block and removes the echoed command', () => {
        let state = reduceTerminalCommandState(EMPTY_TERMINAL_COMMAND_STATE, {
            t: 'command-start', seq: 0, commandId: 'one', command: 'echo hello', startedAt: 1,
        });
        state = appendTerminalCommandOutput(state, 'PS C:\\work> echo hello\r\nhello\r\n');
        state = reduceTerminalCommandState(state, {
            t: 'command-end', seq: 2, commandId: 'one', endedAt: 3, durationMs: 2, exitCode: 0,
        });
        expect(terminalBlockOutputText(state.blocks[0])).toBe('hello');
        expect(terminalTranscriptText(state)).toBe('$ echo hello\nhello');
    });

    it('ignores output when no command block is active', () => {
        expect(appendTerminalCommandOutput(EMPTY_TERMINAL_COMMAND_STATE, 'prompt')).toBe(EMPTY_TERMINAL_COMMAND_STATE);
    });

    it('models carriage-return progress output without duplicating lines', () => {
        const block = {
            commandId: 'one', command: 'build', startedAt: 1, status: 'running' as const,
            output: 'progress 10%\rprogress 80%\rprogress 100%\r\n',
        };
        expect(terminalBlockOutputText(block)).toBe('progress 100%');
    });

    it('removes a partially duplicated local shell echo', () => {
        const block = {
            commandId: 'one', command: 'echo hello', startedAt: 1, status: 'succeeded' as const,
            endedAt: 2, durationMs: 1, exitCode: 0,
            output: 'echecho hello\r\nhello\r\n',
        };
        expect(terminalBlockOutputText(block)).toBe('hello');
    });
});
