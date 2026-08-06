import { describe, expect, it, beforeEach } from 'vitest';
import { getTerminalModes, setTerminalModes } from './terminalModes';

describe('terminalModes', () => {
    beforeEach(() => {
        // Reset to defaults between tests.
        setTerminalModes({
            activeAlt: false,
            bracketedPaste: false,
            autoWrap: true,
            insertMode: false,
            cursorVisible: true,
        });
    });

    it('starts with sane defaults', () => {
        expect(getTerminalModes()).toEqual({
            activeAlt: false,
            bracketedPaste: false,
            autoWrap: true,
            insertMode: false,
            cursorVisible: true,
        });
    });

    it('updates only the provided fields', () => {
        setTerminalModes({ bracketedPaste: true });
        const modes = getTerminalModes();
        expect(modes.bracketedPaste).toBe(true);
        expect(modes.autoWrap).toBe(true);
        expect(modes.activeAlt).toBe(false);
    });

    it('tracks the alternate screen state', () => {
        setTerminalModes({ activeAlt: true });
        expect(getTerminalModes().activeAlt).toBe(true);
        setTerminalModes({ activeAlt: false });
        expect(getTerminalModes().activeAlt).toBe(false);
    });
});
