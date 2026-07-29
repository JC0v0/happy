# Rust Terminal Runtime

Status: host-side migration complete.

## Scope

The terminal's host-local runtime is entirely Rust. This deliberately does not
rewrite the Expo clients, the payload-opaque relay server, account flows,
Socket.IO, or end-to-end encryption.

TypeScript is now only the control plane:

- authentication and machine/session registration;
- encrypted Socket.IO transport;
- server-routed push delivery;
- process and disconnect lifecycle;
- translation between Rust binary output and the existing encrypted public
  terminal protocol.

`happy-host-agent` is the authoritative terminal runtime:

- select and spawn the platform shell;
- own the platform PTY;
- accept raw input and stream raw output;
- batch output and assign the single ordered sequence;
- retain the bounded replay ring and produce attach snapshots;
- parse shell integration markers;
- own command, current-directory, and needs-input state;
- own device viewports and the controller-selected shared terminal grid;
- apply resize and terminate the shell.

There is no `node-pty` fallback in the Happy CLI terminal path. A missing or
incompatible Rust runtime is a startup error with a build instruction instead
of a silent behavioral downgrade.

## Local IPC protocol

Protocol version 2 uses bounded length-prefixed binary frames:

```text
u32 big-endian frame length
u8  frame kind
... payload
```

The maximum frame is 8 MiB. PTY input and output remain raw bytes on this
boundary. Low-frequency spawn, resize, metadata, state, and request-correlation
payloads use UTF-8 JSON inside their frames.

The Rust process and TypeScript adapter both use bounded queues. If the
TypeScript side stops reading, stdout applies backpressure, the Rust event loop
stops draining its 256-message channel, and the PTY reader blocks rather than
growing memory indefinitely.

The public network protocol is unchanged in this migration. TypeScript converts
Rust output bytes to the existing encrypted terminal event before Socket.IO
delivery, so existing apps and the opaque server remain compatible.

## Runtime discovery

The CLI requires a protocol-2 binary and searches in this order:

1. `HAPPY_HOST_AGENT_BIN`;
2. `packages/happy-cli/tools/unpacked/happy-host-agent[.exe]`;
3. `packages/happy-cli/tools/host-agent/<platform>-<arch>/`;
4. the monorepo release build under
   `packages/happy-host-agent/target/release/`.

Every candidate must pass `happy-host-agent --probe`.

## Build and stage

```bash
pnpm --filter happy host-agent:build
pnpm --filter happy host-agent:stage
```

`host-agent:build` produces the optimized Rust binary. `host-agent:stage` also
copies it into the platform directory included by the CLI package.

The Rust Terminal Runtime workflow builds all supported targets, merges them
into one CLI package, and runs `host-agent:verify-staged` before packing.
`prepublishOnly` applies the same six-binary check, so an incomplete npm package
cannot be published accidentally. The existing CLI postinstall restores the
Unix executable bit that npm removes from ordinary packaged files. The runtime
also repairs that bit lazily before probing, covering pnpm installations where
dependency scripts are disabled.

The supported package directory names are:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

## Verification

```bash
cargo test --manifest-path packages/happy-host-agent/Cargo.toml
pnpm --filter @slopus/happy-wire build
pnpm --filter happy typecheck
pnpm --filter happy exec vitest run src/terminal/rustTerminalRuntime.test.ts
```

The native integration test starts a real PTY through Rust, sends raw input,
observes raw output, requests a Rust-owned snapshot, and exits the shell.

## Rollback

Because the Node PTY implementation and dependency have been removed, rollback
means installing or checking out the previous CLI release. There is no
environment flag that changes the runtime implementation inside this version.

## Intentionally separate future work

These optimizations are not required to complete the Rust host migration and
can evolve without changing runtime ownership:

- adding an encrypted binary Socket.IO terminal envelope alongside the current
  JSON-compatible public payload;
- adding screen epochs and cell deltas as an optional rendering optimization;
- enabling xterm WebGL where clients support it;
- evaluating a native mobile renderer after profiling the WebView bridge.
