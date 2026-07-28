import { describe, expect, it } from 'vitest';
import { terminalCommandData, terminalCommandText, terminalShortcutData } from './terminalInput';

describe('terminal input helpers', () => {
    it('turns a submitted command into PTY input', () => {
        expect(terminalCommandData('  pnpm test  ')).toBe('pnpm test\r');
        expect(terminalCommandText('  pnpm test  ')).toBe('pnpm test');
    });

    it('ignores empty command submissions', () => {
        expect(terminalCommandData('   ')).toBeNull();
        expect(terminalCommandText('   ')).toBeNull();
    });

    it('encodes shell navigation and control keys', () => {
        expect(terminalShortcutData('escape')).toBe('\u001b');
        expect(terminalShortcutData('tab')).toBe('\t');
        expect(terminalShortcutData('interrupt')).toBe('\u0003');
        expect(terminalShortcutData('up')).toBe('\u001b[A');
        expect(terminalShortcutData('down')).toBe('\u001b[B');
        expect(terminalShortcutData('left')).toBe('\u001b[D');
        expect(terminalShortcutData('right')).toBe('\u001b[C');
    });

    it('encodes extended editing, navigation, control, and function keys', () => {
        expect(terminalShortcutData('backtab')).toBe('\u001b[Z');
        expect(terminalShortcutData('enter')).toBe('\r');
        expect(terminalShortcutData('backspace')).toBe('\u007f');
        expect(terminalShortcutData('delete')).toBe('\u001b[3~');
        expect(terminalShortcutData('home')).toBe('\u001b[H');
        expect(terminalShortcutData('end')).toBe('\u001b[F');
        expect(terminalShortcutData('page-up')).toBe('\u001b[5~');
        expect(terminalShortcutData('page-down')).toBe('\u001b[6~');
        expect(terminalShortcutData('ctrl-a')).toBe('\u0001');
        expect(terminalShortcutData('ctrl-d')).toBe('\u0004');
        expect(terminalShortcutData('ctrl-e')).toBe('\u0005');
        expect(terminalShortcutData('ctrl-k')).toBe('\u000b');
        expect(terminalShortcutData('ctrl-l')).toBe('\u000c');
        expect(terminalShortcutData('ctrl-r')).toBe('\u0012');
        expect(terminalShortcutData('ctrl-u')).toBe('\u0015');
        expect(terminalShortcutData('ctrl-w')).toBe('\u0017');
        expect(terminalShortcutData('ctrl-z')).toBe('\u001a');
        expect(terminalShortcutData('alt-b')).toBe('\u001bb');
        expect(terminalShortcutData('alt-f')).toBe('\u001bf');
        expect(terminalShortcutData('f1')).toBe('\u001bOP');
        expect(terminalShortcutData('f4')).toBe('\u001bOS');
        expect(terminalShortcutData('f5')).toBe('\u001b[15~');
        expect(terminalShortcutData('f12')).toBe('\u001b[24~');
    });
});
