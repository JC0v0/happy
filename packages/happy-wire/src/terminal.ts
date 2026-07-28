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

export const TerminalIdSchema = z.string().min(1).max(128);

const TerminalScopeSchema = {
    /** Stable per-device PTY identity. Absent means the legacy shared PTY. */
    terminalId: TerminalIdSchema.optional(),
};

/** Keystroke bytes (base64) from a client, to be written to its device PTY. */
export const TerminalInputSchema = z.object({
    t: z.literal('input'),
    data: z.string(),
    ...TerminalScopeSchema,
});
export type TerminalInput = z.infer<typeof TerminalInputSchema>;

/**
 * A complete command submitted from Happy's command dock. Unlike raw
 * `terminal-input`, this gives the CLI an explicit command boundary so it can
 * attach lifecycle metadata without attempting to reconstruct editable shell
 * input from a byte stream. Older CLIs simply do not register this RPC and
 * clients fall back to `terminal-input`.
 */
export const TerminalExecuteSchema = z.object({
    t: z.literal('execute'),
    command: z.string().min(1).max(32 * 1024),
    ...TerminalScopeSchema,
});
export type TerminalExecute = z.infer<typeof TerminalExecuteSchema>;

export const TerminalExecuteResponseSchema = z.object({
    commandId: z.string().optional(),
    tracked: z.boolean(),
});
export type TerminalExecuteResponse = z.infer<typeof TerminalExecuteResponseSchema>;

/** Terminal dimensions from a client, to be applied via pty.resize(). */
export const TerminalResizeSchema = z.object({
    t: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    ...TerminalScopeSchema,
});
export type TerminalResize = z.infer<typeof TerminalResizeSchema>;

/** Request from a newly attached client for a replay of the recent output buffer. */
export const TerminalAttachSchema = z.object({
    t: z.literal('attach'),
    ...TerminalScopeSchema,
});
export type TerminalAttach = z.infer<typeof TerminalAttachSchema>;

/**
 * Terminal color theme synced from the CLI host's local terminal
 * configuration (e.g. Windows Terminal settings). All values are CSS hex
 * strings like `#1e1e2e`. When absent the app falls back to its built-in
 * palette.
 */
export const TerminalThemeSchema = z.object({
    background: z.string().optional(),
    foreground: z.string().optional(),
    cursor: z.string().optional(),
    cursorAccent: z.string().optional(),
    selectionBackground: z.string().optional(),
    black: z.string().optional(),
    red: z.string().optional(),
    green: z.string().optional(),
    yellow: z.string().optional(),
    blue: z.string().optional(),
    magenta: z.string().optional(),
    cyan: z.string().optional(),
    white: z.string().optional(),
    brightBlack: z.string().optional(),
    brightRed: z.string().optional(),
    brightGreen: z.string().optional(),
    brightYellow: z.string().optional(),
    brightBlue: z.string().optional(),
    brightMagenta: z.string().optional(),
    brightCyan: z.string().optional(),
    brightWhite: z.string().optional(),
});
export type TerminalTheme = z.infer<typeof TerminalThemeSchema>;

/** Response to `terminal-attach`: the host's terminal theme for color syncing. */
export const TerminalCapabilitiesSchema = z.object({
    protocolVersion: z.number().int().min(1),
    structuredCommands: z.boolean(),
    shell: z.string(),
    perDevicePty: z.boolean().optional(),
    /** The shared PTY grid follows the device that most recently sent input. */
    adaptiveGrid: z.boolean().optional(),
    /** Native host runtime selected for this terminal session. */
    ptyBackend: z.enum(['node-pty', 'rust-host-agent']).optional(),
});
export type TerminalCapabilities = z.infer<typeof TerminalCapabilitiesSchema>;

export const TerminalSessionStateSchema = z.object({
    status: z.enum(['idle', 'running', 'needs-input']),
    cwd: z.string().optional(),
    activeCommand: z.object({
        commandId: z.string(),
        command: z.string(),
        startedAt: z.number().int().nonnegative(),
        cwd: z.string().optional(),
    }).optional(),
});
export type TerminalSessionState = z.infer<typeof TerminalSessionStateSchema>;

