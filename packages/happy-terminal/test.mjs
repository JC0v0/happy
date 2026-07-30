const { default: init, terminal_new, terminal_write, terminal_render, terminal_free, terminal_free_string, terminal_clear } = require("./pkg/happy_terminal.js");

async function test() {
    await init();
    
    const term = terminal_new(40, 5);
    console.log("Created terminal:", term, "cols:", require("./pkg/happy_terminal.js").terminal_cols(term));
    
    // Write some ANSI content
    const data = "\x1b[32mHello \x1b[31mWorld!\x1b[0m\r\n\x1b[1mBold text\x1b[0m";
    terminal_write(term, data);
    
    // Read back the JSON
    const jsPtr = terminal_render(term);
    const mem = new Uint8Array(require("./pkg/happy_terminal.js").memory.buffer);
    let len = 0;
    while (mem[jsPtr + len] !== 0) len++;
    const json = new TextDecoder().decode(mem.slice(jsPtr, jsPtr + len));
    terminal_free_string(jsPtr);
    
    const parsed = JSON.parse(json);
    console.log("Rows:", parsed.rows_count, "Cols:", parsed.cols);
    for (const row of parsed.rows) {
        const text = row.cells.map(c => c.ch).join("");
        console.log("  '" + text + "'");
    }
    
    terminal_free(term);
}

test().catch(console.error);
