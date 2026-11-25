//! Cells as they are copied: `readCellsToCopy` answers a range of the workbook shown the way the page puts it on
//! the clipboard.
//!
//! ```text
//! {"kind":"readCellsToCopy","cells":{"sheetId":…,"oneCorner":{"r","c"},"otherCorner":{"r","c"}},
//!  "rowsOutOfView":[runs]}
//! → {"kind":"cellsToCopy","copiedCellsAsText":…,"values":…,"rowCount":2,"columnCount":3,
//!    "cells":[{"row":0,"column":0,"textToPaste":"1.5"},…],"localeOfTexts":"en-US"}
//! ```
//!
//! The corners may be in any order. A range that reaches the last row of its sheet leaves out the empty rows at its
//! end (one row stays), and one that reaches the last column the empty columns (`blankRowsLeftOut`,
//! `blankColumnsLeftOut`), rows out of view or not. Then the rows the page has out of view (`rowsOutOfView`, hidden
//! or filtered away) are left out, the rows after them moving up; when they are all of them, nothing is copied
//! (`copiedCellsAsText` is `null`). A merged range whose first row is out of view, but not all its rows, shows its
//! first cell in its first row in view: the cell's text is pasted from there, and neither the copy nor its values
//! are written.
//!
//! - `copiedCellsAsText` is the copy for this workbook's own pastes (`copied_cells.rs`): every cell's input and
//!   format. A dropdown's option is copied with its label now, and as text when the option is gone. A value spilled
//!   into the range from a formula outside it is copied as that value.
//! - `values` is what pasting only the values would paste: `writtenAsTheCopiedCells` when every cell is its own
//!   value, `notWritten` while formulas wait to be worked out, else `writtenBesideTheCopiedCells` with a copy
//!   (`asText`) whose cells are the values of the formulas, of the dropdowns and of what the formulas copied spill,
//!   an error as its text, and whose formats are the number formats alone.
//! - `cells` is what other programs get: each cell's text to paste, the way the workbook's locale writes it (a
//!   number with its own number format as shown, when the shown text reads back as the same number, else as one
//!   would edit it; a text that would read as something else with a `'` first; a formula as its text). A number
//!   with a number format also has the text it shows (`textShown`) and whether that is the whole number
//!   (`isNumberShownWhole`).

use hashbrown::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::calculate::SpillOutcome;
use crate::copied_cells::{CopiedCell, CopiedCells, CopiedFormat, CopiedInput, CopiedValues, Span, VERSION};
use crate::formula_text;
use crate::ids::{Bases, IdRun, LineId};
use crate::locale::{self, Locale};
use crate::number_format::{Kind, NumberFormat, Room};
use crate::shown::{shown, ShownValue};
use crate::typing::reading::{self, Locales, Reading};
use crate::value::{self, Value};
use crate::workbook::formats::{blocks, Leaf};
use crate::workbook::layout::CellIds;
use crate::workbook::{rich, Input, Sheet, Workbook};

pub const KINDS: &[&str] = &["readCellsToCopy", "readCellsToCopyInTheOrderOfTheirRows"];

/// Cells between two corners of a sheet, in any order.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellsBetween {
    pub sheet_id: String,
    pub one_corner: CellIds,
    pub other_corner: CellIds,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    #[serde(rename_all = "camelCase")]
    ReadCellsToCopy {
        cells: CellsBetween,
        #[serde(default, deserialize_with = "crate::workbook::layout::written::not_null")]
        rows_out_of_view: Option<Vec<IdRun>>,
    },
    ReadCellsToCopyInTheOrderOfTheirRows {
        cells: RowsInOrder,
    },
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    let copied = match Request::deserialize(request) {
        Ok(Request::ReadCellsToCopy { cells, rows_out_of_view }) => {
            let out_of_view = rows_out_of_view.unwrap_or_default();
            if out_of_view.iter().any(|run| run.count == 0) {
                return super::unreadable();
            }
            copied(workbook, &cells, &out_of_view, false)
        }
        Ok(Request::ReadCellsToCopyInTheOrderOfTheirRows { cells }) => {
            if cells.rows.is_empty() || cells.rows.iter().any(|run| run.count == 0) {
                return super::unreadable();
            }
            copied_in_order(workbook, &cells)
        }
        Err(_) => return super::unreadable(),
    };
    match copied {
        Ok(copied) => copied.answer().to_string(),
        Err(refusal) => json!({"kind": "refused", "refusal": refusal}).to_string(),
    }
}

