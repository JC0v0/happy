//! Terminal cell model - one per grid position.

use serde::{Serialize, Deserialize};

/// Bitflags for text attributes.
pub const ATTR_BOLD: u8 = 1 << 0;
pub const ATTR_ITALIC: u8 = 1 << 1;
pub const ATTR_UNDERLINE: u8 = 1 << 2;
pub const ATTR_REVERSE: u8 = 1 << 3;
pub const ATTR_DIM: u8 = 1 << 4;
pub const ATTR_STRIKE: u8 = 1 << 5;

/// Default color index values (0-15 = ANSI palette, 16 = default fg, 17 = default bg).
pub const DEFAULT_FG: u8 = 16;
pub const DEFAULT_BG: u8 = 17;

/// A single terminal cell.
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Cell {
    /// The character (ASCII or basic Unicode).
    pub ch: char,
    /// ANSI color index for foreground (0-15 palette, 16=default, 17=default bg).
    pub fg: u8,
    /// ANSI color index for background.
    pub bg: u8,
    /// Attribute bitflags (ATTR_BOLD, etc.).
    pub attrs: u8,
    /// Wide character flag (true = takes 2 cells).
    pub wide: bool,
    /// True if this cell is the continuation of a wide char.
    pub wide_cont: bool,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            ch: ' ',
            fg: DEFAULT_FG,
            bg: DEFAULT_BG,
            attrs: 0,
            wide: false,
            wide_cont: false,
        }
    }
}

impl Cell {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn has_attr(&self, flag: u8) -> bool {
        self.attrs & flag != 0
    }
}
