export const WIDE_LAYOUT_MIN_WIDTH = 800;

export type ResponsiveLayoutMode = 'compact' | 'wide';

export interface ResponsiveLayout {
    mode: ResponsiveLayoutMode;
    isWide: boolean;
    showSidebar: boolean;
    showInlineBackButton: boolean;
}

export function resolveResponsiveLayout(width: number): ResponsiveLayout {
    const isWide = Number.isFinite(width) && width >= WIDE_LAYOUT_MIN_WIDTH;

    return {
        mode: isWide ? 'wide' : 'compact',
        isWide,
        showSidebar: isWide,
        showInlineBackButton: !isWide,
    };
}
