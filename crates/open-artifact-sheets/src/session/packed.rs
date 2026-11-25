//! Cell blocks passed separately from the read's JSON, in the worker's packed-cell format.

use hashbrown::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

use crate::shown::ShownValue;
use crate::workbook::load::Refusal;
use crate::workbook::{CellContents, Input, ValueContents, Workbook};

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum Columns {
    Pair([String; 2]),
    Object(ColumnBounds),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ColumnBounds {
    one_column: String,
    other_column: String,
}

pub(super) fn read_rows(
    workbook: &Workbook,
    sheet_id: &str,
    rows: Option<Vec<String>>,
    columns: Option<Columns>,
    mut take: impl FnMut(&[u8], &str),
) -> String {
    match selected_rows(workbook, sheet_id, rows, columns, &mut take) {
        Ok(contents) => contents,
        Err(reason) => json!({"kind": "refused", "refusal": reason}).to_string(),
    }
}

fn selected_rows(
    workbook: &Workbook,
    sheet_id: &str,
    rows: Option<Vec<String>>,
    columns: Option<Columns>,
    take: &mut impl FnMut(&[u8], &str),
) -> Result<String, Refusal> {
    let index = workbook
        .sheet_index(sheet_id)
        .ok_or(Refusal::UnknownSheet)?;
    let sheet = &workbook.sheets[index];
    let rows = rows.map(|ids| {
        ids.iter()
            .filter_map(|id| sheet.rows.position(workbook.bases.parse(id)?))
            .collect::<HashSet<_>>()
    });
    let columns = columns
        .map(|bounds| {
            let (first, last) = match bounds {
                Columns::Pair([first, last]) => (first, last),
                Columns::Object(bounds) => (bounds.one_column, bounds.other_column),
            };
            let place = |id: &str| {
                workbook
                    .bases
                    .parse(id)
                    .and_then(|id| sheet.columns.position(id))
                    .ok_or(Refusal::UnknownColumn)
            };
            let (first, last) = (place(&first)?, place(&last)?);
            Ok(first.min(last)..=first.max(last))
        })
        .transpose()?;
    let selected = |r: usize, c: usize| {
        rows.as_ref().is_none_or(|rows| rows.contains(&r))
            && columns.as_ref().is_none_or(|columns| columns.contains(&c))
    };
    let mut cells: Vec<_> = sheet
        .cells
        .iter()
        .filter_map(|(&at, cell)| {
            let r = sheet.rows.position(at.0)?;
            let c = sheet.columns.position(at.1)?;
            selected(r, c).then_some(((r, c), at, cell))
        })
        .collect();
    cells.sort_unstable_by_key(|&(position, _, _)| position);
    let locale = crate::locale::find(&workbook.locale).unwrap_or_else(crate::locale::en_us);
    let cells = cells
        .into_iter()
        .map(|(_, at, cell)| workbook.cell_contents(index, at, cell, locale, true));
    let blocks = send(cells, &mut 0, take);
    let spilled: Vec<_> = workbook
        .spilled_cells_where(index, locale, selected)
        .into_iter()
        .map(|(_, cell)| cell)
        .collect();
    let mut result = json!({"kind": "rowsWithCellsPacked", "cells": blocks});
    if !spilled.is_empty() {
        result["spilledCells"] = Json::Array(spilled);
    }
    Ok(result.to_string())
}

/// Bound the retained string table and list storage, even when the caller reads a whole workbook.
const CELLS_PER_BLOCK: usize = 4096;

pub(super) fn send(
    cells: impl IntoIterator<Item = CellContents>,
    next: &mut usize,
    take: &mut impl FnMut(&[u8], &str),
) -> Vec<usize> {
    let mut block = Block::default();
    let mut indices = Vec::new();
    for cell in cells {
        block.add(cell);
        if block.forms.len() == CELLS_PER_BLOCK {
            std::mem::take(&mut block).send(next, &mut indices, take);
        }
    }
    if !block.forms.is_empty() {
        block.send(next, &mut indices, take);
    }
    indices
}

#[derive(Default)]
struct Block {
    text_indices: HashMap<String, u32>,
    column_indices: HashMap<u32, u32>,
    texts: String,
    text_ends: Vec<u32>,
    text_length: u32,
    values: Vec<f64>,
    rows: Vec<u32>,
    row_ends: Vec<u32>,
    column_texts: Vec<u32>,
    column_numbers: Vec<u32>,
    columns: Vec<u32>,
    shown_texts: Vec<u32>,
    input_texts: Vec<u32>,
    formulas: Vec<u32>,
    extras: Vec<u32>,
    forms: Vec<u8>,
}

impl Block {
    fn text(&mut self, text: String) -> u32 {
        *self.text_indices.entry(text).or_insert_with_key(|text| {
            self.texts.push_str(text);
            self.text_length += text.encode_utf16().count() as u32;
            self.text_ends.push(self.text_length);
            self.text_ends.len() as u32
        })
    }

    fn add(&mut self, cell: CellContents) {
        let r = self.text(cell.r);
        if self.rows.last() == Some(&r) {
            *self.row_ends.last_mut().unwrap() += 1;
        } else {
            self.rows.push(r);
            self.row_ends.push(self.forms.len() as u32 + 1);
        }
        let c = self.text(cell.c);
        let column = self.column_indices.entry(c).or_insert_with(|| {
            let n = self.column_texts.len() as u32;
            self.column_texts.push(c);
            self.column_numbers.push(n);
            n
        });
        self.columns.push(*column);

        let mut extras = Map::new();
        let (mut form, mut number, input_text, formula) = match cell.input {
            Input::Number { value } => (
                0,
                value,
                cell.number_is_edited_as.map_or(0, |text| self.text(text)),
                0,
            ),
            Input::Text { value } => (1, f64::from(self.text(value)), 0, 0),
            Input::Boolean { value } => (2, f64::from(u8::from(value)), 0, 0),
            Input::Formula { formula } => (
                3,
                0.0,
                cell.formula_text.map_or(0, |text| self.text(text)),
                self.text(serde_json::to_string(&formula).expect("formula serializes")),
            ),
            input => {
                extras.insert("input".into(), json!(input));
                (4, 0.0, 0, 0)
            }
        };
        if let Some(value) = cell.value {
            match (form, value) {
                (3.., ValueContents::Number(value)) => {
                    form |= 8;
                    number = value;
                }
                (3.., ValueContents::Text(value)) => {
                    form |= 16;
                    number = f64::from(self.text(value));
                }
                (3.., ValueContents::Boolean(value)) => {
                    form |= 24;
                    number = f64::from(u8::from(value));
                }
                (_, value) => {
                    extras.insert("value".into(), json!(value));
                }
            }
        }
        if cell.text_is_edited_after_the_mark {
            form |= 32;
        }
        let shown = match cell.shown {
            Some(ShownValue::Text { text, color: None }) => {
                form |= 64;
                self.text(text)
            }
            other => {
                extra(&mut extras, "shown", other);
                0
            }
        };
        extra(
            &mut extras,
            "numbersOfListLines",
            cell.numbers_of_list_lines,
        );
        extra(&mut extras, "dropdownOption", cell.dropdown_option);
        extra(
            &mut extras,
            "numberFormatBrought",
            cell.number_format_brought,
        );
        extra(&mut extras, "linksTo", cell.links_to);
        extra(&mut extras, "spill", cell.spill);
        extra(
            &mut extras,
            "drawsRandomNumbers",
            cell.draws_random_numbers.then_some(true),
        );
        let extra = if extras.is_empty() {
            0
        } else {
            form |= 128;
            self.text(Json::Object(extras).to_string())
        };

        self.values.push(number);
        self.input_texts.push(input_text);
        self.formulas.push(formula);
        self.shown_texts.push(shown);
        self.extras.push(extra);
        self.forms.push(form);
    }

    fn send(self, next: &mut usize, indices: &mut Vec<usize>, take: &mut impl FnMut(&[u8], &str)) {
        let mut lists = Vec::new();
        let header = [
            self.rows.len(),
            self.column_texts.len(),
            self.forms.len(),
            self.text_ends.len(),
        ];
        lists.extend(
            header
                .into_iter()
                .flat_map(|len| (len as u32).to_le_bytes()),
        );
        lists.extend(self.values.into_iter().flat_map(f64::to_le_bytes));
        for list in [
            self.rows,
            self.row_ends,
            self.column_texts,
            self.column_numbers,
            self.text_ends,
            self.columns,
            self.shown_texts,
            self.input_texts,
            self.formulas,
            self.extras,
        ] {
            lists.extend(list.into_iter().flat_map(u32::to_le_bytes));
        }
        lists.extend(self.forms);
        take(&lists, &self.texts);
        indices.push(*next);
        *next += 1;
    }
}

fn extra(extras: &mut Map<String, Json>, name: &str, value: Option<impl Serialize>) {
    if let Some(value) = value {
        extras.insert(name.into(), json!(value));
    }
}