/// Rows of a sheet in the order they are to be copied, by runs of ids, and the columns between two.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowsInOrder {
    sheet_id: String,
    rows: Vec<IdRun>,
    one_column: String,
    other_column: String,
}

/// Cells of rows in the order given, as they are copied (readCellsToCopyInTheOrderOfTheirRows): a row named twice is
/// refused (`rowNamedTwice`, whether the sheet has it or not, before `unknownSheet`), rows the sheet does not have are passed over, and when
/// none is left, `unknownRow` (after the columns' `unknownColumn`). Rows that are not one after another, in order, are
/// copied as values: the copy's top row is the first of them in the sheet.
fn copied_in_order(workbook: &Workbook, cells: &RowsInOrder) -> Result<Copied, &'static str> {
    let mut named: HashSet<(&str, u64)> = HashSet::new();
    for run in &cells.rows {
        for n in run.first..run.first.saturating_add(run.count) {
            if !named.insert((run.base.as_str(), n as u64)) {
                return Err("rowNamedTwice");
            }
        }
    }
    let s = workbook.sheet_index(&cells.sheet_id).ok_or("unknownSheet")?;
    let sheet = &workbook.sheets[s];
    let bases = &workbook.bases;
    let column = |id: &str| bases.parse(id).and_then(|l| sheet.columns.position(l)).ok_or("unknownColumn");
    let (c1, c2) = (column(&cells.one_column)?, column(&cells.other_column)?);
    let rows: Vec<usize> = cells
        .rows
        .iter()
        .filter_map(|run| bases.find(&run.base).map(|base| (base, run)))
        .flat_map(|(base, run)| (run.first..run.first.saturating_add(run.count)).map(move |n| LineId { base, n }))
        .filter_map(|line| sheet.rows.position(line))
        .collect();
    if rows.is_empty() {
        return Err("unknownRow");
    }
    Ok(copied_rows(workbook, s, rows, c1.min(c2), c1.max(c2), &HashSet::new(), false))
}

/// What one place of the copied range holds.
enum Held<'a> {
    /// A cell's input.
    Input(&'a Input),
    /// A value a formula spills there; `inside` when that formula is copied too.
    Spilled { value: &'a Value, inside: bool },
}

/// Cells as they are copied: the copy for this workbook's own pastes (none when it is not written), what pasting
/// only their values pastes, and what other programs get.
pub(in crate::session) struct Copied {
    pub copy: Option<CopiedCells>,
    pub values: CopiedValues,
    row_count: usize,
    column_count: usize,
    /// Each cell's text to paste, by its place in the copy.
    texts: Vec<Json>,
    locale: &'static str,
}

impl Copied {
    /// The answer to `readCellsToCopy`.
    fn answer(self) -> Json {
        let values = match self.values {
            CopiedValues::NotWritten => json!({"kind": "notWritten"}),
            CopiedValues::WrittenAsTheCopiedCells => json!({"kind": "writtenAsTheCopiedCells"}),
            CopiedValues::WrittenBesideTheCopiedCells(beside) => {
                json!({"kind": "writtenBesideTheCopiedCells", "asText": beside.text()})
            }
        };
        json!({
            "kind": "cellsToCopy",
            "copiedCellsAsText": self.copy.map(|copy| copy.text()),
            "values": values,
            "rowCount": self.row_count,
            "columnCount": self.column_count,
            "cells": self.texts,
            "localeOfTexts": self.locale,
        })
    }
}

/// Cells between two corners as they are copied, the rows out of view left out; `whole` keeps the empty rows and
/// columns at the end of the sheet too.
pub(in crate::session) fn copied(
    workbook: &Workbook,
    cells: &CellsBetween,
    out_of_view: &[IdRun],
    whole: bool,
) -> Result<Copied, &'static str> {
    let s = workbook.sheet_index(&cells.sheet_id).ok_or("unknownSheet")?;
    let sheet = &workbook.sheets[s];
    let bases = &workbook.bases;
    let row = |id: &str| bases.parse(id).and_then(|l| sheet.rows.position(l)).ok_or("unknownRow");
    let column = |id: &str| bases.parse(id).and_then(|l| sheet.columns.position(l)).ok_or("unknownColumn");
    let (r1, r2) = (row(&cells.one_corner.r)?, row(&cells.other_corner.r)?);
    let (c1, c2) = (column(&cells.one_corner.c)?, column(&cells.other_corner.c)?);
    let hidden: HashSet<LineId> = out_of_view
        .iter()
        .filter_map(|run| bases.find(&run.base).map(|base| (base, run)))
        .flat_map(|(base, run)| (run.first..run.first.saturating_add(run.count)).map(move |n| LineId { base, n }))
        .collect();
    let rows = (r1.min(r2)..=r1.max(r2)).collect();
    Ok(copied_rows(workbook, s, rows, c1.min(c2), c1.max(c2), &hidden, whole))
}

