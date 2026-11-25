//! Reading cells: their contents, the cause of an error, a formula as typed, a proposed formula's value, the text to
//! edit.
//!
//! - `readCells`: the cells asked for that hold something, in the order asked (a cell asked twice is told twice), as
//!   `readWorkbook` tells them; the empty ones an array spills into in `spilledCells`, with the formula's cell and
//!   the value they show.
//! - `readCauseOfError`: why a formula comes to an error (`cells/cause.rs`), or `null`.
//! - `readTypedFormula`: a text as the sheet would keep it as a formula, in the workbook's locale.
//! - `readProposedFormulaValue`: the cell as it would be with a text entered (`null` for no text), its formulas
//!   worked out with the clock the last calculation read. Entering it is refused as it would be. Once its cell is
//!   found, the formulas waiting for `calculate` are worked out first, as `calculate` does, unless a merged range
//!   covers the cell (refused before that; an empty text is not).
//! - `readTextToEdit`: the text a person edits a cell's input as: a formula as written in the workbook's locale, a
//!   number with its digits as the cell shows them (a percentage, a date), a text after the mark when typed again it
//!   would read otherwise, a person's or option's label, a rich text's plain text; nothing for an empty cell.

mod cause;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::calculate;
use crate::edited;
use crate::ids::LineId;
use crate::locale::{self, Locale};
use crate::typing::{self, CellAt};
use crate::workbook::formats::Leaf;
use crate::workbook::load::Refusal;
use crate::workbook::{Input, Workbook};

pub const KINDS: &[&str] =
    &["readCells", "readCauseOfError", "readTypedFormula", "readProposedFormulaValue", "readTextToEdit"];

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    #[serde(rename_all = "camelCase")]
    ReadCells { sheet_id: String, cells: Vec<CellAt> },
    #[serde(rename_all = "camelCase")]
    ReadCauseOfError { sheet_id: String, cell: CellAt },
    #[serde(rename_all = "camelCase")]
    ReadTypedFormula { sheet_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    ReadProposedFormulaValue { sheet_id: String, cell: CellAt, text: String },
    #[serde(rename_all = "camelCase")]
    ReadTextToEdit { sheet_id: String, cell: CellAt },
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    let Ok(request) = Request::deserialize(request) else {
        return super::unreadable();
    };
    match answered(workbook, request) {
        Ok(answer) => answer.to_string(),
        Err(refusal) => json!({"kind": "refused", "refusal": refusal}).to_string(),
    }
}

fn answered(workbook: &Workbook, request: Request) -> Result<Json, Refusal> {
    let sheet_of = |id: &str| workbook.sheet_index(id).ok_or(Refusal::UnknownSheet);
    let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
    Ok(match request {
        Request::ReadCells { sheet_id, cells } => {
            let s = sheet_of(&sheet_id)?;
            // A viewport may still name a row or column deleted by another edit.
            let at: Vec<_> = cells.iter().filter_map(|cell| cell_at(workbook, s, cell).ok()).collect();
            read_cells(workbook, s, &at, locale)
        }
        Request::ReadCauseOfError { sheet_id, cell } => {
            let s = sheet_of(&sheet_id)?;
            let at = cell_at(workbook, s, &cell)?;
            json!({"kind": "causeOfError", "cause": cause::of(workbook, s, at)})
        }
        Request::ReadTypedFormula { sheet_id, text } => {
            let s = sheet_of(&sheet_id)?;
            json!({"kind": "typedFormula", "formula": typing::typed_formula(workbook, s, &text)})
        }
        Request::ReadProposedFormulaValue { sheet_id, cell, text } => {
            let Some(ops) = typing::proposed(workbook, &sheet_id, &cell, &text)? else {
                return Ok(json!({"kind": "proposedFormulaValue", "cell": null}));
            };
            let s = sheet_of(&sheet_id)?;
            let at = cell_at(workbook, s, &cell)?;
            let mut proposed = workbook.clone();
            proposed.apply(&ops)?;
            calculate::calculate(&mut proposed, workbook.calculated_at);
            let contents = proposed.sheets[s].cells.get(&at).map(|c| proposed.cell_contents(s, at, c, locale, true));
            json!({"kind": "proposedFormulaValue", "cell": contents})
        }
        Request::ReadTextToEdit { sheet_id, cell } => {
            let s = sheet_of(&sheet_id)?;
            let at = cell_at(workbook, s, &cell)?;
            json!({"kind": "textToEdit", "text": text_to_edit(workbook, s, at, locale)})
        }
    })
}

