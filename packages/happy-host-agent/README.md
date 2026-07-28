# Happy Host Agent

Native PTY runtime used incrementally by `happy-cli`. It owns only the local
pseudoterminal lifecycle; authentication, end-to-end encryption, session RPCs,
and server connectivity remain in TypeScript during the migration.

The helper communicates over newline-delimited JSON on stdin/stdout. PTY byte
payloads are base64 inside this local IPC protocol so arbitrary byte boundaries
remain intact. The public network protocol is unchanged.

Build locally:

```powershell
& "$HOME\.cargo\bin\cargo.exe" build --release --manifest-path packages/happy-host-agent/Cargo.toml
```

The CLI automatically discovers a workspace release build. Set
`HAPPY_HOST_AGENT_BIN` to test another binary, or
`HAPPY_HOST_AGENT_DISABLED=1` to force the existing `node-pty` fallback.
