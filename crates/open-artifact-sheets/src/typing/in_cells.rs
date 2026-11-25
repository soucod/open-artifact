//! Typing into a block of cells: one text entered into each (`enterInCells`), rows of texts pasted from the block's
//! first cell on (`pasteRowsOfTexts`), and the block cleared (`clearCells`).
//!
//! A block (`CellBlock`) is rows of a sheet, named in runs of ids (in the sheet's order whatever order they are
//! named in, the ids it doesn't have aside), and the columns from one to the other, either way round. A block of no
//! runs, or with a run of no ids, is unreadable; so are such rows to land in.
//!
//! A text entered into a block goes into each cell no merged range covers, as typed into that cell: a formula's
//! references move with the cell, from the cell typed in (`formula::shifted`). A text is entered into as many
//! cells at a time as come to 960 KiB, each counting 224 bytes and the text's in UTF-8, in whole words of 4 bytes
//! (`tooManyCellsToEnterIn`): 4,388 cells for a text of up to 3 bytes, 3,034 for 100. A cell that comes to what it
//! holds is left out.
//!
//! Rows of texts land from the block's first cell on: several rows on the rows that follow it in the sheet (every one
//! the sheet has among those the page says they may land in, when it says), one row on each row of the block (whatever
//! the page says). Each row's texts land on the columns from the block's left on, or, when every row is one text, each
//! on all the block's columns. A merged range that reaches into where the texts would land so, and into the block's
//! rows, keeps them from it: one row on the block's first row only, one text on its first column only. So does a block
//! of every row the sheet has, for one row down it, and a block of every column, for one text across it. A formula's
//! references move as far as it lands from its own cell, its row of texts' place below the block's top and its place
//! right of the block's left: one row on every row of the block moves down to each, one text on every column moves
//! right to each. The sheet grows by the rows and columns a text that is not empty reaches past its end; then the texts
//! are pasted as `pasteTexts` pastes them, leaving out an empty text for a cell that holds nothing. The place changed
//! is where the rows land, as wide as the widest (or the block), within the sheet.
//!
//! Clearing a block empties every cell in it that holds something and takes away its checkboxes; a dropdown stays.

use hashbrown::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use super::reading::{self, Reading};
use super::{change_of, check_length, formula, locale_of, locales_of, ops_of, paste_cells};
use super::{workbook_locale, CellAt, Change, How, Pasted, PastedTextIs};
use super::TextThatNoCellShows;
use super::TypedCell;
use crate::ids::{IdRun, LineId};
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{blocks, Leaf};
use crate::workbook::load::{CellToSet, CellsToFormat, Op, Refusal};
use crate::workbook::{layout, Sheet, Workbook};

/// Whether a text of `bytes` (in UTF-8) is entered into too many cells at a time.
pub(super) fn are_too_many_to_enter_in(cells: usize, bytes: usize) -> bool {
    cells as u64 * (224 + (bytes as u64 & !3)) > 960 * 1024
}

/// A block of cells, as an edit names it.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellBlock {
    sheet_id: String,
    pub(super) rows: Vec<IdRun>,
    one_column: String,
    other_column: String,
}

/// A block of cells found in its sheet: the sheet's index, the rows' positions in order, and the columns' first and
/// last positions.
pub(super) struct Block {
    pub s: usize,
    pub rows: Vec<usize>,
    pub left: usize,
    pub right: usize,
}

impl Block {
    pub fn count(&self) -> usize {
        self.rows.len() * (self.right - self.left + 1)
    }

    /// The block's cells by position, row by row.
    pub fn positions(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.rows.iter().flat_map(move |&r| (self.left..=self.right).map(move |c| (r, c)))
    }
}

/// A block as its sheet has it, or why it can't be found: its sheet, then its columns, then whether the sheet has
/// any of its rows (`unknownRow` when none; rows it doesn't have are left out otherwise).
pub(super) fn block_of(workbook: &Workbook, block: &CellBlock) -> Result<Block, Refusal> {
    let s = workbook.sheet_index(&block.sheet_id).ok_or(Refusal::UnknownSheet)?;
    let sheet = &workbook.sheets[s];
    let column =
        |id: &str| workbook.bases.parse(id).and_then(|l| sheet.columns.position(l)).ok_or(Refusal::UnknownColumn);
    let (one, other) = (column(&block.one_column)?, column(&block.other_column)?);
    let named = |line: LineId| {
        let base = workbook.bases.name(line.base);
        block.rows.iter().any(|run| run.base == base && line.n >= run.first && line.n - run.first < run.count)
    };
    let rows: Vec<usize> = (0..sheet.rows.len()).filter(|&r| sheet.rows.line(r).is_some_and(named)).collect();
    if rows.is_empty() {
        return Err(Refusal::UnknownRow);
    }
    Ok(Block { s, rows, left: one.min(other), right: one.max(other) })
}

