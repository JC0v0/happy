export const SHARED_TERMINAL_COLS = 80;
export const SHARED_TERMINAL_ROWS = 24;

export interface SharedGridFontSizeOptions {
    baseFontSize: number;
    measuredCols: number;
    measuredRows: number;
    gridCols?: number;
    gridRows?: number;
    zoomDelta?: number;
    minFontSize?: number;
    maxFontSize?: number;
}

/**
 * Calculate a local font size that fits the current shared logical grid
 * inside this device's physical viewport. Grid changes are sequenced with PTY
 * output, so ANSI wrapping and TUI coordinates stay identical on every client.
 */
export function sharedGridFontSize(options: SharedGridFontSizeOptions): number {
    const min = options.minFontSize ?? 8;
    const max = options.maxFontSize ?? 24;
    const gridCols = options.gridCols ?? SHARED_TERMINAL_COLS;
    const gridRows = options.gridRows ?? SHARED_TERMINAL_ROWS;
    const scale = Math.min(
        options.measuredCols / gridCols,
        options.measuredRows / gridRows,
    );
    const fitted = options.baseFontSize * (Number.isFinite(scale) && scale > 0 ? scale : 1);
    const zoomed = fitted + (options.zoomDelta ?? 0);
    return Math.min(max, Math.max(min, Math.floor(zoomed * 10) / 10));
}
