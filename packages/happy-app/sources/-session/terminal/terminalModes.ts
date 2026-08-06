/**
 * Shared terminal mode state consumed by input/paste paths.
 *
 * The Skia renderer reads the WASM model's `modes` snapshot each frame and
 * writes it here; input paths (e.g. bracketed-paste wrapping in the command
 * dock) read it back without needing to plumb props through every layer.
 */
export interface TerminalModes {
    activeAlt: boolean;
    bracketedPaste: boolean;
    autoWrap: boolean;
    insertMode: boolean;
    cursorVisible: boolean;
}

let modes: TerminalModes = {
    activeAlt: false,
    bracketedPaste: false,
    autoWrap: true,
    insertMode: false,
    cursorVisible: true,
};

export function setTerminalModes(next: Partial<TerminalModes>): void {
    modes = { ...modes, ...next };
}

export function getTerminalModes(): TerminalModes {
    return modes;
}
