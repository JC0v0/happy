import { describe, expect, it } from 'vitest';
import { TERMINAL_VISUAL_THEME, resolveTerminalPalette } from './terminalVisualTheme';
import { darkThemeSemantics, hexContrastRatio, lightThemeSemantics } from '@/themeSemantics';

describe('terminal visual theme', () => {
    it('matches the app semantic palettes for dark and light modes', () => {
        // Terminal canvas now aligns with the app design language.
        // Dark mode terminal uses the same warm-grey dark palette as the app.
        expect(TERMINAL_VISUAL_THEME.canvas).toBe(darkThemeSemantics.canvas);
        expect(TERMINAL_VISUAL_THEME.text).toBe(darkThemeSemantics.textPrimary);
        expect(TERMINAL_VISUAL_THEME.textMuted).toBe(darkThemeSemantics.textMuted);
        expect(TERMINAL_VISUAL_THEME.border).toBe(darkThemeSemantics.border);
    });

    it('keeps terminal text highly legible on dark canvas', () => {
        expect(hexContrastRatio(TERMINAL_VISUAL_THEME.text, TERMINAL_VISUAL_THEME.canvas)).toBeGreaterThanOrEqual(7);
        expect(hexContrastRatio(TERMINAL_VISUAL_THEME.textMuted, TERMINAL_VISUAL_THEME.canvas)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps terminal text highly legible on light canvas', () => {
        expect(hexContrastRatio(lightThemeSemantics.textPrimary, lightThemeSemantics.canvas)).toBeGreaterThanOrEqual(7);
        expect(hexContrastRatio(lightThemeSemantics.textMuted, lightThemeSemantics.canvas)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('resolveTerminalPalette', () => {
    it('derives dark palette from dark semantic theme', () => {
        const p = resolveTerminalPalette(darkThemeSemantics, 'dark');
        expect(p.canvas).toBe(darkThemeSemantics.canvas);
        expect(p.chrome).toBe(darkThemeSemantics.surface);
        expect(p.chromeRaised).toBe(darkThemeSemantics.surfaceRaised);
        expect(p.control).toBe(darkThemeSemantics.surfaceMuted);
        expect(p.controlPressed).toBe(darkThemeSemantics.surfaceSelected);
        expect(p.border).toBe(darkThemeSemantics.border);
        expect(p.text).toBe(darkThemeSemantics.textPrimary);
        expect(p.textMuted).toBe(darkThemeSemantics.textMuted);
        expect(p.accent).toBe(darkThemeSemantics.focus);
        expect(p.success).toBe(darkThemeSemantics.status.success);
        expect(p.warning).toBe(darkThemeSemantics.status.warning);
        expect(p.danger).toBe(darkThemeSemantics.status.error);
    });

    it('derives light palette from light semantic theme', () => {
        const p = resolveTerminalPalette(lightThemeSemantics, 'light');
        expect(p.canvas).toBe(lightThemeSemantics.canvas);
        expect(p.chrome).toBe(lightThemeSemantics.surface);
        expect(p.text).toBe(lightThemeSemantics.textPrimary);
        expect(p.textMuted).toBe(lightThemeSemantics.textMuted);
        expect(p.border).toBe(lightThemeSemantics.border);
        expect(p.accent).toBe(lightThemeSemantics.focus);
        expect(p.success).toBe(lightThemeSemantics.status.success);
        expect(p.warning).toBe(lightThemeSemantics.status.warning);
        expect(p.danger).toBe(lightThemeSemantics.status.error);
    });

    it('produces rgba selection and background tints from the focus color', () => {
        const dark = resolveTerminalPalette(darkThemeSemantics, 'dark');
        const light = resolveTerminalPalette(lightThemeSemantics, 'light');

        // Selection and accentBg should be rgba strings derived from the focus color.
        expect(dark.selection).toMatch(/^rgba\(/);
        expect(dark.accentBg).toMatch(/^rgba\(/);
        expect(light.selection).toMatch(/^rgba\(/);
        expect(light.accentBg).toMatch(/^rgba\(/);

        // Light mode uses lower alpha for selection than dark mode.
        expect(light.selection).not.toBe(dark.selection);
    });

    it('provides a scrim color for modal overlays', () => {
        const dark = resolveTerminalPalette(darkThemeSemantics, 'dark');
        const light = resolveTerminalPalette(lightThemeSemantics, 'light');
        expect(dark.scrim).toMatch(/^rgba\(0, 0, 0,/);
        expect(light.scrim).toMatch(/^rgba\(0, 0, 0,/);
        // Light scrim is lighter than dark scrim.
        expect(light.scrim).not.toBe(dark.scrim);
    });

    it('keeps text legible on both dark and light canvases', () => {
        const dark = resolveTerminalPalette(darkThemeSemantics, 'dark');
        const light = resolveTerminalPalette(lightThemeSemantics, 'light');

        expect(hexContrastRatio(dark.text, dark.canvas)).toBeGreaterThanOrEqual(7);
        expect(hexContrastRatio(dark.textMuted, dark.canvas)).toBeGreaterThanOrEqual(4.5);
        expect(hexContrastRatio(light.text, light.canvas)).toBeGreaterThanOrEqual(7);
        expect(hexContrastRatio(light.textMuted, light.canvas)).toBeGreaterThanOrEqual(4.5);
    });
});
