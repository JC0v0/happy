import { describe, expect, it } from 'vitest';
import { TERMINAL_VISUAL_THEME } from './-session/terminal/terminalVisualTheme';
import {
    darkThemeSemantics,
    hexContrastRatio,
    lightThemeSemantics,
    semanticGeometry,
    semanticRoleKeys,
    semanticStatusKeys,
} from './themeSemantics';

describe('theme semantics', () => {
    it('keeps light and dark semantic role shapes in parity', () => {
        expect(Object.keys(lightThemeSemantics).sort()).toEqual(Object.keys(darkThemeSemantics).sort());
        expect(Object.keys(lightThemeSemantics.status).sort()).toEqual([...semanticStatusKeys].sort());
        expect(Object.keys(darkThemeSemantics.status).sort()).toEqual([...semanticStatusKeys].sort());

        for (const key of semanticRoleKeys) {
            expect(lightThemeSemantics[key]).toBeTruthy();
            expect(darkThemeSemantics[key]).toBeTruthy();
        }
    });

    it('meets text contrast thresholds on primary app surfaces', () => {
        for (const theme of [lightThemeSemantics, darkThemeSemantics]) {
            expect(hexContrastRatio(theme.textPrimary, theme.canvas)).toBeGreaterThanOrEqual(4.5);
            expect(hexContrastRatio(theme.textSecondary, theme.canvas)).toBeGreaterThanOrEqual(4.5);
            expect(hexContrastRatio(theme.textMuted, theme.canvas)).toBeGreaterThanOrEqual(4.5);
            expect(hexContrastRatio(theme.textPrimary, theme.surface)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps structural regions flat and interactive controls compact', () => {
        expect(semanticGeometry.radius.structural).toBe(0);
        expect(semanticGeometry.elevation.structural).toBe(0);
        expect(semanticGeometry.elevation.overlay).toBe(0);
        expect(semanticGeometry.radius.interactive).toBe(4);
    });

    it('aligns terminal dark palette with dark theme semantics', () => {
        // Terminal now follows the app design language. Its default (dark)
        // palette matches the dark semantic theme so RAW mode feels like a
        // native part of the app rather than an embedded foreign surface.
        expect(TERMINAL_VISUAL_THEME.canvas).toBe(darkThemeSemantics.canvas);
        expect(TERMINAL_VISUAL_THEME.text).toBe(darkThemeSemantics.textPrimary);
        expect(TERMINAL_VISUAL_THEME.border).toBe(darkThemeSemantics.border);
    });
});

