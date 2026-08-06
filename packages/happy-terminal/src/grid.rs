//! Grid-based screen buffer with scrollback.

use crate::cell::Cell;

/// A row in the terminal grid.
pub struct Row {
    pub cells: Vec<Cell>,
}

impl Row {
    pub fn new(cols: usize) -> Self {
        Self {
            cells: vec![Cell::default(); cols],
        }
    }

    pub fn resize(&mut self, cols: usize) {
        if cols > self.cells.len() {
            self.cells.resize(cols, Cell::default());
        } else if cols < self.cells.len() {
            self.cells.truncate(cols);
        }
    }

    pub fn clear(&mut self) {
        for cell in &mut self.cells {
            cell.reset();
        }
    }
}

/// The terminal screen: a grid of cells with scrollback history.
pub struct Screen {
    /// Visible rows (the viewport).
    pub rows: Vec<Row>,
    /// Scrollback history (older rows that scrolled off the top).
    pub scrollback: Vec<Row>,
    /// Maximum scrollback lines to keep.
    pub max_scrollback: usize,
    /// Number of columns.
    pub cols: usize,
    /// Number of visible rows.
    pub rows_count: usize,
    /// First row of the scrolling region (inclusive, 0-based).
    pub scroll_top: usize,
    /// Last row of the scrolling region (inclusive, 0-based).
    pub scroll_bottom: usize,
}

impl Screen {
    pub fn new(cols: usize, rows: usize, max_scrollback: usize) -> Self {
        let rows_vec = (0..rows).map(|_| Row::new(cols)).collect();
        Self {
            rows: rows_vec,
            scrollback: Vec::new(),
            max_scrollback,
            cols,
            rows_count: rows,
            scroll_top: 0,
            scroll_bottom: rows.saturating_sub(1),
        }
    }

    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows_count = rows;

        // Resize existing rows.
        for row in &mut self.rows {
            row.resize(cols);
        }

        // Add or remove rows.
        if rows > self.rows.len() {
            for _ in self.rows.len()..rows {
                self.rows.push(Row::new(cols));
            }
        } else if rows < self.rows.len() {
            self.rows.truncate(rows);
        }