/// The cells of rows (positions, in the order they are copied) and columns as they are copied, the rows `hidden`
/// left out; `whole` keeps the empty rows and columns at the end of the sheet too. Rows that are not one after
/// another in order are copied as values, as rows out of view leave them.
fn copied_rows(
    workbook: &Workbook,
    s: usize,
    mut rows: Vec<usize>,
    left: usize,
    right: usize,
    hidden: &HashSet<LineId>,
    whole: bool,
) -> Copied {
    let sheet = &workbook.sheets[s];
    let bases = &workbook.bases;
    let top = *rows.iter().min().expect("a row");
    let bottom = *rows.iter().max().expect("a row");
    let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
    let mut columns: Vec<usize> = (left..=right).collect();
    let spilled = spilled_values(workbook, sheet);
    let held = |r: usize, c: usize| -> Option<Held> {
        let place = (sheet.rows.line(r)?, sheet.columns.line(c)?);
        if let Some(cell) = sheet.cells.get(&place) {
            return Some(Held::Input(&cell.input));
        }
        let &((ar, ac), value) = spilled.get(&(r, c))?;
        let inside = (top..=bottom).contains(&ar) && (left..=right).contains(&ac);
        Some(Held::Spilled { value, inside })
    };
    // Empty rows and columns at the end of the sheet are left out, one of each staying (rows out of view count).
    let mut blank_rows_left_out = None;
    if !whole && bottom + 1 == sheet.rows.len() {
        while rows.len() > 1 && columns.iter().all(|&c| held(*rows.last().unwrap(), c).is_none()) {
            rows.pop();
            blank_rows_left_out = Some(true);
        }
    }
    let mut blank_columns_left_out = None;
    if !whole && right + 1 == sheet.columns.len() {
        while columns.len() > 1 && rows.iter().all(|&r| held(r, *columns.last().unwrap()).is_none()) {
            columns.pop();
            blank_columns_left_out = Some(true);
        }
    }
    // Then the rows out of view. With rows left out, the formulas' references would no longer fit: their values are
    // copied instead. Which rows are out of view may change as the formulas are worked out, so until then such a
    // copy is not written.
    let area_rows = rows.clone();
    let is_hidden = |p: usize| hidden.contains(&sheet.rows.line(p).expect("a row"));
    rows.retain(|&p| !is_hidden(p));
    let in_order = area_rows.windows(2).all(|w| w[1] == w[0] + 1);
    let values_only = rows.len() < area_rows.len() || !in_order;
    // A merged range of the copy whose first row is out of view, but not all its rows, shows its first cell in its
    // first row in view: that cell's text is pasted there, and neither the copy nor its values are written.
    let mut shown_lower: HashMap<(usize, usize), (usize, usize)> = HashMap::new();
    if values_only {
        for (t, b, l, _) in crate::workbook::layout::merged_boxes(bases, sheet) {
            if (top..=bottom).contains(&t) && (left..=right).contains(&l) && is_hidden(t) {
                if let Some(&first) = rows.iter().find(|&&p| (t..=b).contains(&p)) {
                    shown_lower.insert((first, l), (t, l));
                }
            }
        }
    }
    let unsure = values_only && (workbook.needs_calculation || !shown_lower.is_empty());

    if rows.is_empty() {
        return Copied {
            copy: None,
            values: CopiedValues::NotWritten,
            row_count: 0,
            column_count: columns.len(),
            texts: Vec::new(),
            locale: locale.tag,
        };
    }

    // What a formula's number brings, where its cell has no number format of its own: it is shown with it, and
    // copied with it as a number format of its value.
    let brought = |place: (LineId, LineId)| -> Option<Json> {
        if sheet.formats.get(Leaf::NumberFormat, place).is_some() {
            return None;
        }
        let outcome = workbook.outcome(&sheet.id, place.0, place.1)?;
        match (&outcome.brought, &outcome.value) {
            (Some(brought), Value::Number(_)) => Some(json!({"pattern": &*brought.pattern})),
            _ => None,
        }
    };
    let mut copied = Vec::new();
    let mut values = Vec::new();
    let mut texts = Vec::new();
    let mut has_values = false;
    // The number formats formulas bring, by place in the copy: of the values copied in their place, and of the values
    // written beside.
    let (mut copied_brought, mut values_brought) = (HashMap::new(), HashMap::new());
    for (i, &r) in rows.iter().enumerate() {
        for (j, &c) in columns.iter().enumerate() {
            let (r, c) = shown_lower.get(&(r, c)).copied().unwrap_or((r, c));
            let Some(held) = held(r, c) else { continue };
            let place = (sheet.rows.line(r).expect("a row"), sheet.columns.line(c).expect("a column"));
            let (row, column) = (i as u32, j as u32);
            let mut to_paste = json!({"row": row, "column": column});
            match held {
                Held::Input(Input::Formula { .. }) if values_only => {
                    let value = workbook.outcome(&sheet.id, place.0, place.1).map(|o| &o.value);
                    let value = value.unwrap_or(&Value::Blank);
                    if let Some(input) = value_input(value) {
                        copied.push(CopiedCell { row, column, input });
                    }
                    let pattern = brought(place);
                    value_to_paste(&mut to_paste, sheet, place, value, locale, pattern.as_ref());
                    if let Some(pattern) = pattern {
                        copied_brought.insert((row, column), pattern);
                    }
                }
                Held::Input(input) => {
                    let (copied_input, value, text) = copied_input(workbook, s, sheet, place, input, locale);
                    // An option its sheet no longer has is copied as a text, the value it is written beside with: the
                    // value goes beside when something else needs it there, but is no reason to write values beside.
                    let as_its_value = matches!(copied_input, CopiedInput::Text { .. });
                    copied.push(CopiedCell { row, column, input: copied_input });
                    if let Some(value) = &value {
                        has_values |= !as_its_value;
                        if let Some(input) = value_input(value) {
                            values.push(CopiedCell { row, column, input });
                        }
                    }
                    match (input, &value) {
                        (Input::Number { value }, _) => {
                            text_of_number(&mut to_paste, sheet, place, *value, locale, None, None)
                        }
                        (Input::Formula { .. }, Some(Value::Number(n))) => {
                            let pattern = brought(place);
                            text_of_number(&mut to_paste, sheet, place, *n, locale, Some(text), pattern.as_ref());
                            if let Some(pattern) = pattern {
                                values_brought.insert((row, column), pattern);
                            }
                        }
                        (input, value) => {
                            to_paste["textToPaste"] = json!(text);
                            let read = input.reads_as_text();
                            let shown = match (input, value) {
                                (Input::Text { value }, _) => Some(value.as_str()),
                                (_, Some(Value::Text(t))) => Some(&**t),
                                _ => read.as_deref(),
                            };
                            if let Some(t) = shown {
                                text_shown(&mut to_paste, sheet, place, t);
                            }
                        }
                    }
                }
                Held::Spilled { value, inside: true } if !values_only => {
                    has_values = true;
                    if let Some(input) = value_input(value) {
                        values.push(CopiedCell { row, column, input });
                    }
                    to_paste["textToPaste"] = json!("");
                    if let Value::Text(t) = value {
                        text_shown(&mut to_paste, sheet, place, t);
                    }
                }
                Held::Spilled { value, .. } => {
                    let Some(input) = value_input(value) else { continue };
                    value_to_paste(&mut to_paste, sheet, place, value, locale, None);
                    copied.push(CopiedCell { row, column, input });
                }
            }
            texts.push(to_paste);
        }
    }

    // Group the formats inside the copied rectangle before dropping rows omitted
    // from a sorted or filtered selection. Only formatted gaps can affect a block.
    let selected_rows = area_rows.len();
    let mut area_rows = area_rows;
    if !in_order {
        let selected: HashSet<usize> = area_rows.iter().copied().collect();
        let mut gaps: Vec<usize> = sheet.formats.iter()
            .filter_map(|(_, (row, _), _)| sheet.rows.position(row))
            .filter(|r| (top..=bottom).contains(r) && !selected.contains(r))
            .collect();
        gaps.sort_unstable();
        gaps.dedup();
        area_rows.extend(gaps);
    }
    let in_view = |i: usize| i < selected_rows && !is_hidden(area_rows[i]);
    let formats = copied_formats(sheet, &area_rows, in_view, &columns, |_| true, &copied_brought);
    let copy = |cells: Vec<CopiedCell>, formats: Vec<CopiedFormat>| CopiedCells {
        version: VERSION,
        top_row_position: top as u32,
        left_column_position: left as u32,
        row_count: rows.len() as u64,
        column_count: columns.len() as u64,
        cells,
        formats,
        blank_rows_left_out,
        blank_columns_left_out,
    };
    let values = if workbook.needs_calculation || !shown_lower.is_empty() {
        CopiedValues::NotWritten
    } else if !has_values {
        CopiedValues::WrittenAsTheCopiedCells
    } else {
        let number_formats = copied_formats(
            sheet,
            &area_rows,
            in_view,
            &columns,
            |leaf| leaf == Leaf::NumberFormat,
            &values_brought,
        );
        CopiedValues::WrittenBesideTheCopiedCells(copy(values, number_formats))
    };
    Copied {
        copy: (!unsure).then(|| copy(copied, formats)),
        values,
        row_count: rows.len(),
        column_count: columns.len(),
        texts,
        locale: locale.tag,
    }
}

