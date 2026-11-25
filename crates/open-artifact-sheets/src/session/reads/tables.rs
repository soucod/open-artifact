//! The reads of tables: the table the page sees around a cell, the cell tables a sheet holds, what importing a table
//! would change, and the rows and values a filter leaves.
//!
//! Kinds: readTableAtCell, readTableWithin, readCellTables, readCellTableAt, readCellTableDeclaredAs,
//! readWhatATableChanges, readFilteredRows, readValuesOfFilteredColumn, readRowsInSortedOrder, readTablesOfSheet.
//!
//! A table is named by ids (`live.rs`); a filter on it is read in `filter.rs`; the tables a sheet's cells make, as
//! recognized, in `guess/recognize.rs` and `guess/recognize/`. readTableWithin is answered as unreadable.

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::unreadable;
use crate::session::edits::tables::into_sheet::{self, TableIntoSheet};
use crate::session::edits::tables::{rows_in_sorted_order, Direction, FurtherKey};
use crate::session::edits::Refused;
use crate::ids::Axis;
use crate::workbook::layout::CellIds;
use crate::workbook::objects::CellTable;
use crate::workbook::{Sheet, Workbook};

pub(crate) mod filter;
pub(super) mod guess;
mod live;
pub(crate) mod values;

pub(super) use guess::{tables_for_formatting, TableForFormatting};

pub const KINDS: &[&str] = &[
    "readTableAtCell",
    "readTableWithin",
    "readCellTables",
    "readCellTableAt",
    "readCellTableDeclaredAs",
    "readWhatATableChanges",
    "readFilteredRows",
    "readValuesOfFilteredColumn",
    "readRowsInSortedOrder",
    "readTablesOfSheet",
];

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    #[serde(rename_all = "camelCase")]
    ReadTableAtCell { sheet_id: String, cell: CellIds },
    #[serde(rename_all = "camelCase")]
    ReadCellTables { sheet_id: String },
    #[serde(rename_all = "camelCase")]
    ReadTablesOfSheet { sheet_id: String },
    #[serde(rename_all = "camelCase")]
    ReadCellTableAt { sheet_id: String, cell: CellIds },
    #[serde(rename_all = "camelCase")]
    ReadCellTableDeclaredAs { sheet_id: String, cell_table: CellTable },
    #[serde(rename_all = "camelCase")]
    ReadWhatATableChanges { table: TableIntoSheet, new_id_code: String },
    ReadFilteredRows { table: live::TableInIds, filter: filter::Filter },
    // The filter given as null is none (the page asks so of a table no one filters); left out, it is unreadable.
    ReadValuesOfFilteredColumn {
        table: live::TableInIds,
        #[serde(deserialize_with = "Option::deserialize")]
        filter: Option<filter::Filter>,
        c: String,
    },
    // The rows a sortRows of the same fields would order, in its order.
    #[serde(rename_all = "camelCase")]
    ReadRowsInSortedOrder {
        sheet_id: String,
        one_row: String,
        other_row: String,
        by_column: String,
        direction: Direction,
        #[serde(default)]
        then_by: Vec<FurtherKey>,
    },
}

impl Request {
    fn is_readable(&self) -> bool {
        match self {
            // The code of new ids, well formed: 8 to 16 small letters and digits.
            Request::ReadWhatATableChanges { table, new_id_code: code } => {
                table.is_readable()
                    && (8..=16).contains(&code.len())
                    && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            }
            Request::ReadFilteredRows { filter, .. } => filter.is_readable(),
            Request::ReadValuesOfFilteredColumn { filter, .. } => filter.as_ref().is_none_or(filter::Filter::is_readable),
            Request::ReadTableAtCell { .. }
            | Request::ReadCellTables { .. }
            | Request::ReadTablesOfSheet { .. }
            | Request::ReadCellTableAt { .. }
            | Request::ReadCellTableDeclaredAs { .. }
            | Request::ReadRowsInSortedOrder { .. } => true,
        }
    }
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    answer_while(workbook, request, false)
}

