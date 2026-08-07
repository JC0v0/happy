# Happy App Design System Rules

These rules are enforced mechanically by `sources/designLint.test.ts` (vitest).
Run `pnpm --filter happy-app test -- --run sources/designLint.test.ts` to check.

## Color

- Component code never hardcodes hex colors. Use semantic tokens:
  `theme.semantic.textPrimary / textSecondary / textMuted / surface / surfaceMuted / border / focus / status.*`.
- Legacy `theme.colors.*` keys are allowed only where a semantic equivalent does
  not exist yet (e.g. `textDestructive`, `status.*`). New code uses `theme.semantic.*`.
- Allowlisted palette-owning files (art/syntax/QR/HTML domains):
  - `sources/app/+html.tsx` — static HTML shell
  - `sources/app/_layout.tsx` — Android notification-channel LED colors (platform config)
  - `sources/components/Avatar*.tsx` — generated avatar art ramps
  - `sources/components/CodeEditor.web.tsx` — syntax highlighting theme
  - `sources/components/FileIcon.tsx` — file-type icon palette
  - `sources/components/qr/QRCode*.tsx` — QR codes need literal black/white
  - `sources/components/markdown/MermaidRenderer.tsx` — diagram canvas + inline HTML
  - `sources/-session/terminal/SessionTerminalView.tsx` — colors injected into the
    terminal WebView as a JS string (cannot read theme tokens at runtime)
- `sources/app/(app)/dev/**` is the design-system sandbox and is exempt.

## Icons

- One icon family: `Ionicons` (`@expo/vector-icons`). No hand-rolled SVG paths.
- Icon color is always a theme token, never a hex literal.
  - Settings/navigation rows: `theme.semantic.focus` (single accent).
  - Neutral info icons: `theme.semantic.textSecondary`.
  - Status icons (online/offline/error) may use `theme.semantic.status.*` because
    the color IS the information.
- Icon sizes: 24 in list rows, 20 for inline actions, 15-18 in compact toolbars.

## Shape (corner radius)

One scale, defined in `semanticGeometry.radius` (`sources/themeSemantics.ts`):

| Token | Value | Use |
|---|---|---|
| `structural` | 0 | Cards, groups, sheets, page regions |
| `compact` | 2 | Small chips, selected segments |
| `interactive` | 4 | Buttons, inputs, menu rows |
| `pill` | 999 | Avatars, status dots, circular badges |

- Literals `0 | 2 | 4 | 999` are accepted by the lint (they match the scale),
  but new code should reference `theme.geometry.radius.*`.
- No other radius values. No squircles (20), no 8/12/16 cards.

## Typography

- Page-level text uses `components/ui/text.tsx` variants (`display`, `headline`,
  `heading`, `title`, `subtitle`, `default`, `muted`, `description`, `small`,
  `label`, `mono`, `xs`), which map to `TypeScale` in `constants/Typography.ts`.
- Screens (`sources/app/**`) never set a raw `fontSize >= 17` — page titles and
  state headers must come from the variant system. Body-scale text (<= 16) may
  still use literals inside components.
- Font families: IBM Plex Sans (default), IBM Plex Mono (code/paths/IDs),
  Bricolage Grotesque (logo only).

## Elevation

The app is flat: `elevation` 0 and transparent shadows everywhere
(locked by `themeSemantics.test.ts`). Do not add `shadow*`/`elevation` props;
separate surfaces with hairline borders (`StyleSheet.hairlineWidth`) instead.
