/**
 * Skia-based terminal renderer.
 *
 * Draws the WASM terminal model's grid with react-native-skia, and owns the
 * native-side terminal interactions the WebView used to provide:
 *
 *  - **Scrollback**: a vertical drag pans through the Rust grid's scrollback
 *    history (rendered via `renderScrolled`), a tap while scrolled snaps back
 *    to the live edge.
 *  - **Keyboard input**: a hidden TextInput captures keystrokes and forwards
 *    them to the host through `onInput`. Tapping the canvas focuses it.
 *  - **Resize**: the view measures its container and reports grid cols/rows
 *    changes up through `onGridSizeChange` so the parent can resize both the
 *    WASM model and the remote PTY.
 *
 * Cell backgrounds are batched into runs of same-color Rects; glyphs are drawn
 * as Skia Text. The cursor is an inverted block, hidden while scrolled back.
 */

import * as React from 'react';
import { View, StyleSheet, TextInput, Pressable } from 'react-native';
import {
    Canvas,
    Rect,
    Text as SkiaText,
    Skia,
    type SkTypeface,
    type SkFont,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Asset } from 'expo-asset';
import { readAsStringAsync } from 'expo-file-system/legacy';
import type { RenderData, TerminalHandle, TerminalOscEvent } from './useSkiaTerminal';
import { setTerminalModes } from '../terminalModes';
import { hardwareKeyToTerminalInput } from './skiaHardwareKeys';
import type { TerminalPalette } from '../terminalVisualTheme';

import fontModule from '../../../../assets/terminal/sarasa-term-sc-woff2.txt';

export interface SkiaTerminalViewProps {
    /** The live WASM terminal handle (already fed the PTY byte stream). */
    termHandle: TerminalHandle | null;
    fontSize?: number;
    palette: TerminalPalette;
    /** Forward host-bound keystrokes (already encoded as terminal input). */
    onInput: (data: string) => void;
    /** Report grid geometry changes (cols/rows derived from measured px). */
    onGridSizeChange: (cols: number, rows: number) => void;
    /** OSC events (window title, clipboard writes) surfaced by the WASM model. */
    onOscEvent?: (events: TerminalOscEvent[]) => void;
}

const CELL_WIDTH_RATIO = 0.6;
const CELL_HEIGHT_RATIO = 1.2;
const SCROLL_SNAP_THRESHOLD = 4;

// Mirrors cell.rs ATTR_* bitflags.
const ATTR_UNDERLINE = 4;
const ATTR_DIM = 16;
const ATTR_STRIKE = 32;

function colorWithAlpha(c: Float32Array, alpha: number): Float32Array {
    return new Float32Array([c[0], c[1], c[2], alpha]);
}

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

/** Decode base64 to a Uint8Array without relying on atob (Hermes-safe). */
function base64ToBytes(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const len = base64.length;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const byteLength = ((len * 3) >> 2) - padding;
    const bytes = new Uint8Array(byteLength);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
        const a = lookup[base64.charCodeAt(i)];
        const b = lookup[base64.charCodeAt(i + 1)];
        const c = lookup[base64.charCodeAt(i + 2)];
        const d = lookup[base64.charCodeAt(i + 3)];
        const triple = (a << 18) | (b << 12) | (c << 6) | d;
        if (p < byteLength) bytes[p++] = (triple >> 16) & 0xff;
        if (p < byteLength) bytes[p++] = (triple >> 8) & 0xff;
        if (p < byteLength) bytes[p++] = triple & 0xff;
    }
    return bytes;
}

interface FontCache {
    typeface: SkTypeface | null;
    font: SkFont | null;
}

let fontCache: FontCache | null = null;
let fontLoading: Promise<FontCache | null> | null = null;

async function loadTerminalFont(fontSize: number): Promise<FontCache | null> {
    if (fontCache?.font) return fontCache;
    if (fontLoading) return fontLoading;
    fontLoading = (async () => {
        const asset = Asset.fromModule(fontModule);
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('Font asset has no localUri');
        const base64 = await readAsStringAsync(asset.localUri);
        const bytes = base64ToBytes(base64.trim());
        const data = Skia.Data.fromBytes(bytes);
        const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
        const font = typeface ? Skia.Font(typeface, fontSize) : null;
        fontCache = { typeface, font };
        return fontCache;
    })();
    return fontLoading;
}

