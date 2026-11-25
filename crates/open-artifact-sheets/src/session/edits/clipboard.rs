//! Copied cells pasted, cells moved, and cells filled from others.
//!
//! Kinds: pasteCopiedCells, pasteValuesOfCopiedCells, pasteCellsOfAnotherProgram, pasteValuesOfCells, moveCells,
//! fillCells.
//!
//! `pasteCopiedCells` pastes a copy the page took with `readCellsToCopy` (`copiedCellsAsText`, `copied_cells.rs`)
//! into the cells selected, from their top left:
//!
//! - A copy of one row is pasted on every row selected, one of one column on every column selected (so one cell
//!   fills the selection), unless it left out the blank rows (or columns) at the end of its sheet; a larger copy is
//!   pasted once, its own size. A copy pasted more than once over a merged range that is also in a row selected is
//!   pasted once instead, and one that would give a cell a merged range covers something refuses
//!   (`pasteCutsMergedCells`).
//! - With rows out of view in the way (`mayLandIn`, the rows a copy of more than one row may land in), a paste on
//!   any other row the sheet has refuses (`rowNotNamedInTheWay`).
//! - A paste past the sheet's last row or column adds the rows and columns it needs first (`row_<code>.0`, …), up to
//!   1,000 rows and 26 columns and one more of each for every cell the copy gives, whatever the sheet's size (else
//!   `pasteDoesNotFit`). Then a copy pasted over and over that sets more than a fill may refuses
//!   (`repeatedPasteTooLarge`, `MOST_WEIGHT_SET`: about 131,764 cells given one number).
//! - Every cell pasted over takes the copy's input or is emptied; a formula's relative references move as far as
//!   the copy did (`typing::formula::moved`). A dropdown's option stays one when the sheet has a dropdown with it
//!   (whose label it takes), else it is its label as text.
//! - The formats of the cells pasted over are taken away, then the copy's are set, a dropdown's only where the
//!   sheet has that dropdown; colors (fills, fonts') only when they are pasted (`copiedColors`).
//! - A paste, a move or a fill that leaves more cells of dropdowns holding none of their options than there were
//!   refuses once its operations are applied (`cellOfDropdownHoldsNoOption`, `edits::options_kept`).
//! - Formulas pasted with many words of their own are shown to the person first, as typed ones are
//!   (`typing/unseen.rs`): once the cells are given (after `formulaTooLong` and `pasteCutsMergedCells`), the paste
//!   answers `toBeShownFirst` until it is queued with exactly those texts as `shownToThePerson`, or refuses more
//!   than 50 of them. Values pastes show nothing.
//!
//! The others:
//!
//! - `pasteValuesOfCopiedCells` pastes the values of a copy as `readCellsToCopy` wrote them (`values`): the copy's
//!   cells that are values, and the values beside them in place of its formulas and options, with their number
//!   formats and no other format. Without values (`notWritten`), or with values not of the copy, the copy is not
//!   read.
//! - `pasteCellsOfAnotherProgram` pastes cells another program put on the clipboard (`clipboard/another_program.rs`).
//! - `pasteValuesOfCells` copies cells and pastes their values at once, from a cell's top left, on any sheet: the
//!   empty rows and columns at the end of their sheet too. The formulas waiting for `calculate` are worked out first.
//! - `moveCells` moves a block of cells (one block: `rowNotNamedInTheWay` for rows out of view in it) to a cell's
//!   top left, on any sheet, growing it as a paste does: what they hold, their formats (those of the cells landed on
//!   taken away), and the tables all on the block (deleted, moved to another sheet). Formulas anywhere naming cells
//!   of the block follow them, a range only when both its corners are in it.
//! - `fillCells` fills the rows above or below a block, or the columns to its left or right, line by line: each goes
//!   on as its cells do (`continuePatterns`: numbers, dates and times by a step, names of days, months and quarters,
//!   texts ending in a number), or the block is repeated (`repeatSource`), with its formats.
//!
//! The place changed is the cells pasted over.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use hashbrown::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{Context, Made, Refused};
use crate::copied_cells::{CopiedCell, CopiedCells, CopiedFormat, CopiedInput, CopiedValues, Span};
use crate::dates;
use crate::formula::{CellPoint, Reference, StoredFormula};
use crate::formula_text;
use crate::ids::{self, split_id, Axis, Bases, IdRun, LineId};
use crate::locale::{self, Locale};
use crate::number_format::{names, Kind, NumberFormat};
use crate::session::place::Place;
use crate::session::reads::clipboard::{copied, copied_formats, CellsBetween};
use crate::typing::{formula, unseen, were_shown, TextThatNoCellShows};
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{read_format, sorted_runs, write_format, Leaf};
use crate::workbook::layout::{written, CellIds};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{shown_cell_table, CellTable, CellTableToSet, RowsOfACellTable};
use crate::workbook::{rich, Input, Sheet, Workbook};

mod another_program;

use another_program::{Looks, PasteCellsOfAnotherProgram};

/// The most bytes a formula may have, and the most references.
const LONGEST_FORMULA: usize = 8192;
const MOST_REFERENCES: usize = 256;

/// The most rows and columns a sheet can have.
const MOST_ROWS: u64 = 1_048_576;
const MOST_COLUMNS: u64 = 16_384;

/// The most rows and columns a paste may add, one more of each for every cell the copy gives.
const MOST_ROWS_ADDED: u64 = 1000;
const MOST_COLUMNS_ADDED: u64 = 26;


pub enum Edit {
    PasteCopiedCells(PasteCopiedCells),
    PasteValuesOfCopiedCells(PasteValuesOfCopiedCells),
    PasteCellsOfAnotherProgram(PasteCellsOfAnotherProgram),
    PasteValuesOfCells(PasteValuesOfCells),
    MoveCells(MoveCells),
    FillCells(FillCells),
}

/// Cells selected: rows (by runs), from one column to another.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selected {
    sheet_id: String,
    rows: Vec<IdRun>,
    one_column: String,
    other_column: String,
}

/// Whether a copy's colors (of fills and fonts) are pasted, or are not yet.
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CopiedColors {
    ArePasted,
    AreNotPastedYet,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasteCopiedCells {
    selected: Selected,
    copied_cells_as_text: String,
    copied_colors: CopiedColors,
    /// The rows a copy may land in when rows out of view are in its way.
    #[serde(default)]
    may_land_in: Option<Vec<IdRun>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasteValuesOfCopiedCells {
    selected: Selected,
    /// The copy as `readCellsToCopy` answered it (`null` is no copy).
    #[serde(deserialize_with = "written::maybe_null")]
    copied_cells_as_text: Option<String>,
    values: Values,
    #[serde(default)]
    may_land_in: Option<Vec<IdRun>>,
}

/// The values of copied cells, as `readCellsToCopy` answered them.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Values {
    /// Formulas waited to be worked out: no values.
    NotWritten {},
    /// Every cell copied is its own value.
    WrittenAsTheCopiedCells {},
    /// A copy of the same cells whose cells are the values of the formulas and of the options copied.
    #[serde(rename_all = "camelCase")]
    WrittenBesideTheCopiedCells { as_text: String },
}

impl Edit {
    /// The sheet a paste or a fill down or up lays out in the order the person sees its rows (`seen`); a fill's block
    /// is looked for first.
    pub fn in_seen_order(&self, workbook: &Workbook) -> Option<&str> {
        match self {
            Edit::PasteCopiedCells(edit) => Some(&edit.selected.sheet_id),
            Edit::PasteValuesOfCopiedCells(edit) => Some(&edit.selected.sheet_id),
            Edit::PasteCellsOfAnotherProgram(edit) => Some(&edit.selected.sheet_id),
            Edit::FillCells(edit @ FillCells { lines_to_fill: LinesToFill::Rows { .. }, .. }) => {
                let s = workbook.sheet_index(&edit.source.sheet_id)?;
                let found = !positions(&workbook.bases, &workbook.sheets[s].rows, &edit.source.rows).is_empty();
                found.then_some(edit.source.sheet_id.as_str())
            }
            _ => None,
        }
    }

    /// Whether the edit pastes the values cells have now (`pasteValuesOfCells`): formulas waiting for `calculate` are
    /// worked out first.
    pub fn measures_values(&self) -> bool {
        matches!(self, Edit::PasteValuesOfCells(_))
    }
}

impl Values {
    /// The values as written, unless a copy beside is not one that reads.
    fn read(&self) -> Option<CopiedValues> {
        Some(match self {
            Values::NotWritten {} => CopiedValues::NotWritten,
            Values::WrittenAsTheCopiedCells {} => CopiedValues::WrittenAsTheCopiedCells,
            Values::WrittenBesideTheCopiedCells { as_text } => {
                CopiedValues::WrittenBesideTheCopiedCells(CopiedCells::read(as_text)?)
            }
        })
    }
}

/// The values of cells copied and pasted at once, from a cell's top left (on any sheet).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasteValuesOfCells {
    cells: CellsBetween,
    to_sheet_id: String,
    to_top_left: CellIds,
}

/// Cells selected moved, with what they hold and their formats, to a cell's top left (on any sheet).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveCells {
    cells: Selected,
    to_sheet_id: String,
    to_top_left: CellIds,
    /// The rows the cells may land in when rows out of view are in their way.
    #[serde(default)]
    may_land_in: Option<Vec<IdRun>>,
}

/// Cells filled from a block of others beside them (`source`): rows above or below it, or the columns to its left
/// or right.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FillCells {
    source: Selected,
    lines_to_fill: LinesToFill,
    filled_cells: FilledCells,
}

/// The lines a fill fills.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum LinesToFill {
    /// Rows above or below the block, without a gap between them and it.
    Rows { rows: Vec<IdRun> },
    /// The columns from beside the block as far as one, to its left or right.
    ColumnsAsFarAs { column: String },
}

/// What the cells filled are given: the patterns of the block's lines continued, or the block over and over.
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilledCells {
    ContinuePatterns,
    RepeatSource,
}

/// Whether runs read: some, each of some ids, none past the largest.
fn runs_read(runs: &[IdRun]) -> bool {
    !runs.is_empty() && runs.iter().all(|r| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32)
}

