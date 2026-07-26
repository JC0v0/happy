<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/.github/logotype-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="/.github/logotype-light.png">
    <img src="/.github/logotype-dark.png" width="400" alt="Happy">
  </picture>
</div>

<h1 align="center">
  Terminal-first fork of slopus/happy
</h1>

<h4 align="center">
A mobile and web client for your terminal, end-to-end encrypted.
</h4>

> **Fork notice.** This is a secondary-development fork of [`slopus/happy`](https://github.com/slopus/happy). The upstream project is a mobile/web client for AI coding agents (Claude Code, Codex, …). **This fork removes the agent layer and repurposes the app as a pure terminal client**: you attach to a remote shell from your phone or browser, over the same E2E-encrypted relay the upstream uses for sessions. App Store / Google Play / Discord / demo links below belong to the upstream project, not this fork.

<div align="center">

[📱 **iOS App**](https://apps.apple.com/us/app/happy-claude-code-client/id6748571505) • [🤖 **Android App**](https://play.google.com/store/apps/details?id=com.ex3ndr.happy) • [🌐 **Web App**](https://app.happy.engineering) • [🎥 **See a Demo**](https://youtu.be/GCS0OG9QMSE) • [📚 **Upstream Docs**](https://happy.engineering/docs/) • [💬 **Discord**](https://discord.gg/fX9WBAhyfD) <sub>(upstream)</sub>

</div>

## What changed vs upstream

- **Removed**: coding-agent backends in the CLI (Claude Code / Codex / Gemini / ACP / agy / openclaw), the agent UI components and pages, and the mobile voice assistant.
- **Added**: E2E-encrypted terminal sessions — a pty relay across `happy-wire` / `happy-server` / `happy-cli` / `happy-app`. Web renders with xterm.js, native renders with a WebView + offline-bundled xterm, and a shared `TerminalOrderer` handles sequence dedup and gap resync. Host color scheme is synced to the client, and scrollback survives reattach.
- **Kept**: the encrypted sync engine, server, wire protocol, and GitHub login.

See [`docs/roadmap.md`](docs/roadmap.md) for status.

## How does it work?

The CLI hosts an E2E-encrypted pty session on your computer; the app (web or native) attaches to it through `happy-server`. The server only relays ciphertext — your terminal output never leaves your devices unencrypted.

Because this is a fork, install from source (the `happy` package name on npm belongs to upstream):

```bash
pnpm install
pnpm --filter happy cli
```

## 🔥 Why this fork?

- 📱 **Terminal access from anywhere** — drive a remote shell from your phone or browser
- 🔐 **End-to-end encrypted** — output is encrypted in transit; the server only relays
- 🖥️ **Persistent sessions** — reattach to a running terminal without losing scrollback
- 🧩 **Built on a proven base** — inherits upstream's sync engine, wire protocol, and server

## 📦 Project Components

- **[Happy App](packages/happy-app)** — Web UI + mobile client (Expo)
- **[Happy CLI](packages/happy-cli)** — Command-line interface that hosts terminal sessions
- **[Happy Server](packages/happy-server)** — Backend for encrypted relay
- **[Happy Wire](packages/happy-wire)** — Shared wire schemas/types
- **[Happy Agent](packages/happy-agent)** — Upstream remote-agent-control package; kept, but **not wired into the terminal flow** of this fork
- **[Happy App Logs](packages/happy-app-logs)** — Logging helper
- **[Codium](packages/codium)** — Bundled editor

## Tracking upstream

This fork tracks `slopus/happy` **selectively** — bug fixes, protocol/wire upgrades, dependency bumps — rather than wholesale, because upstream continues toward the agent direction this fork moves away from. Rebasing the whole branch onto `origin/main` tends to reintroduce removed agent code, so upstream changes are cherry-picked.

## 📚 Documentation & Contributing

- **[Internal docs](docs/README.md)** — Protocol, backend, CLI architecture, deployment
- **[Contributing guide](docs/CONTRIBUTING.md)**
- Upstream docs site: <https://happy.engineering/docs/>

## License

MIT License — see [LICENSE](LICENSE). This fork inherits the upstream license and attribution.