/// The answer, formulas waiting for `calculate` or not (readRowsInSortedOrder minds it).
pub fn answer_while(workbook: &Workbook, request: &Json, is_calculation_due: bool) -> String {
    let Ok(request) = serde_json::from_value::<Request>(request.clone()) else { return unreadable() };
    if !request.is_readable() {
        return unreadable();
    }
    let answer = match request {
        Request::ReadRowsInSortedOrder { sheet_id, one_row, other_row, by_column, direction, then_by } => {
            return match rows_in_sorted_order(workbook, &sheet_id, &one_row, &other_row, by_column, direction, then_by, is_calculation_due) {
                Ok(rows) => json!({"kind": "rowsInSortedOrder", "rows": rows}).to_string(),
                Err("unreadableRequest") => unreadable(),
                Err(refusal) => json!({"kind": "refused", "refusal": refusal}).to_string(),
            };
        }
        request => request,
    };
    let answer = match &answer {
        Request::ReadTableAtCell { sheet_id, cell } => table_at_cell(workbook, sheet_id, cell),
        Request::ReadCellTables { sheet_id } => cell_tables(workbook, sheet_id),
        Request::ReadTablesOfSheet { sheet_id } => tables_of_sheet(workbook, sheet_id),
        Request::ReadCellTableAt { sheet_id, cell } => cell_table_at(workbook, sheet_id, cell),
        Request::ReadCellTableDeclaredAs { sheet_id, cell_table } => cell_table_declared_as(workbook, sheet_id, cell_table),
        Request::ReadWhatATableChanges { table, new_id_code } => {
            match into_sheet::what_it_changes(workbook, table, new_id_code) {
                Ok(answer) => Ok(answer),
                Err(Refused::Because(refusal)) => Err(refusal),
                Err(_) => return unreadable(),
            }
        }
        Request::ReadFilteredRows { table, filter } => filter::filtered_rows(workbook, table, filter),
        Request::ReadValuesOfFilteredColumn { table, filter, c } => {
            filter::values_of_filtered_column(workbook, table, filter.as_ref().unwrap_or(&filter::Filter::default()), c)
        }
        Request::ReadRowsInSortedOrder { .. } => unreachable!("answered above"),
    };
    match answer {
        Ok(answer) => answer.to_string(),
        Err(refusal) => json!({"kind": "refused", "refusal": refusal}).to_string(),
    }
}

/// A sheet (`unknownSheet`).
pub(in crate::session) fn sheet<'a>(workbook: &'a Workbook, sheet_id: &str) -> Result<&'a Sheet, &'static str> {
    workbook.sheet_index(sheet_id).map(|i| &workbook.sheets[i]).ok_or("unknownSheet")
}

/// A cell's row and column, neither deleted (`unknownRow`, `unknownColumn`).
pub(in crate::session) fn cell_at(workbook: &Workbook, sheet: &Sheet, cell: &CellIds) -> Result<(usize, usize), &'static str> {
    let row = workbook.bases.parse(&cell.r).and_then(|l| sheet.rows.position(l)).ok_or("unknownRow")?;
    let column = workbook.bases.parse(&cell.c).and_then(|l| sheet.columns.position(l)).ok_or("unknownColumn")?;
    Ok((row, column))
}

/// The table the page guesses around a cell (`unknownSheet`, `unknownRow`, `unknownColumn`).
fn table_at_cell(workbook: &Workbook, sheet_id: &str, cell: &CellIds) -> Result<Json, &'static str> {
    let sheet = sheet(workbook, sheet_id)?;
    let (row, column) = cell_at(workbook, sheet, cell)?;
    Ok(json!({"kind": "table", "read": guess::read_at(workbook, sheet, row, column)}))
}

/// The cell tables a sheet declares (`unknownSheet`).
fn cell_tables(workbook: &Workbook, sheet_id: &str) -> Result<Json, &'static str> {
    let sheet = sheet(workbook, sheet_id)?;
    Ok(json!({"kind": "cellTables", "cellTables": guess::cell_tables(workbook, sheet)}))
}

/// The tables a sheet's cells make, declared or recognized (`unknownSheet`).
fn tables_of_sheet(workbook: &Workbook, sheet_id: &str) -> Result<Json, &'static str> {
    let sheet = sheet(workbook, sheet_id)?;
    Ok(json!({"kind": "tablesOfSheet", "tables": guess::tables_of_sheet(workbook, sheet)}))
}

/// The cell table holding a cell, declared or guessed (`unknownSheet`, `unknownRow`, `unknownColumn`).
fn cell_table_at(workbook: &Workbook, sheet_id: &str, cell: &CellIds) -> Result<Json, &'static str> {
    let sheet = sheet(workbook, sheet_id)?;
    let (row, column) = cell_at(workbook, sheet, cell)?;
    Ok(json!({"kind": "cellTableAt", "cellTable": guess::cell_table_at(workbook, sheet, row, column)}))
}

/// The cell table a sheet would declare, its rows and columns lines the sheet has had (deleted or not):
/// `unknownSheet`, `unknownRow`, `unknownColumn`.
fn cell_table_declared_as(workbook: &Workbook, sheet_id: &str, t: &CellTable) -> Result<Json, &'static str> {
    let sheet = sheet(workbook, sheet_id)?;
    let knows = |axis: &Axis, id: &str| workbook.bases.parse(id).is_some_and(|l| axis.knows(l));
    let rows = [Some(&t.header_rows), t.footer_rows.as_ref()].into_iter().flatten();
    if !rows.flat_map(|r| [&r.first_row, &r.last_row]).all(|id| knows(&sheet.rows, id)) {
        return Err("unknownRow");
    }
    if ![&t.first_column, &t.last_column].into_iter().all(|id| knows(&sheet.columns, id)) {
        return Err("unknownColumn");
    }
    Ok(json!({"kind": "cellTableAt", "cellTable": guess::cell_table_declared_as(workbook, sheet, t)}))
}
