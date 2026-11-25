//! The sheet as the recognizer reads it (`Sheet`): the cells showing something, by row (a text trimmed, a number, or
//! anything else), the unticked checkboxes apart, and the merged ranges whose top left shows something, by their top
//! row; then the questions it asks of them: what a row shows across some columns, the first and last rows that show
//! something, a row of group headings over the row under it, and a row of years or dates.

use std::collections::{BTreeMap, BTreeSet};

use super::super::grid::{Grid, Shown};
use crate::number_format::Kind as FormatKind;
use crate::workbook::Input;

/// A range of cells: its top, left, bottom and right.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(in crate::session::reads::tables::guess) struct Rect {
    pub top: usize,
    pub left: usize,
    pub bottom: usize,
    pub right: usize,
}

impl Rect {
    pub(in crate::session::reads::tables::guess) fn holds(&self, row: usize, column: usize) -> bool {
        self.top <= row && row <= self.bottom && self.left <= column && column <= self.right
    }

    pub(super) fn meets(&self, other: &Rect) -> bool {
        other.top <= self.bottom && self.top <= other.bottom && other.left <= self.right && self.left <= other.right
    }
}

/// What a cell shows, as the recognizer tells it apart.
#[derive(Clone, Copy, Debug)]
pub(super) enum Value<'g> {
    /// A text, trimmed (never empty).
    Text(&'g str),
    Number(f64),
    Boolean,
    Error,
}

/// A cell showing something.
#[derive(Clone, Copy, Debug)]
pub(super) struct Cell<'g> {
    pub row: usize,
    pub column: usize,
    pub value: Value<'g>,
}

impl Cell<'_> {
    pub(super) fn number(&self) -> Option<f64> {
        match self.value {
            Value::Number(n) => Some(n),
            _ => None,
        }
    }

    pub(super) fn is_text(&self) -> bool {
        matches!(self.value, Value::Text(_))
    }
}

/// The cells of a row from one column to another (none when the first is past the last).
fn between<'s, 'g>(cells: &'s [Cell<'g>], first: usize, last: usize) -> &'s [Cell<'g>] {
    let a = cells.partition_point(|c| c.column < first);
    let b = cells.partition_point(|c| c.column <= last);
    if b < a {
        &[]
    } else {
        &cells[a..b]
    }
}

/// A sheet as the recognizer reads it.
pub(super) struct Sheet<'g> {
    pub grid: &'g Grid<'g>,
    /// The cells showing something by row, each row's by column: all but the unticked checkboxes and those a merged
    /// range hides.
    pub cells: BTreeMap<usize, Vec<Cell<'g>>>,
    /// The unticked checkboxes (FALSE in a cell given a checkbox) by row.
    pub unticked: BTreeMap<usize, Vec<Cell<'g>>>,
    /// The merged ranges whose top left shows something, by their top row.
    pub merges_by_top: BTreeMap<usize, Vec<Rect>>,
    /// The most rows one of those spans.
    pub span: usize,
}