/// Whether the read works out the formulas waiting for `calculate` first: a proposed formula's value does, once its
/// cell is found and no merged range covers it (the text empty, or refused otherwise, all the same).
pub fn works_formulas_out(workbook: &Workbook, request: &Json) -> bool {
    let Ok(Request::ReadProposedFormulaValue { sheet_id, cell, text }) = Request::deserialize(request) else {
        return false;
    };
    workbook.sheet_index(&sheet_id).is_some_and(|s| cell_at(workbook, s, &cell).is_ok())
        && !matches!(typing::proposed(workbook, &sheet_id, &cell, &text), Err(Refusal::CellCoveredByMergedRange))
}

/// A cell of a sheet by its row and column ids.
fn cell_at(workbook: &Workbook, s: usize, cell: &CellAt) -> Result<(LineId, LineId), Refusal> {
    let sheet = &workbook.sheets[s];
    let r = workbook.bases.parse(&cell.r).filter(|&l| sheet.rows.contains(l)).ok_or(Refusal::UnknownRow)?;
    let c = workbook.bases.parse(&cell.c).filter(|&l| sheet.columns.contains(l)).ok_or(Refusal::UnknownColumn)?;
    Ok((r, c))
}

/// The cells that hold something, and the empty ones an array spills into.
fn read_cells(workbook: &Workbook, s: usize, cells: &[(LineId, LineId)], locale: &Locale) -> Json {
    let sheet = &workbook.sheets[s];
    let positions: hashbrown::HashSet<_> = cells.iter()
        .filter_map(|&(r, c)| sheet.rows.position(r).zip(sheet.columns.position(c)))
        .collect();
    let fills: hashbrown::HashMap<_, _> = workbook
        .spilled_cells_where(s, locale, |r, c| positions.contains(&(r, c))).into_iter().collect();
    let mut contents = Vec::new();
    let mut spilled = Vec::new();
    for &(r, c) in cells {
        if let Some(cell) = sheet.cells.get(&(r, c)) {
            contents.push(json!(workbook.cell_contents(s, (r, c), cell, locale, true)));
            continue;
        }
        let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else {
            continue;
        };
        if let Some(cell) = fills.get(&(row, column)) {
            spilled.push(cell.clone());
        }
    }
    let mut answer = json!({"kind": "cellsContents", "cells": contents});
    if !spilled.is_empty() {
        answer["spilledCells"] = Json::Array(spilled);
    }
    answer
}

/// The text a person edits a cell's input as.
fn text_to_edit(workbook: &Workbook, s: usize, at: (LineId, LineId), locale: &Locale) -> String {
    let sheet = &workbook.sheets[s];
    let Some(cell) = sheet.cells.get(&at) else {
        return String::new();
    };
    match &cell.input {
        Input::Formula { .. } => workbook.cell_contents(s, at, cell, locale, true).formula_text.unwrap_or_default(),
        Input::Number { value } => {
            let pattern = sheet.formats.get(Leaf::NumberFormat, at).and_then(|f| f.get("pattern")?.as_str());
            edited::number_edited_as(*value, pattern.unwrap_or("General"), locale)
        }
        Input::Text { value } if edited::text_is_edited_after_the_mark(value, locale) => format!("'{value}"),
        Input::Text { value } => value.clone(),
        Input::Boolean { value } => if *value { "TRUE" } else { "FALSE" }.to_owned(),
        Input::DropdownOption { option_id, label } => {
            sheet.dropdown_option(option_id).map_or(label, |o| &o.label).clone()
        }
        Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
            let text = cell.input.reads_as_text().unwrap_or_default();
            if edited::text_is_edited_after_the_mark(&text, locale) { format!("'{text}") } else { text }
        }
    }
}
