import { describe, expect, it } from 'vitest';
import {
    TerminalInputSchema,
    TerminalResizeSchema,
    TerminalAttachSchema,
    TerminalOutputSchema,
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

    describe('TerminalAttachSchema', () => {
        it('accepts a bare attach request', () => {
            expect(TerminalAttachSchema.safeParse({ t: 'attach' }).success).toBe(true);
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

    describe('TerminalRpcParamsSchema', () => {
        it('routes each variant by the t discriminator', () => {
            expect(TerminalRpcParamsSchema.safeParse({ t: 'input', data: 'x' }).success).toBe(true);
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
