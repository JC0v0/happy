import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import * as fs from "fs";
import * as path from "path";

let pgliteInstance: PGlite | null = null;

/**
 * pglite-prisma-adapter 0.7 returns bytea columns as Uint8Array, matching the
 * Prisma 7 driver-adapter contract. This project still uses Prisma 6, whose
 * adapter boundary accepts byte values as plain number arrays. Normalize the
 * query result at the local PGlite boundary so Bytes fields work in standalone
 * mode without changing the PostgreSQL path.
 */
function normalizePrisma6Bytes(value: unknown): unknown {
    if (ArrayBuffer.isView(value)) {
        return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (Array.isArray(value)) {
        return value.map(normalizePrisma6Bytes);
    }
    return value;
}

function wrapPrisma6PGliteAdapter<T extends object>(adapter: T): T {
    const wrapped = adapter as T & {
        __happyPrisma6BytesWrapped?: boolean;
        queryRaw?: (...args: any[]) => Promise<any>;
        startTransaction?: (...args: any[]) => Promise<object>;
    };
    if (wrapped.__happyPrisma6BytesWrapped) {
        return adapter;
    }
    wrapped.__happyPrisma6BytesWrapped = true;

    if (wrapped.queryRaw) {
        const queryRaw = wrapped.queryRaw.bind(adapter);
        wrapped.queryRaw = async (...args: any[]) => {
            const result = await queryRaw(...args);
            return {
                ...result,
                rows: result.rows.map((row: unknown[]) => row.map(normalizePrisma6Bytes)),
            };
        };
    }

    if (wrapped.startTransaction) {
        const startTransaction = wrapped.startTransaction.bind(adapter);
        wrapped.startTransaction = async (...args: any[]) => (
            wrapPrisma6PGliteAdapter(await startTransaction(...args))
        );
    }

    return adapter;
}

type WebAssemblyModuleCtor = new (bytes: Buffer) => WebAssembly.Module;

function getWebAssemblyModuleCtor(): WebAssemblyModuleCtor | null {
    const moduleCtor = (globalThis as { WebAssembly?: { Module?: unknown } }).WebAssembly?.Module;
    return typeof moduleCtor === "function"
        ? (moduleCtor as WebAssemblyModuleCtor)
        : null;
}

function findPGliteWasm(): { wasmModule: WebAssembly.Module; fsBundle: Blob } | null {
    const wasmModuleCtor = getWebAssemblyModuleCtor();
    if (!wasmModuleCtor) {
        return null;
    }
    const searchPaths = [
        process.cwd(),
        path.dirname(process.execPath),
    ];
    for (const dir of searchPaths) {
        const wasmPath = path.join(dir, "pglite.wasm");
        const dataPath = path.join(dir, "pglite.data");
        if (fs.existsSync(wasmPath) && fs.existsSync(dataPath)) {
            const wasmModule = new wasmModuleCtor(fs.readFileSync(wasmPath));
            const fsBundle = new Blob([fs.readFileSync(dataPath)]);
            return { wasmModule, fsBundle };
        }
    }
    return null;
}

function createClient(): PrismaClient {
    const provider = process.env.DB_PROVIDER || "postgres";

    if (provider === "pglite") {
        const pgliteDir = process.env.PGLITE_DIR || "./data/pglite";
        const wasmOpts = findPGliteWasm();
        if (wasmOpts) {
            pgliteInstance = new PGlite({ dataDir: pgliteDir, ...wasmOpts });
        } else {
            pgliteInstance = new PGlite(pgliteDir);
        }
        const adapter = new PrismaPGlite(pgliteInstance);
        const connect = adapter.connect.bind(adapter);
        adapter.connect = async () => wrapPrisma6PGliteAdapter(await connect());
        return new PrismaClient({ adapter } as any);
    }

    return new PrismaClient();
}

export const db = createClient();

export function getPGlite(): PGlite | null {
    return pgliteInstance;
}
