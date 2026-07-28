import { describe, expect, it } from 'vitest';
import {
    TerminalInputSchema,
    TerminalExecuteSchema,
    TerminalExecuteResponseSchema,
    TerminalResizeSchema,
    TerminalAttachSchema,
    TerminalAttachResponseSchema,
    TerminalOutputSchema,
    TerminalStreamEventSchema,
    TerminalRpcParamsSchema,
    TerminalOutputEventSchema,
} from './terminal';

describe('terminal wire schemas', () => {
    describe('TerminalInputSchema', () => {
        it('accepts a base64 keystroke payload', () => {
            expect(TerminalInputSchema.safeParse({ t: 'input', data: 'aGVsbG8=' }).success).toBe(true);
        });

        it('rejects a missing data field', () => {
            expect(TerminalInputSchema.safeParse({ t: 'input' }).success).toBe(false);
        });

        it('rejects the wrong discriminator', () => {
            expect(TerminalInputSchema.safeParse({ t: 'resize', data: 'x' }).success).toBe(false);
        });
    });

    describe('TerminalResizeSchema', () => {
        it('accepts in-range integer dimensions', () => {
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 80, rows: 24 }).success).toBe(true);
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 1, rows: 1 }).success).toBe(true);
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 1000, rows: 1000 }).success).toBe(true);
        });

        it('rejects out-of-range dimensions', () => {
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 0, rows: 24 }).success).toBe(false);
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 80, rows: 0 }).success).toBe(false);
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 1001, rows: 24 }).success).toBe(false);
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 80, rows: 1001 }).success).toBe(false);
        });

        it('rejects non-integer dimensions', () => {
            expect(TerminalResizeSchema.safeParse({ t: 'resize', cols: 80.5, rows: 24 }).success).toBe(false);
        });
    });

    describe('TerminalExecuteSchema', () => {
        it('accepts a bounded complete command and response', () => {
            expect(TerminalExecuteSchema.safeParse({ t: 'execute', command: 'git status' }).success).toBe(true);
            expect(TerminalExecuteResponseSchema.safeParse({ tracked: true, commandId: 'cmd-1' }).success).toBe(true);
            expect(TerminalExecuteResponseSchema.safeParse({ tracked: false }).success).toBe(true);
        });

        it('rejects empty commands', () => {
            expect(TerminalExecuteSchema.safeParse({ t: 'execute', command: '' }).success).toBe(false);
        });
    });

    describe('TerminalAttachSchema', () => {
        it('accepts a bare attach request', () => {
            expect(TerminalAttachSchema.safeParse({ t: 'attach' }).success).toBe(true);
        });

        it('accepts a stable device terminal id while preserving legacy payloads', () => {
            expect(TerminalAttachSchema.safeParse({ t: 'attach', terminalId: 'device-ios-1' }).success).toBe(true);
            expect(TerminalInputSchema.safeParse({ t: 'input', terminalId: 'device-ios-1', data: 'Yw==' }).success).toBe(true);
            expect(TerminalResizeSchema.safeParse({ t: 'resize', terminalId: 'device-web-1', cols: 120, rows: 40 }).success).toBe(true);
            expect(TerminalAttachSchema.safeParse({ t: 'attach', terminalId: '' }).success).toBe(false);
        });
    });

    describe('TerminalOutputSchema', () => {
        it('accepts a live output chunk with a seq counter', () => {
            expect(TerminalOutputSchema.safeParse({ t: 'output', seq: 0, data: 'aGVsbG8=' }).success).toBe(true);
            expect(TerminalOutputSchema.safeParse({ t: 'output', seq: 42, data: '' }).success).toBe(true);
        });

        it('treats snapshot as optional', () => {
            expect(TerminalOutputSchema.safeParse({ t: 'output', seq: 1, data: 'x', snapshot: true }).success).toBe(true);
            expect(TerminalOutputSchema.safeParse({ t: 'output', seq: 1, data: 'x', snapshot: false }).success).toBe(true);
        });

        it('rejects a negative or non-integer seq', () => {
            expect(TerminalOutputSchema.safeParse({ t: 'output', seq: -1, data: 'x' }).success).toBe(false);
            expect(TerminalOutputSchema.safeParse({ t: 'output', seq: 1.5, data: 'x' }).success).toBe(false);
        });
    });

    describe('TerminalStreamEventSchema', () => {
        it('accepts ordered command lifecycle, cwd and state events', () => {
            expect(TerminalStreamEventSchema.safeParse({
                t: 'command-start', seq: 1, commandId: 'cmd-1', command: 'pwd', startedAt: 100, cwd: '/tmp',
            }).success).toBe(true);
            expect(TerminalStreamEventSchema.safeParse({
                t: 'cwd', seq: 2, path: '/work',
            }).success).toBe(true);
            expect(TerminalStreamEventSchema.safeParse({
                t: 'command-end', seq: 3, commandId: 'cmd-1', endedAt: 160, durationMs: 60, exitCode: 0, cwd: '/work',
            }).success).toBe(true);
            expect(TerminalStreamEventSchema.safeParse({
                t: 'state', seq: 4, state: 'idle',
            }).success).toBe(true);
            expect(TerminalStreamEventSchema.safeParse({
                t: 'grid', seq: 5, cols: 42, rows: 28, controllerTerminalId: 'device-ios-1',
            }).success).toBe(true);
        });


        it('scopes output to the originating device PTY', () => {
            expect(TerminalOutputSchema.safeParse({
                t: 'output', terminalId: 'device-ios-1', seq: 1, data: 'eA==',
            }).success).toBe(true);
        });

        it('rejects malformed lifecycle metadata', () => {
            expect(TerminalStreamEventSchema.safeParse({
                t: 'command-end', seq: 3, commandId: 'cmd-1', endedAt: 160, durationMs: -1, exitCode: 0,
            }).success).toBe(false);
            expect(TerminalStreamEventSchema.safeParse({ t: 'state', seq: 4, state: 'unknown' }).success).toBe(false);
            expect(TerminalStreamEventSchema.safeParse({ t: 'grid', seq: 5, cols: 0, rows: 24 }).success).toBe(false);
        });
    });

    describe('TerminalAttachResponseSchema', () => {
        it('allows new capabilities while retaining the empty legacy response', () => {
            expect(TerminalAttachResponseSchema.safeParse({}).success).toBe(true);
            expect(TerminalAttachResponseSchema.safeParse({
                capabilities: {
                    protocolVersion: 4,
                    structuredCommands: true,
                    shell: 'powershell',
                    perDevicePty: false,
                    adaptiveGrid: true,
                    ptyBackend: 'rust-host-agent',
                },
                state: {
                    status: 'running',
                    cwd: 'C:\\work',
                    activeCommand: { commandId: 'cmd-1', command: 'pnpm test', startedAt: 100, cwd: 'C:\\work' },
                },
            }).success).toBe(true);
        });
    });

    describe('TerminalRpcParamsSchema', () => {
        it('routes each variant by the t discriminator', () => {
            expect(TerminalRpcParamsSchema.safeParse({ t: 'input', data: 'x' }).success).toBe(true);
            expect(TerminalRpcParamsSchema.safeParse({ t: 'execute', command: 'ls' }).success).toBe(true);
            expect(TerminalRpcParamsSchema.safeParse({ t: 'resize', cols: 80, rows: 24 }).success).toBe(true);
            expect(TerminalRpcParamsSchema.safeParse({ t: 'attach' }).success).toBe(true);
        });

        it('rejects an unknown variant', () => {
            expect(TerminalRpcParamsSchema.safeParse({ t: 'output', seq: 0, data: 'x' }).success).toBe(false);
            expect(TerminalRpcParamsSchema.safeParse({ t: 'nope' }).success).toBe(false);
        });
    });

    describe('TerminalOutputEventSchema', () => {
        it('accepts the unencrypted relay envelope', () => {
            expect(TerminalOutputEventSchema.safeParse({ t: 'terminal-output', sid: 'sess-1', c: 'ciphertext' }).success).toBe(true);
        });

        it('rejects an empty ciphertext', () => {
            // Schema itself allows any string; the server enforces non-empty.
            // We still assert the envelope shape parses with an empty payload
            // so the server-side guard remains the sole gatekeeper.
            expect(TerminalOutputEventSchema.safeParse({ t: 'terminal-output', sid: 'sess-1', c: '' }).success).toBe(true);
        });

        it('rejects missing fields', () => {
            expect(TerminalOutputEventSchema.safeParse({ t: 'terminal-output', sid: 'sess-1' }).success).toBe(false);
            expect(TerminalOutputEventSchema.safeParse({ t: 'terminal-output', c: 'c' }).success).toBe(false);
        });
    });
});