/// A cell's input as copied, the value it is copied with besides (a formula's, a dropdown option's label), and its
/// text to paste.
fn copied_input(
    workbook: &Workbook,
    s: usize,
    sheet: &Sheet,
    place: (LineId, LineId),
    input: &Input,
    locale: &Locale,
) -> (CopiedInput, Option<Value>, String) {
    match input {
        Input::Number { value } => (CopiedInput::Number { value: *value }, None, String::new()),
        Input::Text { value } => (CopiedInput::Text { value: value.clone() }, None, text_to_paste(value, locale)),
        Input::Boolean { value } => {
            (CopiedInput::Boolean { value: *value }, None, if *value { "TRUE" } else { "FALSE" }.to_owned())
        }
        Input::Formula { formula } => {
            let text = workbook.formula_text(s, formula);
            let written = formula_text::in_locale(&text, locale);
            let value = workbook.outcome(&sheet.id, place.0, place.1).map(|o| o.value.clone());
            (CopiedInput::Formula { text }, Some(value.unwrap_or(Value::Blank)), written)
        }
        Input::DropdownOption { option_id, label } => match sheet.dropdown_option(option_id) {
            Some(option) => (
                CopiedInput::DropdownOption { option_id: option_id.clone(), label: option.label.clone() },
                Some(Value::text(option.label.as_str())),
                option.label.clone(),
            ),
            // An option its sheet no longer has is copied as the text it shows.
            None => (CopiedInput::Text { value: label.clone() }, Some(Value::text(label.as_str())), label.clone()),
        },
        // People are their own value, as a text is; text with looks is copied with its text.
        Input::User { user_id, label } => (
            CopiedInput::User { user_id: user_id.clone(), label: label.clone() },
            None,
            text_to_paste(label, locale),
        ),
        Input::Users { users } => {
            (CopiedInput::Users { users: users.clone() }, None, text_to_paste(&rich::labels(users), locale))
        }
        Input::RichText { paragraphs } => {
            let text = rich::plain_text(paragraphs);
            let pasted = text_to_paste(&text, locale);
            (CopiedInput::RichText { paragraphs: paragraphs.clone() }, Some(Value::text(text.as_str())), pasted)
        }
    }
}

