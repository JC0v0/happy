/**
 * Skia-based terminal renderer - pure rendering, no WASM management.
 *
 * Takes a RenderData snapshot from useSkiaTerminal() and draws the
 * terminal grid using react-native-skia. Architecture mirrors Warp's
 * render pipeline: cell background rects (Rect) + glyph text (Text).
 */

import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Rect, Text as SkiaText, useFont } from '@shopify/react-native-skia';

// ── Types ─────────────────────────────────────────────────────────────

export interface CellData {
    ch: string;
    fg: number;
    bg: number;
    attrs: number;
}

export interface RenderData {
    rows: { cells: CellData[] }[];
    cursor_row: number;
    cursor_col: number;
    cursor_visible: boolean;
    cols: number;
    rows_count: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function toSkiaColor(rgb: number): Float32Array {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    return new Float32Array([r / 255, g / 255, b / 255, 1]);
}

// ── Component ─────────────────────────────────────────────────────────

interface SkiaTerminalViewProps {
    renderData: RenderData | null;
    fontSize?: number;
}

export const SkiaTerminalView = React.memo(function SkiaTerminalView(
    props: SkiaTerminalViewProps,
): React.ReactElement {
    const { renderData, fontSize = 13 } = props;
    const font = useFont(null, fontSize);

    if (!renderData || !font) {
        return <View style={styles.container} />;
    }

    const cellWidth = fontSize * 0.6;
    const cellHeight = fontSize * 1.2;

    // Build Skia elements, batching same-bg cells.
    const elements: React.ReactElement[] = [];
    for (let row = 0; row < renderData.rows.length; row++) {
        const rowData = renderData.rows[row];
        let col = 0;
        while (col < rowData.cells.length) {
            const head = rowData.cells[col];
            const x = col * cellWidth;
            const y = row * cellHeight;

            // Count consecutive cells with same background.
            let end = col + 1;
            while (end < rowData.cells.length && rowData.cells[end].bg === head.bg) {
                end++;
            }
            const bgWidth = (end - col) * cellWidth;

            // Background rect.
            elements.push(
                React.createElement(Rect, {
                    key: `bg-${row}-${col}`,
                    x, y,
                    width: bgWidth,
                    height: cellHeight,
                    color: toSkiaColor(head.bg),
                }),
            );

            // Foreground text.
            for (let c = col; c < end; c++) {
                const ch = rowData.cells[c].ch;
                if (ch && ch !== ' ') {
                    elements.push(
                        React.createElement(SkiaText, {
                            key: `fg-${row}-${c}`,
                            x: c * cellWidth,
                            y: y + cellHeight * 0.8,
                            text: ch,
                            color: toSkiaColor(rowData.cells[c].fg),
                            font,
                        }),
                    );
                }
            }

            col = end;
        }
    }

    return (
        <View style={styles.container}>
            <Canvas style={styles.canvas}>
                {elements}
            </Canvas>
        </View>
    );
});

const styles = StyleSheet.create({
    container: { flex: 1 },
    canvas: { flex: 1 },
});