        // Clamp the scroll region to the new viewport.
        self.scroll_top = self.scroll_top.min(rows.saturating_sub(1));
        self.scroll_bottom = self.scroll_bottom.min(rows.saturating_sub(1));
    }

    /// Reset the scrolling region to the full screen.
    pub fn reset_scroll_region(&mut self) {
        self.scroll_top = 0;
        self.scroll_bottom = self.rows_count.saturating_sub(1);
    }

    /// Set the scrolling region from 1-based protocol rows.
    pub fn set_scroll_region(&mut self, top1: usize, bottom1: usize) {
        let max = self.rows_count.saturating_sub(1);
        let top = top1.saturating_sub(1).min(max);
        let bottom = bottom1.saturating_sub(1).min(max);
        if top < bottom {
            self.scroll_top = top;
            self.scroll_bottom = bottom;
        }
    }

    /// True when the scroll region covers the whole viewport.
    pub fn is_full_screen_scroll(&self) -> bool {
        self.scroll_top == 0 && self.scroll_bottom + 1 >= self.rows_count
    }

    /// Scroll the region up by `n` rows. Rows leaving the top of the region are
    /// pushed to scrollback only when `to_scrollback` is set (full-screen live
    /// scroll outside the alternate screen). Blank rows enter at the bottom.
    pub fn scroll_up_region(&mut self, n: usize, to_scrollback: bool) {
        if n == 0 || self.rows.is_empty() {
            return;
        }
        let top = self.scroll_top;
        let bottom = self.scroll_bottom;
        let n = n.min(bottom - top + 1);

        if to_scrollback {
            for r in top..(top + n) {
                let row = std::mem::replace(&mut self.rows[r], Row::new(self.cols));
                self.scrollback.push(row);
            }
            if self.scrollback.len() > self.max_scrollback {
                let extra = self.scrollback.len() - self.max_scrollback;
                self.scrollback.drain(0..extra);
            }
        }

        // Shift the region up by n rows.
        for r in top..=(bottom - n) {
            self.rows[r] = std::mem::replace(&mut self.rows[r + n], Row::new(self.cols));
        }
        for r in (bottom + 1 - n)..=bottom {
            self.rows[r] = Row::new(self.cols);
        }
    }

    /// Scroll the region down by `n` rows (blank rows enter at the top).
    pub fn scroll_down_region(&mut self, n: usize) {
        if n == 0 || self.rows.is_empty() {
            return;
        }
        let top = self.scroll_top;
        let bottom = self.scroll_bottom;
        let n = n.min(bottom - top + 1);

        for r in ((top + n)..=bottom).rev() {
            self.rows[r] = std::mem::replace(&mut self.rows[r - n], Row::new(self.cols));
        }
    }

    /// Insert `n` blank lines at `row`, shifting lines below (within the
    /// scroll region) down. Lines pushed past the region bottom are dropped.
    pub fn insert_lines(&mut self, row: usize, n: usize) {
        if n == 0 || row < self.scroll_top || row > self.scroll_bottom {
            return;
        }
        let bottom = self.scroll_bottom;
        let n = n.min(bottom - row + 1);
        for r in ((row + n)..=bottom).rev() {
            self.rows[r] = std::mem::replace(&mut self.rows[r - n], Row::new(self.cols));
        }
    }

    /// Delete `n` lines at `row`, pulling lines below (within the scroll
    /// region) up. Blank lines enter at the region bottom.
    pub fn delete_lines(&mut self, row: usize, n: usize) {
        if n == 0 || row > self.scroll_bottom {
            return;
        }
        let bottom = self.scroll_bottom;
        let n = n.min(bottom - row + 1);
        for r in row..=(bottom - n) {
            self.rows[r] = std::mem::replace(&mut self.rows[r + n], Row::new(self.cols));
        }
        for r in (bottom + 1 - n)..=bottom {
            self.rows[r] = Row::new(self.cols);
        }
    }

    /// Insert `n` blank cells at `col` on `row`, shifting the rest right.
    pub fn insert_chars(&mut self, row: usize, col: usize, n: usize) {
        if n == 0 || row >= self.rows.len() || col >= self.cols {
            return;
        }
        let cells = &mut self.rows[row].cells;
        let cols = cells.len();
        let n = n.min(cols - col);
        cells.copy_within(col..cols - n, col + n);
        for c in col..(col + n) {
            cells[c].reset();
        }
    }

    /// Delete `n` cells at `col` on `row`, shifting the rest left.
    pub fn delete_chars(&mut self, row: usize, col: usize, n: usize) {
        if n == 0 || row >= self.rows.len() || col >= self.cols {
            return;
        }
        let cells = &mut self.rows[row].cells;
        let cols = cells.len();
        let n = n.min(cols - col);
        cells.copy_within(col + n..cols, col);
        for c in (cols - n)..cols {
            cells[c].reset();
        }
    }

    /// Erase `n` cells starting at `col` on `row` (no shifting).
    pub fn erase_chars(&mut self, row: usize, col: usize, n: usize) {
        if row >= self.rows.len() {
            return;
        }
        for c in col..(col + n).min(self.cols) {
            if let Some(cell) = self.rows[row].cells.get_mut(c) {
                cell.reset();
            }
        }
    }

    /// Clear the entire screen.
    pub fn clear(&mut self) {
        for row in &mut self.rows {
            row.clear();
        }
    }

    /// Get a mutable cell at (row, col).
    pub fn cell_mut(&mut self, row: usize, col: usize) -> Option<&mut Cell> {
        self.rows.get_mut(row)?.cells.get_mut(col)
    }
}