pub fn read(edit: &Json) -> Option<Edit> {
    let mut fields = edit.as_object()?.clone();
    let kind = fields.remove("kind")?;
    let fields = Json::Object(fields);
    match kind.as_str()? {
        "pasteCopiedCells" => {
            let edit = PasteCopiedCells::deserialize(&fields).ok()?;
            let reads = runs_read(&edit.selected.rows) && edit.may_land_in.as_deref().is_none_or(runs_read);
            reads.then_some(Edit::PasteCopiedCells(edit))
        }
        "pasteValuesOfCopiedCells" => {
            let edit = PasteValuesOfCopiedCells::deserialize(&fields).ok()?;
            let reads = runs_read(&edit.selected.rows) && edit.may_land_in.as_deref().is_none_or(runs_read);
            reads.then_some(Edit::PasteValuesOfCopiedCells(edit))
        }
        "pasteCellsOfAnotherProgram" => {
            let edit = PasteCellsOfAnotherProgram::deserialize(&fields).ok()?;
            edit.reads().then_some(Edit::PasteCellsOfAnotherProgram(edit))
        }
        "pasteValuesOfCells" => Some(Edit::PasteValuesOfCells(PasteValuesOfCells::deserialize(&fields).ok()?)),
        "moveCells" => {
            let edit = MoveCells::deserialize(&fields).ok()?;
            let reads = runs_read(&edit.cells.rows) && edit.may_land_in.as_deref().is_none_or(runs_read);
            reads.then_some(Edit::MoveCells(edit))
        }
        "fillCells" => {
            let edit = FillCells::deserialize(&fields).ok()?;
            let reads = runs_read(&edit.source.rows)
                && match &edit.lines_to_fill {
                    LinesToFill::Rows { rows } => runs_read(rows),
                    LinesToFill::ColumnsAsFarAs { .. } => true,
                };
            reads.then_some(Edit::FillCells(edit))
        }
        _ => None,
    }
}

pub fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let made = match edit {
        Edit::PasteCopiedCells(edit) => {
            let how = What::Cells { colors: edit.copied_colors == CopiedColors::ArePasted };
            let copy = CopiedCells::read(&edit.copied_cells_as_text);
            paste(workbook, &edit.selected, edit.may_land_in.as_deref(), copy, how, None, context)
        }
        Edit::PasteValuesOfCopiedCells(edit) => {
            let copy = edit.copied_cells_as_text.as_deref().and_then(CopiedCells::read);
            let copy = copy.zip(edit.values.read()).and_then(|(copy, values)| values_copy(copy, values));
            paste(workbook, &edit.selected, edit.may_land_in.as_deref(), copy, What::Values, None, context)
        }
        Edit::PasteCellsOfAnotherProgram(edit) => {
            let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
            let (copy, looks) = edit.copy(locale).unzip();
            let how = What::Cells { colors: true };
            paste(workbook, &edit.selected, edit.may_land_in.as_deref(), copy, how, looks.as_ref(), context)
        }
        Edit::PasteValuesOfCells(edit) => {
            // The cell pasted from is looked for first, then the cells copied.
            let s = workbook.sheet_index(&edit.to_sheet_id).ok_or(Refused::Because("unknownSheet"))?;
            let sheet = &workbook.sheets[s];
            let line = |id: &str, axis: &Axis, refusal| {
                workbook.bases.parse(id).filter(|&l| axis.position(l).is_some()).ok_or(Refused::Because(refusal))
            };
            let row = line(&edit.to_top_left.r, &sheet.rows, "unknownRow")?;
            line(&edit.to_top_left.c, &sheet.columns, "unknownColumn")?;
            // The cells are copied whole: the empty rows and columns at the end of their sheet are pasted too.
            let copied = copied(workbook, &edit.cells, &[], true).map_err(Refused::Because)?;
            let copy = copied.copy.and_then(|copy| values_copy(copy, copied.values));
            let selected = Selected {
                sheet_id: edit.to_sheet_id,
                rows: vec![IdRun { base: workbook.bases.name(row.base).to_owned(), first: row.n, count: 1 }],
                one_column: edit.to_top_left.c.clone(),
                other_column: edit.to_top_left.c,
            };
            paste(workbook, &selected, None, copy, What::Values, None, context)
        }
        Edit::MoveCells(edit) => move_cells(workbook, &edit, context),
        Edit::FillCells(edit) => fill_cells(workbook, &edit, context),
    }?;
    super::options_kept(workbook, made)
}

/// The positions of the lines runs name that the axis has, not deleted; others are passed over.
fn positions(bases: &Bases, axis: &Axis, runs: &[IdRun]) -> BTreeSet<usize> {
    let mut out = BTreeSet::new();
    for run in runs {
        let Some(base) = bases.find(&run.base) else { continue };
        let end = run.first as u64 + run.count as u64;
        if (run.count as usize) <= axis.len() {
            out.extend((run.first as u64..end).filter_map(|n| axis.position(LineId { base, n: n as u32 })));
        } else {
            let named = |l: LineId| l.base == base && (run.first as u64..end).contains(&(l.n as u64));
            out.extend((0..axis.len()).filter(|&p| axis.line(p).is_some_and(named)));
        }
    }
    out
}

/// Whether runs name a line.
fn names(bases: &Bases, runs: &[IdRun], line: LineId) -> bool {
    let base = bases.name(line.base);
    runs.iter().any(|r| r.base == base && (r.first as u64..r.first as u64 + r.count as u64).contains(&(line.n as u64)))
}

/// The sheet and columns of a selection: the sheet's index and its leftmost and rightmost columns.
fn selected_columns(workbook: &Workbook, selected: &Selected) -> Result<(usize, usize, usize), Refused> {
    let s = workbook.sheet_index(&selected.sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    let sheet = &workbook.sheets[s];
    let column = |id: &str| {
        workbook.bases.parse(id).and_then(|l| sheet.columns.position(l)).ok_or(Refused::Because("unknownColumn"))
    };
    let (a, b) = (column(&selected.one_column)?, column(&selected.other_column)?);
    Ok((s, a.min(b), a.max(b)))
}

/// Where a copy lands: the top rows and left columns it is pasted from (more than one when it is pasted over and
/// over), and its size.
struct Landing {
    rows: Vec<usize>,
    columns: Vec<usize>,
    row_count: u64,
    column_count: u64,
}

impl Landing {
    /// A copy of one row is pasted on every row selected, one of one column on every column selected, unless the
    /// copy left out the blank rows (or columns) at the end of its sheet.
    fn of(rows: &BTreeSet<usize>, left: usize, right: usize, copy: &CopiedCells) -> Landing {
        let top = *rows.first().expect("a row selected");
        let (row_count, column_count) = (copy.row_count, copy.column_count);
        let every_row = row_count == 1 && copy.blank_rows_left_out != Some(true);
        let every_column = column_count == 1 && copy.blank_columns_left_out != Some(true);
        Landing {
            rows: if every_row { rows.iter().copied().collect() } else { vec![top] },
            columns: if every_column { (left..=right).collect() } else { vec![left] },
            row_count,
            column_count,
        }
    }

    fn is_repeated(&self) -> bool {
        self.rows.len() > 1 || self.columns.len() > 1
    }

    /// Pasted once, from the top left.
    fn once(&self) -> Landing {
        Landing { rows: vec![self.rows[0]], columns: vec![self.columns[0]], ..*self }
    }

    fn bottom(&self) -> u64 {
        *self.rows.last().expect("a row") as u64 + self.row_count - 1
    }

    fn right(&self) -> u64 {
        *self.columns.last().expect("a column") as u64 + self.column_count - 1
    }

    /// Whether a box (top, bottom, left, right) is in the way of the paste: in the rows and columns pasted over, and in
    /// a row selected (not necessarily one pasted over). A merged range below the rows selected (a copy of one column
    /// pasted across columns goes on below them) is not in its way, nor is one in rows selected the paste stops above.
    fn meets_selected(&self, selected: &BTreeSet<usize>, (t, b, l, r): (usize, usize, usize, usize)) -> bool {
        let columns =
            self.columns.iter().any(|&p| p as u64 <= r as u64 && l as u64 <= p as u64 + self.column_count - 1);
        let rows = self.rows.iter().any(|&p| p as u64 <= b as u64 && t as u64 <= p as u64 + self.row_count - 1);
        columns && rows && selected.range(t..=b).next().is_some()
    }

    /// The rows pasted over, in order; and the columns.
    fn area_rows(&self) -> Vec<usize> {
        self.rows.iter().flat_map(|&t| t..t + self.row_count as usize).collect()
    }

    fn area_columns(&self) -> Vec<usize> {
        self.columns.iter().flat_map(|&l| l..l + self.column_count as usize).collect()
    }
}

/// The workbook with the rows and columns a paste adds after the sheet's last ones, to reach its bottom row and right
/// column (`row_<code>.0`, …, then `col_<code>.0`, …), and the operations adding them.
fn grown<'a>(workbook: &'a Workbook, s: usize, bottom: u64, right: u64, code: &str) -> (Cow<'a, Workbook>, Vec<Op>) {
    let sheet = &workbook.sheets[s];
    let rows_added = (bottom + 1).saturating_sub(sheet.rows.len() as u64) as u32;
    let columns_added = (right + 1).saturating_sub(sheet.columns.len() as u64) as u32;
    if rows_added == 0 && columns_added == 0 {
        return (Cow::Borrowed(workbook), Vec::new());
    }
    let mut grown = workbook.clone();
    let mut ops = Vec::new();
    for (added, prefix) in [(rows_added, "row"), (columns_added, "col")] {
        if added == 0 {
            continue;
        }
        let base_name = format!("{prefix}_{code}");
        let base = grown.bases.intern(&base_name);
        let sheet = &mut grown.sheets[s];
        let axis = if prefix == "row" { &mut sheet.rows } else { &mut sheet.columns };
        let last = axis.line(axis.len().wrapping_sub(1));
        axis.insert_after(last, base, 0, added).expect("ids of the edit's own");
        let after = last.map(|l| workbook.bases.text(l));
        let run = IdRun { base: base_name, first: 0, count: added };
        ops.push(if prefix == "row" {
            Op::InsertRows { sheet_id: sheet.id.clone(), after, rows: run }
        } else {
            Op::InsertColumns { sheet_id: sheet.id.clone(), after, columns: run }
        });
    }
    (Cow::Owned(grown), ops)
}

/// What a paste pastes of a copy: its cells (inputs and formats; colors when they are pasted), or their values.
#[derive(Clone, Copy, PartialEq, Eq)]
enum What {
    Cells { colors: bool },
    Values,
}

impl What {
    /// Whether a paste gives (and takes away) a format's leaf: values only their number formats.
    fn pastes(self, leaf: Leaf) -> bool {
        match self {
            What::Cells { colors } => colors || !matches!(leaf, Leaf::FillColor | Leaf::FontColor),
            What::Values => leaf == Leaf::NumberFormat,
        }
    }
}

