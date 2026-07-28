export interface TerminalModifierState {
    ctrl: boolean;
}

export const EMPTY_TERMINAL_MODIFIERS: TerminalModifierState = { ctrl: false };

export function toggleTerminalCtrl(modifiers: TerminalModifierState): TerminalModifierState {
    return { ctrl: !modifiers.ctrl };
}

const CTRL_ESCAPE_SEQUENCES: Readonly<Record<string, string>> = {
    '\u001b[A': '\u001b[1;5A',
    '\u001b[B': '\u001b[1;5B',
    '\u001b[C': '\u001b[1;5C',
    '\u001b[D': '\u001b[1;5D',
    '\u001b[H': '\u001b[1;5H',
    '\u001b[F': '\u001b[1;5F',
    '\u001b[3~': '\u001b[3;5~',
    '\u001b[5~': '\u001b[5;5~',
    '\u001b[6~': '\u001b[6;5~',
};

const CTRL_CHARACTER_ALIASES: Readonly<Record<number, string>> = {
    0x2d: '\u001f',
    0x32: '\u0000',
    0x33: '\u001b',
    0x34: '\u001c',
    0x35: '\u001d',
    0x36: '\u001e',
    0x37: '\u001f',
    0x38: '\u007f',
};

function ctrlCharacter(input: string): string | null {
    if (input.length !== 1) {
        return null;
    }
    const code = input.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
        return input;
    }
    if (code === 0x20 || code === 0x40) {
        return '\u0000';
    }
    if (CTRL_CHARACTER_ALIASES[code] !== undefined) {
        return CTRL_CHARACTER_ALIASES[code];
    }
    if (code >= 0x41 && code <= 0x5f) {
        return String.fromCharCode(code - 0x40);
    }
    if (code >= 0x61 && code <= 0x7a) {
        return String.fromCharCode(code - 0x60);
    }
    if (code === 0x3f) {
        return '\u007f';
    }
    return null;
}

/** Applies the armed modifiers to exactly one terminal input event. */
export function applyTerminalModifiers(
    input: string,
    modifiers: TerminalModifierState,
): { data: string; modifiers: TerminalModifierState } {
    if (!modifiers.ctrl || input.length === 0) {
        return { data: input, modifiers };
    }
    const modified = CTRL_ESCAPE_SEQUENCES[input] ?? ctrlCharacter(input) ?? input;
    return { data: modified, modifiers: EMPTY_TERMINAL_MODIFIERS };
}
