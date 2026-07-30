/**
 * Skia-based terminal renderer.
 *
 * Takes a RenderData snapshot from the WASM terminal model and draws the
 * grid using react-native-skia. Cell backgrounds are batched into runs of
 * same-color Rects; glyphs are drawn as Skia Text. The cursor is rendered
 * as an inverted block.
 */

import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Rect, Text as SkiaText, useFont } from '@shopify/react-native-skia';
import type { RenderData } from './useSkiaTerminal';
import type { TerminalPalette } from '../terminalVisualTheme';

export interface SkiaTerminalViewProps {
    renderData: RenderData | null;
    fontSize?: number;
    palette: TerminalPalette;
}

const CELL_WIDTH_RATIO = 0.6;
const CELL_HEIGHT_RATIO = 1.2;

function toSkiaColor(rgb: number): Float32Array {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    return new Float32Array([r / 255, g / 255, b / 255, 1]);
}

function hexToRgb(hex: string): number {
    const value = hex.replace('#', '');
    return Number.parseInt(value, 16);
}

export const SkiaTerminalView = React.memo(function SkiaTerminalView(
    props: SkiaTerminalViewProps,
): React.ReactElement {
    const { renderData, fontSize = 13, palette } = props;
    const font = useFont(null, fontSize);

    const cellWidth = fontSize * CELL_WIDTH_RATIO;
    const cellHeight = fontSize * CELL_HEIGHT_RATIO;

    const canvasBg = toSkiaColor(hexToRgb(palette.canvas));
    const defaultFg = toSkiaColor(hexToRgb(palette.text));
    const cursorColor = toSkiaColor(hexToRgb(palette.accent));

    if (!renderData || !font) {
        return (
            <View style={[styles.container, { backgroundColor: palette.canvas }]} />
        );
    }

    const elements: React.ReactElement[] = [];

    // Cursor block (inverted: accent background, canvas text)
    if (renderData.cursor_visible) {
        const cx = renderData.cursor_col * cellWidth;
        const cy = renderData.cursor_row * cellHeight;
        elements.push(
            React.createElement(Rect, {
                key: 'cursor',
                x: cx,
                y: cy,
                width: cellWidth,
                height: cellHeight,
                color: cursorColor,
            }),
        );
    }

    // Cell backgrounds and text
    for (let row = 0; row < renderData.rows.length; row++) {
        const rowData = renderData.rows[row];
        let col = 0;
        while (col < rowData.cells.length) {
            const head = rowData.cells[col];
            const x = col * cellWidth;
            const y = row * cellHeight;

            // Batch consecutive cells with the same background color.
            let end = col + 1;
            while (end < rowData.cells.length && rowData.cells[end].bg === head.bg) {
                end++;
            }
            const bgWidth = (end - col) * cellWidth;

            // Background rect (skip if it's the default bg - canvas already painted).
            if (head.bg !== 0x111010) {
                elements.push(
                    React.createElement(Rect, {
                        key: `bg-${row}-${col}`,
                        x, y,
                        width: bgWidth,
                        height: cellHeight,
                        color: toSkiaColor(head.bg),
                    }),
                );
            }

            // Foreground text
            for (let c = col; c < end; c++) {
                const cell = rowData.cells[c];
                if (cell.ch && cell.ch !== ' ') {
                    const isCursor = renderData.cursor_visible
                        && row === renderData.cursor_row
                        && c === renderData.cursor_col;
                    elements.push(
                        React.createElement(SkiaText, {
                            key: `fg-${row}-${c}`,
                            x: c * cellWidth,
                            y: y + cellHeight * 0.8,
                            text: cell.ch,
                            color: isCursor ? canvasBg : toSkiaColor(cell.fg),
                            font,
                        }),
                    );
                }
            }

            col = end;
        }
    }

    return (
        <View style={[styles.container, { backgroundColor: palette.canvas }]}>
            <Canvas style={styles.canvas}>
                <Rect
                    key="canvas-bg"
                    x={0}
                    y={0}
                    width={renderData.cols * cellWidth}
                    height={renderData.rows_count * cellHeight}
                    color={canvasBg}
                />
                {elements}
            </Canvas>
        </View>
    );
});

const styles = StyleSheet.create({
    container: { flex: 1 },
    canvas: { flex: 1 },
});