/// The copy of the values of copied cells, when they were written: the copy's cells that are values, with the values
/// beside them in place of its formulas and options (a copy of the same cells, but for its cells and formats, holding
/// values alone), and the number formats of the copy (or of the values beside it). Without values, or with values
/// that are not the copy's, the copy is not read.
fn values_copy(copy: CopiedCells, values: CopiedValues) -> Option<CopiedCells> {
    let is_value = |input: &CopiedInput| {
        matches!(
            input,
            CopiedInput::Number { .. }
                | CopiedInput::Text { .. }
                | CopiedInput::Boolean { .. }
                | CopiedInput::User { .. }
                | CopiedInput::Users { .. }
        )
    };
    match values {
        CopiedValues::NotWritten => None,
        CopiedValues::WrittenAsTheCopiedCells => copy.cells.iter().all(|cell| is_value(&cell.input)).then_some(copy),
        CopiedValues::WrittenBesideTheCopiedCells(beside) => {
            let same = |c: &CopiedCells| {
                (c.top_row_position, c.left_column_position, c.row_count, c.column_count)
                    == (copy.top_row_position, copy.left_column_position, copy.row_count, copy.column_count)
                    && (c.blank_rows_left_out, c.blank_columns_left_out)
                        == (copy.blank_rows_left_out, copy.blank_columns_left_out)
            };
            if !same(&beside) || !beside.cells.iter().all(|cell| is_value(&cell.input)) {
                return None;
            }
            let given: HashSet<(u32, u32)> = beside.cells.iter().map(|cell| (cell.row, cell.column)).collect();
            let mut cells: Vec<CopiedCell> = copy
                .cells
                .into_iter()
                .filter(|cell| is_value(&cell.input) && !given.contains(&(cell.row, cell.column)))
                .chain(beside.cells)
                .collect();
            cells.sort_by_key(|cell| (cell.row, cell.column));
            Some(CopiedCells { cells, formats: beside.formats, ..copy })
        }
    }
}

/// Pastes a copy (`None` when it is not read) on the cells selected; one of cells of another program with their
/// looks.
fn paste(
    workbook: &Workbook,
    selected: &Selected,
    may_land_in: Option<&[IdRun]>,
    copy: Option<CopiedCells>,
    what: What,
    looks: Option<&Looks>,
    context: &Context,
) -> Result<Made, Refused> {
    let (s, left, right) = selected_columns(workbook, selected)?;
    let sheet = &workbook.sheets[s];
    let rows = positions(&workbook.bases, &sheet.rows, &selected.rows);
    if rows.is_empty() {
        return Err(Refused::Because("unknownRow"));
    }
    let copy = copy.ok_or(Refused::Because("unreadableCopiedCells"))?;
    // The rows a copy may land in are looked at only for a copy of more than one row.
    if let (Some(runs), true) = (may_land_in, copy.row_count > 1) {
        if positions(&workbook.bases, &sheet.rows, runs).is_empty() {
            return Err(Refused::Because("unknownRow"));
        }
    }
    let mut landing = Landing::of(&rows, left, right, &copy);
    // Cells of another program are pasted once down whole columns (every row of the sheet selected, in any order),
    // and once across whole rows.
    if looks.is_some() {
        if rows.len() == sheet.rows.len() {
            landing.rows.truncate(1);
        }
        if left == 0 && right + 1 == sheet.columns.len() {
            landing.columns.truncate(1);
        }
    }
    if landing.is_repeated() {
        let boxes = crate::workbook::layout::merged_boxes(&workbook.bases, sheet);
        if boxes.into_iter().any(|b| landing.meets_selected(&rows, b)) {
            landing = landing.once();
        }
    }
    // The rows in the way are those the sheet has (the rows a paste adds are not in the way).
    if let Some(runs) = may_land_in {
        if copy.row_count > 1 {
            let end = |top: usize| (top as u64 + copy.row_count).min(sheet.rows.len() as u64) as usize;
            let mut in_the_way = landing.rows.iter().flat_map(|&top| top..end(top)).filter_map(|p| sheet.rows.line(p));
            if in_the_way.any(|line| !names(&workbook.bases, runs, line)) {
                return Err(Refused::Because("rowNotNamedInTheWay"));
            }
        }
    }
    // Rows of another program with no cells, or a cell whose look is none of the looks.
    if copy.column_count == 0 || looks.is_some_and(|looks| !looks.all_given) {
        return Err(Refused::Because("unreadableCopiedCells"));
    }
    let (row_count, column_count) = (sheet.rows.len() as u64, sheet.columns.len() as u64);
    let (bottom, far_right) = (landing.bottom(), landing.right());
    let fits = |end: u64, count: u64, most: u64, most_added: u64| {
        end < most && (end + 1).saturating_sub(count) <= most_added + copy.cells.len() as u64
    };
    if !fits(bottom, row_count, MOST_ROWS, MOST_ROWS_ADDED)
        || !fits(far_right, column_count, MOST_COLUMNS, MOST_COLUMNS_ADDED)
    {
        return Err(Refused::Because("pasteDoesNotFit"));
    }

    // What each cell pasted over is given, tile by tile, in the sheet grown as far as the paste goes.
    let (grown, mut ops) = grown(workbook, s, bottom, far_right, context.code);
    let mut given: HashMap<(usize, usize), Input> = HashMap::new();
    // The cells a formula by offsets landed on as one.
    let mut by_offsets: HashSet<(usize, usize)> = HashSet::new();
    for &top in &landing.rows {
        for &left in &landing.columns {
            let rows_moved = top as i64 - copy.top_row_position as i64;
            let columns_moved = left as i64 - copy.left_column_position as i64;
            for cell in &copy.cells {
                let place = (top + cell.row as usize, left + cell.column as usize);
                let input = match (&cell.input, what) {
                    (CopiedInput::FormulaByOffsets { text, otherwise }, _) => {
                        match another_program::formula_by_offsets(&grown, s, text, place) {
                            Some(formula) => {
                                by_offsets.insert(place);
                                Some(Input::Formula { formula })
                            }
                            None => otherwise.as_deref().map(|input| pasted_input(&grown, s, input, 0, 0)).transpose()?,
                        }
                    }
                    (input, What::Cells { .. }) => Some(pasted_input(&grown, s, input, rows_moved, columns_moved)?),
                    (input, What::Values) => Some(pasted_value(sheet, place, input)?),
                };
                if let Some(input) = input {
                    given.insert(place, input);
                }
            }
        }
    }
    // In the person's own order of rows, a paste landing on the rows it moves moves no formula reading another row
    // (`seen`).
    if let Some(seen) = context.seen.filter(|seen| seen.sheet == s) {
        let target = &grown.sheets[s];
        let reads = |(&(r, _), input): (&(usize, usize), &Input)| match (input, target.rows.line(r)) {
            (Input::Formula { formula }, Some(row)) => super::seen::reads_another_row(formula, &grown.bases.text(row)),
            _ => false,
        };
        if landing.area_rows().iter().any(|&r| seen.meets(r, r)) && given.iter().any(reads) {
            return Err(Refused::Because("formulaReadsAnotherRow"));
        }
    }
    // A copy pasted over and over is weighed as a fill is: what it gives, and the cells it empties.
    if landing.is_repeated() {
        let (in_rows, in_columns): (HashSet<usize>, HashSet<usize>) =
            (landing.area_rows().into_iter().collect(), landing.area_columns().into_iter().collect());
        let emptied = held_cells(sheet)
            .filter(|&((r, c), _)| in_rows.contains(&r) && in_columns.contains(&c) && !given.contains_key(&(r, c)))
            .count() as u64;
        if weight_written(given.values(), emptied) > MOST_WEIGHT_SET {
            return Err(Refused::Because("repeatedPasteTooLarge"));
        }
    }
    let covered = covered_cells(workbook, sheet);
    if given.keys().any(|place| covered.contains(place)) {
        return Err(Refused::Because("pasteCutsMergedCells"));
    }
    if let What::Cells { .. } = what {
        let to_show = texts_to_show(&grown, s, &given);
        if to_show.len() > unseen::MOST_TEXTS {
            return Err(Refused::Because("tooMuchThatNoCellShows"));
        }
        // None shown (null or left out) asks nothing first.
        let asks = context.shown_to_the_person.is_some_and(|shown| !were_shown(workbook, &to_show, shown));
        if !to_show.is_empty() && asks {
            return Err(Refused::Answer(json!({"kind": "toBeShownFirst", "textThatNoCellShows": to_show})));
        }
    }

    let bases = &grown.bases;
    let target = &grown.sheets[s];
    let row_id = |p: usize| target.rows.line(p).expect("a row pasted on");
    let column_id = |p: usize| target.columns.line(p).expect("a column pasted on");
    let area_rows = landing.area_rows();
    let area_columns = landing.area_columns();
    let (in_rows, in_columns): (HashSet<usize>, HashSet<usize>) =
        (area_rows.iter().copied().collect(), area_columns.iter().copied().collect());

    // The formats: those of the cells pasted over taken away, then the copy's (or the looks of the cells).
    let formats = match looks {
        Some(looks) => another_program::looks_given(bases, sheet, target, &landing, looks, &by_offsets),
        None => pasted_formats(bases, sheet, target, &landing, &copy.formats, what),
    };

    // The cells: first those that hold something, row by row (one given more to keep than it holds waits), then the
    // rest the copy gives.
    let mut held_cells: Vec<((usize, usize), &Input)> = sheet
        .cells
        .iter()
        .filter_map(|((r, c), cell)| {
            let place = (sheet.rows.position(*r)?, sheet.columns.position(*c)?);
            (in_rows.contains(&place.0) && in_columns.contains(&place.1)).then_some((place, &cell.input))
        })
        .collect();
    held_cells.sort_by_key(|&(place, _)| place);
    let id = |(r, c): (usize, usize)| (bases.text(row_id(r)), bases.text(column_id(c)));
    let mut cells = Vec::new();
    let mut done: HashSet<(usize, usize)> = HashSet::new();
    for (place, now) in held_cells {
        let input = given.get(&place);
        if input.map_or(0, weight) > held_weight(now) {
            continue;
        }
        let (r, c) = id(place);
        cells.push(CellToSet { r, c, input: input.cloned() });
        done.insert(place);
    }
    let mut rest: Vec<(&(usize, usize), &Input)> = given.iter().filter(|(place, _)| !done.contains(*place)).collect();
    rest.sort_by_key(|&(place, _)| *place);
    for (&place, input) in rest {
        let (r, c) = id(place);
        cells.push(CellToSet { r, c, input: Some(input.clone()) });
    }

    // Values that change nothing add no rows or columns either (a copy of cells does).
    if what == What::Values && cells.is_empty() && formats.is_empty() {
        return Ok(Made { ops: Vec::new(), place: None });
    }
    if !cells.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto });
    }
    ops.extend(formats);
    let (top, left) = (area_rows[0], area_columns[0]);
    let place = Place::cells(&sheet.id, top, left, bottom as usize, far_right as usize);
    Ok(Made { ops, place: Some(place) })
}

