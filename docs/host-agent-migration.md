# Rust Host Agent Migration

## Goal

Move host-local terminal responsibilities from Node.js to a small native Rust
runtime without rewriting the Expo clients, the opaque relay server, account
flows, or end-to-end encryption.

## Runtime boundary

The TypeScript CLI remains the control plane during the migration:

- authentication and machine registration;
- encrypted Socket.IO session transport;
- terminal event sequencing, snapshots, Blocks metadata, and notifications;
- compatibility fallback to `node-pty`.

`happy-host-agent` is the native data plane:

- create and own the platform PTY;
- write input bytes and stream output bytes without changing boundaries;
- apply the controller-owned terminal grid;
- terminate the shell without opening a visible console window.

The two processes communicate through newline-delimited JSON over private
stdin/stdout pipes. PTY byte fields are base64 only on this local IPC boundary.
The public encrypted terminal protocol remains unchanged in phase 1.

## Selection and rollback

At session startup the CLI looks for the native binary in this order:

1. `HAPPY_HOST_AGENT_BIN`;
2. a packaged `tools/host-agent/<platform>-<arch>` binary;
3. the monorepo release build under `packages/happy-host-agent/target/release`.

The binary must pass a protocol probe. If it is absent, disabled, incompatible,
or fails the probe, the CLI uses `node-pty`. Set
`HAPPY_HOST_AGENT_DISABLED=1` for an explicit rollback.

## Delivery phases

### Phase 1 — native PTY runtime

- Rust owns spawn, input, output, resize, kill, and exit status.
- TypeScript preserves all network and product behavior.
- Attach capabilities expose the active `ptyBackend` for diagnostics.

### Phase 2 — framed local IPC and backpressure

- Replace line JSON with a length-prefixed binary local protocol.
- Add bounded write queues, high/low watermarks, and congestion metrics.
- Package signed native binaries for Windows, macOS, and Linux in CI.

### Phase 3 — authoritative terminal state

- Evaluate a pinned `libghostty-vt` adapter behind the same Rust interface.
- Add screen epochs, full state checkpoints, and cell/scrollback deltas.
- Keep raw VT byte streaming as the compatibility path until parity tests pass.

### Phase 4 — public binary transport

- Add an encrypted binary terminal envelope alongside the current JSON schema.
- Negotiate capability per client and retain protocol downgrade support.
- Keep the server payload-opaque and avoid server-side terminal parsing.

### Phase 5 — renderer optimization

- Enable xterm WebGL with automatic fallback where stable.
- Profile mobile WebView bridge and frame timing before considering a Skia grid.
- A native Skia renderer is optional and must consume the same screen epochs;
  it is not a prerequisite for the Rust Agent migration.
