/**
 * Terminal chrome + canvas palette.
 *
 * The terminal palette is derived from the app's semantic theme so the
 * terminal canvas, chrome, and accent colors stay in sync with the rest
 * of the product across both light and dark modes.
 */
import type { ThemeSemantics } from '@/themeSemantics';

export type TerminalVariant = 'light' | 'dark';

export interface TerminalPalette {
    canvas: string;
    chrome: string;
    chromeRaised: string;
    control: string;
    controlPressed: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    accentStrong: string;
    selection: string;
    accentBg: string;
    success: string;
    successBg: string;
    warning: string;
    danger: string;
    dangerBg: string;
    scrim: string;
}

/** Convert a #rrggbb hex to an rgba() string with the given alpha. */
function rgbaFromHex(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Resolve a complete terminal palette from the app's semantic theme.
 *
 * Every color the terminal views need — canvas, chrome, accent, status,
 * selection, block-decoration backgrounds, and the modal scrim — is derived
 * from the semantic theme so there is a single source of truth.
 */
export function resolveTerminalPalette(
    semantic: ThemeSemantics,
    variant: TerminalVariant,
): TerminalPalette {
    const accentStrong = variant === 'dark' ? '#8B7CF0' : '#6758D4';
    const selectionAlpha = variant === 'dark' ? 0.28 : 0.18;
    const accentBgAlpha = variant === 'dark' ? 0.10 : 0.08;
    return {
        canvas: semantic.canvas,
        chrome: semantic.surface,
        chromeRaised: semantic.surfaceRaised,
        control: semantic.surfaceMuted,
        controlPressed: semantic.surfaceSelected,
        border: semantic.border,
        text: semantic.textPrimary,
        textMuted: semantic.textMuted,
        accent: semantic.focus,
        accentStrong,
        selection: rgbaFromHex(semantic.focus, selectionAlpha),
        accentBg: rgbaFromHex(semantic.focus, accentBgAlpha),
        success: semantic.status.success,
        successBg: rgbaFromHex(semantic.status.success, 0.08),
        warning: semantic.status.warning,
        danger: semantic.status.error,
        dangerBg: rgbaFromHex(semantic.status.error, 0.08),
        scrim: variant === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.35)',
    };
}

/**
 * Static dark-mode default.
 *
 * Kept for backwards compatibility and for tests that verify the terminal
 * palette matches the app's dark semantic theme. Prefer
 * {@link resolveTerminalPalette} in component code.
 */
export const TERMINAL_VISUAL_THEME = {
    canvas: '#111010',
    chrome: '#171515',
    chromeRaised: '#1D1A1A',
    control: '#211E1E',
    controlPressed: '#2B2727',
    border: '#393434',
    text: '#F4F0EF',
    textMuted: '#9A9390',
    accent: '#B8AEFF',
    accentStrong: '#8B7CF0',
    selection: 'rgba(184, 174, 255, 0.28)',
    accentBg: 'rgba(184, 174, 255, 0.10)',
    success: '#72C992',
    successBg: 'rgba(114, 201, 146, 0.07)',
    warning: '#E3B86B',
    danger: '#F08484',
    dangerBg: 'rgba(240, 132, 132, 0.08)',
    scrim: 'rgba(0, 0, 0, 0.5)',
} as const;