/// Moves a block of cells: what they hold (inputs alone, not values spilled into them), their formats, and the tables
/// on them, the formulas of the workbook following the cells they name.
fn move_cells(workbook: &Workbook, edit: &MoveCells, context: &Context) -> Result<Made, Refused> {
    let bases = &workbook.bases;
    let (s, left, right) = selected_columns(workbook, &edit.cells)?;
    let sheet = &workbook.sheets[s];
    let rows = positions(bases, &sheet.rows, &edit.cells.rows);
    let (Some(&top), Some(&bottom)) = (rows.first(), rows.last()) else {
        return Err(Refused::Because("unknownRow"));
    };
    // The rows moved are one block: rows out of view between them are not (the page names the rows it moves).
    if bottom - top + 1 != rows.len() {
        return Err(Refused::Because("rowNotNamedInTheWay"));
    }
    let t = workbook.sheet_index(&edit.to_sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    let target = &workbook.sheets[t];
    let to_top = bases.parse(&edit.to_top_left.r).and_then(|l| target.rows.position(l));
    let to_top = to_top.ok_or(Refused::Because("unknownRow"))?;
    let (height, width) = (bottom - top + 1, right - left + 1);
    // The rows a block lands in that the sheet has must all be named, one row or more.
    if let Some(runs) = &edit.may_land_in {
        if positions(bases, &target.rows, runs).is_empty() {
            return Err(Refused::Because("unknownRow"));
        }
        let end = (to_top + height).min(target.rows.len());
        if (to_top..end).any(|p| !names(bases, runs, target.rows.line(p).expect("a row"))) {
            return Err(Refused::Because("rowNotNamedInTheWay"));
        }
    }
    let to_left = bases.parse(&edit.to_top_left.c).and_then(|l| target.columns.position(l));
    let to_left = to_left.ok_or(Refused::Because("unknownColumn"))?;
    if s == t && (top, left) == (to_top, to_left) {
        return Ok(Made::nothing());
    }
    let (to_bottom, to_right) = (to_top + height - 1, to_left + width - 1);
    // As a paste, a move adds at most 1,000 rows and 26 columns, one more of each for every cell it moves.
    let moved = held_cells(sheet).filter(|&((r, c), _)| (top..=bottom).contains(&r) && (left..=right).contains(&c));
    let moved = moved.count() as u64;
    let fits = |end: usize, count: usize, most: u64, most_added: u64| {
        (end as u64) < most && (end as u64 + 1).saturating_sub(count as u64) <= most_added + moved
    };
    if !fits(to_bottom, target.rows.len(), MOST_ROWS, MOST_ROWS_ADDED)
        || !fits(to_right, target.columns.len(), MOST_COLUMNS, MOST_COLUMNS_ADDED)
    {
        return Err(Refused::Because("pasteDoesNotFit"));
    }

    // The target grown as far as the cells go (a move past the sheet's end adds rows and columns as a paste does).
    let (grown, mut ops) = grown(workbook, t, to_bottom as u64, to_right as u64, context.code);
    let moving = Moving {
        bases: &grown.bases,
        from: &grown.sheets[s],
        to: &grown.sheets[t],
        block: (top, bottom, left, right),
        to_top_left: (to_top, to_left),
    };
    let in_block = |(r, c): (usize, usize)| (top..=bottom).contains(&r) && (left..=right).contains(&c);
    let in_target = |(r, c): (usize, usize)| (to_top..=to_bottom).contains(&r) && (to_left..=to_right).contains(&c);

    // What each cell landed on is given: a formula with the references into the block following the cells, an option
    // of a dropdown the target has (its id well formed), else its label as text.
    let mut given: HashMap<(usize, usize), Input> = HashMap::new();
    for (place, input) in held_cells(sheet) {
        if !in_block(place) {
            continue;
        }
        let input = match input {
            Input::Formula { formula } => {
                Input::Formula { formula: moving.formula(formula).unwrap_or_else(|| formula.clone()) }
            }
            Input::DropdownOption { option_id, label } => {
                let option = CopiedInput::DropdownOption { option_id: option_id.clone(), label: label.clone() };
                pasted_input(&grown, t, &option, 0, 0)?
            }
            input => input.clone(),
        };
        given.insert((to_top + place.0 - top, to_left + place.1 - left), input);
    }
    let covered = covered_cells(workbook, target);
    if given.keys().any(|place| covered.contains(place)) {
        return Err(Refused::Because("pasteCutsMergedCells"));
    }

    // The cells, sheet by sheet: the target's (the cells left emptied there, and those landed on), then the others in
    // order (on the sheet moved from, the cells left); each sheet's formulas naming the block after its cells, but
    // for those a merged range covers.
    for i in std::iter::once(t).chain((0..workbook.sheets.len()).filter(|&i| i != t)) {
        let covered = covered_cells(workbook, &workbook.sheets[i]);
        let at = &grown.sheets[i];
        let id = |(r, c): (usize, usize)| {
            let line = |axis: &Axis, p: usize| grown.bases.text(axis.line(p).expect("a line of the move"));
            (line(&at.rows, r), line(&at.columns, c))
        };
        let mut landed: BTreeMap<(usize, usize), Option<Input>> = BTreeMap::new();
        let mut followed: Vec<((usize, usize), StoredFormula)> = Vec::new();
        for (place, input) in held_cells(&workbook.sheets[i]) {
            let (from, to) = (i == s && in_block(place), i == t && in_target(place));
            match input {
                _ if from || to => {
                    landed.insert(place, None);
                }
                Input::Formula { formula } if !covered.contains(&place) => {
                    followed.extend(moving.formula(formula).map(|formula| (place, formula)))
                }
                _ => {}
            }
        }
        if i == t {
            landed.extend(given.iter().map(|(&place, input)| (place, Some(input.clone()))));
        }
        followed.sort_by_key(|&(place, _)| place);
        let landed = landed.into_iter().map(|(place, input)| (id(place), input));
        let followed = followed.into_iter().map(|(place, formula)| (id(place), Some(Input::Formula { formula })));
        let cells: Vec<CellToSet> = landed.chain(followed).map(|((r, c), input)| CellToSet { r, c, input }).collect();
        if !cells.is_empty() {
            ops.push(Op::SetCells { sheet_id: at.id.clone(), cells, form: CellForm::List });
        }
    }

    // The formats: the block's taken away, then those of the cells landed on, then the block's set where it lands.
    let gb = &grown.bases;
    let block_rows: Vec<usize> = (top..=bottom).collect();
    let block_columns: Vec<usize> = (left..=right).collect();
    let target_rows: Vec<usize> = (to_top..=to_bottom).collect();
    let target_columns: Vec<usize> = (to_left..=to_right).collect();
    let mut formats: Vec<Op> = Vec::new();
    formats.extend(taken_away(gb, sheet, &grown.sheets[s], &block_rows, &block_columns, |_| true));
    formats.extend(taken_away(gb, target, &grown.sheets[t], &target_rows, &target_columns, |_| true));
    let copied = copied_formats(sheet, &block_rows, |_| true, &block_columns, |_| true, &HashMap::new());
    let landing =
        Landing { rows: vec![to_top], columns: vec![to_left], row_count: height as u64, column_count: width as u64 };
    formats.extend(formats_given(gb, target, &grown.sheets[t], &landing, &copied, What::Cells { colors: true }));

    // The tables shown all on the block move with it (to another sheet, they are deleted).
    let mut tables = Vec::new();
    for (id, table) in sheet.cell_tables.values() {
        let Some((_, live)) = shown_cell_table(bases, sheet, table) else { continue };
        let row = |id: &str| bases.parse(id).and_then(|l| sheet.rows.position(l));
        let column = |id: &str| bases.parse(id).and_then(|l| sheet.columns.position(l));
        let footer = live.footer_rows.iter().flat_map(|f| [&f.first_row, &f.last_row]);
        let mut rows = [&live.header_rows.first_row, &live.header_rows.last_row].into_iter().chain(footer);
        let mut columns = [&live.first_column, &live.last_column].into_iter();
        let on_block = rows.all(|r| row(r).is_some_and(|p| (top..=bottom).contains(&p)))
            && columns.all(|c| column(c).is_some_and(|p| (left..=right).contains(&p)));
        if !on_block {
            continue;
        }
        if !ids::is_well_formed(id, "ctb") {
            return Err(Refused::Because("idNotWellFormed"));
        }
        let moved = (s == t).then(|| {
            let to_row = |id: &str| moving.row(row(id).expect("a row of the table"));
            let to_column = |id: &str| moving.column(column(id).expect("a column of the table"));
            let rows = |r: &RowsOfACellTable| RowsOfACellTable {
                first_row: to_row(&r.first_row),
                last_row: to_row(&r.last_row),
            };
            CellTable {
                header_rows: rows(&live.header_rows),
                first_column: to_column(&live.first_column),
                last_column: to_column(&live.last_column),
                footer_rows: live.footer_rows.as_ref().map(rows),
            }
        });
        tables.push(CellTableToSet { cell_table_id: id.clone(), cell_table: moved });
    }

    let moves_something =
        ops.iter().any(|op| matches!(op, Op::SetCells { .. })) || !formats.is_empty() || !tables.is_empty();
    if !moves_something {
        return Ok(Made::nothing());
    }
    ops.extend(formats);
    if !tables.is_empty() {
        ops.push(Op::SetCellTables { sheet_id: sheet.id.clone(), cell_tables: tables });
    }
    Ok(Made { ops, place: Some(Place::cells(&target.id, to_top, to_left, to_bottom, to_right)) })
}

/// The inputs of a sheet's cells, by position.
fn held_cells(sheet: &Sheet) -> impl Iterator<Item = ((usize, usize), &Input)> {
    sheet
        .cells
        .iter()
        .filter_map(|((r, c), cell)| Some(((sheet.rows.position(*r)?, sheet.columns.position(*c)?), &cell.input)))
}

/// Where a move takes a block of cells (by position, in the sheet moved from), and so the references into it: each
/// to the cell it lands on, a range only when both its corners are in the block. Whole rows and columns stay.
struct Moving<'a> {
    bases: &'a Bases,
    from: &'a Sheet,
    to: &'a Sheet,
    /// Top, bottom, left, right.
    block: (usize, usize, usize, usize),
    to_top_left: (usize, usize),
}

