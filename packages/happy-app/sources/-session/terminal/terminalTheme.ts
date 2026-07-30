/**
 * Default ANSI 16-color palettes. Used as fallbacks before the CLI syncs
 * the host's actual terminal colors via `terminal-attach`.
 *
 * Dark:  Campbell (Windows Terminal default) - for dark backgrounds.
 * Light: A light-background adapted palette with adjusted luminance so
 *        ANSI color names remain readable on warm-white canvas.
 */
export const DEFAULT_TERMINAL_ANSI_COLORS_DARK = {
    black: '#0C0C0C',
    red: '#C50F1F',
    green: '#13A10E',
    yellow: '#C19C00',
    blue: '#0037DA',
    magenta: '#881798',
    cyan: '#3A96DD',
    white: '#CCCCCC',
    brightBlack: '#767676',
    brightRed: '#E74856',
    brightGreen: '#16C60C',
    brightYellow: '#F9F1A5',
    brightBlue: '#3B78FF',
    brightMagenta: '#B4009E',
    brightCyan: '#61D6D6',
    brightWhite: '#F2F2F2',
} as const;

/** Light-background ANSI palette: saturated but readable on warm white. */
export const DEFAULT_TERMINAL_ANSI_COLORS_LIGHT = {
    black: '#F4F0EF',
    red: '#B63838',
    green: '#247A4A',
    yellow: '#8A5A12',
    blue: '#315F9B',
    magenta: '#7A4BC9',
    cyan: '#1F7A8C',
    white: '#201D1D',
    brightBlack: '#746E69',
    brightRed: '#9E2A2A',
    brightGreen: '#1E6E3F',
    brightYellow: '#7A4F0F',
    brightBlue: '#2A5590',
    brightMagenta: '#6B3DB8',
    brightCyan: '#1A6B7A',
    brightWhite: '#111010',
} as const;

/** @deprecated Use DEFAULT_TERMINAL_ANSI_COLORS_DARK */
export const DEFAULT_TERMINAL_ANSI_COLORS = DEFAULT_TERMINAL_ANSI_COLORS_DARK;
