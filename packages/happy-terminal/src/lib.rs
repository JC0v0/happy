//! Happy Terminal - WASM terminal model.
//! ANSI parser + grid screen buffer. Uses #[no_mangle] exports (no wasm-bindgen).

mod cell;
mod grid;

use cell::{
    ATTR_BOLD, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_REVERSE, ATTR_DIM, ATTR_STRIKE,
    DEFAULT_FG, DEFAULT_BG, Color,
};
use grid::{Screen, Row};
use std::ffi::CString;

const ANSI_PALETTE: [(u8, u8, u8); 18] = [
    (0x0C, 0x0C, 0x0C), (0xC5, 0x0F, 0x1F), (0x13, 0xA1, 0x0E), (0xC1, 0x9C, 0x00),
    (0x00, 0x37, 0xDA), (0x88, 0x17, 0x98), (0x3A, 0x96, 0xDD), (0xCC, 0xCC, 0xCC),
    (0x76, 0x76, 0x76), (0xE7, 0x48, 0x56), (0x16, 0xC6, 0x0C), (0xF9, 0xF1, 0xA5),
    (0x3B, 0x78, 0xFF), (0xB4, 0x00, 0x9E), (0x61, 0xD6, 0xD6), (0xF2, 0xF2, 0xF2),
    (0xF4, 0xF0, 0xEF), (0x11, 0x10, 0x10),
];

/// xterm 256-color mapping for palette indices 16..=255 (cube + grayscale).
fn xterm_256_rgb(idx: u8) -> (u8, u8, u8) {
    if idx < 16 {
        return ANSI_PALETTE[idx as usize];
    }
    if idx < 232 {
        let n = idx - 16;
        let r = n / 36;
        let g = (n % 36) / 6;
        let b = n % 6;
        let v = |c: u8| if c == 0 { 0 } else { 55 + c * 40 };
        return (v(r), v(g), v(b));
    }
    let gray = 8 + (idx - 232) * 10;
    (gray, gray, gray)
}

/// Resolve a cell color to a 0xRRGGBB value.
fn color_rgb(color: Color) -> u32 {
    let (r, g, b) = match color {
        Color::Rgb(rgb) => return rgb & 0x00FF_FFFF,
        Color::Palette(idx) => {
            let i = idx as usize;
            if i < ANSI_PALETTE.len() {
                ANSI_PALETTE[i]
            } else {
                xterm_256_rgb(idx)
            }
        }
    };
    ((r as u32) << 16) | ((g as u32) << 8) | (b as u32)
}

#[derive(serde::Serialize)]
struct CellData {
    ch: String,
    fg: u32,
    bg: u32,
    attrs: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<String>,
}

#[derive(serde::Serialize)]
struct RowData {
    cells: Vec<CellData>,
}

#[derive(serde::Serialize, Clone, Copy)]
struct ModesData {
    active_alt: bool,
    bracketed_paste: bool,
    auto_wrap: bool,
    insert_mode: bool,
    cursor_visible: bool,
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
    /// Terminal mode flags the client needs to make input/rendering decisions.
    modes: ModesData,
}

#[derive(serde::Serialize, Clone)]
struct OscEvent {
    #[serde(rename = "type")]
    kind: &'static str,
    value: String,
}

fn param(params: &vte::Params, idx: usize, default: u16) -> u16 {
    params.iter().nth(idx).and_then(|p| p.first()).copied().unwrap_or(default)
}

pub struct Terminal {
    screen: Screen,
    alt: Screen,
    active_alt: bool,
    cursor_row: usize,
    cursor_col: usize,
    saved_cursor_row: usize,
    saved_cursor_col: usize,
    cur_fg: Color,
    cur_bg: Color,
    cur_attrs: u8,
    cursor_visible: bool,
    auto_wrap: bool,
    insert_mode: bool,
    bracketed_paste: bool,
    last_printed: char,
    links: Vec<String>,
    current_link: Option<u32>,
    pending_osc_events: Vec<OscEvent>,
}