impl Moving<'_> {
    fn row(&self, p: usize) -> String {
        self.bases.text(self.to.rows.line(self.to_top_left.0 + p - self.block.0).expect("a row landed on"))
    }

    fn column(&self, p: usize) -> String {
        self.bases.text(self.to.columns.line(self.to_top_left.1 + p - self.block.2).expect("a column landed on"))
    }

    /// The point a reference's cell (at a row and column position) is moved to, when it is in the block.
    fn point(&self, (r, c): (usize, usize), point: &CellPoint) -> Option<CellPoint> {
        let (top, bottom, left, right) = self.block;
        if !(top..=bottom).contains(&r) || !(left..=right).contains(&c) {
            return None;
        }
        Some(CellPoint { r: self.row(r), c: self.column(c), ..point.clone() })
    }

    /// Where a reference's cell is, on the sheet moved from.
    fn cell(&self, sheet_id: &str, point: &CellPoint) -> Option<(usize, usize)> {
        let at = |axis: &Axis, id: &str| axis.position(self.bases.parse(id)?);
        (sheet_id == self.from.id).then_some(())?;
        Some((at(&self.from.rows, &point.r)?, at(&self.from.columns, &point.c)?))
    }

    /// Where a range's corners are, on the sheet moved from: a deleted end snapped toward the other, as the range
    /// reads now.
    fn corners(&self, sheet_id: &str, one: &CellPoint, other: &CellPoint) -> Option<((usize, usize), (usize, usize))> {
        let snapped = |axis: &Axis, a: &str, b: &str| {
            let (a, b) = (self.bases.parse(a)?, self.bases.parse(b)?);
            Some((axis.snap_toward(a, b)?, axis.snap_toward(b, a)?))
        };
        (sheet_id == self.from.id).then_some(())?;
        let (r1, r2) = snapped(&self.from.rows, &one.r, &other.r)?;
        let (c1, c2) = snapped(&self.from.columns, &one.c, &other.c)?;
        Some(((r1, c1), (r2, c2)))
    }

    /// A formula with its references into the block following the cells; `None` when it names none.
    fn formula(&self, formula: &StoredFormula) -> Option<StoredFormula> {
        let mut followed = false;
        let references = formula
            .references
            .iter()
            .map(|reference| {
                let to = self.to.id.clone();
                let moved = match reference {
                    Reference::Cell { sheet_id, cell } => self
                        .cell(sheet_id, cell)
                        .and_then(|at| self.point(at, cell))
                        .map(|cell| Reference::Cell { sheet_id: to, cell }),
                    Reference::Range { sheet_id, top_left, bottom_right } => self
                        .corners(sheet_id, top_left, bottom_right)
                        .and_then(|(one, other)| self.point(one, top_left).zip(self.point(other, bottom_right)))
                        .map(|(top_left, bottom_right)| Reference::Range { sheet_id: to, top_left, bottom_right }),
                    _ => None,
                };
                followed |= moved.is_some();
                moved.unwrap_or_else(|| reference.clone())
            })
            .collect();
        followed.then(|| StoredFormula { text_between_references: formula.text_between_references.clone(), references })
    }
}

/// Fills cells from a block beside them, line by line: down or up the block's columns over rows below or above it,
/// or along its rows over the columns to its right or left. Each line goes on as its cells do (`series`), or they
/// are repeated (formulas moved as a paste moves them). The cells filled take what the block's cells hold and the
/// block's formats, over and over; a cell filled with what it holds is left alone.
fn fill_cells(workbook: &Workbook, edit: &FillCells, context: &Context) -> Result<Made, Refused> {
    let bases = &workbook.bases;
    let (s, left, right) = selected_columns(workbook, &edit.source)?;
    let sheet = &workbook.sheets[s];
    let source_rows: Vec<usize> = positions(bases, &sheet.rows, &edit.source.rows).into_iter().collect();
    let (Some(&top), Some(&bottom)) = (source_rows.first(), source_rows.last()) else {
        return Err(Refused::Because("unknownRow"));
    };
    // The lines (columns of the block filled down or up, or its rows filled across), and the positions along them
    // of the block's cells and of the cells filled.
    let down = matches!(edit.lines_to_fill, LinesToFill::Rows { .. });
    let (lines, along_block, along_filled): (Vec<usize>, Vec<usize>, Vec<usize>) = match &edit.lines_to_fill {
        LinesToFill::Rows { rows } => {
            let rows = positions(bases, &sheet.rows, rows);
            let (Some(&first), Some(&last)) = (rows.first(), rows.last()) else {
                return Err(Refused::Because("unknownRow"));
            };
            // In the person's own order of rows, a fill that meets the rows it moves moves no formula reading
            // another row (`seen`).
            if let Some(seen) = context.seen.filter(|seen| seen.sheet == s) {
                let reads = |&p: &usize| {
                    let row = sheet.rows.line(p).expect("a row of the block");
                    let own = bases.text(row);
                    (left..=right).filter_map(|c| sheet.cells.get(&(row, sheet.columns.line(c)?))).any(|cell| {
                        matches!(&cell.input, Input::Formula { formula } if super::seen::reads_another_row(formula, &own))
                    })
                };
                if seen.meets(first.min(top), last.max(bottom)) && source_rows.iter().any(reads) {
                    return Err(Refused::Because("formulaReadsAnotherRow"));
                }
            }
            if first <= bottom && top <= last {
                return Err(Refused::Because("fillEndsInsideSource"));
            }
            ((left..=right).collect(), source_rows.clone(), rows.into_iter().collect())
        }
        LinesToFill::ColumnsAsFarAs { column } => {
            let column = bases.parse(column).and_then(|l| sheet.columns.position(l));
            let column = column.ok_or(Refused::Because("unknownColumn"))?;
            if (left..=right).contains(&column) {
                return Err(Refused::Because("fillEndsInsideSource"));
            }
            let filled = if column > right { (right + 1..=column).collect() } else { (column..left).collect() };
            (source_rows.clone(), (left..=right).collect(), filled)
        }
    };
    let place = |line: usize, along: usize| if down { (along, line) } else { (line, along) };
    let ids = |(r, c): (usize, usize)| {
        (sheet.rows.line(r).expect("a row of the fill"), sheet.columns.line(c).expect("a column of the fill"))
    };
    let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);

    // What each cell filled is given (nothing, for a cell of the block that holds nothing), by how far it is from the
    // block's first cell.
    let first = along_block[0] as i64;
    let mut given: HashMap<(usize, usize), Input> = HashMap::new();
    let mut continued = false;
    for &line in &lines {
        let places: Vec<(LineId, LineId)> = along_block.iter().map(|&along| ids(place(line, along))).collect();
        let inputs: Vec<Option<&Input>> = places.iter().map(|p| sheet.cells.get(p).map(|cell| &cell.input)).collect();
        let series = match edit.filled_cells {
            FilledCells::RepeatSource => Series::Repeated,
            FilledCells::ContinuePatterns => series(sheet, locale, &places, &inputs),
        };
        continued |= !matches!(series, Series::Repeated);
        for &along in &along_filled {
            let k = along as i64 - first;
            let input = match &series {
                Series::Repeated => {
                    let i = k.rem_euclid(inputs.len() as i64);
                    let Some(input) = inputs[i as usize] else { continue };
                    match input {
                        Input::Formula { formula } => {
                            let text = workbook.formula_text(s, formula);
                            let (rows, columns) = if down { (k - i, 0) } else { (0, k - i) };
                            Input::Formula { formula: moved_formula(workbook, s, &text, rows, columns)? }
                        }
                        Input::DropdownOption { option_id, label } => option_pasted(sheet, option_id, label)?,
                        input => input.clone(),
                    }
                }
                series => series.at(k)?,
            };
            given.insert(place(line, along), input);
        }
    }
    // The rows filled and the block's (rows out of view among them) go on without a gap, unless a row left out
    // changes nothing: the block is one row, and no line of it goes on.
    let (first_filled, last_filled) = (along_filled[0], *along_filled.last().expect("a line filled"));
    let span = last_filled.max(bottom) - first_filled.min(top) + 1;
    if down && (along_block.len() > 1 || continued) && along_filled.len() + along_block.len() != span {
        return Err(Refused::Because("rowNotNamedInTheWay"));
    }

    let (area_rows, area_columns) = if down { (&along_filled, &lines) } else { (&lines, &along_filled) };
    let (last_row, last_column) = (*area_rows.last().expect("a row filled"), *area_columns.last().expect("a column"));
    let place_filled = Place::cells(&sheet.id, area_rows[0], area_columns[0], last_row, last_column);
    let (in_rows, in_columns): (HashSet<usize>, HashSet<usize>) =
        (area_rows.iter().copied().collect(), area_columns.iter().copied().collect());
    let mut held: Vec<((usize, usize), &Input)> =
        held_cells(sheet).filter(|((r, c), _)| in_rows.contains(r) && in_columns.contains(c)).collect();
    held.sort_by_key(|&(place, _)| place);
    let emptied = held.iter().filter(|(place, _)| !given.contains_key(place)).count() as u64;
    if weight_written(given.values(), emptied) > MOST_WEIGHT_SET {
        return Err(Refused::Because("fillTooLarge"));
    }
    let covered = covered_cells(workbook, sheet);
    if given.keys().any(|place| covered.contains(place)) {
        return Err(Refused::Because("cellCoveredByMergedRange"));
    }

    // The cells, as a paste sets them, but for those given what they hold.
    let id = |place: (usize, usize)| {
        let (r, c) = ids(place);
        (bases.text(r), bases.text(c))
    };
    let mut cells = Vec::new();
    let mut done: HashSet<(usize, usize)> = HashSet::new();
    for (place, now) in held {
        let input = given.get(&place);
        if input == Some(now) {
            done.insert(place);
            continue;
        }
        if input.map_or(0, weight) > held_weight(now) {
            continue;
        }
        let (r, c) = id(place);
        cells.push(CellToSet { r, c, input: input.cloned() });
        done.insert(place);
    }
    let mut rest: Vec<(&(usize, usize), &Input)> = given.iter().filter(|(place, _)| !done.contains(*place)).collect();
    rest.sort_by_key(|&(place, _)| *place);
    for (&place, input) in rest {
        let (r, c) = id(place);
        cells.push(CellToSet { r, c, input: Some(input.clone()) });
    }

    // The formats: those of the cells filled taken away, then the block's, over and over; unless every cell filled
    // has the formats of the block's cell it is filled from.
    let (block_rows, block_columns) = if down { (&along_block, &lines) } else { (&lines, &along_block) };
    let tile = |p: usize, from: usize| (p as i64 - from as i64).rem_euclid(along_block.len() as i64) as u32;
    let index_of = |lines: &[usize], p: usize| lines.iter().position(|&q| q == p).expect("a line of the block") as u32;
    let row_index = |p: usize| if down { tile(p, top) } else { index_of(block_rows, p) };
    let column_index = |p: usize| if down { index_of(block_columns, p) } else { tile(p, left) };
    let mut ops = Vec::new();
    if !cells.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto });
    }
    let filled_from = |(r, c): (usize, usize)| {
        if down {
            (top + tile(r, top) as usize, c)
        } else {
            (r, left + tile(c, left) as usize)
        }
    };
    let leaves: BTreeSet<Leaf> = sheet.formats.iter().map(|(leaf, ..)| leaf).collect();
    let formats_change = area_rows.iter().any(|&r| {
        area_columns.iter().any(|&c| {
            let (cell, from) = (ids((r, c)), ids(filled_from((r, c))));
            leaves.iter().any(|&leaf| sheet.formats.get(leaf, cell) != sheet.formats.get(leaf, from))
        })
    });
    if !formats_change {
        return Ok(if ops.is_empty() { Made::nothing() } else { Made { ops, place: Some(place_filled) } });
    }
    ops.extend(taken_away(bases, sheet, sheet, area_rows, area_columns, |_| true));
    let mut formats = Vec::new();
    for format in copied_formats(sheet, block_rows, |_| true, block_columns, |_| true, &HashMap::new()) {
        let within = |spans: &[Span], i: u32| spans.iter().any(|span| span.first <= i && i - span.first < span.count);
        let mut rows: Vec<LineId> = area_rows
            .iter()
            .filter(|&&p| within(&format.rows, row_index(p)))
            .map(|&p| sheet.rows.line(p).expect("a row filled"))
            .collect();
        let mut columns: Vec<LineId> = area_columns
            .iter()
            .filter(|&&p| within(&format.columns, column_index(p)))
            .map(|&p| sheet.columns.line(p).expect("a column filled"))
            .collect();
        if rows.is_empty() || columns.is_empty() {
            continue;
        }
        let (rows, columns) = (sorted_runs(bases, &mut rows), sorted_runs(bases, &mut columns));
        formats.push(CellsToFormat { rows, columns, format: format.format });
    }
    if !formats.is_empty() {
        ops.push(Op::SetCellFormats { sheet_id: sheet.id.clone(), formats });
    }
    Ok(Made { ops, place: Some(place_filled) })
}

