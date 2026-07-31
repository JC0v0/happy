//! Happy Terminal - WASM terminal model.
//! ANSI parser + grid screen buffer. Uses #[no_mangle] exports (no wasm-bindgen).

mod cell;
mod grid;

use cell::{ATTR_BOLD, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_REVERSE, ATTR_DIM, ATTR_STRIKE, DEFAULT_FG, DEFAULT_BG};
use grid::{Screen, Row};
use std::ffi::CString;

const ANSI_PALETTE: [(u8, u8, u8); 18] = [
    (0x0C, 0x0C, 0x0C), (0xC5, 0x0F, 0x1F), (0x13, 0xA1, 0x0E), (0xC1, 0x9C, 0x00),
    (0x00, 0x37, 0xDA), (0x88, 0x17, 0x98), (0x3A, 0x96, 0xDD), (0xCC, 0xCC, 0xCC),
    (0x76, 0x76, 0x76), (0xE7, 0x48, 0x56), (0x16, 0xC6, 0x0C), (0xF9, 0xF1, 0xA5),
    (0x3B, 0x78, 0xFF), (0xB4, 0x00, 0x9E), (0x61, 0xD6, 0xD6), (0xF2, 0xF2, 0xF2),
    (0xF4, 0xF0, 0xEF), (0x11, 0x10, 0x10),
];

#[derive(serde::Serialize)]
struct CellData {
    ch: String,
    fg: u32,
    bg: u32,
    attrs: u8,
}

#[derive(serde::Serialize)]
struct RowData {
    cells: Vec<CellData>,
}

#[derive(serde::Serialize)]
struct RenderData {
    rows: Vec<RowData>,
    cursor_row: usize,
    cursor_col: usize,
    cursor_visible: bool,
    cols: usize,
    rows_count: usize,
    /// Number of rows held in scrollback history (above the viewport).
    scrollback_count: usize,
}

fn color_rgb(idx: u8) -> u32 {
    let i = if (idx as usize) < ANSI_PALETTE.len() { idx as usize } else { DEFAULT_FG as usize };
    let (r, g, b) = ANSI_PALETTE[i];
    ((r as u32) << 16) | ((g as u32) << 8) | (b as u32)
}

fn param(params: &vte::Params, idx: usize, default: u16) -> u16 {
    params.iter().nth(idx).and_then(|p| p.first()).copied().unwrap_or(default)
}

pub struct Terminal {
    screen: Screen,
    cursor_row: usize,
    cursor_col: usize,
    saved_cursor_row: usize,
    saved_cursor_col: usize,
    cur_fg: u8,
    cur_bg: u8,
    cur_attrs: u8,
    cursor_visible: bool,
}

// ── #[no_mangle] exports ──────────────────────────────────────────────

/// Create a new terminal. Returns a pointer (Box). JS owns the pointer and
/// must call terminal_free to release it.
#[no_mangle]
pub extern "C" fn terminal_new(cols: u32, rows: u32) -> *mut Terminal {
    let t = Terminal {
        screen: Screen::new(cols as usize, rows as usize, 5000),
        cursor_row: 0, cursor_col: 0,
        saved_cursor_row: 0, saved_cursor_col: 0,
        cur_fg: DEFAULT_FG, cur_bg: DEFAULT_BG,
        cur_attrs: 0, cursor_visible: true,
    };
    Box::into_raw(Box::new(t))
}

/// Free the terminal.
#[no_mangle]
pub unsafe extern "C" fn terminal_free(ptr: *mut Terminal) {
    if ptr.is_null() { return; }
    drop(Box::from_raw(ptr));
}

/// Write UTF-8 data to the terminal.
#[no_mangle]
pub unsafe extern "C" fn terminal_write(ptr: *mut Terminal, data_ptr: *const u8, data_len: u32) {
    if ptr.is_null() { return; }
    let t = &mut *ptr;
    let slice = std::slice::from_raw_parts(data_ptr, data_len as usize);
    if let Ok(s) = std::str::from_utf8(slice) {
        let mut parser = vte::Parser::new();
        for byte in s.bytes() {
            parser.advance(t, byte);
        }
    }
}

