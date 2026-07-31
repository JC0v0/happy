# Happy Terminal - WASM Build

Builds the Rust terminal model to WASM and copies it to the app assets as a
base64 text file. The app decodes and instantiates it at runtime
(`useSkiaTerminal`). The crate uses plain `#[no_mangle]` exports — no
wasm-bindgen / wasm-pack glue — so a stock `cargo` is all you need.

## Prerequisites

- Rust toolchain with the `wasm32-unknown-unknown` target:
  `rustup target add wasm32-unknown-unknown`

## Build

```bash
# Compile the WASM module
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path packages/happy-terminal/Cargo.toml

# Repack it as base64 into the app assets (strip newlines — Metro serves it raw)
base64 -i packages/happy-terminal/target/wasm32-unknown-unknown/release/happy_terminal.wasm \
  | tr -d '\n' > packages/happy-app/assets/terminal/terminal-wasm.txt
```

On Windows PowerShell the repack step is:

```powershell
$wasm = [Convert]::ToBase64String([IO.File]::ReadAllBytes('target/wasm32-unknown-unknown/release/happy_terminal.wasm'))
$wasm | Set-Content '../happy-app/assets/terminal/terminal-wasm.txt' -NoNewline
```
