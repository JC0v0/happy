import { describe, expect, it } from 'vitest';
import { hardwareKeyToTerminalInput, isHardwareTerminalKey } from './skiaHardwareKeys';

describe('skia hardware key mapping', () => {
    it('maps arrow keys to their ANSI sequences', () => {
        expect(hardwareKeyToTerminalInput('ArrowUp')).toBe('\u001b[A');
        expect(hardwareKeyToTerminalInput('ArrowDown')).toBe('\u001b[B');
        expect(hardwareKeyToTerminalInput('ArrowLeft')).toBe('\u001b[D');
        expect(hardwareKeyToTerminalInput('ArrowRight')).toBe('\u001b[C');
    });

    it('maps the navigation cluster', () => {
        expect(hardwareKeyToTerminalInput('Home')).toBe('\u001b[H');
        expect(hardwareKeyToTerminalInput('End')).toBe('\u001b[F');
        expect(hardwareKeyToTerminalInput('PageUp')).toBe('\u001b[5~');
        expect(hardwareKeyToTerminalInput('PageDown')).toBe('\u001b[6~');
    });

    it('maps Escape and forward-delete', () => {
        expect(hardwareKeyToTerminalInput('Escape')).toBe('\u001b');
        expect(hardwareKeyToTerminalInput('Delete')).toBe('\u001b[3~');
    });

    it('lets printable text and Enter/Backspace fall through to the input path', () => {
        expect(hardwareKeyToTerminalInput('a')).toBeNull();
        expect(hardwareKeyToTerminalInput('Z')).toBeNull();
        expect(hardwareKeyToTerminalInput(' ')).toBeNull();
        expect(hardwareKeyToTerminalInput('Enter')).toBeNull();
        expect(hardwareKeyToTerminalInput('Backspace')).toBeNull();
    });

    it('identifies which keys are intercepted', () => {
        expect(isHardwareTerminalKey('ArrowUp')).toBe(true);
        expect(isHardwareTerminalKey('PageDown')).toBe(true);
        expect(isHardwareTerminalKey('Escape')).toBe(true);
        expect(isHardwareTerminalKey('a')).toBe(false);
        expect(isHardwareTerminalKey('Enter')).toBe(false);
    });
});
