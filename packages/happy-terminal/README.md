# Happy Terminal - WASM Build

Builds the Rust terminal model to WASM and copies output to the app assets.

## Prerequisites

- Rust toolchain with `wasm32-unknown-unknown` target
- `wasm-pack` (`cargo install wasm-pack`)

## Build

```bash
cd packages/happy-terminal
wasm-pack build --target web --out-dir pkg

# Copy to app assets
powershell -Command "
  `$wasm = [Convert]::ToBase64String([IO.File]::ReadAllBytes('pkg/happy_terminal_bg.wasm'));
  `$wasm | Set-Content '../happy-app/assets/terminal/terminal-wasm.txt' -NoNewline
"

# Copy JS glue + types
copy pkg\happy_terminal.js ..\happy-app\assets\terminal\happy_terminal.js
copy pkg\happy_terminal.d.ts ..\happy-app\sources\-session\terminal\skia\happy_terminal.d.ts
```