/// A value as a copied input: an error as its text; nothing for a blank or an empty text.
fn value_input(value: &Value) -> Option<CopiedInput> {
    Some(match value {
        Value::Number(n) => CopiedInput::Number { value: *n },
        Value::Boolean(b) => CopiedInput::Boolean { value: *b },
        Value::Text(t) if t.is_empty() => return None,
        Value::Text(t) => CopiedInput::Text { value: t.to_string() },
        Value::Error(e) => CopiedInput::Text { value: e.text().to_owned() },
        Value::Blank => return None,
    })
}

/// A value's text to paste, as that of a cell holding it (with the number format `brought`, when its own is none).
fn value_to_paste(
    to_paste: &mut Json,
    sheet: &Sheet,
    place: (LineId, LineId),
    value: &Value,
    locale: &Locale,
    brought: Option<&Json>,
) {
    let text = match value {
        Value::Number(n) => return text_of_number(to_paste, sheet, place, *n, locale, None, brought),
        Value::Boolean(b) => if *b { "TRUE" } else { "FALSE" }.to_owned(),
        Value::Text(t) => {
            to_paste["textToPaste"] = json!(text_to_paste(t, locale));
            return text_shown(to_paste, sheet, place, t);
        }
        Value::Error(e) => e.text().to_owned(),
        Value::Blank => String::new(),
    };
    to_paste["textToPaste"] = json!(text);
}

