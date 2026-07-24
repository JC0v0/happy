import { getMetricsLabelsFromSocket, websocketEventsCounter } from "@/app/monitoring/metrics2";
import { ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { Socket } from "socket.io";

// Terminal output relay: the session-scoped CLI connection owning a session
// emits encrypted pty output chunks here; the server relays them, blind and
// unpersisted, to every client interested in the session. The payload `c` is
// end-to-end encrypted by the CLI with the session key — the server treats it
// as an opaque string.

// Ciphertext cap per chunk. Terminal chunks are small (a few KB); 96KB is
// generous headroom and stays well under engine.io's 1MB packet limit.
const MAX_CIPHERTEXT_CHARS = 96 * 1024;
// Per-socket token bucket. Live terminal output can burst (e.g. `cat` of a
// large file); 200 chunks/sec sustained with a 600-chunk burst allowance is
// far above interactive use while still bounding abuse.
const RATE_LIMIT_REFILL_PER_SEC = 200;
const RATE_LIMIT_BURST = 600;

export function terminalHandler(userId: string, socket: Socket, connection: ClientConnection) {
    const labels = getMetricsLabelsFromSocket(socket);
    let tokens = RATE_LIMIT_BURST;
    let lastRefill = Date.now();
    // Session ownership doesn't change for the lifetime of a socket — cache
    // the accountId check so high-frequency chunks don't hit the database.
    const validatedSessions = new Set<string>();

    socket.on('terminal-output', async (data: any) => {
        try {
            websocketEventsCounter.inc({ event_type: 'terminal-output', ...labels });

            // Token bucket rate limit — drop excess chunks rather than queue them
            const now = Date.now();
            tokens = Math.min(RATE_LIMIT_BURST, tokens + ((now - lastRefill) / 1000) * RATE_LIMIT_REFILL_PER_SEC);
            lastRefill = now;
            if (tokens < 1) {
                return;
            }
            tokens -= 1;

            const { sid, c } = data ?? {};
            if (typeof sid !== 'string' || typeof c !== 'string' || c.length === 0 || c.length > MAX_CIPHERTEXT_CHARS) {
                return;
            }

            // Only the session-scoped CLI connection that owns this session may emit output
            if (connection.connectionType !== 'session-scoped' || connection.sessionId !== sid) {
                return;
            }

            if (!validatedSessions.has(sid)) {
                const session = await db.session.findUnique({
                    where: { id: sid, accountId: userId },
                    select: { id: true }
                });
                if (!session) {
                    return;
                }
                validatedSessions.add(sid);
            }

            eventRouter.emitEphemeral({
                userId,
                payload: { type: 'terminal-output', sessionId: sid, c },
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
                skipSenderConnection: connection
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in terminal-output handler: ${error}`);
        }
    });
}
