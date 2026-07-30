/**
 * Hook that manages the WASM terminal model lifecycle.
 *
 * Loads the Rust-compiled WASM module once (cached at module level), creates
 * a TerminalHandle per session, and exposes it via a ref. The calling view
 * writes PTY bytes and reads render snapshots through the handle.
 *
 * Requires a JS engine with WebAssembly support (JSC, not Hermes).
 */

import * as React from 'react';
import wasmAssetModule from '../../../../assets/terminal/terminal-wasm.txt';

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
    cursor_row: number;
    cursor_col: number;
    cursor_visible: boolean;
    cols: number;
    rows_count: number;
}

let wasmModule: WasmExports | null = null;
let wasmLoading: Promise<WasmExports> | null = null;

async function loadWasm(): Promise<WasmExports> {
    if (wasmModule) return wasmModule;
    if (wasmLoading) return wasmLoading;

    wasmLoading = (async () => {
        const { Asset } = await import('expo-asset');
        const { readAsStringAsync } = await import('expo-file-system/legacy');

        const asset = Asset.fromModule(wasmAssetModule);
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('WASM asset has no localUri');

        const base64 = await readAsStringAsync(asset.localUri);
        const binary = globalThis.atob(base64.trim());
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const instantiation = await WebAssembly.instantiate(bytes, { env: {} });
        const instanceExports = (instantiation as any).instance?.exports ?? (instantiation as any).exports;
        if (!instanceExports) throw new Error('No exports from WASM instantiation');
        wasmModule = instanceExports as unknown as WasmExports;
        return wasmModule;
    })();

    return wasmLoading;
}

export class TerminalHandle {
    ptr: number;
    cols: number;
    rows: number;

    constructor(cols: number, rows: number) {
        this.ptr = wasmModule!.terminal_new(cols, rows);
        this.cols = cols;
        this.rows = rows;
    }

    write(data: Uint8Array): void {
        if (data.length === 0) return;
        const ptr = wasmModule!.alloc(data.length);
        new Uint8Array(wasmModule!.memory.buffer).set(data, ptr);
        wasmModule!.terminal_write(this.ptr, ptr, data.length);
        wasmModule!.dealloc(ptr, data.length);
    }

    resize(cols: number, rows: number): void {
        if (cols === this.cols && rows === this.rows) return;
        this.cols = cols;
        this.rows = rows;
        wasmModule!.terminal_resize(this.ptr, cols, rows);
    }

    render(): RenderData | null {
        const jsonPtr = wasmModule!.terminal_render(this.ptr);
        if (!jsonPtr) return null;
        const mem = new Uint8Array(wasmModule!.memory.buffer);
        let len = 0;
        while (mem[jsonPtr + len] !== 0) len++;
        const json = new TextDecoder().decode(mem.slice(jsonPtr, jsonPtr + len));
        wasmModule!.terminal_free_string(jsonPtr);
        return JSON.parse(json);
    }

    clear(): void {
        wasmModule!.terminal_clear(this.ptr);
    }

    dispose(): void {
        if (this.ptr !== 0) {
            wasmModule!.terminal_free(this.ptr);
            this.ptr = 0;
        }
    }
}

export function useSkiaTerminal(initialCols: number, initialRows: number): {
    ready: boolean;
    termRef: React.MutableRefObject<TerminalHandle | null>;
} {
    const [ready, setReady] = React.useState(false);
    const termRef = React.useRef<TerminalHandle | null>(null);

    React.useEffect(() => {
        if (typeof WebAssembly === 'undefined') {
            console.warn('[skia] WebAssembly not available in this runtime');
            return;
        }
        let cancelled = false;
        loadWasm()
            .then(() => {
                if (cancelled) return;
                termRef.current = new TerminalHandle(initialCols, initialRows);
                setReady(true);
            })
            .catch((err: any) => console.warn('[skia] WASM load failed:', err?.message ?? err));
        return () => {
            cancelled = true;
            termRef.current?.dispose();
            termRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { ready, termRef };
}