/// The merged ranges' boxes of a sheet as it reads them back (one overlapping a range before it merges nothing):
/// top, bottom, left, right.
pub(super) fn merged_boxes(workbook: &Workbook, sheet: &Sheet) -> Vec<(usize, usize, usize, usize)> {
    layout::merged_boxes(&workbook.bases, sheet)
}

/// Whether a merged range covers the cell at a position (it is in one, not first).
pub(super) fn is_covered(boxes: &[(usize, usize, usize, usize)], (r, c): (usize, usize)) -> bool {
    boxes.iter().any(|&(t, b, l, rt)| (t..=b).contains(&r) && (l..=rt).contains(&c) && (r, c) != (t, l))
}

/// The cell's ids at a position of the sheet.
pub(super) fn place_at(sheet: &Sheet, (r, c): (usize, usize)) -> (LineId, LineId) {
    (sheet.rows.line(r).expect("a row of the sheet"), sheet.columns.line(c).expect("a column of the sheet"))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum InCellsEdit {
    #[serde(rename_all = "camelCase")]
    EnterInCells { cells: CellBlock, typed_in: CellAt, text: String },
    #[serde(rename_all = "camelCase")]
    PasteRowsOfTexts {
        selected: CellBlock,
        rows: Vec<Vec<String>>,
        pasted_text_is: PastedTextIs,
        #[serde(default)]
        locale_of_texts: Option<String>,
        #[serde(default)]
        may_land_in: Option<Vec<IdRun>>,
    },
    ClearCells { cells: CellBlock },
}

/// Whether runs read: some, none of no ids or of ids past the largest.
pub(super) fn are_readable(runs: &[IdRun]) -> bool {
    !runs.is_empty() && runs.iter().all(|r| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32)
}

/// The edit read, with its block's rows and the rows the texts may land in.
fn read(edit: &Value) -> Result<InCellsEdit, Refusal> {
    let edit = InCellsEdit::deserialize(edit).map_err(|_| Refusal::UnreadableRequest)?;
    let readable = match &edit {
        InCellsEdit::EnterInCells { cells, .. } | InCellsEdit::ClearCells { cells } => are_readable(&cells.rows),
        InCellsEdit::PasteRowsOfTexts { selected, may_land_in, .. } => {
            are_readable(&selected.rows) && may_land_in.as_deref().is_none_or(are_readable)
        }
    };
    readable.then_some(edit).ok_or(Refusal::UnreadableRequest)
}

/// Whether an `enterInCells`, `pasteRowsOfTexts` or `clearCells` edit reads: its fields as they are read, a
/// locale known.
pub fn reads(edit: &Value) -> bool {
    match read(edit) {
        Ok(InCellsEdit::PasteRowsOfTexts { locale_of_texts, .. }) => {
            locale_of_texts.is_none_or(|tag| crate::locale::find(&tag).is_some())
        }
        Ok(_) => true,
        Err(_) => false,
    }
}

/// The operations of an `enterInCells` edit, and the block's corners (top, left, bottom, right), or the
/// refusal.
pub fn enter_in_cells(workbook: &Workbook, edit: &Value) -> Result<(Vec<Op>, (usize, usize, usize, usize)), Refusal> {
    let InCellsEdit::EnterInCells { cells, typed_in, text } = read(edit)? else {
        return Err(Refusal::UnreadableRequest);
    };
    let block = block_of(workbook, &cells)?;
    let sheet = &workbook.sheets[block.s];
    let typed_r = workbook.bases.parse(&typed_in.r).and_then(|l| sheet.rows.position(l)).ok_or(Refusal::UnknownRow)?;
    let typed_c =
        workbook.bases.parse(&typed_in.c).and_then(|l| sheet.columns.position(l)).ok_or(Refusal::UnknownColumn)?;
    if are_too_many_to_enter_in(block.count(), text.len()) {
        return Err(Refusal::TooManyCellsToEnterIn);
    }
    let corners = (
        block.rows.first().copied().unwrap_or(0),
        block.left,
        block.rows.last().copied().unwrap_or(0),
        block.right,
    );
    let locale = workbook_locale(workbook);
    let is_formula = matches!(reading::read(&text, locales_of(workbook, locale), true), Reading::Formula(_));
    let boxes = merged_boxes(workbook, sheet);
    let mut order = Vec::new();
    let mut changes: HashMap<(LineId, LineId), Change> = HashMap::new();
    for (r, c) in block.positions() {
        if is_covered(&boxes, (r, c)) {
            continue;
        }
        let place = place_at(sheet, (r, c));
        let text = if is_formula {
            formula::shifted(&text, r as i64 - typed_r as i64, c as i64 - typed_c as i64)
        } else {
            text.clone()
        };
        check_length(workbook, block.s, &text, locale, How::Entered)?;
        let change = change_of(workbook, block.s, place, &text, locale, How::Entered);
        if change.pattern.is_none() && change.input.as_ref() == sheet.cells.get(&place).map(|cell| &cell.input) {
            continue;
        }
        order.push(place);
        changes.insert(place, change);
    }
    if order.is_empty() {
        return Ok((Vec::new(), corners));
    }
    Ok((ops_of(workbook, sheet, &order, &changes), corners))
}

/// The operations of a `clearCells` edit, or the refusal.
pub fn clear_cells(workbook: &Workbook, edit: &Value) -> Result<Vec<Op>, Refusal> {
    let InCellsEdit::ClearCells { cells } = read(edit)? else { return Err(Refusal::UnreadableRequest) };
    let block = block_of(workbook, &cells)?;
    let sheet = &workbook.sheets[block.s];
    let bases = &workbook.bases;
    let mut emptied = Vec::new();
    let mut checkboxes = Vec::new();
    for position in block.positions() {
        let place = place_at(sheet, position);
        if sheet.cells.contains_key(&place) {
            emptied.push(CellToSet { r: bases.text(place.0), c: bases.text(place.1), input: None });
        }
        if sheet.formats.get(Leaf::CellControl, place).is_some_and(|control| control["kind"] == "checkbox") {
            checkboxes.push(place);
        }
    }
    let mut ops = Vec::new();
    if !emptied.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells: emptied, form: CellForm::List });
    }
    if !checkboxes.is_empty() {
        let none = json!({"kind": "none"});
        let formats = blocks(bases, checkboxes.iter().map(|&place| (Leaf::CellControl, place, &none)))
            .into_iter()
            .map(|(rows, columns, format)| CellsToFormat { rows, columns, format })
            .collect();
        ops.push(Op::SetCellFormats { sheet_id: sheet.id.clone(), formats });
    }
    Ok(ops)
}

