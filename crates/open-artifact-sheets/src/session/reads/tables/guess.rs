//! The page's guess at the table around a cell (readTableAtCell): the block of cells around it, its header (the row
//! that best names columns of one kind of value), the blocks above and below that read as more of it, and the part
//! each row of its body plays; then its columns' names and kinds. The modules go from the sheet as the guess reads
//! it (`grid`) up to the table around a cell (`around`) and its columns (`columns`).

use std::collections::BTreeMap;

use serde_json::{json, Value as Json};

use super::live::Role;
use crate::workbook::{Sheet, Workbook};

mod around;
mod block;
mod cell_tables;
mod columns;
mod grid;
mod header;
mod profile;
mod recognize;
mod rows;
mod runs;
mod table;

pub(super) use cell_tables::{cell_table_at, cell_table_declared_as, cell_tables};
pub(in crate::session::reads) use recognize::tables_of_sheet;
use grid::Grid;
use recognize::Basis;
use runs::{HeaderRows, Table};

/// The table guessed around a cell, with its columns: null when there is none.
pub(super) fn read_at(workbook: &Workbook, sheet: &Sheet, row: usize, column: usize) -> Json {
    let grid = Grid::of(workbook, sheet);
    let tables = recognize::found_tables(&grid, sheet);
    let Some(found) = tables.iter().find(|t| t.area().holds(row, column)) else { return Json::Null };
    let Some(table) = found.reading(&grid) else { return Json::Null };
    read_table(workbook, sheet, &grid, &found.basis, &table, found.row_under_reading(&grid, Some(&table)))
}

fn read_table(workbook: &Workbook, sheet: &Sheet, grid: &Grid, basis: &Basis, table: &Table, under: Option<usize>) -> Json {
    let columns = columns_in_ids(workbook, sheet, grid, table);
    json!({"basis": basis.in_json(), "table": table_in_ids(workbook, sheet, table, under), "columns": columns})
}

type Span = (usize, usize);
type Area = (usize, usize, usize, usize);

/// The classified table around a conditional-format selection.
pub(in crate::session::reads) struct TableForFormatting {
    pub cells: Area,
    pub records: Option<Area>,
    pub assumed: bool,
    pub footer: Option<Span>,
    pub non_records: Vec<(Span, &'static str)>,
    pub names: BTreeMap<usize, String>,
}

pub(in crate::session::reads) fn tables_for_formatting(
    workbook: &Workbook,
    sheet: &Sheet,
    (top, left, bottom, right): Area,
    adjacent: bool,
) -> Vec<TableForFormatting> {
    let grid = Grid::of(workbook, sheet);
    recognize::found_tables(&grid, sheet).into_iter().filter_map(|found| {
        let area = found.area();
        let near = usize::from(adjacent);
        if top > area.bottom.saturating_add(near) || area.top > bottom.saturating_add(near)
            || left > area.right || area.left > right
        {
            return None;
        }
        let table = found.reading(&grid);
        let non_records = table.as_ref().into_iter().flat_map(|t| &t.runs).filter_map(|r| {
            match r.role {
                Role::Spacer => Some(((r.first, r.last), "blank")),
                Role::Section | Role::HeaderAgain => Some(((r.first, r.last), "sectionLabel")),
                Role::Subtotal => Some(((r.first, r.last), "subtotal")),
                Role::Record => None,
            }
        }).collect();
        let names = table.as_ref().into_iter().flat_map(|t| grid.columns(t)).filter_map(|c| Some((c.column, c.name?))).collect();
        Some(TableForFormatting {
            cells: (area.top, area.left, area.bottom, area.right),
            // The records run to the last of them: titles at the end, which the table read at a cell leaves out,
            // are among them here.
            records: table.map(|t| (t.from, area.left, found.last_record().map_or(t.to, |last| last.max(t.to)), area.right)),
            assumed: matches!(found.basis, Basis::Assumed(_)),
            footer: found.footer,
            non_records,
            names,
        })
    }).collect()
}

/// A table's columns by ids, each with its name and kind.
fn columns_in_ids(workbook: &Workbook, sheet: &Sheet, grid: &Grid, table: &Table) -> Vec<Json> {
    let id = |c: usize| sheet.columns.line(c).map(|l| workbook.bases.text(l));
    grid.columns(table).into_iter().map(|c| json!({"c": id(c.column), "name": c.name, "kind": c.kind.name()})).collect()
}

/// A role as the page names it.
fn role_name(role: Role) -> &'static str {
    match role {
        Role::Record => "record",
        Role::Spacer => "spacer",
        Role::Section => "section",
        Role::Subtotal => "subtotal",
        Role::HeaderAgain => "headerAgain",
    }
}

/// A guessed table by ids, with the row under its body.
fn table_in_ids(workbook: &Workbook, sheet: &Sheet, table: &Table, under: Option<usize>) -> Json {
    let row = |r: usize| sheet.rows.line(r).map(|l| workbook.bases.text(l));
    let column = |c: usize| sheet.columns.line(c).map(|l| workbook.bases.text(l));
    let header = table.header.map(|h| json!({"firstRow": row(h.first), "lastRow": row(h.last), "isSure": h.is_sure}));
    let runs: Vec<Json> = table
        .runs
        .iter()
        .map(|r| json!({"firstRow": row(r.first), "lastRow": row(r.last), "role": role_name(r.role)}))
        .collect();
    json!({
        "sheetId": sheet.id,
        "header": header,
        "firstColumn": column(table.first_column),
        "lastColumn": column(table.last_column),
        "firstRowOfBody": row(table.from),
        "lastRowOfBody": row(table.to),
        "rowUnderTheBody": under.and_then(row),
        "runs": runs,
    })
}