impl<'g> Sheet<'g> {
    pub(super) fn of(grid: &'g Grid<'g>) -> Sheet<'g> {
        let mut cells: BTreeMap<usize, Vec<Cell>> = BTreeMap::new();
        let mut unticked: BTreeMap<usize, Vec<Cell>> = BTreeMap::new();
        for (row, column, shown) in grid.shown_cells() {
            let value = match shown {
                Shown::Text(t) => Value::Text(t.trim()),
                Shown::Number(n) => Value::Number(*n),
                Shown::Boolean(_) => Value::Boolean,
                Shown::Error(_) => Value::Error,
            };
            let cell = Cell { row, column, value };
            if matches!(shown, Shown::Boolean(false)) && grid.has_checkbox(row, column) {
                unticked.entry(row).or_default().push(cell);
            } else {
                cells.entry(row).or_default().push(cell);
            }
        }
        let merges: Vec<Rect> = grid.merges_in_order().map(|m| Rect { top: m.top, left: m.left, bottom: m.bottom, right: m.right }).collect();
        let hidden = |c: &Cell| merges.iter().any(|m| m.top <= c.row && c.row <= m.bottom && m.left <= c.column && c.column <= m.right && (c.row, c.column) != (m.top, m.left));
        for map in [&mut cells, &mut unticked] {
            for row in map.values_mut() {
                row.retain(|c| !hidden(c));
            }
        }
        let mut merges_by_top: BTreeMap<usize, Vec<Rect>> = BTreeMap::new();
        let mut span = 0usize;
        for m in &merges {
            if cells.get(&m.top).is_some_and(|row| !between(row, m.left, m.left).is_empty()) {
                merges_by_top.entry(m.top).or_default().push(*m);
                span = span.max((m.bottom - m.top).saturating_add(1).max(1));
            }
        }
        Sheet { grid, cells, unticked, merges_by_top, span }
    }

    /// The cells of a row from one column to another.
    pub(super) fn cells_in(&self, row: usize, first: usize, last: usize) -> &[Cell<'g>] {
        self.cells.get(&row).map_or(&[], |cells| between(cells, first, last))
    }

    /// The unticked checkboxes of a row from one column to another.
    pub(super) fn unticked_in(&self, row: usize, first: usize, last: usize) -> &[Cell<'g>] {
        self.unticked.get(&row).map_or(&[], |cells| between(cells, first, last))
    }

    /// The columns a cell's merged range spans when the cell is its top left (only its own column otherwise).
    pub(super) fn merge_columns(&self, row: usize, column: usize) -> (usize, usize) {
        let merge = self.merges_by_top.get(&row).and_then(|ms| ms.iter().find(|m| m.top == row && m.left == column));
        (column, merge.map_or(column, |m| m.right))
    }

    /// The merged ranges whose top left shows something meeting a range, by their top row.
    pub(super) fn merges_meeting<'s>(&'s self, area: Rect) -> impl Iterator<Item = &'s Rect> + 's {
        let from = area.top.saturating_sub(self.span);
        self.merges_by_top.range(from..=area.bottom).flat_map(|(_, ms)| ms).filter(move |m| m.meets(&area))
    }

    /// Whether a row shows something from one column to another: a cell's own, or a merged range's meeting it.
    pub(super) fn has_content(&self, row: usize, a: usize, b: usize) -> bool {
        if !self.cells_in(row, a, b).is_empty() {
            return true;
        }
        let area = Rect { top: row, left: a.min(b), bottom: row, right: a.max(b) };
        self.merges_meeting(area).next().is_some()
    }

    /// The first row from one to another showing something from one column to another; a merged range counts only on
    /// the first row.
    pub(super) fn first_content_row(&self, from: usize, to: usize, first: usize, last: usize) -> Option<usize> {
        if from <= to && self.has_content(from, first, last) {
            return Some(from);
        }
        for (&row, cells) in self.cells.range(from..) {
            if row > to {
                return None;
            }
            if !between(cells, first, last).is_empty() {
                return Some(row);
            }
        }
        None
    }

    /// The last row of the run of rows from one (to another at most) that all show something.
    pub(super) fn last_filled_row(&self, from: usize, to: usize, first: usize, last: usize) -> Option<usize> {
        let mut found = None;
        let mut row = from;
        while row <= to {
            if !self.has_content(row, first, last) {
                break;
            }
            found = Some(row);
            if row == to {
                break;
            }
            row += 1;
        }
        found
    }

    /// Whether a cell can be a heading over others: a text not a dropdown's option or a person's, or a number merged
    /// across columns.
    pub(super) fn is_label_like(&self, cell: &Cell) -> bool {
        match cell.value {
            Value::Text(_) => !matches!(
                self.grid.input(cell.row, cell.column),
                Some(Input::DropdownOption { .. } | Input::User { .. } | Input::Users { .. })
            ),
            Value::Number(_) => {
                let (a, b) = self.merge_columns(cell.row, cell.column);
                a < b
            }
            Value::Boolean | Value::Error => false,
        }
    }

    /// Whether a row holds group headings over the row under it: one not across all the columns with two cells or
    /// more under it, nothing right under a heading of one column (nor under the columns given), every cell a label,
    /// and the row under reading as headings.
    pub(super) fn is_label_over_block(&self, row: usize, first: usize, last: usize, columns: &BTreeSet<usize>) -> bool {
        let cells = self.cells_in(row, first, last);
        if cells.is_empty() {
            return false;
        }
        let next = row.saturating_add(1);
        let spans: Vec<(usize, usize)> = cells.iter().map(|c| self.merge_columns(c.row, c.column)).collect();
        if !spans.iter().any(|&(a, b)| !(a == first && b == last) && self.cells_in(next, a, b).len() > 1) {
            return false;
        }
        if spans.iter().any(|&(a, b)| a == b && !self.cells_in(next, a, a).is_empty()) {
            return false;
        }
        if columns.iter().any(|&k| !self.cells_in(next, k, k).is_empty()) {
            return false;
        }
        if !cells.iter().all(|c| self.is_label_like(c)) {
            return false;
        }
        self.is_heading_row(next, first, last, Some(row), Skip::LabelLike)
    }

    /// The first row of a range holding more than a lone label: two cells or more, or one right of the first column
    /// that is a group heading over the row under it.
    pub(super) fn first_wide_row(&self, area: &Rect) -> Option<usize> {
        for (&row, cells) in self.cells.range(area.top..) {
            if row > area.bottom {
                return None;
            }
            let cs = between(cells, area.left, area.right);
            if cs.is_empty() {
                continue;
            }
            if cs.len() == 1 {
                if cs[0].column <= area.left {
                    continue;
                }
                if !self.is_label_over_block(row, area.left, area.right, &BTreeSet::new()) {
                    continue;
                }
            }
            return Some(row);
        }
        None
    }

    /// Whether a cell's number shows as a date, a time or both.
    pub(super) fn is_dated(&self, cell: &Cell) -> bool {
        cell.number().is_some()
            && self
                .grid
                .number_format(cell.row, cell.column)
                .is_some_and(|p| matches!(p.kind, FormatKind::Date | FormatKind::Time | FormatKind::DateAndTime))
    }

    /// Whether cells are numbers running strictly up or down: years from 1900 to 2100 a step apart (two or more), or
    /// else all shown as dates or times.
    pub(super) fn is_time_run(&self, cells: &[&Cell]) -> bool {
        let Some(numbers) = cells.iter().map(|c| c.number()).collect::<Option<Vec<f64>>>() else { return false };
        let n = numbers.len();
        let up = numbers.windows(2).all(|w| w[1] > w[0]);
        let monotone = up || numbers.windows(2).all(|w| w[1] < w[0]);
        if numbers.iter().all(|&x| x >= 1900.0 && x <= 2100.0 && x == x.trunc())
            && numbers.windows(2).all(|w| (w[1] - w[0]).abs() < 1.5)
        {
            return n > 1 && monotone;
        }
        if n < 2 || !monotone {
            return false;
        }
        cells.iter().all(|c| self.is_dated(c))
    }

    /// Whether a row reads as headings over the rows under it, across some columns: the cells not skipped (none in
    /// the first column) are runs of years or dates, each group of them under one merged range of the row above when
    /// grouped so. A row with none gives true.
    pub(super) fn is_heading_row(&self, row: usize, first: usize, last: usize, above: Option<usize>, skip: Skip) -> bool {
        let mut groups: BTreeMap<Option<(usize, usize)>, Vec<&Cell>> = BTreeMap::new();
        for cell in self.cells_in(row, first, last) {
            if self.skips(cell, skip) {
                continue;
            }
            if cell.column == first {
                return false;
            }
            let key = above.and_then(|above| {
                let area = Rect { top: above, left: cell.column, bottom: above, right: cell.column };
                self.merges_meeting(area).next().map(|m| (m.top, m.left))
            });
            groups.entry(key).or_default().push(cell);
        }
        groups.values().all(|cells| self.is_time_run(cells))
    }

    fn skips(&self, cell: &Cell, skip: Skip) -> bool {
        match skip {
            Skip::LabelLike => self.is_label_like(cell),
            Skip::Texts => cell.is_text() && self.is_label_like(cell),
        }
    }
}

/// The cells a row of headings leaves out of its run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Skip {
    /// Labels: texts (but options and people) and numbers merged across columns.
    LabelLike,
    /// Texts only (but options and people).
    Texts,
}
