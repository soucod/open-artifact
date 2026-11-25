//! A guessed table (`Table`): its header rows, columns and body, and the part each row of the body plays. A row
//! showing nothing, or less than most rows and only what a merged range carries down, is a spacer; a lone text where
//! most rows show three cells or more is a section's title; a row like the header (or a few rows of it) is the
//! header again; the rest are records. The body ends at its last record.

use std::collections::BTreeSet;

use super::super::live::Role;
use super::grid::Grid;

/// The header's first and last rows, and whether the guess is sure of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct HeaderRows {
    pub first: usize,
    pub last: usize,
    pub is_sure: bool,
}

/// Rows of the body playing one part.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Run {
    pub first: usize,
    pub last: usize,
    pub role: Role,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Table {
    pub header: Option<HeaderRows>,
    pub first_column: usize,
    pub last_column: usize,
    /// The body's first and last rows.
    pub from: usize,
    pub to: usize,
    pub runs: Vec<Run>,
}

impl Table {
    /// The header's first row, or the body's when there is none.
    pub(super) fn top(&self) -> usize {
        self.header.map_or(self.from, |h| h.first)
    }

    /// Whether the table holds a cell, in its header or its body.
    pub(super) fn holds(&self, row: usize, column: usize) -> bool {
        self.first_column <= column
            && column <= self.last_column
            && ((self.from <= row && row <= self.to) || self.header.is_some_and(|h| h.first <= row && row <= h.last))
    }

    /// How many rows are records.
    pub(super) fn records(&self) -> usize {
        self.runs.iter().filter(|r| r.role == Role::Record).map(|r| r.last - r.first + 1).fold(0, usize::saturating_add)
    }
}

impl Grid<'_> {
    /// The table with a header over columns from one to the other and a body from a row to another, ending at its
    /// last record (looked for four times at most, the rows' parts read again each time over the shorter body).
    /// None when the body holds no record.
    pub(super) fn table(&self, header: Option<HeaderRows>, first: usize, last: usize, from: usize, to: usize) -> Option<Table> {
        let mut to = to;
        for _ in 0..4 {
            if from > to {
                return None;
            }
            let parts = self.parts(header, first, last, from, to);
            let i = parts.iter().rposition(|&p| p == Role::Record)?;
            let end = from.saturating_add(i);
            if end == to {
                return in_runs(header, first, last, from, &parts);
            }
            to = end;
        }
        self.table_once(header, first, last, from, to)
    }

    /// The table with a header over columns from one to the other and a body from a row to another, the rows'
    /// parts read once.
    pub(super) fn table_once(&self, header: Option<HeaderRows>, first: usize, last: usize, from: usize, to: usize) -> Option<Table> {
        in_runs(header, first, last, from, &self.parts(header, first, last, from, to))
    }

    /// The part each row of a body plays.
    fn parts(&self, header: Option<HeaderRows>, first: usize, last: usize, from: usize, to: usize) -> Vec<Role> {
        let counts: Vec<usize> = if from > to { Vec::new() } else { (from..=to).map(|r| self.count(r, first, last)).collect() };
        let mut filled: Vec<usize> = counts.iter().copied().filter(|&n| n != 0).collect();
        filled.sort_unstable();
        // Three rows in five showing something show this many cells or fewer.
        let usual = filled.get(filled.len() * 3 / 5).copied().unwrap_or(0);
        let mut parts: Vec<Role> = counts
            .iter()
            .enumerate()
            .map(|(i, &count)| {
                let row = from + i;
                if count == 0 || (count < usual && !self.owns_any(row, first, last)) {
                    Role::Spacer
                } else if count == 1 && self.is_section_title(row, first, last, usual) {
                    Role::Section
                } else {
                    Role::Record
                }
            })
            .collect();
        let Some(header) = header else { return parts };
        let again = self.header_again(&parts, header, first, last, from);
        for row in again {
            let i = row.saturating_sub(from);
            if i < parts.len() {
                parts[i] = Role::HeaderAgain;
            }
        }
        parts
    }

    /// The rows of a body that show the header again: a row repeating one of the header's last ten rows, with the
    /// rows above and below it that copy the header's rows above and below that one, and a label over them like the
    /// one over the header; or a row much like those header rows.
    fn header_again(&self, parts: &[Role], header: HeaderRows, first: usize, last: usize, from: usize) -> BTreeSet<usize> {
        let mut again = BTreeSet::new();
        let (top, bottom) = (header.first, header.last);
        let lowest = top.max(bottom.saturating_sub(9));
        for (i, &part) in parts.iter().enumerate() {
            let row = from + i;
            if !matches!(part, Role::Record | Role::Section) || again.contains(&row) {
                continue;
            }
            let found = if top > bottom { None } else { (lowest..=bottom).find(|&h| self.repeats(row, h, first, last)) };
            let Some(h) = found else {
                if self.echoes(row, lowest, bottom, first, last) {
                    again.insert(row);
                }
                continue;
            };
            again.insert(row);
            let mut topmost = row;
            for k in 1..=h - lowest {
                let Some(above) = row.checked_sub(k) else { break };
                if above < from || !self.is_copy_of(above, h - k, first, last) {
                    break;
                }
                again.insert(above);
                topmost = above;
            }
            for k in 1..=bottom.saturating_sub(h) {
                let below = row.saturating_add(k);
                if !self.is_copy_of(below, h.saturating_add(k), first, last) {
                    break;
                }
                again.insert(below);
            }
            if topmost != 0 && topmost - 1 >= from && self.label_echoes_above(topmost - 1, top, first, last) {
                again.insert(topmost - 1);
            }
        }
        again
    }
}

/// A table from its rows' parts, rows playing the same part one after another in one run; none without a record.
fn in_runs(header: Option<HeaderRows>, first: usize, last: usize, from: usize, parts: &[Role]) -> Option<Table> {
    if !parts.contains(&Role::Record) {
        return None;
    }
    let mut runs: Vec<Run> = Vec::new();
    for (i, &role) in parts.iter().enumerate() {
        let row = from + i;
        push_run(&mut runs, row, row, role);
    }
    let to = runs.last()?.last;
    Some(Table { header, first_column: first, last_column: last, from, to, runs })
}

pub(super) fn push_run(runs: &mut Vec<Run>, first: usize, last: usize, role: Role) {
    match runs.last_mut() {
        Some(run) if run.role == role && run.last.saturating_add(1) == first => run.last = last,
        _ => runs.push(Run { first, last, role }),
    }
}