/// Resize the terminal grid.
#[no_mangle]
pub unsafe extern "C" fn terminal_resize(ptr: *mut Terminal, cols: u32, rows: u32) {
    if ptr.is_null() { return; }
    let t = &mut *ptr;
    t.screen.resize(cols as usize, rows as usize);
    if t.cursor_row >= rows as usize { t.cursor_row = (rows as usize).saturating_sub(1); }
    if t.cursor_col >= cols as usize { t.cursor_col = (cols as usize).saturating_sub(1); }
}

/// Render to JSON string. Returns a malloc'd C string; JS must call terminal_free_string.
#[no_mangle]
pub unsafe extern "C" fn terminal_render(ptr: *mut Terminal) -> *mut std::ffi::c_char {
    if ptr.is_null() { return std::ptr::null_mut(); }
    let t = &*ptr;

    let rows: Vec<RowData> = t.screen.rows.iter().map(|row| {
        let cells: Vec<CellData> = row.cells.iter().map(|cell| {
            let (fg_idx, bg_idx) = if cell.has_attr(ATTR_REVERSE) { (cell.bg, cell.fg) } else { (cell.fg, cell.bg) };
            CellData { ch: cell.ch.to_string(), fg: color_rgb(fg_idx), bg: color_rgb(bg_idx), attrs: cell.attrs }
        }).collect();
        RowData { cells }
    }).collect();

    let data = RenderData {
        rows,
        cursor_row: t.cursor_row,
        cursor_col: t.cursor_col,
        cursor_visible: t.cursor_visible,
        cols: t.screen.cols,
        rows_count: t.screen.rows_count,
        scrollback_count: t.screen.scrollback.len(),
    };

    let json = serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string());
    CString::new(json).unwrap_or_else(|_| CString::new("{}").unwrap()).into_raw()
}

/// Number of scrollback rows currently retained.
#[no_mangle]
pub unsafe extern "C" fn terminal_scrollback_len(ptr: *mut Terminal) -> u32 {
    if ptr.is_null() { return 0; }
    (*ptr).screen.scrollback.len() as u32
}

/// Render a viewport `scroll_offset` rows above the live edge.
///
/// `scroll_offset = 0` renders the live viewport (identical to terminal_render).
/// `scroll_offset = k` shifts the window up by k rows into scrollback history.
/// The cursor is hidden whenever the view is scrolled away from the live edge.
/// Returns a malloc'd C string; JS must call terminal_free_string.
#[no_mangle]
pub unsafe extern "C" fn terminal_render_scrolled(ptr: *mut Terminal, scroll_offset: u32) -> *mut std::ffi::c_char {
    if ptr.is_null() { return std::ptr::null_mut(); }
    let t = &*ptr;
    let sb = t.screen.scrollback.len();
    let off = (scroll_offset as usize).min(sb);

    let to_row_data = |row: &Row| RowData {
        cells: row.cells.iter().map(|cell| {
            let (fg_idx, bg_idx) = if cell.has_attr(ATTR_REVERSE) { (cell.bg, cell.fg) } else { (cell.fg, cell.bg) };
            CellData { ch: cell.ch.to_string(), fg: color_rgb(fg_idx), bg: color_rgb(bg_idx), attrs: cell.attrs }
        }).collect(),
    };

    let rows: Vec<RowData> = (0..t.screen.rows_count)
        .map(|i| {
            // idx < 0 reaches into scrollback, idx >= 0 into the live viewport.
            let idx = i as isize - off as isize;
            if idx < 0 {
                to_row_data(&t.screen.scrollback[sb + idx as usize])
            } else {
                to_row_data(&t.screen.rows[idx as usize])
            }
        })
        .collect();

    let data = RenderData {
        rows,
        cursor_row: t.cursor_row,
        cursor_col: t.cursor_col,
        cursor_visible: t.cursor_visible && off == 0,
        cols: t.screen.cols,
        rows_count: t.screen.rows_count,
        scrollback_count: sb,
    };
    let json = serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string());
    CString::new(json).unwrap_or_else(|_| CString::new("{}").unwrap()).into_raw()
}

/// Free a string returned by terminal_render.
#[no_mangle]
pub unsafe extern "C" fn terminal_free_string(ptr: *mut std::ffi::c_char) {
    if ptr.is_null() { return; }
    drop(CString::from_raw(ptr));
}

