# Warp-inspired Terminal Blocks — Design QA

Whole-app redesign QA: [design-qa-device-first.md](./design-qa-device-first.md)

Date: 2026-07-28

## Visual evidence

- Source: `C:/Users/Administrator/AppData/Local/Temp/warp-ui-references/warp-docs-blocks.webp` (official Warp Blocks documentation image, 1347 × 880).
- Implementation, full state: `C:/Users/Administrator/AppData/Local/Temp/warp-ui-references/happy-blocks-implementation-desktop-v1.jpg` (2560 × 1215, DPR 1).
- Implementation, selected long-output state: `C:/Users/Administrator/AppData/Local/Temp/warp-ui-references/happy-blocks-implementation-focused-v3.jpg` (2560 × 1215, DPR 1).
- Side-by-side final comparison: `C:/Users/Administrator/AppData/Local/Temp/warp-ui-references/warp-vs-happy-blocks-final-qa.jpg`.

The source and implementation were opened together in one comparison image. Happy intentionally keeps its purple focus color and bottom shortcut dock while matching Warp's semantic command/output grouping, quiet dark chrome, selected-block treatment, sticky command headers, and progressive actions.

## States inspected

- Default Blocks mode and persistent Blocks/RAW preference.
- Selected and unselected blocks.
- Success, non-zero exit, empty output, waiting, and long output.
- Expanded and collapsed output.
- Copy command, copy output, rerun, favorite, and RAW actions.
- Searchable local history and favorite synchronization.
- Alternate-screen/TUI hint and RAW fallback.
- Scroll-follow, scroll-away, and “latest” return behavior.
- Reload/attach reconstruction from structured terminal metadata.

## Responsive and accessibility checks

- The shared React Native `SectionList` implementation is used by web and native; block content is vertical and does not require horizontal scrolling.
- The selected action row occupies 290 points including padding, fitting a 320-point content width; the shortcut strip is horizontally scrollable.
- Native keeps the existing `<= 480` phone font breakpoint, safe-area padding, keyboard avoidance, and touch scroll bridge.
- Command output remains selectable; icon-only controls have semantic labels and button roles.
- Nested interactive elements discovered in the first browser pass were removed. A fresh reload produced no React or application errors.
- The Chrome automation adapter reports its fixed 2560 × 1215 capture surface even when the host window is narrow, so native phone width was verified structurally and through the shared component/type path rather than claimed as a separate browser screenshot.

## Findings and fixes

1. P1 behavior/content: PowerShell occasionally returned a partially duplicated local echo (`echecho ...`). The transcript normalizer now recognizes and removes that shell echo; a regression test covers it.
2. P1 accessibility: the collapse control was nested inside the block selection button on web. The header now uses sibling selection and collapse buttons; the React nested-button error is gone.
3. P2 fidelity: the selected accent stopped at the command header. The accent and selected surface now continue through the output, preserving Warp's block boundary.
4. P2 navigation: long output needed an explicit return path after scrolling away. The floating “latest” control was exercised with 80 output lines and returned to the live edge.
5. P1 cross-client TUI interaction: touch and wheel gestures in an alternate buffer were being converted into PTY input, so scrolling one client changed every connected client. Interactive-buffer gestures are now intercepted locally and open the per-client Blocks record view; no wheel or cursor sequence is sent to the shared PTY.
6. P1 mobile keyboard interaction: RAW previously retained the outer command input, TUI focus was deferred past the trusted iOS touch event, and blank taps always refocused xterm. RAW now hides the outer input; cursor-near taps focus synchronously, while taps away from the TUI cursor blur xterm and dismiss the native keyboard.
7. P2 mobile terminal ergonomics: advanced keys were limited to the primary shortcut strip. A dedicated, scrollable key sheet now exposes navigation, editing, control, and F1–F12 sequences without crowding the always-visible controls.
8. P1 modifier behavior: Ctrl was only available as fixed shortcuts. A standalone, visibly armed Ctrl latch now waits without emitting data, combines with the next soft-keyboard or shortcut input, supports letters, terminal navigation, and conventional digit aliases, then automatically disarms.
9. P1 collaborative TUI model: all devices now drive one session-wide PTY, so RAW commands, keys, mouse input, and TUI state are shared. Client scrollback remains local. Each device reports its viewport, but only the device that most recently sent input controls the shared PTY grid; resizing a passive viewer never reflows another client.
10. P1 RAW record parity: commands submitted directly through PowerShell PSReadLine now emit a hidden OSC command marker. The CLI turns that marker into the same structured lifecycle events as the command dock, so RAW commands appear in the shared Blocks feed without duplicating dock-submitted commands.
11. P1 shared TUI rendering: fitting each xterm independently produced different logical column counts, so the same PTY stream wrapped differently on desktop and mobile. Grid changes are now sequenced ahead of PTY redraw output, every renderer adopts the same controller-owned columns/rows, and each device only adjusts its local font scale. Browser verification moved cleanly from 287x68 desktop to 49x44 at 390x844 and back, with no horizontal page overflow or prompt corruption.

No unresolved P0, P1, or P2 findings remain.

## Interaction and console verification

- Executed `echo warp-block-qa-0728`; one completed block appeared with normalized output.
- Executed a non-zero command and verified `EXIT 7` plus the empty-output state.
- Executed an 80-line command and verified the first/last lines, sticky header, scroll-away state, and latest jump.
- Switched Blocks → RAW → Blocks and confirmed the same PTY output remained available.
- Opened history, favorited a block, and confirmed the history item changed to `Remove favorite`.
- Reloaded the route and confirmed Blocks restored; fresh browser logs contained no errors. Remaining warnings are pre-existing Expo web notification and React Native Web `pointerEvents` notices.

## Engineering verification

- `pnpm --filter happy-app test -- --run sources/-session/terminal`: 11 files, 65 tests passed.
- `pnpm --filter happy-app typecheck`: passed.
- `pnpm --filter happy test -- --run src/terminal/terminalInstance.test.ts src/terminal/terminalAttentionDetector.test.ts src/terminal/terminalShellIntegration.test.ts`: 3 files, 15 tests passed.
- Real `node-pty` PowerShell check: RAW submission emitted both `OSC 133;C` command-start and `OSC 133;D;0` completion markers.
- `git diff --check` for the terminal implementation and persistence files: passed (line-ending notices only).

final result: passed
