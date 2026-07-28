import { describe, expect, it } from 'vitest';
import { applyTerminalModifiers, toggleTerminalCtrl } from './terminal-modifiers';

describe('terminal modifier latch', () => {
    it('does not emit anything merely by arming Ctrl', () => {
        expect(toggleTerminalCtrl({ ctrl: false })).toEqual({ ctrl: true });
        expect(toggleTerminalCtrl({ ctrl: true })).toEqual({ ctrl: false });
    });

    it('combines Ctrl with the next letter and then disarms', () => {
        expect(applyTerminalModifiers('c', { ctrl: true })).toEqual({
            data: '\u0003',
            modifiers: { ctrl: false },
        });
        expect(applyTerminalModifiers('C', { ctrl: true }).data).toBe('\u0003');
    });

    it('supports Ctrl plus terminal navigation keys', () => {
        expect(applyTerminalModifiers('\u001b[D', { ctrl: true }).data).toBe('\u001b[1;5D');
        expect(applyTerminalModifiers('\u001b[5~', { ctrl: true }).data).toBe('\u001b[5;5~');
        expect(applyTerminalModifiers('\u001b[3~', { ctrl: true }).data).toBe('\u001b[3;5~');
    });

    it('supports conventional Ctrl digit aliases', () => {
        expect(applyTerminalModifiers('2', { ctrl: true }).data).toBe('\u0000');
        expect(applyTerminalModifiers('3', { ctrl: true }).data).toBe('\u001b');
        expect(applyTerminalModifiers('6', { ctrl: true }).data).toBe('\u001e');
        expect(applyTerminalModifiers('-', { ctrl: true }).data).toBe('\u001f');
    });

    it('passes unsupported or already-controlled input through and still disarms', () => {
        expect(applyTerminalModifiers('中文', { ctrl: true })).toEqual({
            data: '中文',
            modifiers: { ctrl: false },
        });
        expect(applyTerminalModifiers('\u0003', { ctrl: true })).toEqual({
            data: '\u0003',
            modifiers: { ctrl: false },
        });
    });
});