impl Terminal {
    fn new(cols: usize, rows: usize) -> Self {
        let max_scrollback = 5000;
        Self {
            screen: Screen::new(cols, rows, max_scrollback),
            alt: Screen::new(cols, rows, 0),
            active_alt: false,
            cursor_row: 0,
            cursor_col: 0,
            saved_cursor_row: 0,
            saved_cursor_col: 0,
            cur_fg: Color::Palette(DEFAULT_FG),
            cur_bg: Color::Palette(DEFAULT_BG),
            cur_attrs: 0,
            cursor_visible: true,
            auto_wrap: true,
            insert_mode: false,
            bracketed_paste: false,
            last_printed: ' ',
            links: Vec::new(),
            current_link: None,
            pending_osc_events: Vec::new(),
        }
    }

    fn active_screen(&self) -> &Screen {
        if self.active_alt { &self.alt } else { &self.screen }
    }

    fn active_screen_mut(&mut self) -> &mut Screen {
        if self.active_alt { &mut self.alt } else { &mut self.screen }
    }

    /// Reset to initial state (RIS), preserving the grid dimensions.
    fn reset(&mut self) {
        let cols = self.screen.cols;
        let rows = self.screen.rows_count;
        *self = Terminal::new(cols, rows);
    }

    fn feed(&mut self, data: &[u8]) {
        if let Ok(s) = std::str::from_utf8(data) {
            let mut parser = vte::Parser::new();
            for byte in s.bytes() {
                parser.advance(self, byte);
            }
        }
    }

    fn render_data(&self, scroll_offset: usize) -> RenderData {
        let screen = self.active_screen();
        let sb = if self.active_alt { 0 } else { screen.scrollback.len() };
        let off = if self.active_alt { 0 } else { scroll_offset.min(sb) };

        let to_row_data = |row: &Row| RowData {
            cells: row.cells.iter().map(|cell| {
                let (fg, bg) = if cell.has_attr(ATTR_REVERSE) {
                    (color_rgb(cell.bg), color_rgb(cell.fg))
                } else {
                    (color_rgb(cell.fg), color_rgb(cell.bg))
                };
                let link = cell.link.map(|idx| self.links[idx as usize].clone());
                CellData {
                    ch: cell.ch.to_string(),
                    fg,
                    bg,
                    attrs: cell.attrs,
                    link,
                }
            }).collect(),
        };

        let rows: Vec<RowData> = (0..screen.rows_count)
            .map(|i| {
                let idx = i as isize - off as isize;
                if idx < 0 {
                    to_row_data(&screen.scrollback[sb + idx as usize])
                } else {
                    to_row_data(&screen.rows[idx as usize])
                }
            })
            .collect();

        RenderData {
            rows,
            cursor_row: self.cursor_row,
            cursor_col: self.cursor_col,
            cursor_visible: self.cursor_visible && off == 0,
            cols: screen.cols,
            rows_count: screen.rows_count,
            scrollback_count: sb,
            modes: ModesData {
                active_alt: self.active_alt,
                bracketed_paste: self.bracketed_paste,
                auto_wrap: self.auto_wrap,
                insert_mode: self.insert_mode,
                cursor_visible: self.cursor_visible,
            },
        }
    }

    fn line_feed(&mut self) {
        if self.cursor_row == self.active_screen().scroll_bottom {
            let to_scrollback = !self.active_alt && self.active_screen().is_full_screen_scroll();
            self.active_screen_mut().scroll_up_region(1, to_scrollback);
        } else if self.cursor_row + 1 < self.active_screen().rows_count {
            self.cursor_row += 1;
        }
    }

    fn reverse_index(&mut self) {
        if self.cursor_row == self.active_screen().scroll_top {
            self.active_screen_mut().scroll_down_region(1);
        } else if self.cursor_row > 0 {
            self.cursor_row -= 1;
        }
    }

    fn set_scroll_region(&mut self, params: &vte::Params) {
        let has_params = params.iter().count() > 0;
        if !has_params {
            self.active_screen_mut().reset_scroll_region();
        } else {
            let top = param(params, 0, 1) as usize;
            let bottom = param(params, 1, 1) as usize;
            if top == 0 {
                self.active_screen_mut().reset_scroll_region();
            } else {
                self.active_screen_mut().set_scroll_region(top, bottom);
            }
        }
        // Per DECSTBM, the cursor moves to the home position of the region.
        self.cursor_row = self.active_screen().scroll_top;
        self.cursor_col = 0;
    }