/// The most a fill, or a copy pasted over and over, may set, by `weight_written`.
const MOST_WEIGHT_SET: u64 = 11_200_000;

/// What a fill or a paste sets weighs: 56 for each cell and its input written as JSON (`null`
/// for a cell emptied); a cell that holds nothing given nothing counts for nothing.
fn weight_written<'a>(given: impl Iterator<Item = &'a Input>, emptied: u64) -> u64 {
    let written = |input: Option<&Input>| 56 + serde_json::to_string(&input).expect("an input written").len() as u64;
    given.map(|input| written(Some(input))).sum::<u64>() + emptied * written(None)
}

/// Milliseconds in a day and in an hour: dates and times go on in whole milliseconds.
const DAY: i128 = 86_400_000;
const HOUR: i128 = 3_600_000;
/// Dates and times in milliseconds go up to this (but not as far), either way.
const MOST_MILLISECONDS: f64 = 1e15;

/// How a line of a block goes on in the cells filled, `k` cells on from its first (back, below 0).
enum Series {
    /// The line over and over, formulas moved.
    Repeated,
    /// Numbers a step apart, worked out exactly from the first's 15 significant digits.
    Numbers { first: Decimal, step: Decimal },
    /// Dates or times a step apart, in milliseconds; dates within the calendar.
    Milliseconds { first: i128, step: i128, dates: bool },
    /// Dates months apart, keeping the first's day of the month (the month's last when it has fewer days) and its
    /// time; or each the last day of its month.
    Months { day: i64, time: i128, step: i64, ends: bool },
    /// Names of a list a step apart, round and round, written in the case of the first.
    Names { list: Vec<&'static str>, first: usize, step: usize, case: Case },
    /// Texts ending in a number a step apart, as wide as the widest written with leading zeros.
    Digits { prefix: String, first: i128, step: i128, width: usize },
}

impl Series {
    /// The input `k` cells on from the line's first, unless the pattern ends before (a number too large, a date
    /// outside the calendar, a number below 0).
    fn at(&self, k: i64) -> Result<Input, Refused> {
        let ends = || Refused::Because("patternEndsBeforeTheFill");
        let k = k as i128;
        let ms = |ms: i128| ms as f64 / DAY as f64;
        Ok(match self {
            Series::Repeated => unreachable!("a line repeated is copied"),
            Series::Numbers { first, step } => {
                let value = step.times(k).and_then(|moved| first.plus(moved)).ok_or_else(ends)?.number();
                if !value.is_finite() {
                    return Err(ends());
                }
                Input::Number { value }
            }
            Series::Milliseconds { first, step, dates } => {
                let at = k.checked_mul(*step).and_then(|moved| moved.checked_add(*first)).ok_or_else(ends)?;
                if *dates && !in_calendar(at.div_euclid(DAY)) {
                    return Err(ends());
                }
                Input::Number { value: ms(at) }
            }
            Series::Months { day, time, step, ends: month_ends } => {
                let Some(day) = months_on(*day, k * *step as i128, *month_ends) else { return Err(ends()) };
                Input::Number { value: ms(day as i128 * DAY + time) }
            }
            Series::Names { list, first, step, case } => {
                let i = (*first as i128 + k * *step as i128).rem_euclid(list.len() as i128);
                Input::Text { value: case.written(list[i as usize]) }
            }
            Series::Digits { prefix, first, step, width } => {
                let n = first + k * step;
                if n < 0 {
                    return Err(ends());
                }
                Input::Text { value: format!("{prefix}{n:0width$}") }
            }
        })
    }
}

/// How a line of a block's cells (`places`, holding `inputs`) goes on: numbers of one kind (by their patterns) as
/// numbers, dates or times; texts as names of a list (the workbook locale's days and months, short then long, then
/// en-US's, then quarters), or as numbers at their ends. Any other line, or one with a cell that holds nothing, is
/// repeated.
fn series(sheet: &Sheet, locale: &Locale, places: &[(LineId, LineId)], inputs: &[Option<&Input>]) -> Series {
    let numbers: Option<Vec<f64>> = inputs
        .iter()
        .map(|input| match input {
            Some(Input::Number { value }) => Some(*value),
            _ => None,
        })
        .collect();
    if let Some(numbers) = numbers {
        let classes: Vec<Class> = places.iter().map(|&place| Class::of(sheet, place)).collect();
        if classes.iter().any(|&class| class != classes[0]) {
            return Series::Repeated;
        }
        return numbers_series(classes[0], &numbers);
    }
    let texts: Option<Vec<&str>> = inputs
        .iter()
        .map(|input| match input {
            Some(Input::Text { value }) => Some(value.as_str()),
            _ => None,
        })
        .collect();
    let Some(texts) = texts else { return Series::Repeated };
    let (theirs, en) = (locale.names(), &names::EN_US);
    let lists =
        [theirs, en].into_iter().flat_map(|n| [n.days_short, n.days_long, n.short, n.long]).chain(["Q1|Q2|Q3|Q4"]);
    for list in lists {
        let list: Vec<&'static str> = list.split('|').collect();
        let found: Option<Vec<usize>> = texts
            .iter()
            .map(|text| {
                let text = text.to_lowercase();
                list.iter().position(|name| name.to_lowercase() == text)
            })
            .collect();
        let Some(found) = found else { continue };
        let n = list.len();
        let step = if found.len() == 1 { 1 } else { (found[1] + n - found[0]) % n };
        if found.windows(2).any(|w| (w[1] + n - w[0]) % n != step) {
            return Series::Repeated;
        }
        return Series::Names { list, first: found[0], step, case: Case::of(texts[0]) };
    }
    digits_series(&texts).unwrap_or(Series::Repeated)
}

/// What a number's pattern makes it, for a fill: a date, a date and time, a time (a duration among them), or a
/// number.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    Number,
    Date,
    DateAndTime,
    Time,
}

impl Class {
    fn of(sheet: &Sheet, place: (LineId, LineId)) -> Class {
        let pattern =
            sheet.formats.value(Leaf::NumberFormat, place)["pattern"].as_str().unwrap_or("General").to_owned();
        match NumberFormat::parse(&pattern).map(|format| format.kind()) {
            Ok(Kind::Date) => Class::Date,
            Ok(Kind::DateAndTime) => Class::DateAndTime,
            Ok(Kind::Time | Kind::Duration) => Class::Time,
            _ => Class::Number,
        }
    }
}

/// A number as a decimal, `digits` × 10^`exponent`. Numbers filled go on so, exactly, as long as the digits of two
/// at the smaller of their exponents fit in an `i128`.
#[derive(Clone, Copy)]
struct Decimal {
    digits: i128,
    exponent: i32,
}

impl Decimal {
    /// A number's 15 significant digits, with no 0 ending them (0 is 0 × 10⁰).
    fn of(n: f64) -> Decimal {
        if n == 0.0 {
            return Decimal { digits: 0, exponent: 0 };
        }
        let written = format!("{n:.14e}");
        let (digits, exponent) = written.split_once('e').expect("a number written with an exponent");
        let mut digits: i128 = digits.replace('.', "").parse().expect("15 digits");
        let mut exponent = exponent.parse::<i32>().expect("an exponent") - 14;
        while digits % 10 == 0 {
            digits /= 10;
            exponent += 1;
        }
        Decimal { digits, exponent }
    }

