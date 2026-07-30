/**
 * Hook that wires socket output -> WASM terminal model -> Skia render data.
 */

import * as React from 'react';
import { subscribeTerminalOutput } from '../terminalOutputBus';


console.warn('[skia] useSkiaTerminal module evaluated');

interface WasmExports {
    memory: WebAssembly.Memory;
    alloc(size: number): number;
    dealloc(ptr: number, size: number): void;
    terminal_new(cols: number, rows: number): number;
    terminal_free(ptr: number): void;
    terminal_write(ptr: number, dataPtr: number, dataLen: number): void;
    terminal_resize(ptr: number, cols: number, rows: number): void;
    terminal_render(ptr: number): number;
    terminal_free_string(ptr: number): void;
    terminal_clear(ptr: number): void;
    terminal_cols(ptr: number): number;
    terminal_rows(ptr: number): number;
}

export interface CellData { ch: string; fg: number; bg: number; attrs: number; }
export interface RenderData {
    rows: { cells: CellData[] }[];
    cursor_row: number; cursor_col: number; cursor_visible: boolean;
    cols: number; rows_count: number;
}

let wasmModule: WasmExports | null = null;
let wasmLoading: Promise<WasmExports> | null = null;

function base64ToUint8(base64: string): Uint8Array {
    const logger = (globalThis as any).console;
    try {
        const binary = globalThis.atob(base64);
        console.warn('[skia] atob succeeded, length:', binary.length);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch (e: any) {
        console.warn('[skia] atob failed:', e?.message);
        throw e;
    }
}

async function loadWasm(): Promise<WasmExports> {
    const logger = (globalThis as any).console;
    if (wasmModule) return wasmModule;
    if (wasmLoading) return wasmLoading;

    wasmLoading = (async () => {
        const { Asset } = await import('expo-asset');
        const { readAsStringAsync } = await import('expo-file-system/legacy');

        logger?.warn?.('[skia] Loading WASM asset...');
        // Dynamic require for Metro to assign a module ID
        const wasmAsset = (require as any)('../../../assets/terminal/terminal-wasm.txt');
        const asset = Asset.fromModule(wasmAsset);
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('WASM asset has no localUri');
        console.warn('[skia] Asset loaded, decoding...');

        const base64 = await readAsStringAsync(asset.localUri);
        const wasmBytes = base64ToUint8(base64.trim());

        console.warn('[skia] Instantiating WASM (size:', wasmBytes.length, 'bytes)...');
        const instantiation = await WebAssembly.instantiate(wasmBytes, { env: {} });
        const instanceExports = (instantiation as any).instance?.exports ?? (instantiation as any).exports;
        if (!instanceExports) throw new Error('No exports from WASM instantiation');
        wasmModule = instanceExports as unknown as WasmExports;
        console.warn('[skia] WASM loaded. Exports:', Object.keys(wasmModule).filter(k => k.startsWith('terminal')).join(', '));
        return wasmModule;
    })();

    return wasmLoading;
}

class TerminalHandle {
    ptr: number; cols: number; rows: number;
    constructor(cols: number, rows: number) {
        this.ptr = wasmModule!.terminal_new(cols, rows);
        this.cols = cols; this.rows = rows;
    }
    write(data: string): void {
        const encoded = new TextEncoder().encode(data);
        const ptr = wasmModule!.alloc(encoded.length);
        new Uint8Array(wasmModule!.memory.buffer).set(encoded, ptr);
        wasmModule!.terminal_write(this.ptr, ptr, encoded.length);
        wasmModule!.dealloc(ptr, encoded.length);
    }
    resize(cols: number, rows: number): void {
        if (cols === this.cols && rows === this.rows) return;
        this.cols = cols; this.rows = rows;
        wasmModule!.terminal_resize(this.ptr, cols, rows);
    }
    render(): RenderData {
        const jsonPtr = wasmModule!.terminal_render(this.ptr);
        const mem = new Uint8Array(wasmModule!.memory.buffer);
        let len = 0;
        while (mem[jsonPtr + len] !== 0) len++;
        const json = new TextDecoder().decode(mem.slice(jsonPtr, jsonPtr + len));
        wasmModule!.terminal_free_string(jsonPtr);
        return JSON.parse(json);
    }
    clear(): void { wasmModule!.terminal_clear(this.ptr); }
    dispose(): void {
        if (this.ptr !== 0) { wasmModule!.terminal_free(this.ptr); this.ptr = 0; }
    }
}

interface UseSkiaTerminalOptions {
    sessionId: string; terminalId: string;
    cols: number; rows: number; enabled: boolean;
}
interface UseSkiaTerminalResult {
    ready: boolean; renderData: RenderData | null;
    write: (data: string) => void; doResize: (cols: number, rows: number) => void;
}

export function useSkiaTerminal(opts: UseSkiaTerminalOptions): UseSkiaTerminalResult {
    const { sessionId, cols, rows, enabled } = opts;
    const [ready, setReady] = React.useState(false);
    const [renderData, setRenderData] = React.useState<RenderData | null>(null);
    const termRef = React.useRef<TerminalHandle | null>(null);
    const colsRef = React.useRef(cols);
    const rowsRef = React.useRef(rows);

    React.useEffect(() => {
        console.warn('[skia] useEffect called, enabled:', enabled);
        if (!enabled) return;
        console.warn('[skia] useEffect running, WebAssembly:', typeof WebAssembly);
        const logger = (globalThis as any).console;

        if (typeof WebAssembly === 'undefined') {
            logger?.warn?.('[skia] WebAssembly NOT available in this runtime.');
            return;
        }
        console.warn('[skia] WebAssembly available, loading WASM...');
        let cancelled = false;
        loadWasm()
            .then(() => {
                if (cancelled) return;
                console.warn('[skia] WASM loaded, creating terminal handle...');
                const term = new TerminalHandle(colsRef.current, rowsRef.current);
                termRef.current = term;
                setReady(true);
            })
            .catch((err: any) => {
                console.warn('[skia] WASM load failed:', err?.message ?? err);
            });
        return () => {
            cancelled = true;
            termRef.current?.dispose();
            termRef.current = null;
        };
    }, [enabled]);

    React.useEffect(() => {
        if (!enabled || !ready) return;
        console.warn('[skia] Subscribing to terminal output...');
        const unsubscribe = subscribeTerminalOutput(sessionId, (chunk: any) => {
            const term = termRef.current;
            if (!term) return;
            if ((chunk as any).data) term.write((chunk as any).data);
            const data = term.render();
            setRenderData(data);
        });
        return unsubscribe;
    }, [enabled, ready, sessionId]);

    const write = React.useCallback((data: string) => {
        termRef.current?.write(data);
    }, []);
    const doResize = React.useCallback((newCols: number, newRows: number) => {
        colsRef.current = newCols; rowsRef.current = newRows;
        termRef.current?.resize(newCols, newRows);
    }, []);

    return { ready, renderData, write, doResize };
}