export const SkiaTerminalView = React.memo(function SkiaTerminalView(
    props: SkiaTerminalViewProps,
): React.ReactElement {
    const { termHandle, fontSize = 13, palette, onInput, onGridSizeChange, onOscEvent } = props;
    const [font, setFont] = React.useState<SkFont | null>(null);
    const [renderData, setRenderData] = React.useState<RenderData | null>(null);
    const [scrollOffset, setScrollOffset] = React.useState(0);

    const inputRef = React.useRef<TextInput>(null);
    const scrollOffsetRef = React.useRef(0);
    scrollOffsetRef.current = scrollOffset;
    const activeAltRef = React.useRef(false);
    const onOscEventRef = React.useRef(onOscEvent);
    React.useEffect(() => { onOscEventRef.current = onOscEvent; }, [onOscEvent]);

    const cellWidth = fontSize * CELL_WIDTH_RATIO;
    const cellHeight = fontSize * CELL_HEIGHT_RATIO;

    // Load the embedded monospace font once (cached across remounts).
    React.useEffect(() => {
        let cancelled = false;
        loadTerminalFont(fontSize)
            .then((result) => {
                if (!cancelled && result?.font) setFont(result.font);
            })
            .catch((err: any) => console.warn('[skia] Font load failed:', err?.message ?? err));
        return () => { cancelled = true; };
    }, [fontSize]);

    // Measure the container and derive grid cols/rows; report changes up so the
    // parent can resize the WASM model + remote PTY in lockstep.
    const handleLayout = React.useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
        const { width, height } = e.nativeEvent.layout;
        const cols = Math.max(2, Math.floor(width / cellWidth));
        const rows = Math.max(1, Math.floor(height / cellHeight));
        onGridSizeChange(cols, rows);
    }, [cellWidth, cellHeight, onGridSizeChange]);

    // Render loop: pull a snapshot from the WASM model each frame. Scrolled
    // views use renderScrolled; live views use render. Clamp the offset to the
    // available scrollback so new output can't leave the view dangling.
    React.useEffect(() => {
        if (!termHandle) {
            setRenderData(null);
            return;
        }
        const id = setInterval(() => {
            const maxScroll = termHandle.scrollbackLen();
            const off = Math.min(scrollOffsetRef.current, maxScroll);
            if (off !== scrollOffsetRef.current) {
                scrollOffsetRef.current = off;
                setScrollOffset(off);
            }
            const snapshot = off > 0 ? termHandle.renderScrolled(off) : termHandle.render();
            if (snapshot?.modes) {
                activeAltRef.current = snapshot.modes.active_alt;
                setTerminalModes({
                    activeAlt: snapshot.modes.active_alt,
                    bracketedPaste: snapshot.modes.bracketed_paste,
                    autoWrap: snapshot.modes.auto_wrap,
                    insertMode: snapshot.modes.insert_mode,
                    cursorVisible: snapshot.modes.cursor_visible,
                });
            }
            setRenderData(snapshot);
            const events = termHandle.takeEvents();
            if (events.length > 0 && onOscEventRef.current) {
                onOscEventRef.current(events);
            }
        }, 16);
        return () => clearInterval(id);
    }, [termHandle]);

    // Follow live output when at the live edge; otherwise hold the user's
    // scroll position. A scroll gesture sets the offset; new output doesn't
    // force-scroll unless we're already at the bottom.
    const scrollBy = React.useCallback((deltaRows: number) => {
        if (!termHandle || activeAltRef.current) return;
        const maxScroll = termHandle.scrollbackLen();
        const next = Math.max(0, Math.min(maxScroll, scrollOffsetRef.current + deltaRows));
        if (next !== scrollOffsetRef.current) {
            scrollOffsetRef.current = next;
            setScrollOffset(next);
        }
    }, [termHandle]);

    // Vertical drag pans through scrollback (drag up = look further back).
    // Accumulate sub-row remainder so small drags still scroll smoothly.
    const scrollRemainder = React.useRef(0);
    const pan = React.useMemo(() => Gesture.Pan()
        .minDistance(6)
        .onStart(() => { scrollRemainder.current = 0; })
        .onChange((e) => {
            scrollRemainder.current += e.changeY / cellHeight;
            const rows = scrollRemainder.current > 0
                ? Math.floor(scrollRemainder.current)
                : Math.ceil(scrollRemainder.current);
            if (rows !== 0) {
                scrollRemainder.current -= rows;
                scrollBy(rows);
            }
        }), [cellHeight, scrollBy]);

    // Tap: if scrolled, snap to the live edge; otherwise focus the keyboard.
    const tap = React.useMemo(() => Gesture.Tap()
        .onEnd(() => {
            if (scrollOffsetRef.current > SCROLL_SNAP_THRESHOLD) {
                scrollOffsetRef.current = 0;
                setScrollOffset(0);
            } else {
                inputRef.current?.focus();
            }
        }), []);

    const composed = React.useMemo(() => Gesture.Race(pan, tap), [pan, tap]);

    const canvasBg = toSkiaColor(hexToRgb(palette.canvas));
    const cursorColor = toSkiaColor(hexToRgb(palette.accent));

    const handleChangeText = React.useCallback((text: string) => {
        if (text.length > 0) {
            onInput(text);
        }
    }, [onInput]);

    // Hardware keyboard: arrows / nav cluster / Escape / forward-delete are
    // translated to ANSI sequences and sent directly. Printable text, Enter
    // and Backspace still flow through onChangeText / the branches below.
    // An armed Ctrl modifier is applied by the shared send path upstream.
    const handleKeyPress = React.useCallback((e: { nativeEvent: { key: string } }) => {
        const key = e.nativeEvent.key;
        const mapped = hardwareKeyToTerminalInput(key);
        if (mapped !== null) {
            onInput(mapped);
            return;
        }
        if (key === 'Enter') {
            onInput('\r');
        } else if (key === 'Backspace') {
            onInput('\x7f');
        }
    }, [onInput]);

    const elements: React.ReactElement[] = [];
    if (renderData && font) {
        // Cursor block (inverted) — only when at the live edge.
        if (renderData.cursor_visible && scrollOffset === 0) {
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

        for (let row = 0; row < renderData.rows.length; row++) {
            const rowData = renderData.rows[row];
            let col = 0;
            while (col < rowData.cells.length) {
                const head = rowData.cells[col];
                const x = col * cellWidth;
                const y = row * cellHeight;

                let end = col + 1;
                while (end < rowData.cells.length && rowData.cells[end].bg === head.bg) {
                    end++;
                }
                const bgWidth = (end - col) * cellWidth;

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

                for (let c = col; c < end; c++) {
                    const cell = rowData.cells[c];
                    if (cell.ch && cell.ch !== ' ') {
                        const isCursor = renderData.cursor_visible
                            && scrollOffset === 0
                            && row === renderData.cursor_row
                            && c === renderData.cursor_col;
                        const hasLink = !!cell.link;
                        let color: Float32Array;
                        if (isCursor) {
                            color = canvasBg;
                        } else if (hasLink) {
                            color = toSkiaColor(hexToRgb(palette.accent));
                        } else {
                            color = toSkiaColor(cell.fg);
                        }
                        if ((cell.attrs & ATTR_DIM) !== 0 && !isCursor) {
                            color = colorWithAlpha(color, 0.55);
                        }
                        elements.push(
                            React.createElement(SkiaText, {
                                key: `fg-${row}-${c}`,
                                x: c * cellWidth,
                                y: y + cellHeight * 0.8,
                                text: cell.ch,
                                color,
                                font,
                            }),
                        );
                        if ((cell.attrs & ATTR_UNDERLINE) !== 0 || hasLink) {
                            elements.push(
                                React.createElement(Rect, {
                                    key: `ul-${row}-${c}`,
                                    x: c * cellWidth,
                                    y: y + cellHeight - 2,
                                    width: cellWidth,
                                    height: 1,
                                    color,
                                }),
                            );
                        }
                        if ((cell.attrs & ATTR_STRIKE) !== 0) {
                            elements.push(
                                React.createElement(Rect, {
                                    key: `st-${row}-${c}`,
                                    x: c * cellWidth,
                                    y: y + cellHeight * 0.55,
                                    width: cellWidth,
                                    height: 1,
                                    color,
                                }),
                            );
                        }
                    }
                }

                col = end;
            }
        }
    }

    return (
        <View style={styles.container} onLayout={handleLayout}>
            <GestureDetector gesture={composed}>
                <View style={styles.gestureArea} collapsable={false}>
                    <Canvas style={styles.canvas}>
                        <Rect
                            key="canvas-bg"
                            x={0}
                            y={0}
                            width={(renderData?.cols ?? 0) * cellWidth}
                            height={(renderData?.rows_count ?? 0) * cellHeight}
                            color={canvasBg}
                        />
                        {elements}
                    </Canvas>
                    {/* Hidden input that owns the software keyboard. */}
                    <TextInput
                        ref={inputRef}
                        style={styles.hiddenInput}
                        value=""
                        onChangeText={handleChangeText}
                        onKeyPress={handleKeyPress}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        spellCheck={false}
                        keyboardType="ascii-capable"
                        showSoftInputOnFocus
                        caretHidden
                        multiline={false}
                        blurOnSubmit={false}
                    />
                </View>
            </GestureDetector>
            {/* Scrollback position indicator. */}
            {scrollOffset > 0 ? (
                <View style={[styles.scrollPill, { backgroundColor: palette.chromeRaised, borderColor: palette.border }]}>
                    <View style={[styles.scrollPillDot, { backgroundColor: palette.accent }]} />
                </View>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create({
    container: { flex: 1 },
    gestureArea: { flex: 1 },
    canvas: { flex: 1 },
    hiddenInput: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 1,
        height: 1,
        opacity: 0,
    },
    scrollPill: {
        position: 'absolute',
        right: 12,
        bottom: 12,
        width: 10,
        height: 10,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scrollPillDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },
});
