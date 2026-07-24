import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    dbMock,
    emitEphemeralMock,
    counterIncMock,
    labelsMock,
    logMock,
    resetMocks,
} = vi.hoisted(() => {
    const dbMock = {
        session: {
            findUnique: vi.fn(),
        },
    };
    const emitEphemeralMock = vi.fn();
    const counterIncMock = vi.fn();
    const labelsMock = { client: "test-cli" };
    const logMock = vi.fn();
    const resetMocks = () => {
        dbMock.session.findUnique.mockReset();
        emitEphemeralMock.mockReset();
        counterIncMock.mockReset();
        logMock.mockReset();
    };
    return { dbMock, emitEphemeralMock, counterIncMock, labelsMock, logMock, resetMocks };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: logMock }));
vi.mock("@/app/monitoring/metrics2", () => ({
    getMetricsLabelsFromSocket: () => labelsMock,
    websocketEventsCounter: { inc: counterIncMock },
}));
vi.mock("@/app/events/eventRouter", () => ({
    // ClientConnection is a type-only import - no runtime export needed.
    eventRouter: { emitEphemeral: emitEphemeralMock },
}));

import { terminalHandler } from "./terminalHandler";

// 96 * 1024, matching MAX_CIPHERTEXT_CHARS in the handler.
const MAX_CIPHERTEXT_CHARS = 96 * 1024;

function makeSocket() {
    // Capture the handler registered for 'terminal-output' so the test can
    // invoke it directly with a payload.
    let handler: ((data: unknown) => Promise<void> | void) | null = null;
    const socket = {
        on: (event: string, cb: (data: unknown) => Promise<void> | void) => {
            if (event === "terminal-output") {
                handler = cb;
            }
        },
    };
    return {
        socket: socket as any,
        emit: (data: unknown) => {
            if (!handler) {
                throw new Error("terminal-output handler was not registered");
            }
            return handler(data);
        },
    };
}

function scopedConnection(sessionId: string) {
    return {
        connectionType: "session-scoped" as const,
        socket: {} as any,
        userId: "user-1",
        sessionId,
    };
}

describe("terminalHandler", () => {
    beforeEach(() => {
        resetMocks();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("relays a valid chunk via emitEphemeral with the right routing", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();
        const connection = scopedConnection("sess-1");

        terminalHandler("user-1", socket, connection);
        await emit({ sid: "sess-1", c: "ciphertext" });

        expect(emitEphemeralMock).toHaveBeenCalledTimes(1);
        expect(emitEphemeralMock).toHaveBeenCalledWith({
            userId: "user-1",
            payload: { type: "terminal-output", sessionId: "sess-1", c: "ciphertext" },
            recipientFilter: { type: "all-interested-in-session", sessionId: "sess-1" },
            skipSenderConnection: connection,
        });
        expect(counterIncMock).toHaveBeenCalledWith({ event_type: "terminal-output", ...labelsMock });
    });

    it("caches the ownership check across chunks for the same session", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, scopedConnection("sess-1"));
        await emit({ sid: "sess-1", c: "a" });
        await emit({ sid: "sess-1", c: "b" });
        await emit({ sid: "sess-1", c: "c" });

        expect(dbMock.session.findUnique).toHaveBeenCalledTimes(1);
        expect(emitEphemeralMock).toHaveBeenCalledTimes(3);
    });

    it("drops chunks whose connection does not own the session", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        // CLI is scoped to sess-1 but claims to emit for sess-2.
        terminalHandler("user-1", socket, scopedConnection("sess-1"));
        await emit({ sid: "sess-2", c: "ciphertext" });

        expect(emitEphemeralMock).not.toHaveBeenCalled();
        expect(dbMock.session.findUnique).not.toHaveBeenCalled();
    });

    it("drops chunks from non-session-scoped connections", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, {
            connectionType: "user-scoped",
            socket: {} as any,
            userId: "user-1",
        } as any);
        await emit({ sid: "sess-1", c: "ciphertext" });

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("drops chunks for a session the user does not own", async () => {
        dbMock.session.findUnique.mockResolvedValue(null);
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, scopedConnection("sess-1"));
        await emit({ sid: "sess-1", c: "ciphertext" });

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("drops oversized ciphertext", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, scopedConnection("sess-1"));
        await emit({ sid: "sess-1", c: "x".repeat(MAX_CIPHERTEXT_CHARS + 1) });

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("drops empty ciphertext", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, scopedConnection("sess-1"));
        await emit({ sid: "sess-1", c: "" });

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("drops malformed payloads (missing/non-string fields)", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, scopedConnection("sess-1"));
        await emit({ c: "ciphertext" }); // missing sid
        await emit({ sid: "sess-1" }); // missing c
        await emit({ sid: 123, c: "ciphertext" }); // non-string sid
        await emit(null);
        await emit(undefined);

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("rate-limits excess bursts and refills over time", async () => {
        dbMock.session.findUnique.mockResolvedValue({ id: "sess-1" });
        const { socket, emit } = makeSocket();

        terminalHandler("user-1", socket, scopedConnection("sess-1"));

        // 600 is the burst allowance - all should relay at t=0.
        for (let i = 0; i < 600; i++) {
            await emit({ sid: "sess-1", c: String(i) });
        }
        expect(emitEphemeralMock).toHaveBeenCalledTimes(600);

        // 601st at the same instant is dropped (bucket empty, no refill).
        await emit({ sid: "sess-1", c: "dropped" });
        expect(emitEphemeralMock).toHaveBeenCalledTimes(600);

        // After 1s the bucket refills 200 tokens - one more relay goes through.
        vi.setSystemTime(1000);
        await emit({ sid: "sess-1", c: "after-refill" });
        expect(emitEphemeralMock).toHaveBeenCalledTimes(601);
    });
});