/// What a `pasteRowsOfTexts` edit answers (`code` is the edit's `newIdCode`, which the rows and columns the sheet
/// grows by are named with), given what the person has been shown; and the place it changes (top, left, bottom,
/// right), when it pastes something.
pub fn paste_rows_of_texts(
    workbook: &Workbook,
    edit: &Value,
    code: &str,
    shown: Option<&[TextThatNoCellShows]>,
) -> Result<(Pasted, Option<(usize, usize, usize, usize)>), Refusal> {
    let InCellsEdit::PasteRowsOfTexts { selected, rows, pasted_text_is, locale_of_texts, may_land_in } = read(edit)?
    else {
        return Err(Refusal::UnreadableRequest);
    };
    let locale = locale_of(workbook, locale_of_texts.as_deref())?;
    let block = block_of(workbook, &selected)?;
    let widest = rows.iter().map(Vec::len).max().unwrap_or(0);
    let Some(&top) = block.rows.first() else { return Ok((Pasted::Ops(Vec::new()), None)) };
    if widest == 0 {
        return Ok((Pasted::Ops(Vec::new()), None));
    }
    let sheet = &workbook.sheets[block.s];
    // One row is put on every row of the block, and one text (when every row is one) on every column, unless the block
    // is every row the sheet has (or every column)...
    let (every_row, every_column) =
        (block.rows.len() == sheet.rows.len(), block.left == 0 && block.right + 1 == sheet.columns.len());
    let (down, across) = (rows.len() == 1 && !every_row, !every_column && rows.iter().all(|row| row.len() == 1));
    // ...or a merged range reaches into where the texts would land so and into the block's rows (in those columns).
    let landing_rows: Vec<usize> = if down { block.rows.clone() } else { (top..top + rows.len()).collect() };
    let landing_right = if across { block.right } else { block.left + widest - 1 };
    let is_merged_into = merged_boxes(workbook, sheet).iter().any(|&(t, b, l, rt)| {
        let reached = |rows: &[usize]| rows.iter().any(|r| (t..=b).contains(r));
        block.left <= rt && l <= landing_right && reached(&block.rows) && reached(&landing_rows)
    });
    let (down, across) = (down && !is_merged_into, across && !is_merged_into);
    // Each row of texts, the position of the row it lands on and of its own (the block's top, for one row on each).
    let landing: Vec<(usize, usize, &Vec<String>)> = match &rows[..] {
        [row] if down => block.rows.iter().map(|&r| (r, top, row)).collect(),
        _ => rows.iter().enumerate().map(|(i, row)| (top + i, top + i, row)).collect(),
    };
    // Several rows land only on rows the page names (rows the sheet grows by aside); one row lands on the block's.
    if let (Some(may_land_in), [_, _, ..]) = (&may_land_in, &rows[..]) {
        let named = |line: LineId| {
            let base = workbook.bases.name(line.base);
            may_land_in.iter().any(|run| run.base == base && line.n >= run.first && line.n - run.first < run.count)
        };
        if landing.iter().any(|&(r, ..)| sheet.rows.line(r).is_some_and(|line| !named(line))) {
            return Err(Refusal::RowNotNamedInTheWay);
        }
    }
    // Each text, the cell it lands on and how far that is from its own (on its own row, in the column as far from
    // the left as it is from its row's first): a row of one text in each of the block's columns, when every row is.
    let each_one = across;
    let width = if each_one { block.right - block.left + 1 } else { widest };
    let mut landed: Vec<(usize, usize, &String, (i64, i64))> = Vec::new();
    for &(r, own, row) in &landing {
        let down = r as i64 - own as i64;
        match &row[..] {
            [text] if each_one => {
                landed.extend((block.left..=block.right).map(|c| (r, c, text, (down, (c - block.left) as i64))));
            }
            _ => landed.extend(row.iter().enumerate().map(|(j, text)| (r, block.left + j, text, (down, 0)))),
        }
    }
    // The sheet grows by the rows and columns a text that is not empty reaches past its end.
    let reached = landed.iter().filter(|(_, _, text, _)| !text.is_empty());
    let (last_row, last_column) = reached.fold((0, 0), |(r0, c0), &(r, c, ..)| (r0.max(r + 1), c0.max(c + 1)));
    let mut grown = Vec::new();
    if last_row > sheet.rows.len() {
        let after = sheet.rows.line(sheet.rows.len().wrapping_sub(1)).map(|line| workbook.bases.text(line));
        let count = (last_row - sheet.rows.len()) as u32;
        let rows = IdRun { base: format!("row_{code}"), first: 0, count };
        grown.push(Op::InsertRows { sheet_id: sheet.id.clone(), after, rows });
    }
    if last_column > sheet.columns.len() {
        let after = sheet.columns.line(sheet.columns.len().wrapping_sub(1)).map(|line| workbook.bases.text(line));
        let count = (last_column - sheet.columns.len()) as u32;
        let columns = IdRun { base: format!("col_{code}"), first: 0, count };
        grown.push(Op::InsertColumns { sheet_id: sheet.id.clone(), after, columns });
    }
    let before = workbook;
    let grown_workbook;
    let workbook = if grown.is_empty() {
        workbook
    } else {
        let mut copy = workbook.clone();
        copy.apply(&grown)?;
        grown_workbook = copy;
        &grown_workbook
    };
    let sheet = &workbook.sheets[block.s];
    let bases = &workbook.bases;
    let (rows_now, columns_now) = (sheet.rows.len(), sheet.columns.len());
    let mut cells = Vec::new();
    for (r, c, text, (down, right)) in landed {
        let inside = r < rows_now && c < columns_now;
        if text.is_empty() && !(inside && sheet.cells.contains_key(&place_at(sheet, (r, c)))) {
            continue;
        }
        let place = place_at(sheet, (r, c));
        // A formula's references move with it, as an entered one's do.
        let text = match reading::read(text, locales_of(workbook, locale), false) {
            Reading::Formula(_) => formula::shifted(text, down, right),
            _ => text.clone(),
        };
        cells.push(TypedCell { r: bases.text(place.0), c: bases.text(place.1), text });
    }
    // The place changed ends at the last row given a text (an empty one too): rows given none are left out.
    let bottom = landing.iter().filter(|(.., row)| !row.is_empty()).map(|&(r, ..)| r).max().unwrap_or(top).min(rows_now - 1);
    let right = (block.left + width - 1).min(columns_now - 1);
    let corners = Some((top, block.left, bottom, right));
    // The rows and columns the sheet grows by come first, tried or not.
    let after_growing = |ops: Vec<Op>| grown.iter().cloned().chain(ops).collect();
    let pasted = match paste_cells(workbook, before, block.s, &cells, pasted_text_is, locale, shown)? {
        Pasted::Ops(ops) => Pasted::Ops(after_growing(ops)),
        to_be_shown_first => to_be_shown_first,
    };
    Ok((pasted, corners))
}