    /// One's digits and the other's at the smaller exponent, and that exponent; `None` when they don't fit.
    fn aligned(self, other: Decimal) -> Option<(i128, i128, i32)> {
        let exponent = self.exponent.min(other.exponent);
        let at = |d: Decimal| 10i128.checked_pow((d.exponent - exponent) as u32)?.checked_mul(d.digits);
        Some((at(self)?, at(other)?, exponent))
    }

    fn is(self, other: Decimal) -> bool {
        self.aligned(other).is_some_and(|(a, b, _)| a == b)
    }

    fn plus(self, other: Decimal) -> Option<Decimal> {
        let (a, b, exponent) = self.aligned(other)?;
        Some(Decimal { digits: a.checked_add(b)?, exponent })
    }

    fn minus(self, other: Decimal) -> Option<Decimal> {
        let (a, b, exponent) = self.aligned(other)?;
        Some(Decimal { digits: a.checked_sub(b)?, exponent })
    }

    fn times(self, k: i128) -> Option<Decimal> {
        Some(Decimal { digits: self.digits.checked_mul(k)?, exponent: self.exponent })
    }

    /// The nearest number (infinite when too large).
    fn number(self) -> f64 {
        format!("{}e{}", self.digits, self.exponent).parse().expect("a number written")
    }
}

/// How numbers of a class go on. Numbers, as decimals of their 15 significant digits, go on by a step when they are
/// each that step from the one before (not when a step is too many digits); one number is repeated. Numbers filled
/// are the first plus the step that many times, worked out exactly: the pattern ends before the fill when that is too
/// many digits, or too large a number. Dates and times go on in whole
/// milliseconds: one date a day at a time, one time an hour at a time; dates go on by months when each is that many
/// months from the first (`EDATE`, or `EOMONTH` for the last days of months), else by a step. Dates and times too
/// large for milliseconds go on as numbers do.
fn numbers_series(class: Class, numbers: &[f64]) -> Series {
    if class == Class::Number {
        if numbers.len() < 2 {
            return Series::Repeated;
        }
        let decimals: Vec<Decimal> = numbers.iter().map(|&n| Decimal::of(n)).collect();
        let steps: Option<Vec<Decimal>> = decimals.windows(2).map(|w| w[1].minus(w[0])).collect();
        let Some(steps) = steps else { return Series::Repeated };
        if steps.iter().any(|step| !step.is(steps[0])) {
            return Series::Repeated;
        }
        return Series::Numbers { first: decimals[0], step: steps[0] };
    }
    // Dates and times of a thousand billion milliseconds or more go on as numbers; dates outside the calendar are
    // repeated.
    let dates = class != Class::Time;
    let ms: Option<Vec<i128>> = numbers
        .iter()
        .map(|&n| {
            let ms = (n * DAY as f64).round();
            (ms.abs() < MOST_MILLISECONDS).then_some(ms as i128)
        })
        .collect();
    let Some(ms) = ms else { return numbers_series(Class::Number, numbers) };
    if dates && ms.iter().any(|&ms| !in_calendar(ms.div_euclid(DAY))) {
        return Series::Repeated;
    }
    if ms.len() == 1 {
        return Series::Milliseconds { first: ms[0], step: if dates { DAY } else { HOUR }, dates };
    }
    if dates {
        let days: Vec<(i64, i128)> = ms.iter().map(|&ms| (ms.div_euclid(DAY) as i64, ms.rem_euclid(DAY))).collect();
        let (day, time) = days[0];
        let month = |day: i64| {
            let (year, month, _) = dates::date_from_serial(day);
            year * 12 + month as i64
        };
        let step = month(days[1].0) - month(day);
        for ends in [false, true] {
            if ends && !days.iter().all(|&(day, _)| is_month_end(day)) {
                continue;
            }
            let on = |k: usize| months_on(day, k as i128 * step as i128, ends);
            if days.iter().enumerate().all(|(k, &(d, t))| t == time && on(k) == Some(d)) {
                return Series::Months { day, time, step, ends };
            }
        }
    }
    let step = ms[1] - ms[0];
    if ms.windows(2).any(|w| w[1] - w[0] != step) {
        return Series::Repeated;
    }
    Series::Milliseconds { first: ms[0], step, dates }
}

/// Whether a day is in the calendar: 0001-01-01 to 9999-12-31.
fn in_calendar(day: i128) -> bool {
    (dates::serial_from_date(1, 1, 1) as i128..=dates::LAST_SERIAL as i128).contains(&day)
}

fn is_month_end(day: i64) -> bool {
    let (year, month, day) = dates::date_from_serial(day);
    day == dates::days_in_month(year, month)
}

/// The day some months from another: on its day of the month (the month's last, when it has fewer days), or on the
/// month's last day; unless outside the calendar.
fn months_on(day: i64, months: i128, end: bool) -> Option<i64> {
    let (year, month, day) = dates::date_from_serial(day);
    let months = (year as i128 * 12 + month as i128 - 1).checked_add(months)?;
    let (year, month) = (months.div_euclid(12), months.rem_euclid(12) as u32 + 1);
    if !(1..=9999).contains(&year) {
        return None;
    }
    let last = dates::days_in_month(year as i64, month);
    let day = dates::serial_from_date(year as i64, month, if end { last } else { day.min(last) });
    in_calendar(day as i128).then_some(day)
}

/// Texts that end in a number (of 1 to 15 digits) after the same text go on by a step (one text by 1), written as
/// wide as the widest number written with leading zeros, when each is so written and is that step from the one
/// before. A number after a digit and a slash, a colon or a dash (`1/2`, `a1:30`, `1-2-3`, in any locale) is one
/// of a date or a time, and does not go on.
fn digits_series(texts: &[&str]) -> Option<Series> {
    let parts: Vec<(&str, &str)> = texts
        .iter()
        .map(|text| text.split_at(text.len() - text.bytes().rev().take_while(u8::is_ascii_digit).count()))
        .collect();
    let prefix = parts[0].0;
    if parts.iter().any(|&(before, digits)| before != prefix || digits.is_empty() || digits.len() > 15) {
        return None;
    }
    let mut last = prefix.bytes().rev();
    if matches!(last.next(), Some(b'/' | b':' | b'-')) && last.next().is_some_and(|b| b.is_ascii_digit()) {
        return None;
    }
    let padded = parts.iter().filter(|(_, digits)| digits.len() > 1 && digits.starts_with('0'));
    let width = padded.map(|(_, digits)| digits.len()).max().unwrap_or(0);
    let numbers: Vec<i128> = parts.iter().map(|(_, digits)| digits.parse().expect("digits")).collect();
    if parts.iter().zip(&numbers).any(|((_, digits), n)| format!("{n:0width$}") != *digits) {
        return None;
    }
    let step = if numbers.len() == 1 { 1 } else { numbers[1] - numbers[0] };
    if numbers.windows(2).any(|w| w[1] - w[0] != step) {
        return None;
    }
    Some(Series::Digits { prefix: prefix.to_owned(), first: numbers[0], step, width })
}

/// The case names filled are written in, as the first name is: small, capital, a capital then small letters, or as
/// their list has them.
#[derive(Clone, Copy)]
enum Case {
    Small,
    Capital,
    Title,
    Listed,
}

impl Case {
    fn of(text: &str) -> Case {
        let mut chars = text.chars();
        let first = chars.next();
        let rest = chars.as_str();
        if text == text.to_lowercase() {
            Case::Small
        } else if text == text.to_uppercase() {
            Case::Capital
        } else if first.is_some_and(char::is_uppercase) && rest == rest.to_lowercase() {
            Case::Title
        } else {
            Case::Listed
        }
    }

    fn written(self, name: &str) -> String {
        match self {
            Case::Small => name.to_lowercase(),
            Case::Capital => name.to_uppercase(),
            Case::Title => {
                let mut chars = name.chars();
                let first = chars.next().map(|c| c.to_uppercase().collect::<String>()).unwrap_or_default();
                first + &chars.as_str().to_lowercase()
            }
            Case::Listed => name.to_owned(),
        }
    }
}

/// The formats a paste sets: those of the cells pasted over taken away, then the copy's. The sheet is the one pasted
/// on (`ids` it grown as far as the paste goes).
fn pasted_formats(
    bases: &Bases,
    sheet: &Sheet,
    ids: &Sheet,
    landing: &Landing,
    formats: &[CopiedFormat],
    what: What,
) -> Vec<Op> {
    let taken = taken_away(bases, sheet, ids, &landing.area_rows(), &landing.area_columns(), |leaf| what.pastes(leaf));
    taken.into_iter().chain(formats_given(bases, sheet, ids, landing, formats, what)).collect()
}

/// The leaves of formats some of the cells hold (by position in a sheet; that the edit takes away) set back to their
/// defaults over all of them, the lines named by `ids` (the sheet grown, maybe).
fn taken_away(
    bases: &Bases,
    sheet: &Sheet,
    ids: &Sheet,
    rows: &[usize],
    columns: &[usize],
    taken: impl Fn(Leaf) -> bool,
) -> Option<Op> {
    let (in_rows, in_columns): (HashSet<usize>, HashSet<usize>) =
        (rows.iter().copied().collect(), columns.iter().copied().collect());
    let mut held: BTreeSet<Leaf> = BTreeSet::new();
    for (leaf, (r, c), _) in sheet.formats.iter() {
        let at = (sheet.rows.position(r), sheet.columns.position(c));
        if let (Some(r), Some(c)) = at {
            if in_rows.contains(&r) && in_columns.contains(&c) && taken(leaf) {
                held.insert(leaf);
            }
        }
    }
    if held.is_empty() {
        return None;
    }
    let mut rows: Vec<LineId> = rows.iter().map(|&p| ids.rows.line(p).expect("a row of the edit")).collect();
    let mut columns: Vec<LineId> =
        columns.iter().map(|&p| ids.columns.line(p).expect("a column of the edit")).collect();
    let leaves: BTreeMap<Leaf, Json> = held.iter().map(|&leaf| (leaf, leaf.default_value())).collect();
    Some(Op::SetCellFormats {
        sheet_id: sheet.id.clone(),
        formats: vec![CellsToFormat {
            rows: sorted_runs(bases, &mut rows),
            columns: sorted_runs(bases, &mut columns),
            format: write_format(&leaves),
        }],
    })
}

