import * as z from 'zod';

//
// Terminal protocol: raw pty I/O relayed between the CLI (node-pty) and clients.
//
// These schemas describe PLAINTEXT payloads that always travel encrypted:
// - App -> CLI params are encrypted with the session key and sent via `rpc-call`
//   (methods `terminal-input`, `terminal-resize`, `terminal-attach`).
// - CLI -> App output is encrypted with the session key and relayed by the
//   server as an ephemeral event (`terminal-output`). The server never sees
//   plaintext and never persists it.
//

/** Keystroke bytes (base64) from a client, to be written to the pty. */
export const TerminalInputSchema = z.object({
    t: z.literal('input'),
    data: z.string(),
});
export type TerminalInput = z.infer<typeof TerminalInputSchema>;

/** Terminal dimensions from a client, to be applied via pty.resize(). */
export const TerminalResizeSchema = z.object({
    t: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
});
export type TerminalResize = z.infer<typeof TerminalResizeSchema>;

/** Request from a newly attached client for a replay of the recent output buffer. */
export const TerminalAttachSchema = z.object({
    t: z.literal('attach'),
});
export type TerminalAttach = z.infer<typeof TerminalAttachSchema>;

export const TerminalRpcParamsSchema = z.discriminatedUnion('t', [
    TerminalInputSchema,
    TerminalResizeSchema,
    TerminalAttachSchema,
]);
export type TerminalRpcParams = z.infer<typeof TerminalRpcParamsSchema>;

/**
 * A chunk of pty output (base64). `seq` is a per-session monotonically
 * increasing counter; `snapshot: true` marks chunks replayed from the CLI's
 * in-memory buffer in response to `terminal-attach`, so clients can dedupe
 * against the live stream.
 */
export const TerminalOutputSchema = z.object({
    t: z.literal('output'),
    seq: z.number().int().min(0),
    data: z.string(),
    snapshot: z.boolean().optional(),
});
export type TerminalOutput = z.infer<typeof TerminalOutputSchema>;

/**
 * Unencrypted relay envelope emitted by the CLI on the `terminal-output`
 * socket event and forwarded by the server to the session's room as an
 * ephemeral event. `c` is the session-key-encrypted `TerminalOutput`.
 */
export const TerminalOutputEventSchema = z.object({
    t: z.literal('terminal-output'),
    sid: z.string(),
    c: z.string(),
});
export type TerminalOutputEvent = z.infer<typeof TerminalOutputEventSchema>;
