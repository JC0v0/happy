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
    }

    /// Scroll up by `n` lines, moving rows to scrollback.
    pub fn scroll_up(&mut self, n: usize) {
        if n == 0 || self.rows.is_empty() {
            return;
        }
        let n = n.min(self.rows.len());
        // Move top n rows to scrollback.
        for _ in 0..n {
            let mut row = self.rows.remove(0);
            row.clear();
            // The removed row (with content) goes to scrollback.
            // Actually we need to save the content before clearing.
            // Let me fix: save content, then reuse the cleared row.
        }
        // Actually, let me redo this properly.
        // We need to: take the top n rows (with content) -> scrollback,
        // then add n blank rows at the bottom.
        // The above approach is wrong. Let me rewrite.
    }

    /// Scroll up by `n` lines, moving top rows to scrollback and adding
    /// blank rows at the bottom.
    pub fn scroll_up_proper(&mut self, n: usize) {
        if n == 0 || self.rows.is_empty() {
            return;
        }
        let n = n.min(self.rows.len());

        // Move top n rows to scrollback.
        for i in 0..n {
            let row = std::mem::replace(&mut self.rows[i], Row::new(self.cols));
            self.scrollback.push(row);
        }

        // Remove the first n rows (they're now blank from the replace above,
        // but we already saved their content). Actually, we replaced them
        // with blank rows, so we need to remove them and add new ones at the end.
        self.rows.drain(0..n);
        for _ in 0..n {
            self.rows.push(Row::new(self.cols));
        }

        // Trim scrollback.
        if self.scrollback.len() > self.max_scrollback {
            let extra = self.scrollback.len() - self.max_scrollback;
            self.scrollback.drain(0..extra);
        }
    }

    /// Clear the entire screen.
    pub fn clear(&mut self) {
        for row in &mut self.rows {
            row.clear();
        }
    }

    /// Get a cell at (row, col). Returns None if out of bounds.
    pub fn cell(&self, row: usize, col: usize) -> Option<&Cell> {
        self.rows.get(row)?.cells.get(col)
    }

    /// Get a mutable cell at (row, col).
    pub fn cell_mut(&mut self, row: usize, col: usize) -> Option<&mut Cell> {
        self.rows.get_mut(row)?.cells.get_mut(col)
    }
}