/// What a text shows, where its cell's number format has a section for texts (`"x"@`, `0;-0;0;@`, `@`); with no
/// such section a text shows as it is, and nothing is said.
fn text_shown(to_paste: &mut Json, sheet: &Sheet, place: (LineId, LineId), t: &str) {
    let format = sheet.formats.get(Leaf::NumberFormat, place);
    let pattern = format.and_then(|f| f.get("pattern")).and_then(Json::as_str);
    let Some(format) = pattern.and_then(|p| NumberFormat::parse(p).ok()) else { return };
    if format.shows_texts() {
        to_paste["textShown"] = json!(format.show_text(t).text);
    }
}

/// The values that formulas spill into cells besides their own, by position, with the position of the formula.
fn spilled_values<'a>(workbook: &'a Workbook, sheet: &Sheet) -> HashMap<(usize, usize), ((usize, usize), &'a Value)> {
    let mut out = HashMap::new();
    for ((sheet_id, r, c), outcome) in &workbook.outcomes {
        if *sheet_id != sheet.id {
            continue;
        }
        let Some(SpillOutcome::Fills { array, .. }) = &outcome.spill else { continue };
        let (Some(ar), Some(ac)) = (sheet.rows.position(*r), sheet.columns.position(*c)) else { continue };
        for ((i, j), value) in array.stored_entries().filter(|(position, _)| *position != (0, 0)) {
            out.insert((ar + i, ac + j), ((ar, ac), value));
        }
    }
    out
}

/// A text as pasted elsewhere: with a `'` first when it would read as something else (a number, a boolean, a
/// formula) or starts with a `'` that would be taken away.
fn text_to_paste(text: &str, locale: &Locale) -> String {
    let quoted = format!("'{text}");
    if reading::unquoted(&quoted, Locales { text: locale, workbook: locale }, false) == text {
        quoted
    } else {
        text.to_owned()
    }
}

