# Happy CLI development notes

The formal CLI runtime is the independent Rust crate under `rust/`. The npm
package's `bin/happy.mjs` only selects and launches the platform-native binary.

## Checks

```bash
cargo fmt --manifest-path packages/happy-cli/Cargo.toml -- --check
cargo clippy --locked --manifest-path packages/happy-cli/Cargo.toml -- -D warnings
cargo test --locked --manifest-path packages/happy-cli/Cargo.toml
pnpm --filter happy build
```

Keep HTTP, Socket.IO, encryption, terminal IPC v2, and `happy-wire` fixtures
backward-compatible with the TypeScript server and app. New local state must
use the Rust schema marker; do not add legacy credential or settings migration.

The TypeScript files that remain in the workspace are historical development
references and are not included in the npm package or invoked by the native
launcher.
