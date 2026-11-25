//! The order a person sees a sheet's rows in, when they put them in one of their own (`queueEdit`'s `ownRowOrder`,
//!): fills down or up, pastes (`pasteCopiedCells`, `pasteValuesOfCopiedCells`,
//! `pasteCellsOfAnotherProgram`, `pasteRowsOfTexts`) and borders (`setBorders`) of its sheet are made in it, on and
//! of every edit the request makes (its edits before it too).
//!
//! The order names rows of the sheet by runs: those the sheet has (not deleted), in that order, take the places from
//! the first of them in the sheet on, and the rows between them that it does not name come after them, in their own
//! order (found by filling a series down every row under orders of two and three rows; rows the sheet does not have
//! are passed over). A row named twice, even one the sheet does not have, is refused (`rowNamedTwice`), and an order
//! of another sheet is not read. A fill down or up whose rows (the block's, those filled and those between) meet the
//! rows the order puts in places of their own, or a paste that lands on them, is refused when a formula it moves
//! reads a row other than its own by a row that moves with it (`formulaReadsAnotherRow`): another cell's relative
//! row, of this sheet or another; `$` rows and whole columns are read wherever the formula goes.

use std::collections::HashSet;

use super::super::place::Place;
use super::super::OwnRowOrder;
use super::{Made, Refused};
use crate::formula::{Reference, StoredFormula};
use crate::ids::LineId;
use crate::workbook::load::Op;
use crate::workbook::Workbook;

/// An order of a sheet's rows: the sheet, and the places (positions in the sheet as stored) its rows are put in, from
/// the first row it names to the last.
#[derive(Clone, Copy)]
pub struct Seen {
    pub sheet: usize,
    pub from: usize,
    pub to: usize,
}

impl Seen {
    /// Whether rows from one position to another meet the places the order puts its rows in.
    pub fn meets(&self, first: usize, last: usize) -> bool {
        first <= self.to && self.from <= last
    }
}

/// The order the edit on a sheet is made in: none when it is of another sheet or names no row the sheet has (then
/// every row is where it is); with it, the rows in the places from its first on, in the order seen.
pub fn read(workbook: &Workbook, order: &OwnRowOrder, sheet_id: &str) -> Result<Option<(Seen, Vec<LineId>)>, Refused> {
    if order.sheet_id != sheet_id {
        return Ok(None);
    }
    // Runs of a base that overlap name a row twice.
    let mut runs: Vec<(&str, u64, u64)> =
        order.rows.iter().map(|r| (r.base.as_str(), r.first as u64, r.first as u64 + r.count as u64)).collect();
    runs.sort();
    if runs.windows(2).any(|w| w[0].0 == w[1].0 && w[1].1 < w[0].2) {
        return Err(Refused::Because("rowNamedTwice"));
    }
    let Some(s) = workbook.sheet_index(sheet_id) else { return Ok(None) };
    let rows = &workbook.sheets[s].rows;
    let mut lines: Vec<LineId> = Vec::new();
    for run in &order.rows {
        let Some(base) = workbook.bases.find(&run.base) else { continue };
        let named = run.first as u64..run.first as u64 + run.count as u64;
        if (run.count as usize) <= rows.len() {
            lines.extend(named.map(|n| LineId { base, n: n as u32 }).filter(|&line| rows.contains(line)));
        } else {
            let mut found: Vec<LineId> = (0..rows.len())
                .filter_map(|p| rows.line(p))
                .filter(|line| line.base == base && named.contains(&(line.n as u64)))
                .collect();
            found.sort_by_key(|line| line.n);
            lines.extend(found);
        }
    }
    let positions = lines.iter().filter_map(|&line| rows.position(line));
    let (Some(from), Some(to)) = (positions.clone().min(), positions.max()) else { return Ok(None) };
    let named: HashSet<LineId> = lines.iter().copied().collect();
    let others = (from..=to).filter_map(|p| rows.line(p)).filter(|line| !named.contains(line));
    let seen: Vec<LineId> = lines.iter().copied().chain(others).collect();
    Ok(Some((Seen { sheet: s, from, to }, seen)))
}

/// The workbook as the person sees it: the order's sheet with its rows in the order seen.
pub fn shown(workbook: &Workbook, seen: &Seen, lines: &[LineId]) -> Workbook {
    let mut shown = workbook.clone();
    let rows = &mut shown.sheets[seen.sheet].rows;
    *rows = rows.reordered(seen.from, lines);
    shown
}

/// An edit made in the order as made on the sheet as stored: rows it adds after the last are after the sheet's last
/// row (the last seen when the order takes it in), and each corner of its place is in the row it is in where the
/// person sees it (the top left can be below the bottom right).
pub fn back(mut made: Made, shown: &Workbook, workbook: &Workbook, seen: &Seen) -> Made {
    let sheet = &workbook.sheets[seen.sheet];
    let (from, to) = (&shown.sheets[seen.sheet].rows, &sheet.rows);
    let last = |rows: &crate::ids::Axis| rows.line(rows.len().wrapping_sub(1)).map(|line| workbook.bases.text(line));
    if let (Some(seen_last), Some(stored_last)) = (last(from), last(to)) {
        for op in &mut made.ops {
            if let Op::InsertRows { sheet_id, after: Some(after), .. } = op {
                if *sheet_id == sheet.id && *after == seen_last {
                    *after = stored_last.clone();
                }
            }
        }
    }
    if let Some(Place::Sheet { sheet_id, cells: Some((t, _, b, _)), .. }) = &mut made.place {
        if *sheet_id == sheet.id {
            let stored = |p: usize| from.line(p).and_then(|line| to.position(line)).unwrap_or(p);
            (*t, *b) = (stored(*t), stored(*b));
        }
    }
    made
}

/// Whether a formula in a row (by its id) reads another row by a row that moves with it.
pub fn reads_another_row(formula: &StoredFormula, own: &str) -> bool {
    let other = |r: &str, absolute: bool| !absolute && r != own;
    formula.references.iter().any(|reference| match reference {
        Reference::Cell { cell, .. } => other(&cell.r, cell.is_row_absolute),
        Reference::Range { top_left, bottom_right, .. } => {
            other(&top_left.r, top_left.is_row_absolute) || other(&bottom_right.r, bottom_right.is_row_absolute)
        }
        Reference::Columns { top, .. } => top.as_ref().is_some_and(|top| other(&top.r, top.is_row_absolute)),
        Reference::Rows { top, bottom, .. } => other(&top.r, top.is_row_absolute) || other(&bottom.r, bottom.is_row_absolute),
    })
}
