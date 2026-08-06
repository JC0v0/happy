//! Terminal cell model - one per grid position.

use serde::{Serialize, Deserialize};

/// Bitflags for text attributes.
pub const ATTR_BOLD: u8 = 1 << 0;
pub const ATTR_ITALIC: u8 = 1 << 1;
pub const ATTR_UNDERLINE: u8 = 1 << 2;
pub const ATTR_REVERSE: u8 = 1 << 3;
pub const ATTR_DIM: u8 = 1 << 4;
pub const ATTR_STRIKE: u8 = 1 << 5;

/// Palette indices reserved for the terminal's default colors.
pub const DEFAULT_FG: u8 = 16;
pub const DEFAULT_BG: u8 = 17;

/// A cell color: a palette index (0-255) or a truecolor RGB value.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Color {
    /// 0-15 basic ANSI, 16/17 default fg/bg, 18..=255 xterm 256-color.
    Palette(u8),
    /// Truecolor as 0xRRGGBB.
    Rgb(u32),
}

impl Color {
    /// Default background color (only used for `Cell.bg`'s default).
    pub fn default_bg() -> Self {
        Color::Palette(DEFAULT_BG)
    }
}

impl Default for Color {
    fn default() -> Self {
        Color::Palette(DEFAULT_FG)
    }
}

/// A single terminal cell.
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Cell {
    /// The character (ASCII or basic Unicode).
    pub ch: char,
    /// Foreground color.
    pub fg: Color,
    /// Background color.
    pub bg: Color,
    /// Attribute bitflags (ATTR_BOLD, etc.).
    pub attrs: u8,
    /// Wide character flag (true = takes 2 cells).
    pub wide: bool,
    /// True if this cell is the continuation of a wide char.
    pub wide_cont: bool,
    /// Index into the terminal's OSC-8 hyperlink table (None = no link).
    pub link: Option<u32>,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            ch: ' ',
            fg: Color::default(),
            bg: Color::default_bg(),
            attrs: 0,
            wide: false,
            wide_cont: false,
            link: None,
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