    fn enter_alt_screen(&mut self, save_cursor: bool) {
        if self.active_alt {
            return;
        }
        if save_cursor {
            self.saved_cursor_row = self.cursor_row;
            self.saved_cursor_col = self.cursor_col;
        }
        self.alt.clear();
        self.active_alt = true;
        self.cursor_row = 0;
        self.cursor_col = 0;
    }

    fn exit_alt_screen(&mut self, restore_cursor: bool) {
        if !self.active_alt {
            return;
        }
        self.active_alt = false;
        if restore_cursor {
            self.cursor_row = self.saved_cursor_row;
            self.cursor_col = self.saved_cursor_col;
        }
    }

    fn put_char(&mut self, ch: char) {
        let cols = self.active_screen().cols;
        if self.cursor_col >= cols {
            if self.auto_wrap {
                self.cursor_col = 0;
                self.line_feed();
            } else {
                self.cursor_col = cols.saturating_sub(1);
            }
        }
        let row = self.cursor_row;
        let col = self.cursor_col;
        if self.insert_mode {
            self.active_screen_mut().insert_chars(row, col, 1);
        }
        let (fg, bg, attrs, link) = (self.cur_fg, self.cur_bg, self.cur_attrs, self.current_link);
        if let Some(cell) = self.active_screen_mut().cell_mut(row, col) {
            cell.ch = ch;
            cell.fg = fg;
            cell.bg = bg;
            cell.attrs = attrs;
            cell.link = link;
        }
        self.last_printed = ch;
        self.cursor_col += 1;
    }

    fn repeat_last_char(&mut self, n: usize) {
        let ch = self.last_printed;
        if ch == ' ' {
            return;
        }
        for _ in 0..n {
            self.put_char(ch);
        }
    }

    fn cursor_forward_tabs(&mut self, n: usize) {
        let cols = self.active_screen().cols;
        let last = cols.saturating_sub(1);
        for _ in 0..n {
            if self.cursor_col >= last {
                break;
            }
            self.cursor_col = (((self.cursor_col / 8) + 1) * 8).min(last);
        }
    }

    fn cursor_backward_tabs(&mut self, n: usize) {
        for _ in 0..n {
            if self.cursor_col == 0 {
                break;
            }
            self.cursor_col = ((self.cursor_col - 1) / 8) * 8;
        }
    }

    fn set_private_modes(&mut self, params: &vte::Params) {
        match param(params, 0, 0) {
            25 => self.cursor_visible = true,
            7 => self.auto_wrap = true,
            2004 => self.bracketed_paste = true,
            47 | 1047 | 1049 => self.enter_alt_screen(param(params, 0, 0) == 1049),
            _ => {}
        }
    }

    fn reset_private_modes(&mut self, params: &vte::Params) {
        match param(params, 0, 0) {
            25 => self.cursor_visible = false,
            7 => self.auto_wrap = false,
            2004 => self.bracketed_paste = false,
            47 | 1047 | 1049 => self.exit_alt_screen(param(params, 0, 0) == 1049),
            _ => {}
        }
    }

    fn handle_sgr(&mut self, params: &vte::Params) {
        if params.is_empty() {
            self.cur_fg = Color::Palette(DEFAULT_FG);
            self.cur_bg = Color::Palette(DEFAULT_BG);
            self.cur_attrs = 0;
            return;
        }
        let mut iter = params.iter();
        while let Some(param) = iter.next() {
            let v = param[0];
            match v {
                0 => {
                    self.cur_fg = Color::Palette(DEFAULT_FG);
                    self.cur_bg = Color::Palette(DEFAULT_BG);
                    self.cur_attrs = 0;
                }
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
                30..=37 => self.cur_fg = Color::Palette((v - 30) as u8),
                38 => {
                    if let Some(next) = iter.next() {
                        match next[0] {
                            5 => {
                                if let Some(idx) = iter.next() {
                                    self.cur_fg = Color::Palette(idx[0] as u8);
                                }
                            }
                            2 => {
                                if let (Some(r), Some(g), Some(b)) = (iter.next(), iter.next(), iter.next()) {
                                    self.cur_fg = Color::Rgb(
                                        ((r[0] as u32) << 16) | ((g[0] as u32) << 8) | (b[0] as u32),
                                    );
                                }
                            }
                            _ => {}
                        }
                    }
                }
                39 => self.cur_fg = Color::Palette(DEFAULT_FG),
                40..=47 => self.cur_bg = Color::Palette((v - 40) as u8),
                48 => {
                    if let Some(next) = iter.next() {
                        match next[0] {
                            5 => {
                                if let Some(idx) = iter.next() {
                                    self.cur_bg = Color::Palette(idx[0] as u8);
                                }
                            }
                            2 => {
                                if let (Some(r), Some(g), Some(b)) = (iter.next(), iter.next(), iter.next()) {
                                    self.cur_bg = Color::Rgb(
                                        ((r[0] as u32) << 16) | ((g[0] as u32) << 8) | (b[0] as u32),
                                    );
                                }
                            }
                            _ => {}
                        }
                    }
                }
                49 => self.cur_bg = Color::Palette(DEFAULT_BG),
                90..=97 => self.cur_fg = Color::Palette((v - 90 + 8) as u8),
                100..=107 => self.cur_bg = Color::Palette((v - 100 + 8) as u8),
                _ => {}
            }
        }
    }
}

