export type TerminalShortcut =
    | 'escape' | 'tab' | 'backtab' | 'enter' | 'backspace' | 'delete'
    | 'interrupt' | 'up' | 'down' | 'left' | 'right'
    | 'home' | 'end' | 'page-up' | 'page-down'
    | 'ctrl-a' | 'ctrl-d' | 'ctrl-e' | 'ctrl-k' | 'ctrl-l' | 'ctrl-r' | 'ctrl-u' | 'ctrl-w' | 'ctrl-z'
    | 'alt-b' | 'alt-f'
    | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12';

const SHORTCUT_DATA: Record<TerminalShortcut, string> = {
    escape: '\u001b',
    tab: '\t',
    backtab: '\u001b[Z',
    enter: '\r',
    backspace: '\u007f',
    delete: '\u001b[3~',
    interrupt: '\u0003',
    up: '\u001b[A',
    down: '\u001b[B',
    left: '\u001b[D',
    right: '\u001b[C',
    home: '\u001b[H',
    end: '\u001b[F',
    'page-up': '\u001b[5~',
    'page-down': '\u001b[6~',
    'ctrl-a': '\u0001',
    'ctrl-d': '\u0004',
    'ctrl-e': '\u0005',
    'ctrl-k': '\u000b',
    'ctrl-l': '\u000c',
    'ctrl-r': '\u0012',
    'ctrl-u': '\u0015',
    'ctrl-w': '\u0017',
    'ctrl-z': '\u001a',
    'alt-b': '\u001bb',
    'alt-f': '\u001bf',
    f1: '\u001bOP',
    f2: '\u001bOQ',
    f3: '\u001bOR',
    f4: '\u001bOS',
    f5: '\u001b[15~',
    f6: '\u001b[17~',
    f7: '\u001b[18~',
    f8: '\u001b[19~',
    f9: '\u001b[20~',
    f10: '\u001b[21~',
    f11: '\u001b[23~',
    f12: '\u001b[24~',
};

export function terminalShortcutData(shortcut: TerminalShortcut): string {
    return SHORTCUT_DATA[shortcut];
}

export function terminalCommandData(command: string): string | null {
    const normalized = terminalCommandText(command);
    return normalized === null ? null : `${normalized}\r`;
}

/**
 * Wrap clipboard text in bracketed-paste markers when the active program has
 * enabled bracketed paste (CSI ? 2004 h). Unwrapped multiline input would be
 * executed line-by-line by TUIs and shells that opt into bracketed paste.
 */
export function wrapPasteForTerminal(text: string, bracketedPaste: boolean): string {
    return bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
}

/** Complete command without transport-specific Enter bytes. */
export function terminalCommandText(command: string): string | null {
    const trimmed = command.trim();
    return trimmed.length > 0 ? trimmed : null;
}
