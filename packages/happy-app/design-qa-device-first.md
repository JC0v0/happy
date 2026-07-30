# Device-first OpenCode UI — Design QA

Date: 2026-07-29

## Evidence

- Web phone, 390 × 844: `qa/device-first/unauth-phone.png`
- Web wide, 1280 × 900: `qa/device-first/unauth-wide.png`
- Deterministic fixture surface, 1280 × 900: `qa/device-first/fixtures-wide.png`
- Deterministic fixture surface, 390 × 844: `qa/device-first/fixtures-phone.png`
- Runtime: local Expo development server at `http://127.0.0.1:8081`
- Browser: Chromium controlled with `agent-browser 0.33.1`

The browser run produced no page errors. Console output contained only the known Expo web notification-listener warning and React Native Web `pointerEvents` deprecation warning.

## Reproducible state matrix

| Surface/state | Setup | Evidence |
| --- | --- | --- |
| Unauthenticated phone | Deep link `/`, viewport 390 × 844 | Browser screenshot |
| Unauthenticated wide | Deep link `/`, viewport 1280 × 900 | Browser screenshot |
| Loading | `loading` in `/dev/device-first-qa` | Pure production device-home projection |
| Transport error/cached devices | `transport-error` fixture | Pure production device-home projection |
| Mixed online/offline | `mixed-presence` fixture | Pure production device-home projection |
| Empty workspace | `empty-workspace` fixture | Pure production workspace projection |
| Deleted session | `deleted-session` fixture | Inert route-state projection |
| Unsupported legacy session | `unsupported-session` fixture | Inert route-state projection |
| Operation result | `operation-result` fixture | Inert success/error result projection |
| Terminal RAW/BLOCKS | Focused terminal Vitest directory | 69 characterization tests |
| Width boundary | `responsiveLayout.test.ts` at 799/800 and narrow-tablet/wide-phone values | Pure layout test |
| Session Back | Workspace, direct link, refresh, wrong parent, missing metadata | `deviceNavigation.test.ts` |

The fixture route is read-only, imports no production operation module, and redirects to `/` in production unless the existing developer-tools gate is enabled.

## Theme, typography, and accessibility

- Semantic light/dark roles have key parity and WCAG text contrast tests.
- Terminal colors are owned by a separate stable palette and have high-contrast tests.
- Body and Chinese copy use IBM Plex Sans; paths, versions, hostnames, status labels, and IDs use IBM Plex Mono.
- Structural regions are square and flat; interactive controls use a restrained 4 px radius and at least 40–44 px targets.
- Device status is expressed with text plus a 3–4 px rail, never color alone.
- Offline disclosure exposes `expanded` state and a localized count.
- Narrow layouts expose inline Back. Wide layouts use the persistent device sidebar and browser history controls.

## Interaction verification

- Device rows only open a workspace; they never spawn immediately.
- Workspace launch always requests `agent: terminal`, refreshes sessions, and performs one navigation on success.
- A session uses real Back only when the previous route is its own device workspace. Direct links and refreshes replace to the workspace, or `/` when machine metadata is missing.
- Settings, language, account, appearance, features, terminal linking, and server configuration remain reachable without a bottom tab.
- RAW alternate-buffer touch scrolling stays local and does not request BLOCKS mode.
- The terminal characterization suite covers mode persistence, attach ordering, transcript parsing, history, shortcuts, modifiers, shared grid, and touch scrolling.

## Findings

1. P1: Physical tablet detection controlled navigation, hiding Back on narrow iPads and leaving tablet index blank. Fixed with an 800 px width model.
2. P1: Session Back could return to an unrelated route after direct entry. Fixed with a canonical machine-parent resolver and one mutation adapter.
3. P1: RAW TUI scrolling could switch to BLOCKS. The fix is preserved and covered by eight touch-scroll tests.
4. P2: Command palette and several overlays had hard-coded light colors, large radii, and decorative shadows. Replaced with semantic surfaces, hairline borders, and flat elevation.
5. P2: Phone settings depended on the removed bottom tab header for server access. Added stable language and server entries to Settings.

No unresolved P0, P1, or P2 findings remain in the tested and deterministic states. Authenticated live-device visual evidence depends on a real account/device connection; its behavior is covered by the same pure projections and the locally connected mobile flow.

## Automated gates

- `pnpm --filter happy-app typecheck`
- `pnpm --filter happy-app test -- --run`
- `pnpm --filter happy-app test -- --run sources/-session/terminal`
- `git diff --check`