impl vte::Perform for Terminal {
    fn print(&mut self, ch: char) {
        self.put_char(ch);
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\r' => self.cursor_col = 0,
            b'\n' | 0x0B | 0x0C => self.line_feed(),
            0x08 => {
                if self.cursor_col > 0 {
                    self.cursor_col -= 1;
                }
            }
            b'\t' => {
                let next = ((self.cursor_col / 8) + 1) * 8;
                self.cursor_col = next.min(self.active_screen().cols.saturating_sub(1));
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &vte::Params, intermediates: &[u8], _ignore: bool, c: char) {
        let private = intermediates.contains(&b'?');
        match c {
            'h' if private => self.set_private_modes(params),
            'l' if private => self.reset_private_modes(params),
            'h' => {
                if param(params, 0, 0) == 4 {
                    self.insert_mode = true;
                }
            }
            'l' => {
                if param(params, 0, 0) == 4 {
                    self.insert_mode = false;
                }
            }
            'm' => self.handle_sgr(params),
            'A' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_row = self.cursor_row.saturating_sub(n);
            }
            'B' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_row = (self.cursor_row + n)
                    .min(self.active_screen().rows_count.saturating_sub(1));
            }
            'C' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_col = (self.cursor_col + n).min(self.active_screen().cols.saturating_sub(1));
            }
            'D' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_col = self.cursor_col.saturating_sub(n);
            }
            'E' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_row = (self.cursor_row + n)
                    .min(self.active_screen().rows_count.saturating_sub(1));
                self.cursor_col = 0;
            }
            'F' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_row = self.cursor_row.saturating_sub(n);
                self.cursor_col = 0;
            }
            'G' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_col = (n.saturating_sub(1)).min(self.active_screen().cols.saturating_sub(1));
            }
            'H' | 'f' => {
                let row = param(params, 0, 1) as usize;
                let col = param(params, 1, 1) as usize;
                self.cursor_row = (row.saturating_sub(1)).min(self.active_screen().rows_count.saturating_sub(1));
                self.cursor_col = (col.saturating_sub(1)).min(self.active_screen().cols.saturating_sub(1));
            }
            'J' => {
                let (row, col) = (self.cursor_row, self.cursor_col);
                let screen = self.active_screen_mut();
                match param(params, 0, 0) {
                    0 => {
                        for c in col..screen.cols {
                            if let Some(cell) = screen.cell_mut(row, c) {
                                cell.reset();
                            }
                        }
                        for r in (row + 1)..screen.rows_count {
                            screen.rows[r].clear();
                        }
                    }
                    1 => {
                        for r in 0..row {
                            screen.rows[r].clear();
                        }
                        for c in 0..=col {
                            if let Some(cell) = screen.cell_mut(row, c) {
                                cell.reset();
                            }
                        }
                    }
                    _ => screen.clear(),
                }
            }
            'K' => {
                let (row, col) = (self.cursor_row, self.cursor_col);
                let screen = self.active_screen_mut();
                match param(params, 0, 0) {
                    0 => {
                        for c in col..screen.cols {
                            if let Some(cell) = screen.cell_mut(row, c) {
                                cell.reset();
                            }
                        }
                    }
                    1 => {
                        for c in 0..=col {
                            if let Some(cell) = screen.cell_mut(row, c) {
                                cell.reset();
                            }
                        }
                    }
                    _ => screen.rows[row].clear(),
                }
            }
            'S' => {
                let n = param(params, 0, 1) as usize;
                self.active_screen_mut().scroll_up_region(n, false);
            }
            'T' => {
                let n = param(params, 0, 1) as usize;
                self.active_screen_mut().scroll_down_region(n);
            }
            's' => {
                self.saved_cursor_row = self.cursor_row;
                self.saved_cursor_col = self.cursor_col;
            }
            'u' => {
                self.cursor_row = self.saved_cursor_row;
                self.cursor_col = self.saved_cursor_col;
            }
            'L' => {
                let n = param(params, 0, 1) as usize;
                let row = self.cursor_row;
                self.active_screen_mut().insert_lines(row, n);
            }
            'M' => {
                let n = param(params, 0, 1) as usize;
                let row = self.cursor_row;
                self.active_screen_mut().delete_lines(row, n);
            }
            '@' => {
                let n = param(params, 0, 1) as usize;
                let (row, col) = (self.cursor_row, self.cursor_col);
                self.active_screen_mut().insert_chars(row, col, n);
            }
            'P' => {
                let n = param(params, 0, 1) as usize;
                let (row, col) = (self.cursor_row, self.cursor_col);
                self.active_screen_mut().delete_chars(row, col, n);
            }
            'X' => {
                let n = param(params, 0, 1) as usize;
                let (row, col) = (self.cursor_row, self.cursor_col);
                self.active_screen_mut().erase_chars(row, col, n);
            }
            'b' => {
                let n = param(params, 0, 1) as usize;
                self.repeat_last_char(n);
            }
            'd' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_row = (n.saturating_sub(1)).min(self.active_screen().rows_count.saturating_sub(1));
            }
            '`' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_col = (n.saturating_sub(1)).min(self.active_screen().cols.saturating_sub(1));
            }
            'I' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_forward_tabs(n);
            }
            'Z' => {
                let n = param(params, 0, 1) as usize;
                self.cursor_backward_tabs(n);
            }
            'r' => self.set_scroll_region(params),
            _ => {}
        }
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        if params.is_empty() {
            return;
        }
        let cmd = params[0];
        let args = &params[1..];
        match cmd {
            b"0" | b"2" => {
                let title = args
                    .first()
                    .map(|a| String::from_utf8_lossy(a).into_owned())
                    .unwrap_or_default();
                if !title.is_empty() {
                    self.pending_osc_events.push(OscEvent { kind: "title", value: title });
                }
            }
            b"8" => {
                // OSC 8 ; id=... ; url  (hyperlinks)
                let url = args
                    .get(1)
                    .map(|a| String::from_utf8_lossy(a).into_owned())
                    .unwrap_or_default();
                if url.is_empty() {
                    self.current_link = None;
                } else {
                    let idx = match self.links.iter().position(|u| *u == url) {
                        Some(i) => i as u32,
                        None => {
                            self.links.push(url);
                            (self.links.len() - 1) as u32
                        }
                    };
                    self.current_link = Some(idx);
                }
            }
            b"52" => {
                // OSC 52 ; c ; base64  (clipboard write - allowed by config)
                let which = args
                    .first()
                    .map(|a| String::from_utf8_lossy(a).into_owned())
                    .unwrap_or_default();
                let payload = args
                    .get(1)
                    .map(|a| String::from_utf8_lossy(a).into_owned())
                    .unwrap_or_default();
                if which == "c" && !payload.is_empty() {
                    self.pending_osc_events.push(OscEvent { kind: "clipboard", value: payload });
                }
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        match byte {
            b'c' => self.reset(),
            b'D' => self.line_feed(),
            b'M' => self.reverse_index(),
            b'E' => {
                self.cursor_col = 0;
                self.line_feed();
            }
            b'7' => {
                self.saved_cursor_row = self.cursor_row;
                self.saved_cursor_col = self.cursor_col;
            }
            b'8' => {
                self.cursor_row = self.saved_cursor_row;
                self.cursor_col = self.saved_cursor_col;
            }
            _ => {}
        }
    }

    fn hook(&mut self, _params: &vte::Params, _intermediates: &[u8], _ignore: bool, _c: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
}

// ?? #[no_mangle] exports ??????????????????????????????????????????????

/// Create a new terminal. Returns a pointer (Box). JS owns the pointer and
/// must call terminal_free to release it.
#[no_mangle]
pub extern "C" fn terminal_new(cols: u32, rows: u32) -> *mut Terminal {
    let t = Terminal::new(cols as usize, rows as usize);
    Box::into_raw(Box::new(t))
}

/// Free the terminal.
#[no_mangle]
pub unsafe extern "C" fn terminal_free(ptr: *mut Terminal) {
    if ptr.is_null() {
        return;
    }
    drop(Box::from_raw(ptr));
}

/// Write UTF-8 data to the terminal.
#[no_mangle]
pub unsafe extern "C" fn terminal_write(ptr: *mut Terminal, data_ptr: *const u8, data_len: u32) {
    if ptr.is_null() {
        return;
    }
    let t = &mut *ptr;
    let slice = std::slice::from_raw_parts(data_ptr, data_len as usize);
    t.feed(slice);
}

/// Resize the terminal grid (both main and alternate buffers).
#[no_mangle]
pub unsafe extern "C" fn terminal_resize(ptr: *mut Terminal, cols: u32, rows: u32) {
    if ptr.is_null() {
        return;
    }
    let t = &mut *ptr;
    t.screen.resize(cols as usize, rows as usize);
    t.alt.resize(cols as usize, rows as usize);
    if t.cursor_row >= rows as usize {
        t.cursor_row = (rows as usize).saturating_sub(1);
    }
    if t.cursor_col >= cols as usize {
        t.cursor_col = (cols as usize).saturating_sub(1);
    }
}

/// Render the live viewport to a JSON string (malloc'd C string; JS must call
/// terminal_free_string).
#[no_mangle]
pub unsafe extern "C" fn terminal_render(ptr: *mut Terminal) -> *mut std::ffi::c_char {
    if ptr.is_null() {
        return std::ptr::null_mut();
    }
    let t = &*ptr;
    let json = serde_json::to_string(&t.render_data(0)).unwrap_or_else(|_| "{}".to_string());
    CString::new(json).unwrap_or_else(|_| CString::new("{}").unwrap()).into_raw()
}

/// Number of scrollback rows currently retained (0 while in the alternate screen).
#[no_mangle]
pub unsafe extern "C" fn terminal_scrollback_len(ptr: *mut Terminal) -> u32 {
    if ptr.is_null() {
        return 0;
    }
    let t = &*ptr;
    if t.active_alt {
        0
    } else {
        t.screen.scrollback.len() as u32
    }
}

/// Render a viewport `scroll_offset` rows above the live edge.
///
/// `scroll_offset = 0` renders the live viewport (identical to terminal_render).
/// `scroll_offset = k` shifts the window up by k rows into scrollback history.
/// The cursor is hidden whenever the view is scrolled away from the live edge.
/// While the alternate screen is active, the offset is ignored.
/// Returns a malloc'd C string; JS must call terminal_free_string.
#[no_mangle]
pub unsafe extern "C" fn terminal_render_scrolled(ptr: *mut Terminal, scroll_offset: u32) -> *mut std::ffi::c_char {
    if ptr.is_null() {
        return std::ptr::null_mut();
    }
    let t = &*ptr;
    let json = serde_json::to_string(&t.render_data(scroll_offset as usize))
        .unwrap_or_else(|_| "{}".to_string());
    CString::new(json).unwrap_or_else(|_| CString::new("{}").unwrap()).into_raw()
}

/// Take pending OSC events (window title, clipboard writes) as a JSON array and
/// clear the queue. Returns a malloc'd C string; JS must call terminal_free_string.
#[no_mangle]
pub unsafe extern "C" fn terminal_take_events(ptr: *mut Terminal) -> *mut std::ffi::c_char {
    if ptr.is_null() {
        return std::ptr::null_mut();
    }
    let t = &mut *ptr;
    let events = std::mem::take(&mut t.pending_osc_events);
    let json = serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string());
    CString::new(json).unwrap_or_else(|_| CString::new("[]").unwrap()).into_raw()
}

