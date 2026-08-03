# Happy CLI

Native, end-to-end encrypted remote terminal control for macOS, Windows, and Linux.

## Installation

```bash
npm install -g happy
```

The npm package is only a platform launcher and the packaged native binaries. The
CLI and daemon do not require Node.js at runtime.

## Usage

```bash
happy terminal
happy auth login
happy auth status
happy doctor
happy daemon start
happy daemon status
happy daemon list
happy daemon stop
happy notify -p "Build finished"
happy logout
```

Running `happy` without a subcommand starts `happy terminal`.

Authentication uses a mobile QR code or browser flow. Session and terminal
payloads remain encrypted by the CLI before they are sent to the server.

## Local state

Happy stores native CLI state in `~/.happy` by default. Set `HAPPY_HOME_DIR` to
use a separate development or test directory. The Rust CLI uses versioned state
files and intentionally does not read legacy TypeScript credentials or settings.

Useful environment variables:

| Variable | Description |
|----------|-------------|
| `HAPPY_SERVER_URL` | API server URL |
| `HAPPY_WEBAPP_URL` | Web authentication URL |
| `HAPPY_HOME_DIR` | Native CLI state directory |
| `HAPPY_CLI_BIN` | Explicit native CLI executable for daemon tests |
| `HAPPY_HOST_AGENT_BIN` | Explicit Rust host-agent executable |
| `HAPPY_SERVER_BIN` | Explicit self-host server executable |

## Building from source

```bash
pnpm install
pnpm --filter happy build
pnpm --filter happy test
```

`happy build` compiles and stages the current platform Rust binary. Release
packaging stages all six targets and verifies both the native CLI and the
independent Rust host-agent. To include the self-host server in a release,
build the standalone server artifact first:

```bash
pnpm --filter happy bundle:server
pnpm --filter happy bundle:webapp
```

Those artifacts are packaged under `tools/server` and `tools/webapp`; source
mode is only a monorepo development fallback.

The monorepo may use `pnpm exec tsx` only for the development fallback of
`happy server`; it is not part of the published CLI runtime.

## License

MIT
