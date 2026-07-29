# Happy Host Agent

The authoritative native terminal runtime for `happy-cli`.

It owns shell selection, PTY lifecycle, raw I/O, resize, ordered events, replay
snapshots, command metadata, needs-input detection, and the shared terminal
grid. Authentication, end-to-end encryption, Socket.IO, and push delivery stay
in the TypeScript control plane.

The local protocol is version 2: bounded length-prefixed binary frames over
private stdin/stdout pipes. PTY bytes are no longer converted to Base64 on this
local boundary.

Build:

```bash
cargo build --locked --release --manifest-path packages/happy-host-agent/Cargo.toml
```

Or from the monorepo:

```bash
pnpm --filter happy host-agent:build
pnpm --filter happy host-agent:stage
```

Probe:

```bash
packages/happy-host-agent/target/release/happy-host-agent --probe
```

The Happy CLI requires a compatible Rust binary. Set `HAPPY_HOST_AGENT_BIN` to
test a specific build.

Release packaging builds and verifies Darwin, Linux, and Windows binaries for
both ARM64 and x64 before the CLI tarball is produced.