/// Get the ANSI palette as a flat JSON array of RGB ints.
#[no_mangle]
pub unsafe extern "C" fn terminal_palette() -> *mut std::ffi::c_char {
    let arr: Vec<u32> = ANSI_PALETTE.iter().map(|(r, g, b)| {
        ((*r as u32) << 16) | ((*g as u32) << 8) | (*b as u32)
    }).collect();
    let json = serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string());
    CString::new(json).unwrap_or_else(|_| CString::new("[]").unwrap()).into_raw()
}

/// Clear the terminal.
#[no_mangle]
pub unsafe extern "C" fn terminal_clear(ptr: *mut Terminal) {
    if ptr.is_null() { return; }
    let t = &mut *ptr;
    t.screen.clear();
    t.cursor_row = 0;
    t.cursor_col = 0;
}

/// Get number of columns.
#[no_mangle]
pub unsafe extern "C" fn terminal_cols(ptr: *mut Terminal) -> u32 {
    if ptr.is_null() { return 0; }
    (*ptr).screen.cols as u32
}

/// Get number of rows.
#[no_mangle]
pub unsafe extern "C" fn terminal_rows(ptr: *mut Terminal) -> u32 {
    if ptr.is_null() { return 0; }
    (*ptr).screen.rows_count as u32
}

// ── Memory allocator stub (required for WASM) ─────────────────────────

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    drop(Vec::from_raw_parts(ptr, 0, size));
}

// ── ANSI parsing ──────────────────────────────────────────────────────