export const TerminalAttachResponseSchema = z.object({
    theme: TerminalThemeSchema.optional(),
    capabilities: TerminalCapabilitiesSchema.optional(),
    state: TerminalSessionStateSchema.optional(),
});
export type TerminalAttachResponse = z.infer<typeof TerminalAttachResponseSchema>;

export const TerminalRpcParamsSchema = z.discriminatedUnion('t', [
    TerminalInputSchema,
    TerminalExecuteSchema,
    TerminalResizeSchema,
    TerminalAttachSchema,
]);
export type TerminalRpcParams = z.infer<typeof TerminalRpcParamsSchema>;

/**
 * A chunk of pty output (base64). `seq` is monotonically increasing within
 * one `terminalId`; legacy events without an id use the shared sequence.
 * `snapshot: true` marks chunks replayed from the CLI's
 * in-memory buffer in response to `terminal-attach`, so clients can dedupe
 * against the live stream.
 */
export const TerminalOutputSchema = z.object({
    t: z.literal('output'),
    seq: z.number().int().min(0),
    data: z.string(),
    snapshot: z.boolean().optional(),
    ...TerminalScopeSchema,
});
export type TerminalOutput = z.infer<typeof TerminalOutputSchema>;

const TerminalSequencedEventSchema = z.object({
    seq: z.number().int().min(0),
    snapshot: z.boolean().optional(),
    ...TerminalScopeSchema,
});

/** A command accepted by the shell-facing terminal command dock. */
export const TerminalCommandStartSchema = TerminalSequencedEventSchema.extend({
    t: z.literal('command-start'),
    commandId: z.string().min(1),
    command: z.string(),
    startedAt: z.number().int().nonnegative(),
    cwd: z.string().optional(),
});
export type TerminalCommandStart = z.infer<typeof TerminalCommandStartSchema>;

/** Completion metadata emitted when shell integration reaches the next prompt. */
export const TerminalCommandEndSchema = TerminalSequencedEventSchema.extend({
    t: z.literal('command-end'),
    commandId: z.string().min(1),
    endedAt: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int(),
    cwd: z.string().optional(),
});
export type TerminalCommandEnd = z.infer<typeof TerminalCommandEndSchema>;

/** Current working directory reported by shell integration. */
export const TerminalCwdSchema = TerminalSequencedEventSchema.extend({
    t: z.literal('cwd'),
    path: z.string(),
});
export type TerminalCwd = z.infer<typeof TerminalCwdSchema>;

/** Coarse terminal state used by mobile UI and attention notifications. */
export const TerminalStateSchema = TerminalSequencedEventSchema.extend({
    t: z.literal('state'),
    state: z.enum(['idle', 'running', 'needs-input']),
    commandId: z.string().optional(),
});
export type TerminalState = z.infer<typeof TerminalStateSchema>;

/**
 * Shared PTY dimensions selected by the active controller. Every client uses
 * this logical grid while fitting it independently into its physical viewport.
 */
export const TerminalGridSchema = TerminalSequencedEventSchema.extend({
    t: z.literal('grid'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    controllerTerminalId: TerminalIdSchema.optional(),
});
export type TerminalGrid = z.infer<typeof TerminalGridSchema>;

/**
 * Ordered plaintext event stream carried inside the existing encrypted
 * terminal-output relay. Keeping one `seq` domain per device PTY for bytes
 * and metadata makes snapshot/live reconciliation deterministic and leaves
 * the server blind to commands, paths and output.
 */
export const TerminalStreamEventSchema = z.discriminatedUnion('t', [
    TerminalOutputSchema,
    TerminalCommandStartSchema,
    TerminalCommandEndSchema,
    TerminalCwdSchema,
    TerminalStateSchema,
    TerminalGridSchema,
]);
export type TerminalStreamEvent = z.infer<typeof TerminalStreamEventSchema>;

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