/// The copy's formats set where it lands, a dropdown only where the sheet has that dropdown.
fn formats_given(
    bases: &Bases,
    sheet: &Sheet,
    ids: &Sheet,
    landing: &Landing,
    formats: &[CopiedFormat],
    what: What,
) -> Option<Op> {
    let mut given = Vec::new();
    for format in formats {
        let leaves: BTreeMap<Leaf, Json> = read_format(&format.format)
            .expect("a format read")
            .into_iter()
            .filter(|&(leaf, _)| what.pastes(leaf))
            .filter(|(leaf, value)| *leaf != Leaf::CellControl || control_kept(sheet, value))
            .collect();
        if leaves.is_empty() {
            continue;
        }
        let spread = |tiles: &[usize], spans: &[Span]| -> Vec<usize> {
            tiles
                .iter()
                .flat_map(|&t| {
                    spans.iter().flat_map(move |span| t + span.first as usize..t + (span.first + span.count) as usize)
                })
                .collect()
        };
        let (rows, columns) = (spread(&landing.rows, &format.rows), spread(&landing.columns, &format.columns));
        let mut rows: Vec<LineId> = rows.into_iter().map(|p| ids.rows.line(p).expect("a row pasted on")).collect();
        let mut columns: Vec<LineId> =
            columns.into_iter().map(|p| ids.columns.line(p).expect("a column pasted on")).collect();
        given.push(CellsToFormat {
            rows: sorted_runs(bases, &mut rows),
            columns: sorted_runs(bases, &mut columns),
            format: write_format(&leaves),
        });
    }
    (!given.is_empty()).then(|| Op::SetCellFormats { sheet_id: sheet.id.clone(), formats: given })
}

/// The formulas pasted that weigh too much to paste unseen (`typing/unseen.rs`), cell by cell, row by row (but those
/// with fewer references than the formula they take the place of first), each text between references once (so one
/// copied cell pasted over and over shows once, unless a tile turns its references to `#REF!`), and none the
/// workbook's formulas have (`unseen::seen`): its cell, and the formula as the workbook's locale writes it.
fn texts_to_show(workbook: &Workbook, s: usize, given: &HashMap<(usize, usize), Input>) -> Vec<TextThatNoCellShows> {
    let sheet = &workbook.sheets[s];
    let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
    let mut formulas: Vec<((usize, usize), &StoredFormula)> = given
        .iter()
        .filter_map(|(&place, input)| match input {
            Input::Formula { formula } if unseen::weight(&formula.text_between_references) > unseen::MOST_WEIGHT => {
                Some((place, formula))
            }
            _ => None,
        })
        .collect();
    // A reference pasted to `#REF!` over `=B1`, say, comes before the formulas pasted on cells of the rows above.
    let references_before = |(r, c): (usize, usize)| {
        let place = (sheet.rows.line(r)?, sheet.columns.line(c)?);
        match &sheet.cells.get(&place)?.input {
            Input::Formula { formula } => Some(formula.references.len()),
            _ => None,
        }
    };
    formulas.sort_by_key(|&(place, formula)| {
        (formula.references.len() >= references_before(place).unwrap_or(0), place)
    });
    let mut seen = if formulas.is_empty() { HashSet::new() } else { unseen::seen(workbook) };
    let mut to_show = Vec::new();
    for ((r, c), formula) in formulas {
        if !seen.insert(&formula.text_between_references) {
            continue;
        }
        let line = |axis: &Axis, p: usize| workbook.bases.text(axis.line(p).expect("a line pasted on"));
        let written = formula_text::in_locale(&workbook.formula_text(s, formula), locale);
        to_show.push(TextThatNoCellShows { r: line(&sheet.rows, r), c: line(&sheet.columns, c), written });
    }
    to_show
}

/// How much a cell's input given by a paste or a fill has to keep: a text's bytes, a dropdown option's label's, a
/// formula's text's and 164 for each reference to a cell, 256 for each to more; a number or a yes or no nothing; 128
/// for each person and their label's bytes; text with looks 128 for each paragraph and each run, its text's bytes
/// (paragraphs on lines of their own) and its links'.
fn weight(input: &Input) -> usize {
    match input {
        Input::Number { .. } | Input::Boolean { .. } => 0,
        Input::Text { value } => value.len(),
        Input::DropdownOption { label, .. } => label.len(),
        Input::Formula { formula } => {
            let references: usize =
                formula.references.iter().map(|r| if matches!(r, Reference::Cell { .. }) { 164 } else { 256 }).sum();
            formula.text_between_references.iter().map(String::len).sum::<usize>() + references
        }
        Input::User { label, .. } => 128 + label.len(),
        Input::Users { users } => users.iter().map(|person| 128 + person.label.len()).sum(),
        Input::RichText { paragraphs } => {
            let runs = || paragraphs.iter().flat_map(|p| &p.runs);
            let links: usize = runs().filter_map(|run| run.link.as_deref()).map(str::len).sum();
            128 * (paragraphs.len() + runs().count()) + rich::plain_text(paragraphs).len() + links
        }
    }
}

/// How much a cell holds, weighed against what a paste or a fill gives it (more given waits): as `weight`, but a
/// formula's reference weighs 52 for a cell and 144 for more, whatever sheet it is to. The order of the cells set
/// follows it.
fn held_weight(input: &Input) -> usize {
    let Input::Formula { formula } = input else { return weight(input) };
    let references: usize =
        formula.references.iter().map(|r| if matches!(r, Reference::Cell { .. }) { 52 } else { 144 }).sum();
    formula.text_between_references.iter().map(String::len).sum::<usize>() + references
}

/// The cells merged ranges cover (in one, not its first), by position: the ranges read back, a range hidden by one it
/// overlaps covering nothing.
fn covered_cells(workbook: &Workbook, sheet: &Sheet) -> HashSet<(usize, usize)> {
    let mut covered = HashSet::new();
    for (t, b, l, r) in crate::workbook::layout::merged_boxes(&workbook.bases, sheet) {
        for row in t..=b {
            for column in l..=r {
                if (row, column) != (t, l) {
                    covered.insert((row, column));
                }
            }
        }
    }
    covered
}

/// Whether a copied cell control is pasted: a checkbox is, a dropdown when the sheet has it.
fn control_kept(sheet: &Sheet, control: &Json) -> bool {
    match control["dropdownId"].as_str() {
        Some(id) => sheet.dropdowns.values().any(|(dropdown_id, _)| dropdown_id == id),
        None => true,
    }
}

/// What a copied cell gives the cell it is pasted on, the copy moved by rows and columns: a formula moved, an option
/// as `option_pasted` has it.
fn pasted_input(workbook: &Workbook, s: usize, input: &CopiedInput, rows: i64, columns: i64) -> Result<Input, Refused> {
    Ok(match input {
        CopiedInput::Number { value } => Input::Number { value: *value },
        CopiedInput::Text { value } => Input::Text { value: value.clone() },
        CopiedInput::Boolean { value } => Input::Boolean { value: *value },
        CopiedInput::Formula { text } => Input::Formula { formula: moved_formula(workbook, s, text, rows, columns)? },
        CopiedInput::DropdownOption { option_id, label } => option_pasted(&workbook.sheets[s], option_id, label)?,
        CopiedInput::User { .. } | CopiedInput::Users { .. } | CopiedInput::RichText { .. } => people_or_looks(input),
        CopiedInput::FormulaByOffsets { .. } => unreachable!("a formula by offsets lands on its cell"),
    })
}

/// What a dropdown option pasted or filled gives a cell: the option of a dropdown the sheet has with its label there
/// (its id must be well formed, `idNotWellFormed`), else the option's label as text.
fn option_pasted(sheet: &Sheet, option_id: &str, label: &str) -> Result<Input, Refused> {
    Ok(match sheet.dropdown_option(option_id) {
        Some(option) => {
            if !is_option_id(option_id) {
                return Err(Refused::Because("idNotWellFormed"));
            }
            Input::DropdownOption { option_id: option_id.to_owned(), label: option.label.clone() }
        }
        None => Input::Text { value: label.to_owned() },
    })
}

/// What a copied value gives the cell it is pasted on (a position of the sheet, or past its end): a text one of the
/// options of the cell's dropdown reads as (by its label in any case, as it is or trimmed) is that option.
fn pasted_value(sheet: &Sheet, (r, c): (usize, usize), input: &CopiedInput) -> Result<Input, Refused> {
    Ok(match input {
        CopiedInput::Number { value } => Input::Number { value: *value },
        CopiedInput::Boolean { value } => Input::Boolean { value: *value },
        CopiedInput::Text { value } => {
            let place = sheet.rows.line(r).zip(sheet.columns.line(c));
            let options = place.and_then(|place| crate::typing::dropdown_of(sheet, place));
            let text = value.to_lowercase();
            let option = options.and_then(|options| {
                let by = |t: &str| options.iter().find(|o| o.label.to_lowercase() == t);
                by(&text).or_else(|| by(text.trim()))
            });
            match option {
                Some(option) if !is_option_id(&option.option_id) => return Err(Refused::Because("idNotWellFormed")),
                Some(option) => {
                    Input::DropdownOption { option_id: option.option_id.clone(), label: option.label.clone() }
                }
                None => Input::Text { value: value.clone() },
            }
        }
        CopiedInput::User { .. } | CopiedInput::Users { .. } => people_or_looks(input),
        _ => unreachable!("a copy of values holds values alone"),
    })
}

/// A copied person, people or text with looks as the cell pasted on holds them.
fn people_or_looks(input: &CopiedInput) -> Input {
    match input {
        CopiedInput::User { user_id, label } => Input::User { user_id: user_id.clone(), label: label.clone() },
        CopiedInput::Users { users } => Input::Users { users: users.clone() },
        CopiedInput::RichText { paragraphs } => Input::RichText { paragraphs: paragraphs.clone() },
        _ => unreachable!("a person, people or text with looks"),
    }
}

/// A formula's text moved and kept by a sheet, unless too long a formula (in bytes, or in references).
fn moved_formula(workbook: &Workbook, s: usize, text: &str, rows: i64, columns: i64) -> Result<StoredFormula, Refused> {
    let moved = formula::moved(text, rows, columns);
    if moved.len() > LONGEST_FORMULA {
        return Err(Refused::Because("formulaTooLong"));
    }
    let stored = formula::stored(&moved, workbook, s, locale::en_us());
    if stored.references.len() > MOST_REFERENCES {
        return Err(Refused::Because("formulaTooLong"));
    }
    Ok(stored)
}

/// Whether an option's id is well formed: `opt_`, 8 to 16 small letters and digits, `.` and a number.
fn is_option_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("opt_") else { return false };
    let Some((code, _)) = split_id(rest) else { return false };
    (8..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}