/// Free a string returned by terminal_render / terminal_take_events.
#[no_mangle]
pub unsafe extern "C" fn terminal_free_string(ptr: *mut std::ffi::c_char) {
    if ptr.is_null() {
        return;
    }
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

/// Clear the active terminal buffer.
#[no_mangle]
pub unsafe extern "C" fn terminal_clear(ptr: *mut Terminal) {
    if ptr.is_null() {
        return;
    }
    let t = &mut *ptr;
    t.active_screen_mut().clear();
    t.cursor_row = 0;
    t.cursor_col = 0;
}

/// Get number of columns.
#[no_mangle]
pub unsafe extern "C" fn terminal_cols(ptr: *mut Terminal) -> u32 {
    if ptr.is_null() {
        return 0;
    }
    (*ptr).screen.cols as u32
}

/// Get number of rows.
#[no_mangle]
pub unsafe extern "C" fn terminal_rows(ptr: *mut Terminal) -> u32 {
    if ptr.is_null() {
        return 0;
    }
    (*ptr).screen.rows_count as u32
}

// ?? Memory allocator stub (required for WASM) ?????????????????????????

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

// ?? Tests ?????????????????????????????????????????????????????????????

#[cfg(test)]
mod tests {
    use super::*;

    fn term(cols: usize, rows: usize) -> Terminal {
        Terminal::new(cols, rows)
    }

    fn row_text(rd: &RenderData, row: usize) -> String {
        rd.rows[row].cells.iter().map(|c| c.ch.clone()).collect()
    }

    fn all_rows(rd: &RenderData) -> Vec<String> {
        rd.rows.iter().map(|r| r.cells.iter().map(|c| c.ch.clone()).collect()).collect()
    }

    #[test]
    fn alt_screen_preserves_main_buffer_and_cursor() {
        let mut t = term(10, 5);
        t.feed(b"hello");
        assert_eq!(row_text(&t.render_data(0), 0), "hello     ");
        // Move the cursor to row 2 col 3 before entering the alt screen.
        t.feed(b"\x1b[3;4H");
        t.feed(b"\x1b[?1049h");
        assert!(t.active_alt);
        assert_eq!(t.cursor_row, 0);
        assert_eq!(t.cursor_col, 0);
        // Writing into the alt screen must not touch the main buffer.
        t.feed(b"ALT");
        let rd = t.render_data(0);
        assert!(t.active_alt);
        assert_eq!(row_text(&rd, 0), "ALT       ");
        // Exit restores main content and the saved cursor.
        t.feed(b"\x1b[?1049l");
        assert!(!t.active_alt);
        let rd = t.render_data(0);
        assert_eq!(row_text(&rd, 0), "hello     ");
        assert_eq!(t.cursor_row, 2);
        assert_eq!(t.cursor_col, 3);
    }

    #[test]
    fn alt_screen_suppresses_scrollback() {
        let mut t = term(10, 3);
        // Fill the screen and scroll once to create scrollback.
        t.feed(b"line1\r\nline2\r\nline3\r\nline4");
        assert!(t.render_data(0).scrollback_count >= 1);
        // Enter alt, write a bunch of lines; no additional scrollback.
        t.feed(b"\x1b[?1049h");
        t.feed(b"\x1b[0m");
        t.feed(b"a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng");
        assert_eq!(t.render_data(0).scrollback_count, 0);
        assert!(t.render_data(0).modes.active_alt);
    }

    #[test]
    fn truecolor_and_256_color_resolve() {
        let mut t = term(10, 2);
        // 256-color: 38;5;208 -> cube (5, 2, 0) -> 255,135,0.
        t.feed(b"\x1b[38;5;208mA\x1b[0mB");
        let rd = t.render_data(0);
        assert_eq!(rd.rows[0].cells[0].fg, 0x00FF8700);
        assert_eq!(rd.rows[0].cells[1].fg, color_rgb(Color::Palette(DEFAULT_FG)));
        // Truecolor: 38;2;10;20;30.
        t.feed(b"\x1b[38;2;10;20;30mC");
        let rd = t.render_data(0);
        assert_eq!(rd.rows[0].cells[2].fg, 0x000A141E);
    }

    #[test]
    fn scroll_region_keeps_fixed_rows() {
        let mut t = term(10, 5);
        // Region rows 2..=4 (1-based), leaving row 0 fixed.
        t.feed(b"\x1b[2;5r");
        t.feed(b"\x1b[2;1H");
        t.feed(b"111\r\n222\r\n333\r\n444\r\n555");
        let rows = all_rows(&t.render_data(0));
        assert_eq!(rows[0].trim_end(), "");
        assert_eq!(rows[1].trim_end(), "222");
        assert_eq!(rows[2].trim_end(), "333");
        assert_eq!(rows[3].trim_end(), "444");
        assert_eq!(rows[4].trim_end(), "555");
    }

    #[test]
    fn insert_and_delete_lines() {
        let mut t = term(10, 5);
        t.feed(b"AAAA\r\nBBBB\r\nCCCC");
        t.feed(b"\x1b[2;1H");
        t.feed(b"\x1b[1L");
        let rows = all_rows(&t.render_data(0));
        assert_eq!(rows[0].trim_end(), "AAAA");
        assert_eq!(rows[1].trim_end(), "");
        assert_eq!(rows[2].trim_end(), "BBBB");
        assert_eq!(rows[3].trim_end(), "CCCC");
        t.feed(b"\x1b[2;1H");
        t.feed(b"\x1b[1M");
        let rows = all_rows(&t.render_data(0));
        assert_eq!(rows[0].trim_end(), "AAAA");
        assert_eq!(rows[1].trim_end(), "BBBB");
        assert_eq!(rows[2].trim_end(), "CCCC");
    }

    #[test]
    fn insert_mode_and_autowrap_off() {
        let mut t = term(5, 3);
        // Insert mode: characters push existing content right.
        t.feed(b"AB");
        t.feed(b"\x1b[1;2H");
        t.feed(b"\x1b[4h");
        t.feed(b"X");
        let rd = t.render_data(0);
        assert_eq!(row_text(&rd, 0), "AXB  ");
        // Autowrap off: at the last column the cursor stays and overwrites.
        t.feed(b"\x1b[4l");
        t.feed(b"\x1b[?7l");
        t.feed(b"\x1b[1;5H");
        t.feed(b"12");
        let rd = t.render_data(0);
        assert_eq!(row_text(&rd, 0), "AXB 2");
    }

    #[test]
    fn cursor_visibility_and_bracketed_paste_flags() {
        let mut t = term(10, 3);
        t.feed(b"\x1b[?25l\x1b[?2004h");
        let rd = t.render_data(0);
        assert!(!rd.modes.cursor_visible);
        assert!(rd.modes.bracketed_paste);
        t.feed(b"\x1b[?25h\x1b[?2004l");
        let rd = t.render_data(0);
        assert!(rd.modes.cursor_visible);
        assert!(!rd.modes.bracketed_paste);
    }

    #[test]
    fn ris_resets_state() {
        let mut t = term(10, 3);
        t.feed(b"\x1b[38;2;1;2;3mX\x1b[?25l\x1b[2;3r\x1b[?1049h");
        assert!(t.active_alt);
        assert!(!t.cursor_visible);
        t.feed(b"\x1b c");
        assert!(!t.active_alt);
        assert!(t.cursor_visible);
        assert!(t.auto_wrap);
        assert_eq!(t.cursor_row, 0);
        assert_eq!(t.cursor_col, 0);
        let rd = t.render_data(0);
        assert_eq!(row_text(&rd, 0), "          ");
    }

    #[test]
    fn osc_title_clipboard_and_links() {
        let mut t = term(10, 3);
        t.feed(b"\x1b]0;my title\x07");
        t.feed(b"\x1b]52;c;aGVsbG8=\x07");
        t.feed(b"\x1b]8;;https://example.com\x1b\\LINK\x1b]8;;\x1b\\");
        let events = t.pending_osc_events.clone();
        let kinds: Vec<&str> = events.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec!["title", "clipboard"]);
        assert_eq!(events[1].value, "aGVsbG8=");
        // Link cells carry the resolved URL in render output.
        let rd = t.render_data(0);
        assert_eq!(rd.rows[0].cells[0].link.as_deref(), Some("https://example.com"));
        assert_eq!(rd.rows[0].cells[3].link.as_deref(), Some("https://example.com"));
        assert_eq!(rd.rows[0].cells[4].link, None);
    }
}