/// A number's text to paste, and with a number format of its cell, what it shows and whether that is all of it.
/// `formula` is the text of the formula whose value it is: what is pasted then. `brought` is the number format the
/// formula brings, shown with when the cell has none of its own.
fn text_of_number(
    to_paste: &mut Json,
    sheet: &Sheet,
    place: (LineId, LineId),
    n: f64,
    locale: &Locale,
    formula: Option<String>,
    brought: Option<&Json>,
) {
    let format = sheet.formats.get(Leaf::NumberFormat, place).or(brought);
    let pattern = format.and_then(|f| f.get("pattern")).and_then(Json::as_str);
    let shown = pattern.filter(|p| *p != "General").and_then(|p| {
        match shown(&Value::Number(n), Some(p), Room::AsText, locale) {
            Ok(ShownValue::Text { text, .. }) => Some(text),
            _ => None,
        }
    });
    // A number its pattern cannot show (too large a percentage, say) is pasted as one edits it all the same.
    let Some(shown) = shown else {
        to_paste["textToPaste"] = json!(formula.unwrap_or_else(|| number_to_edit(n, pattern, locale)));
        return;
    };
    let whole = reads_as(&shown, n, locale);
    let text = match formula {
        Some(formula) => formula,
        None if whole => shown.clone(),
        None => number_to_edit(n, pattern, locale),
    };
    to_paste["textToPaste"] = json!(text);
    to_paste["textShown"] = json!(shown);
    to_paste["isNumberShownWhole"] = json!(whole);
}

/// Whether a text, pasted, reads as the number.
fn reads_as(text: &str, n: f64, locale: &Locale) -> bool {
    matches!(reading::read(text, Locales { text: locale, workbook: locale }, false), Reading::Number(m, _) if m == n)
}

/// A number as one edits it in a cell with a pattern: a percentage as one (`25.5%`), a date or a time the way the
/// locale writes them (`3/15/2023 18:00`, the date as `2023-03-15` when the pattern writes it so, the time with AM
/// or PM when the pattern has them) when that reads back as the number; anything else as the number. A time is
/// written with its seconds when it has them, and with as many decimals of a second (at most three) as it takes
/// (`13:30:15`, `13:30:15.25`); a date and time at midnight as its date alone.
fn number_to_edit(n: f64, pattern: Option<&str>, locale: &Locale) -> String {
    let plain = number_text(n, locale);
    let Some(format) = pattern.and_then(|p| NumberFormat::parse(p).ok()) else { return plain };
    let pattern = pattern.expect("a pattern");
    let date = if pattern.starts_with("yyyy-mm-dd") { "yyyy-mm-dd".to_owned() } else { locale.short_date.pattern() };
    let am_pm = if pattern.to_ascii_uppercase().contains("AM/PM") { " AM/PM" } else { "" };
    let times = ["h:mm", "h:mm:ss", "h:mm:ss.0", "h:mm:ss.00", "h:mm:ss.000"].map(|time| format!("{time}{am_pm}"));
    let written: Vec<String> = match format.kind() {
        Kind::Percent => return format!("{}%", value::number_text_in(n * 100.0, locale)),
        Kind::Date => vec![date],
        Kind::DateAndTime => {
            std::iter::once(date.clone()).chain(times.iter().map(|time| format!("{date} {time}"))).collect()
        }
        Kind::Time | Kind::Duration => times.to_vec(),
        _ => return plain,
    };
    let reading_back = |written: &String| {
        match NumberFormat::parse(written).map(|f| f.show_number_in(n, locale, Room::AsText)) {
            Ok(Ok(shown)) if reads_as(&shown.text, n, locale) => Some(shown.text),
            _ => None,
        }
    };
    written.iter().find_map(reading_back).unwrap_or(plain)
}

/// A number with the fewest digits that read back as it, written out in full while that takes at most 20
/// characters (`123456789012345680`, `0.0000001`), else as `1.2345678901234568E-05`, `1E+21`; with the locale's
/// decimal sign.
fn number_text(n: f64, locale: &Locale) -> String {
    if n == 0.0 || !n.is_finite() {
        return "0".into();
    }
    let text = format!("{:e}", n.abs());
    let (mantissa, exponent) = text.split_once('e').expect("an exponent");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i32 = exponent.parse().expect("an exponent");
    let len = digits.len() as i32;
    let fixed = if exponent < 0 {
        format!("0.{}{}", "0".repeat((-exponent - 1) as usize), digits)
    } else if exponent + 1 >= len {
        format!("{}{}", digits, "0".repeat((exponent + 1 - len) as usize))
    } else {
        let (int, frac) = digits.split_at((exponent + 1) as usize);
        format!("{int}.{frac}")
    };
    let sign = if n < 0.0 { "-" } else { "" };
    let text = if fixed.len() <= 20 {
        format!("{sign}{fixed}")
    } else {
        let (first, rest) = digits.split_at(1);
        let mantissa = if rest.is_empty() { first.to_owned() } else { format!("{first}.{rest}") };
        format!("{sign}{mantissa}E{}{:02}", if exponent >= 0 { "+" } else { "-" }, exponent.abs())
    };
    match locale.decimal_sign.sign() {
        '.' => text,
        sign => text.replace('.', sign.encode_utf8(&mut [0; 4])),
    }
}