impl vte::Perform for Terminal {
    fn print(&mut self, ch: char) {
        if self.cursor_col >= self.screen.cols {
            self.cursor_col = 0;
            self.line_feed();
        }
        if let Some(cell) = self.screen.cell_mut(self.cursor_row, self.cursor_col) {
            cell.ch = ch;
            cell.fg = self.cur_fg;
            cell.bg = self.cur_bg;
            cell.attrs = self.cur_attrs;
        }
        self.cursor_col += 1;
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\r' => self.cursor_col = 0,
            b'\n' | 0x0B | 0x0C => self.line_feed(),
            0x08 => { if self.cursor_col > 0 { self.cursor_col -= 1; } }
            b'\t' => {
                let next = ((self.cursor_col / 8) + 1) * 8;
                self.cursor_col = next.min(self.screen.cols.saturating_sub(1));
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &vte::Params, _intermediates: &[u8], _ignore: bool, c: char) {
        match c {
            'm' => self.handle_sgr(params),
            'A' => { let n = param(params, 0, 1) as usize; self.cursor_row = self.cursor_row.saturating_sub(n); }
            'B' => { let n = param(params, 0, 1) as usize; self.cursor_row = (self.cursor_row + n).min(self.screen.rows_count.saturating_sub(1)); }
            'C' => { let n = param(params, 0, 1) as usize; self.cursor_col = (self.cursor_col + n).min(self.screen.cols.saturating_sub(1)); }
            'D' => { let n = param(params, 0, 1) as usize; self.cursor_col = self.cursor_col.saturating_sub(n); }
            'E' => { let n = param(params, 0, 1) as usize; self.cursor_row = (self.cursor_row + n).min(self.screen.rows_count.saturating_sub(1)); self.cursor_col = 0; }
            'F' => { let n = param(params, 0, 1) as usize; self.cursor_row = self.cursor_row.saturating_sub(n); self.cursor_col = 0; }
            'G' => { let n = param(params, 0, 1) as usize; self.cursor_col = (n.saturating_sub(1)).min(self.screen.cols.saturating_sub(1)); }
            'H' | 'f' => {
                let row = param(params, 0, 1) as usize;
                let col = param(params, 1, 1) as usize;
                self.cursor_row = (row.saturating_sub(1)).min(self.screen.rows_count.saturating_sub(1));
                self.cursor_col = (col.saturating_sub(1)).min(self.screen.cols.saturating_sub(1));
            }
            'J' => {
                match param(params, 0, 0) {
                    0 => {
                        for col in self.cursor_col..self.screen.cols {
                            if let Some(cell) = self.screen.cell_mut(self.cursor_row, col) { cell.reset(); }
                        }
                        for row in (self.cursor_row + 1)..self.screen.rows_count { self.screen.rows[row].clear(); }
                    }
                    1 => {
                        for row in 0..self.cursor_row { self.screen.rows[row].clear(); }
                        for col in 0..=self.cursor_col {
                            if let Some(cell) = self.screen.cell_mut(self.cursor_row, col) { cell.reset(); }
                        }
                    }
                    _ => self.screen.clear(),
                }
            }
            'K' => {
                match param(params, 0, 0) {
                    0 => { for col in self.cursor_col..self.screen.cols { if let Some(cell) = self.screen.cell_mut(self.cursor_row, col) { cell.reset(); } } }
                    1 => { for col in 0..=self.cursor_col { if let Some(cell) = self.screen.cell_mut(self.cursor_row, col) { cell.reset(); } } }
                    _ => { self.screen.rows[self.cursor_row].clear(); }
                }
            }
            'S' => { let n = param(params, 0, 1) as usize; self.screen.scroll_up_proper(n); }
            'T' => {
                let n = param(params, 0, 1) as usize;
                for _ in 0..n {
                    self.screen.rows.pop();
                    self.screen.rows.insert(0, Row::new(self.screen.cols));
                }
            }
            's' => { self.saved_cursor_row = self.cursor_row; self.saved_cursor_col = self.cursor_col; }
            'u' => { self.cursor_row = self.saved_cursor_row; self.cursor_col = self.saved_cursor_col; }
            _ => {}
        }
    }

    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {}
    fn hook(&mut self, _params: &vte::Params, _intermediates: &[u8], _ignore: bool, _c: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
}

impl Terminal {
    fn line_feed(&mut self) {
        if self.cursor_row + 1 >= self.screen.rows_count {
            self.screen.scroll_up_proper(1);
        } else {
            self.cursor_row += 1;
        }
    }

    fn handle_sgr(&mut self, params: &vte::Params) {
        if params.is_empty() {
            self.cur_fg = DEFAULT_FG; self.cur_bg = DEFAULT_BG; self.cur_attrs = 0;
            return;
        }
        let mut iter = params.iter();
        while let Some(param) = iter.next() {
            let v = param[0];
            match v {
                0 => { self.cur_fg = DEFAULT_FG; self.cur_bg = DEFAULT_BG; self.cur_attrs = 0; }
                1 => self.cur_attrs |= ATTR_BOLD,
                2 => self.cur_attrs |= ATTR_DIM,
                3 => self.cur_attrs |= ATTR_ITALIC,
                4 => self.cur_attrs |= ATTR_UNDERLINE,
                7 => self.cur_attrs |= ATTR_REVERSE,
                9 => self.cur_attrs |= ATTR_STRIKE,
                22 => self.cur_attrs &= !(ATTR_BOLD | ATTR_DIM),
                23 => self.cur_attrs &= !ATTR_ITALIC,
                24 => self.cur_attrs &= !ATTR_UNDERLINE,
                27 => self.cur_attrs &= !ATTR_REVERSE,
                29 => self.cur_attrs &= !ATTR_STRIKE,
                30..=37 => self.cur_fg = (v - 30) as u8,
                38 => {
                    if let Some(next) = iter.next() {
                        match next[0] {
                            5 => { if let Some(idx) = iter.next() { self.cur_fg = if idx[0] < 16 { idx[0] as u8 } else { DEFAULT_FG }; } }
                            2 => { iter.next(); iter.next(); iter.next(); }
                            _ => {}
                        }
                    }
                }
                39 => self.cur_fg = DEFAULT_FG,
                40..=47 => self.cur_bg = (v - 40) as u8,
                48 => {
                    if let Some(next) = iter.next() {
                        match next[0] {
                            5 => { if let Some(idx) = iter.next() { self.cur_bg = if idx[0] < 16 { idx[0] as u8 } else { DEFAULT_BG }; } }
                            2 => { iter.next(); iter.next(); iter.next(); }
                            _ => {}
                        }
                    }
                }
                49 => self.cur_bg = DEFAULT_BG,
                90..=97 => self.cur_fg = (v - 90 + 8) as u8,
                100..=107 => self.cur_bg = (v - 100 + 8) as u8,
                _ => {}
            }
        }
    }
}
