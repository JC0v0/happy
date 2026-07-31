/**
 * Hardware-keyboard → terminal byte mapping for the Skia surface.
 *
 * React Native's `onKeyPress` reports physical keys by name (iOS/Android
 * hardware keyboards, including iPad Magic Keyboard and Bluetooth boards).
 * The Skia terminal owns no xterm.js to translate those names into ANSI
 * bytes, so this module does the translation itself — and reuses the same
 * sequences the toolbar's soft keys already send via `terminalShortcutData`.
 *
 * Modifier handling: the mapping emits the *base* sequence for each key
 * (e.g. `ESC[A` for ArrowUp). The armed Ctrl state is applied upstream by
 * `applyTerminalModifiers` in the shared send path, which already knows how
 * to turn `ESC[A` into Ctrl+Up (`ESC[1;5A`). Keeping modifier logic in
 * one place means the hardware path and the soft-key path behave identically.
 */

import { terminalShortcutData, type TerminalShortcut } from '../terminalInput';

/**
 * Keys that map 1:1 onto an existing TerminalShortcut. These are the keys a
 * terminal user expects to work from a hardware keyboard that produce no
 * printable text: arrows, navigation cluster, and the control keys xterm
 * would normally synthesize.
 */
const HARDWARE_KEY_TO_SHORTCUT: Readonly<Record<string, TerminalShortcut>> = {
    // Arrows
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    // Navigation cluster
    Home: 'home',
    End: 'end',
    PageUp: 'page-up',
    PageDown: 'page-down',
    // Control keys that aren't printable text
    Escape: 'escape',
    Delete: 'delete', // forward-delete
};

/**
 * Translate a hardware `onKeyPress` key name into terminal input bytes.
 *
 * Returns `null` for keys that should fall through to the default text-input
 * path (printable characters, Enter, Backspace — those are already handled by
 * `onChangeText` / the dedicated Backspace & Enter branches). Returning a
 * string means "send this to the host and swallow the key".
 */
export function hardwareKeyToTerminalInput(key: string): string | null {
    const shortcut = HARDWARE_KEY_TO_SHORTCUT[key];
    if (shortcut) {
        return terminalShortcutData(shortcut);
    }
    return null;
}

/** Keys we intercept and translate rather than letting the input echo. */
export function isHardwareTerminalKey(key: string): boolean {
    return key in HARDWARE_KEY_TO_SHORTCUT;
}