/// The formats of the copied cells (those `leaves` takes), their rows and columns counted in the copy; and the number
/// formats `brought` by formulas, by place in the copy. The formats of rows out of view still part columns into
/// blocks: `rows` are the copy's rows with those, the ones `kept` (counted among `rows`)
/// copied.
pub(in crate::session) fn copied_formats(
    sheet: &Sheet,
    rows: &[usize],
    kept: impl Fn(usize) -> bool,
    columns: &[usize],
    leaves: impl Fn(Leaf) -> bool,
    brought: &HashMap<(u32, u32), Json>,
) -> Vec<CopiedFormat> {
    let mut bases = Bases::default();
    let base = bases.intern("");
    let row_of: HashMap<LineId, u32> =
        rows.iter().enumerate().map(|(i, &p)| (sheet.rows.line(p).expect("a row"), i as u32)).collect();
    let column_of: HashMap<LineId, u32> =
        columns.iter().enumerate().map(|(j, &p)| (sheet.columns.line(p).expect("a column"), j as u32)).collect();
    // Each row as counted in the copy, if it is copied; and the copy's rows among all.
    let mut in_copy = Vec::new();
    let mut copied_rows = Vec::new();
    for i in 0..rows.len() {
        in_copy.push(kept(i).then_some(copied_rows.len() as u32));
        if kept(i) {
            copied_rows.push(i as u32);
        }
    }
    let cells = sheet.formats.iter().filter(|&(leaf, ..)| leaves(leaf)).filter_map(|(leaf, (r, c), v)| {
        let place = (LineId { base, n: *row_of.get(&r)? }, LineId { base, n: *column_of.get(&c)? });
        Some((leaf, place, v))
    });
    let brought = brought.iter().map(|(&(row, column), v)| {
        (Leaf::NumberFormat, (LineId { base, n: copied_rows[row as usize] }, LineId { base, n: column }), v)
    });
    let cells = cells.chain(brought);
    let spans = |runs: Vec<IdRun>| runs.into_iter().map(|run| Span { first: run.first, count: run.count }).collect();
    // A block's rows out of view are left out, and those left run on; a block of them alone goes.
    let copied_spans = |runs: Vec<IdRun>| {
        let mut spans: Vec<Span> = Vec::new();
        let copied = runs.iter().flat_map(|run| run.first..run.first + run.count).filter_map(|i| in_copy[i as usize]);
        for i in copied {
            match spans.last_mut() {
                Some(span) if span.first + span.count == i => span.count += 1,
                _ => spans.push(Span { first: i, count: 1 }),
            }
        }
        spans
    };
    // Rows copied out of order (readCellsToCopyInTheOrderOfTheirRows): the blocks are in the order of their
    // columns and then of their rows where they are in the sheet, whatever their places in the copy.
    let mut blocks = blocks(&bases, cells);
    let in_sheet = |runs: &[IdRun]| {
        let mut at: Vec<usize> = runs.iter().flat_map(|run| run.first..run.first + run.count).map(|i| rows[i as usize]).collect();
        at.sort_unstable();
        let mut spans: Vec<IdRun> = Vec::new();
        for p in at {
            match spans.last_mut() {
                Some(span) if span.first as usize + span.count as usize == p => span.count += 1,
                _ => spans.push(IdRun { base: String::new(), first: p as u32, count: 1 }),
            }
        }
        spans
    };
    let run_order = crate::workbook::formats::run_order;
    blocks.sort_by(|a, b| run_order(&a.1, &b.1).then_with(|| run_order(&in_sheet(&a.0), &in_sheet(&b.0))));
    blocks
        .into_iter()
        .map(|(rows, columns, format)| CopiedFormat { rows: copied_spans(rows), columns: spans(columns), format })
        .filter(|format| !format.rows.is_empty())
        .collect()
}
