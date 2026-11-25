//! Operations: what changes a workbook. `load` applies a workbook's whole history of operations to an empty one;
//! `apply` applies an edit's and answers the operations that would take it back (`reverse`).
//!
//! All 32 operations: inserting, deleting, undeleting and moving sheets, rows and columns, putting rows in order
//! (`reorder.rs`); naming
//! sheets; setting cells and cell formats (`formats.rs`); merging, sizes, sheet settings and groups (`layout.rs`);
//! dropdowns, conditional formats, cell tables, views and placements (`objects.rs`); the time zone, the locale and
//! the seed of random numbers.
//!
//! Deleting keeps what is deleted in its place (a deleted row keeps its cells), so that the reverse, undeleting,
//! brings it back as it was. Formulas keep their references by id: a reference to a deleted cell reads `#REF!`
//! until it is undeleted (`Workbook::locate`).

use hashbrown::HashSet;

use serde::{Deserialize, Serialize};

use super::grid::CellForm;
use super::formats::{blocks, read_format, Leaf};
use super::layout::{written, ColumnsToSize, GroupToSet, RangeIds, RowsToSize, SheetToSet};
use super::objects::{CellTableToSet, ConditionalFormatToSet, DropdownToSet, NamedViewToSet, PlacementToSet, ViewToSet};
use super::reorder::{RowsInOrder, SortedBy};
use super::{Cell, Input, Sheet, Workbook};
use crate::ids::listed_runs::RowRuns;
use crate::ids::{move_items, runs_of, split_id, Axis, AxisError, IdRun, LineId};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Op {
    #[serde(rename_all = "camelCase")]
    InsertSheet {
        sheet_id: String,
        name: String,
        #[serde(deserialize_with = "written::maybe_null")] 
        after: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    InsertRows {
        sheet_id: String,
        #[serde(deserialize_with = "written::maybe_null")] 
        after: Option<String>,
        rows: IdRun,
    },
    #[serde(rename_all = "camelCase")]
    InsertColumns {
        sheet_id: String,
        #[serde(deserialize_with = "written::maybe_null")] 
        after: Option<String>,
        columns: IdRun,
    },
    /// Written as `cells` or, 32 cells or more, as `grid`, unless `listed` (`grid.rs`, `set_cells`).
    #[serde(serialize_with = "super::grid::set_cells::serialize", deserialize_with = "super::grid::set_cells::deserialize")]
    SetCells { sheet_id: String, cells: Vec<CellToSet>, form: CellForm },
    #[serde(rename_all = "camelCase")]
    DeleteRows { sheet_id: String, rows: crate::ids::listed_runs::RowRuns },
    #[serde(rename_all = "camelCase")]
    DeleteColumns { sheet_id: String, columns: Vec<IdRun> },
    #[serde(rename_all = "camelCase")]
    UndeleteRows { sheet_id: String, rows: crate::ids::listed_runs::RowRuns },
    #[serde(rename_all = "camelCase")]
    UndeleteColumns { sheet_id: String, columns: Vec<IdRun> },
    #[serde(rename_all = "camelCase")]
    DeleteSheet { sheet_id: String },
    #[serde(rename_all = "camelCase")]
    UndeleteSheet { sheet_id: String },
    #[serde(rename_all = "camelCase")]
    SetCellFormats { sheet_id: String, formats: Vec<CellsToFormat> },
    SetSheetNames { names: Vec<SheetName> },
    #[serde(rename_all = "camelCase")]
    MergeCells { sheet_id: String, ranges: Vec<RangeIds> },
    #[serde(rename_all = "camelCase")]
    UnmergeCells { sheet_id: String, ranges: Vec<RangeIds> },
    #[serde(rename_all = "camelCase")]
    SetColumnWidths { sheet_id: String, widths: Vec<ColumnsToSize> },
    #[serde(rename_all = "camelCase")]
    SetRowHeights { sheet_id: String, heights: Vec<RowsToSize> },
    SetSheetSettings { sheets: Vec<SheetToSet> },
    Reseed { seed: u32 },
    #[serde(rename_all = "camelCase")]
    SetTimeZone {
        #[serde(deserialize_with = "written::maybe_null")] 
        time_zone: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    AdoptTimeZone { time_zone: String },
    SetLocale { locale: String },
    #[serde(rename_all = "camelCase")]
    SetDropdowns { sheet_id: String, dropdowns: Vec<DropdownToSet> },
    #[serde(rename_all = "camelCase")]
    SetRowGroups { sheet_id: String, groups: Vec<GroupToSet> },
    #[serde(rename_all = "camelCase")]
    SetColumnGroups { sheet_id: String, groups: Vec<GroupToSet> },
    #[serde(rename_all = "camelCase")]
    SetConditionalFormats { sheet_id: String, conditional_formats: Vec<ConditionalFormatToSet> },
    SetViews { views: Vec<ViewToSet> },
    #[serde(rename_all = "camelCase")]
    SetPlacements { sheet_id: String, placements: Vec<PlacementToSet> },
    #[serde(rename_all = "camelCase")]
    SetCellTables { sheet_id: String, cell_tables: Vec<CellTableToSet> },
    #[serde(rename_all = "camelCase")]
    SetNamedViews { sheet_id: String, named_views: Vec<NamedViewToSet> },
    #[serde(rename_all = "camelCase")]
    MoveRows { sheet_id: String, moves: Vec<RowMove> },
    #[serde(rename_all = "camelCase")]
    ReorderRows { sheet_id: String, rows: RowsInOrder, sorted_by: Vec<SortedBy> },
    #[serde(rename_all = "camelCase")]
    MoveColumns { sheet_id: String, moves: Vec<ColumnMove> },
    MoveSheets { moves: Vec<SheetMove> },
}

/// Rows to move, and the row they go after (`None`: to the top).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RowMove {
    pub rows: Vec<IdRun>,
    #[serde(deserialize_with = "written::maybe_null")] 
    pub after: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnMove {
    pub columns: Vec<IdRun>,
    #[serde(deserialize_with = "written::maybe_null")] 
    pub after: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetMove {
    pub sheet_ids: Vec<String>,
    #[serde(deserialize_with = "written::maybe_null")] 
    pub after: Option<String>,
}

impl Op {
    /// Whether the operation reads: no list left empty, no run of no ids or of ids past the
    /// largest (`base.4294967295`). One that is not makes the whole request unreadable, whatever comes before it.
    pub fn is_well_formed(&self) -> bool {
        if let Some(ok) = self.layout_well_formed().or_else(|| self.objects_well_formed()) {
            return ok;
        }
        let run = |r: &IdRun| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32;
        let runs = |runs: &[IdRun]| !runs.is_empty() && runs.iter().all(run);
        match self {
            Op::InsertSheet { .. } | Op::DeleteSheet { .. } | Op::UndeleteSheet { .. } => true,
            Op::InsertRows { rows: r, .. } | Op::InsertColumns { columns: r, .. } => run(r),
            // A formula's text is cut at its references: one piece more than there are references.
            Op::SetCells { cells, .. } => {
                !cells.is_empty()
                    && cells.iter().all(|c| match &c.input {
                        Some(Input::Formula { formula }) => formula.text_between_references.len() == formula.references.len() + 1,
                        Some(Input::User { user_id, label }) => super::rich::is_user_id(user_id) && !label.is_empty(),
                        Some(Input::Users { users }) => super::rich::are_people(users),
                        Some(Input::RichText { paragraphs }) => super::rich::fault(paragraphs).is_none(),
                        _ => true,
                    })
            }
            Op::DeleteRows { rows, .. } | Op::UndeleteRows { rows, .. } => runs(rows),
            Op::DeleteColumns { columns, .. } | Op::UndeleteColumns { columns, .. } => runs(columns),
            Op::SetCellFormats { formats, .. } => {
                !formats.is_empty()
                    && formats.iter().all(|f| runs(&f.rows) && runs(&f.columns) && read_format(&f.format).is_some_and(|l| !l.is_empty()))
            }
            Op::Reseed { .. } | Op::SetTimeZone { .. } | Op::AdoptTimeZone { .. } | Op::SetLocale { .. } => true,
            Op::SetSheetNames { names } => !names.is_empty(),
            Op::MoveRows { moves, .. } => !moves.is_empty() && moves.iter().all(|m| runs(&m.rows)),
            Op::ReorderRows { rows, .. } => rows.is_well_formed(),
            Op::MoveColumns { moves, .. } => !moves.is_empty() && moves.iter().all(|m| runs(&m.columns)),
            Op::MoveSheets { moves } => !moves.is_empty() && moves.iter().all(|m| !m.sheet_ids.is_empty()),
            _ => unreachable!("answered by layout_well_formed or objects_well_formed"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetName {
    pub sheet_id: String,
    pub name: String,
}

/// Cells to format: every row by every column, and the format they take.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellsToFormat {
    /// Written as lists of runs of each base when there are many (`listed_runs`).
    #[serde(with = "crate::ids::listed_runs")]
    pub rows: Vec<IdRun>,
    pub columns: Vec<IdRun>,
    pub format: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellToSet {
    pub r: String,
    pub c: String,
    /// The cell's new input; `null` empties it.
    #[serde(deserialize_with = "written::maybe_null")] 
    pub input: Option<Input>,
}

/// Why operations are refused, as the page reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Refusal {
    UnreadableRequest,
    UnknownSheet,
    UnknownRow,
    UnknownColumn,
    ColumnNamedTwice,
    RowNamedTwice,
    CellNamedTwice,
    RowMovedTwice,
    ColumnMovedTwice,
    SheetMovedTwice,
    MovedAfterWhatIsMoved,
    TwoMovesToOnePlace,
    IdAlreadyHeld,
    /// Undeleting what a load deleted: the load did not keep it.
    DeletedCellsNotLoaded,
    NumberNotFinite,
    SyncInUse,
    CellFormatSetTwice,
    SheetSettingsSetTwice,
    UnknownDropdown,
    DropdownSetTwice,
    DropdownOptionIdInTwoDropdowns,
    DropdownIdTaken,
    DropdownOptionIdTaken,
    DropdownInUse,
    UnknownGroup,
    GroupNamedTwice,
    UnknownConditionalFormat,
    ConditionalFormatNamedTwice,
    ViewNamedTwice,
    ViewInUse,
    UnknownView,
    NamedViewNamedTwice,
    PlacementNamedTwice,
    CellTableNamedTwice,
    RangeAlreadyMerged,
    RangeNotMerged,
    UnknownDropdownOption,
    CellOfDropdownHoldsNoOption,
    CellCoveredByMergedRange,
    TextTooLong,
    FormulaTooLong,
    TooMuchThatNoCellShows,
    IdNotWellFormed,
    EditTooLarge,
    TooManyCellsToEnterIn,
    UserIdNotWellFormed,
    TooManyUsersInCell,
    UserLabelNotAllowed,
    AddressLinkedToTooLong,
    AddressLinkedToNotOfTheWeb,
    RichTextTooLarge,
    RowNotNamedInTheWay,
}

/// Rows or columns: what tells them apart in refusals.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Lines {
    Rows,
    Columns,
}

impl Lines {
    pub(super) fn unknown(self) -> Refusal {
        match self {
            Lines::Rows => Refusal::UnknownRow,
            Lines::Columns => Refusal::UnknownColumn,
        }
    }

    pub(super) fn named_twice(self) -> Refusal {
        match self {
            Lines::Rows => Refusal::RowNamedTwice,
            Lines::Columns => Refusal::ColumnNamedTwice,
        }
    }

    fn moved_twice(self) -> Refusal {
        match self {
            Lines::Rows => Refusal::RowMovedTwice,
            Lines::Columns => Refusal::ColumnMovedTwice,
        }
    }

    fn axis(self, sheet: &mut Sheet) -> &mut Axis {
        match self {
            Lines::Rows => &mut sheet.rows,
            Lines::Columns => &mut sheet.columns,
        }
    }

    pub(super) fn axis_of(self, sheet: &Sheet) -> &Axis {
        match self {
            Lines::Rows => &sheet.rows,
            Lines::Columns => &sheet.columns,
        }
    }

    /// Whether the sheet has had (deleted or not) a line of the run `base.first` to `base.(first + count - 1)`.
    fn holds_any(self, sheet: &Sheet, base: u32, first: u32, count: u32) -> bool {
        let axis = self.axis_of(sheet);
        let mut run = first as u64..first as u64 + count as u64;
        if run.end - run.start <= axis.total() as u64 {
            run.any(|n| axis.knows(LineId { base, n: n as u32 }))
        } else {
            axis.every().iter().any(|l| l.base == base && run.contains(&(l.n as u64)))
        }
    }
}

/// Whether two runs share an id.
fn runs_overlap<'a>(runs: impl Iterator<Item = &'a IdRun>) -> bool {
    let mut runs: Vec<&IdRun> = runs.collect();
    runs.sort_by(|a, b| (&a.base, a.first).cmp(&(&b.base, b.first)));
    runs.windows(2).any(|w| w[0].base == w[1].base && w[0].first as u64 + w[0].count as u64 > w[1].first as u64)
}

/// Whether an id (`base.n`) is in one of the runs.
fn in_runs(id: &str, runs: &[&IdRun]) -> bool {
    let Some((base, n)) = split_id(id) else { return false };
    runs.iter().any(|r| r.base == base && n >= r.first && (n as u64) < r.first as u64 + r.count as u64)
}

impl Workbook {
    /// Applies operations in order, all or none; answers the operations that take them back, last first.
    pub fn apply(&mut self, ops: &[Op]) -> Result<Vec<Op>, Refusal> {
        if !ops.iter().all(Op::is_well_formed) {
            return Err(Refusal::UnreadableRequest);
        }
        // A cell set alone checks every cell before it changes one: refused, it has changed nothing, and no copy is
        // needed to put the workbook back.
        if let [Op::SetCells { .. }] = ops {
            return self.apply_in_place(ops);
        }
        let mut next = self.clone();
        let reverse = next.apply_in_place(ops)?;
        *self = next;
        Ok(reverse)
    }

    /// Applies operations in order to the workbook itself, as `apply` does, but not all or none: refused, those before
    /// stay applied (for a workbook put back or thrown away then, with no copy made of it).
    pub(crate) fn apply_in_place(&mut self, ops: &[Op]) -> Result<Vec<Op>, Refusal> {
        if !ops.iter().all(Op::is_well_formed) {
            return Err(Refusal::UnreadableRequest);
        }
        let mut reverse = Vec::with_capacity(ops.len());
        for op in ops {
            reverse.push(self.apply_one(op)?);
        }
        reverse.reverse();
        self.needs_calculation = true;
        Ok(reverse)
    }

    fn sheet_mut(&mut self, sheet_id: &str) -> Result<&mut Sheet, Refusal> {
        let i = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        Ok(&mut self.sheets[i])
    }

    fn apply_one(&mut self, op: &Op) -> Result<Op, Refusal> {
        match op {
            Op::InsertSheet { sheet_id, name, after } => {
                if self.sheet_order.contains(sheet_id) {
                    return Err(Refusal::IdAlreadyHeld);
                }
                let at = match after {
                    None => 0,
                    Some(a) => self.sheet_order.iter().position(|id| id == a).ok_or(Refusal::UnknownSheet)? + 1,
                };
                self.sheet_order.insert(at, sheet_id.clone());
                self.sheets.push(Sheet { id: sheet_id.clone(), name: name.clone(), ..Sheet::default() });
                self.order_sheets();
                Ok(Op::DeleteSheet { sheet_id: sheet_id.clone() })
            }
            Op::DeleteSheet { sheet_id } => {
                let i = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let sheet = self.sheets.remove(i);
                self.deleted_sheets.push(sheet);
                Ok(Op::UndeleteSheet { sheet_id: sheet_id.clone() })
            }
            Op::UndeleteSheet { sheet_id } => {
                let i = self.deleted_sheets.iter().position(|s| &s.id == sheet_id).ok_or(Refusal::UnknownSheet)?;
                let sheet = self.deleted_sheets.remove(i);
                self.sheets.push(sheet);
                self.order_sheets();
                Ok(Op::DeleteSheet { sheet_id: sheet_id.clone() })
            }
            Op::MoveSheets { moves } => {
                let mut seen = hashbrown::HashSet::new();
                if !moves.iter().flat_map(|m| &m.sheet_ids).all(|id| seen.insert(id.as_str())) {
                    return Err(Refusal::SheetMovedTwice);
                }
                if moves.iter().any(|m| m.after.as_deref().is_some_and(|a| seen.contains(a))) {
                    return Err(Refusal::MovedAfterWhatIsMoved);
                }
                let mut places = hashbrown::HashSet::new();
                if !moves.iter().all(|m| places.insert(m.after.as_deref())) {
                    return Err(Refusal::TwoMovesToOnePlace);
                }
                let index = |id: &str| self.sheet_order.iter().position(|s| s == id);
                let mut indexed = Vec::with_capacity(moves.len());
                for m in moves {
                    let mut ids = Vec::with_capacity(m.sheet_ids.len());
                    for id in &m.sheet_ids {
                        self.sheet_index(id).ok_or(Refusal::UnknownSheet)?;
                        ids.push(index(id).ok_or(Refusal::UnknownSheet)?);
                    }
                    let after = match &m.after {
                        None => None,
                        Some(a) => Some(index(a).ok_or(Refusal::UnknownSheet)?),
                    };
                    indexed.push((ids, after));
                }
                let order: Vec<usize> = (0..self.sheet_order.len()).collect();
                let (moved, back) = move_items(&order, &indexed);
                let id = |i: usize| self.sheet_order[i].clone();
                let reverse = back
                    .into_iter()
                    .map(|(ids, after)| SheetMove { sheet_ids: ids.into_iter().map(id).collect(), after: after.map(id) })
                    .collect();
                self.sheet_order = moved.into_iter().map(id).collect();
                self.order_sheets();
                Ok(Op::MoveSheets { moves: reverse })
            }
            Op::InsertRows { sheet_id, after, rows } | Op::InsertColumns { sheet_id, after, columns: rows } => {
                let lines = if matches!(op, Op::InsertRows { .. }) { Lines::Rows } else { Lines::Columns };
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let base = self.bases.intern(&rows.base);
                // A row's (a column's) id is the workbook's alone: no sheet, deleted or not, may hold it already.
                if self.sheets.iter().chain(&self.deleted_sheets).any(|s| lines.holds_any(s, base, rows.first, rows.count)) {
                    return Err(Refusal::IdAlreadyHeld);
                }
                let after = match after {
                    None => None,
                    Some(id) => Some(self.line(id).ok_or(lines.unknown())?),
                };
                lines.axis(&mut self.sheets[index]).insert_after(after, base, rows.first, rows.count).map_err(|e| match e {
                    AxisError::Taken => Refusal::IdAlreadyHeld,
                    AxisError::Unknown => lines.unknown(),
                })?;
                Ok(match lines {
                    Lines::Rows => Op::DeleteRows { sheet_id: sheet_id.clone(), rows: RowRuns::written(vec![rows.clone()]) },
                    Lines::Columns => Op::DeleteColumns { sheet_id: sheet_id.clone(), columns: vec![rows.clone()] },
                })
            }
            Op::DeleteRows { sheet_id, rows: RowRuns { runs, .. } }
            | Op::DeleteColumns { sheet_id, columns: runs }
            | Op::UndeleteRows { sheet_id, rows: RowRuns { runs, .. } }
            | Op::UndeleteColumns { sheet_id, columns: runs } => {
                // The reverse gives the rows back in the form they came in.
                let listed = matches!(op, Op::DeleteRows { rows, .. } | Op::UndeleteRows { rows, .. } if rows.listed);
                let lines = if matches!(op, Op::DeleteRows { .. } | Op::UndeleteRows { .. }) { Lines::Rows } else { Lines::Columns };
                let undelete = matches!(op, Op::UndeleteRows { .. } | Op::UndeleteColumns { .. });
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                if runs_overlap(runs.iter()) {
                    return Err(lines.named_twice());
                }
                let total = lines.axis_of(&self.sheets[index]).total();
                let named = self.lines_of(runs, total).ok_or(lines.unknown())?;
                let axis = lines.axis(&mut self.sheets[index]);
                let known = |l: &LineId| if undelete { axis.is_deleted(*l) } else { axis.contains(*l) };
                if !named.iter().all(known) {
                    return Err(lines.unknown());
                }
                if undelete {
                    axis.undelete(&named);
                } else {
                    axis.delete(&named);
                }
                let (sheet_id, runs) = (sheet_id.clone(), runs.clone());
                Ok(match (lines, undelete) {
                    (Lines::Rows, false) => Op::UndeleteRows { sheet_id, rows: RowRuns { runs, listed } },
                    (Lines::Columns, false) => Op::UndeleteColumns { sheet_id, columns: runs },
                    (Lines::Rows, true) => Op::DeleteRows { sheet_id, rows: RowRuns { runs, listed } },
                    (Lines::Columns, true) => Op::DeleteColumns { sheet_id, columns: runs },
                })
            }
            Op::MoveRows { sheet_id, moves: row_moves } => {
                let moves: Vec<(&[IdRun], Option<&str>)> = row_moves.iter().map(|m| (m.rows.as_slice(), m.after.as_deref())).collect();
                let back = self.move_lines(sheet_id, Lines::Rows, &moves)?;
                let moves = back.into_iter().map(|(rows, after)| RowMove { rows, after }).collect();
                Ok(Op::MoveRows { sheet_id: sheet_id.clone(), moves })
            }
            Op::ReorderRows { sheet_id, rows, sorted_by } => self.reorder_rows(sheet_id, rows, sorted_by),
            Op::MoveColumns { sheet_id, moves: column_moves } => {
                let moves: Vec<(&[IdRun], Option<&str>)> =
                    column_moves.iter().map(|m| (m.columns.as_slice(), m.after.as_deref())).collect();
                let back = self.move_lines(sheet_id, Lines::Columns, &moves)?;
                let moves = back.into_iter().map(|(columns, after)| ColumnMove { columns, after }).collect();
                Ok(Op::MoveColumns { sheet_id: sheet_id.clone(), moves })
            }
            Op::SetSheetNames { names } => {
                let mut old = Vec::with_capacity(names.len());
                for SheetName { sheet_id, name } in names {
                    let sheet = self.sheet_mut(sheet_id)?;
                    old.push(SheetName { sheet_id: sheet_id.clone(), name: std::mem::replace(&mut sheet.name, name.clone()) });
                }
                Ok(Op::SetSheetNames { names: old })
            }
            Op::SetCells { sheet_id, cells, form } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut lines = Vec::with_capacity(cells.len());
                let mut named = hashbrown::HashSet::with_capacity(cells.len());
                for cell in cells {
                    let r = self.line(&cell.r).filter(|l| self.sheets[index].rows.contains(*l)).ok_or(Refusal::UnknownRow)?;
                    let c = self.line(&cell.c).filter(|l| self.sheets[index].columns.contains(*l)).ok_or(Refusal::UnknownColumn)?;
                    // A cell named twice is refused, not set twice over.
                    if !named.insert((r, c)) {
                        return Err(Refusal::CellNamedTwice);
                    }
                    if let Some(Input::Number { value }) = &cell.input {
                        if !value.is_finite() {
                            return Err(Refusal::NumberNotFinite);
                        }
                    }
                    lines.push((r, c));
                }
                let sheet = &mut self.sheets[index];
                let mut old = Vec::with_capacity(cells.len());
                for (cell, &(r, c)) in cells.iter().zip(&lines) {
                    let before = match &cell.input {
                        Some(input) => sheet.cells.insert((r, c), Cell::new(input.clone())),
                        None => sheet.cells.remove(&(r, c)),
                    };
                    old.push(CellToSet { r: cell.r.clone(), c: cell.c.clone(), input: before.map(|b| b.input) });
                }
                // What a set cell's formula last came to is gone until the formulas are worked out again, unless it
                // was given what it held.
                for ((r, c), (cell, was)) in lines.into_iter().zip(cells.iter().zip(&old)) {
                    if cell.input.is_none() || cell.input != was.input {
                        self.outcomes.remove(&super::OutcomeAt(sheet_id, r, c));
                    }
                }
                Ok(Op::SetCells { sheet_id: sheet_id.clone(), cells: old, form: *form })
            }
            Op::SetCellFormats { sheet_id, formats } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let sheet = &self.sheets[index];
                let mut set = Vec::new();
                let mut seen = HashSet::new();
                for f in formats {
                    let leaves = read_format(&f.format).expect("checked when read");
                    let rows = self.lines_of(&f.rows, sheet.rows.total()).filter(|l| l.iter().all(|r| sheet.rows.contains(*r)));
                    let rows = rows.ok_or(Refusal::UnknownRow)?;
                    let columns =
                        self.lines_of(&f.columns, sheet.columns.total()).filter(|l| l.iter().all(|c| sheet.columns.contains(*c)));
                    let columns = columns.ok_or(Refusal::UnknownColumn)?;
                    for (leaf, value) in &leaves {
                        if *leaf == Leaf::CellControl && value["kind"] == "dropdown" {
                            let id = value["dropdownId"].as_str().unwrap_or_default();
                            if !sheet.dropdowns.contains_key(&super::layout::id_key(id)) {
                                return Err(Refusal::UnknownDropdown);
                            }
                        }
                    }
                    for &r in &rows {
                        for &c in &columns {
                            for (leaf, value) in &leaves {
                                if !seen.insert((r, c, *leaf)) {
                                    return Err(Refusal::CellFormatSetTwice);
                                }
                                set.push((*leaf, (r, c), value.clone()));
                            }
                        }
                    }
                }
                let sheet = &mut self.sheets[index];
                let mut old = Vec::with_capacity(set.len());
                for (leaf, cell, value) in set {
                    old.push((leaf, cell, sheet.formats.value(leaf, cell)));
                    sheet.formats.set(leaf, cell, value);
                }
                let formats = blocks(&self.bases, old.iter().map(|(l, c, v)| (*l, *c, v)))
                    .into_iter()
                    .map(|(rows, columns, format)| CellsToFormat { rows, columns, format })
                    .collect();
                Ok(Op::SetCellFormats { sheet_id: sheet_id.clone(), formats })
            }
            Op::Reseed { seed } => Ok(Op::Reseed { seed: std::mem::replace(&mut self.seed, *seed) }),
            // A zone is kept by the name given (a clock reading counts only under that name); `readWorkbook` names
            // it as the zone's own (US/Central is America/Chicago).
            Op::SetTimeZone { time_zone } => {
                if let Some(name) = time_zone {
                    super::time_zone_named(name).ok_or(Refusal::UnreadableRequest)?;
                }
                Ok(Op::SetTimeZone { time_zone: std::mem::replace(&mut self.time_zone, time_zone.clone()) })
            }
            Op::AdoptTimeZone { time_zone } => {
                super::time_zone_named(time_zone).ok_or(Refusal::UnreadableRequest)?;
                let old = self.time_zone.clone();
                if old.is_none() {
                    self.time_zone = Some(time_zone.clone());
                }
                Ok(Op::SetTimeZone { time_zone: old })
            }
            Op::SetLocale { locale } => {
                if super::locale_facts(locale).is_none() {
                    return Err(Refusal::UnreadableRequest);
                }
                Ok(Op::SetLocale { locale: std::mem::replace(&mut self.locale, locale.clone()) })
            }
            Op::MergeCells { .. }
            | Op::UnmergeCells { .. }
            | Op::SetColumnWidths { .. }
            | Op::SetRowHeights { .. }
            | Op::SetSheetSettings { .. }
            | Op::SetRowGroups { .. }
            | Op::SetColumnGroups { .. } => self.apply_layout(op),
            Op::SetDropdowns { .. }
            | Op::SetConditionalFormats { .. }
            | Op::SetCellTables { .. }
            | Op::SetNamedViews { .. }
            | Op::SetViews { .. }
            | Op::SetPlacements { .. } => self.apply_objects(op),
        }
    }

    /// Moves rows or columns of a sheet; answers the moves that put them back, as runs.
    fn move_lines(&mut self, sheet_id: &str, lines: Lines, moves: &[(&[IdRun], Option<&str>)]) -> Result<Vec<(Vec<IdRun>, Option<String>)>, Refusal> {
        let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        let moved: Vec<&IdRun> = moves.iter().flat_map(|(runs, _)| runs.iter()).collect();
        if runs_overlap(moved.iter().copied()) {
            return Err(lines.moved_twice());
        }
        if moves.iter().any(|(_, after)| after.is_some_and(|a| in_runs(a, &moved))) {
            return Err(Refusal::MovedAfterWhatIsMoved);
        }
        let mut places = hashbrown::HashSet::new();
        if !moves.iter().all(|(_, after)| places.insert(*after)) {
            return Err(Refusal::TwoMovesToOnePlace);
        }
        let axis = lines.axis_of(&self.sheets[index]);
        let mut resolved = Vec::with_capacity(moves.len());
        for (runs, after) in moves {
            let named = self.lines_of(runs, axis.total()).filter(|n| n.iter().all(|l| axis.contains(*l))).ok_or(lines.unknown())?;
            let after = match after {
                None => None,
                Some(a) => Some(self.line(a).filter(|l| axis.knows(*l)).ok_or(lines.unknown())?),
            };
            resolved.push((named, after));
        }
        let back = lines.axis(&mut self.sheets[index]).move_lines(&resolved);
        Ok(back.into_iter().map(|(l, after)| (runs_of(&l, &self.bases), after.map(|a| self.bases.text(a)))).collect())
    }

    /// The lines of runs, when every base is known and there are no more than `most` of them (more cannot all be
    /// in a sheet that has had `most` lines).
    pub(super) fn lines_of(&self, runs: &[IdRun], most: usize) -> Option<Vec<LineId>> {
        if runs.iter().map(|r| r.count as u64).sum::<u64>() > most as u64 {
            return None;
        }
        let mut lines = Vec::new();
        for run in runs {
            let base = self.bases.find(&run.base)?;
            lines.extend((run.first as u64..run.first as u64 + run.count as u64).map(|n| LineId { base, n: n as u32 }));
        }
        Some(lines)
    }

    /// A row or column id whose base the workbook knows.
    pub(super) fn line(&self, id: &str) -> Option<LineId> {
        split_id(id)?;
        self.bases.parse(id)
    }
}
