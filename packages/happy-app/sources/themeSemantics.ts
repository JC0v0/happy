export const semanticRoleKeys = [
    'canvas',
    'surface',
    'surfaceRaised',
    'surfaceMuted',
    'surfaceSelected',
    'border',
    'borderStrong',
    'textPrimary',
    'textSecondary',
    'textMuted',
    'textInverse',
    'control',
    'controlPressed',
    'controlDisabled',
    'focus',
] as const;

export const semanticStatusKeys = [
    'success',
    'info',
    'warning',
    'error',
    'offline',
] as const;

export type SemanticRoleKey = typeof semanticRoleKeys[number];
export type SemanticStatusKey = typeof semanticStatusKeys[number];

export const semanticGeometry = {
    radius: {
        structural: 0,
        interactive: 4,
        compact: 2,
        pill: 999,
    },
    elevation: {
        structural: 0,
        overlay: 0,
    },
    borderWidth: {
        hairline: 1,
        focus: 2,
    },
} as const;

export type ThemeSemantics = Record<SemanticRoleKey, string> & {
    status: Record<SemanticStatusKey, string>;
};

export const lightThemeSemantics = {
    canvas: '#FDFCFB',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceMuted: '#F5F2F0',
    surfaceSelected: '#EEEAE7',
    border: '#E2DEDB',
    borderStrong: '#C8C1BC',
    textPrimary: '#201D1D',
    textSecondary: '#625C58',
    textMuted: '#746E69',
    textInverse: '#FDFCFB',
    control: '#201D1D',
    controlPressed: '#393434',
    controlDisabled: '#B8B1AD',
    focus: '#6758D4',
    status: {
        success: '#247A4A',
        info: '#315F9B',
        warning: '#8A5A12',
        error: '#B63838',
        offline: '#746E69',
    },
} as const satisfies ThemeSemantics;

export const darkThemeSemantics = {
    canvas: '#111010',
    surface: '#171515',
    surfaceRaised: '#1D1A1A',
    surfaceMuted: '#211E1E',
    surfaceSelected: '#2B2727',
    border: '#393434',
    borderStrong: '#514A4A',
    textPrimary: '#F4F0EF',
    textSecondary: '#BDB6B3',
    textMuted: '#9A9390',
    textInverse: '#171515',
    control: '#F4F0EF',
    controlPressed: '#D9D2CF',
    controlDisabled: '#625B58',
    focus: '#B8AEFF',
    status: {
        success: '#72C992',
        info: '#8BB7EA',
        warning: '#E3B86B',
        error: '#F08484',
        offline: '#9A9390',
    },
} as const satisfies ThemeSemantics;

export function hexContrastRatio(foreground: string, background: string): number {
    const luminance = (hex: string) => {
        const value = hex.replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(value)) {
            throw new Error(`Expected a six-digit hex color, received ${hex}`);
        }
        const channels = [0, 2, 4].map((offset) => {
            const normalized = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
            return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };

    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}
