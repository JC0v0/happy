const fs = require("fs");
const wasm = require("./pkg/happy_terminal.js");

const wasmBuffer = fs.readFileSync("./pkg/happy_terminal_bg.wasm");
const instance = wasm.initSync({ module: wasmBuffer });

function getMem() { return new Uint8Array(instance.memory.buffer); }

const term = instance.terminal_new(40, 5);
console.log("Term ptr:", term, "cols:", instance.terminal_cols(term));

// Write ANSI: green "Hello " red "World!" + CRLF + bold "Bold"
const data = "\x1b[32mHello \x1b[31mWorld!\x1b[0m\r\n\x1b[1mBold\x1b[0m";
const buf = Buffer.from(data, "utf-8");
const ptr = instance.alloc(buf.length);
getMem().set(buf, ptr);
instance.terminal_write(term, ptr, buf.length);

// Render
const jsonPtr = instance.terminal_render(term);
const mem = getMem();
let len = 0;
while (mem[jsonPtr + len] !== 0) len++;
const json = Buffer.from(mem.slice(jsonPtr, jsonPtr + len)).toString("utf-8");
instance.terminal_free_string(jsonPtr);

const p = JSON.parse(json);
console.log("Rows:", p.rows_count, "Cols:", p.cols);
p.rows.forEach((r, i) => {
    const txt = r.cells.map(c => c.ch).join("");
    const c = r.cells[0];
    console.log("  [" + i + "] '" + txt + "' fg=" + c.fg.toString(16) + " bg=" + c.bg.toString(16));
});

instance.terminal_free(term);
