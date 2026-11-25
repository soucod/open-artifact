//! The tables a sheet's cells make, as they are recognized (readTablesOfSheet): the cell tables it declares,
//! then the blocks of its content (cut apart by blank rows and columns), each read as a table with a header over its
//! records when one proves itself, or else assumed one with the reason it is not recognized.

use serde_json::{json, Value as Json};

use super::grid::{Grid, Kind};
use super::{HeaderRows, Table};
use super::super::live::Role as TableRole;
use super::runs::{push_run as push_table_run, Run as TableRun};
use crate::workbook::{Sheet as WorkbookSheet, Workbook};

mod blocks;
mod body;
mod check;
mod driver;
mod header;
mod sheet;

use sheet::Sheet;

/// Why a table is assumed rather than recognized, in this order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(super) enum Reason {
    OneColumn,
    NoHeadings,
    ColumnWithoutAHeading,
    TwoColumnsOfOneName,
    MergedCellsAmongRecords,
    RowUnderTheTotal,
    SumOfSomeRecords,
    SumRunsOverHeadings,
    FewerThanTwoRecords,
    LabelsPastABlankColumn,
    HeadingComesAgain,
    MayBeLabelsAndValues,
    NothingProvesTheHeader,
    EitherOfTwoRowsMayBeTheHeader,
}

impl Reason {
    fn name(self) -> &'static str {
        match self {
            Reason::OneColumn => "oneColumn",
            Reason::NoHeadings => "noHeadings",
            Reason::ColumnWithoutAHeading => "columnWithoutAHeading",
            Reason::TwoColumnsOfOneName => "twoColumnsOfOneName",
            Reason::MergedCellsAmongRecords => "mergedCellsAmongRecords",
            Reason::RowUnderTheTotal => "rowUnderTheTotal",
            Reason::SumOfSomeRecords => "sumOfSomeRecords",
            Reason::SumRunsOverHeadings => "sumRunsOverHeadings",
            Reason::FewerThanTwoRecords => "fewerThanTwoRecords",
            Reason::LabelsPastABlankColumn => "labelsPastABlankColumn",
            Reason::HeadingComesAgain => "headingComesAgain",
            Reason::MayBeLabelsAndValues => "mayBeLabelsAndValues",
            Reason::NothingProvesTheHeader => "nothingProvesTheHeader",
            Reason::EitherOfTwoRowsMayBeTheHeader => "eitherOfTwoRowsMayBeTheHeader",
        }
    }
}

/// What a table is taken from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Basis {
    Recognized,
    Assumed(Reason),
    Declared(String),
}

impl Basis {
    pub(super) fn in_json(&self) -> Json {
        match self {
            Basis::Recognized => json!({"kind": "recognized"}),
            Basis::Assumed(reason) => json!({"kind": "assumed", "whyNotRecognized": reason.name()}),
            Basis::Declared(id) => json!({"kind": "declared", "cellTableId": id}),
        }
    }
}

/// The part a run of a table's body plays, in this order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(super) enum Role {
    Record,
    SectionLabel,
    Subtotal,
    Blank,
}

impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Record => "record",
            Role::SectionLabel => "sectionLabel",
            Role::Subtotal => "subtotal",
            Role::Blank => "blank",
        }
    }
}

/// A run of a table's body: its first and last rows and its part.
#[derive(Clone, Copy, Debug)]
pub(super) struct Run {
    pub first: usize,
    pub last: usize,
    pub role: Role,
}

/// Adds a run to a body: one of the part of the last run lengthens it.
pub(super) fn push_run(runs: &mut Vec<Run>, first: usize, last: usize, role: Role) {
    if let Some(prev) = runs.last_mut() {
        if prev.role == role {
            prev.last = last;
            return;
        }
    }
    runs.push(Run { first, last, role });
}

/// A table found in a sheet, by positions.
#[derive(Clone, Debug)]
pub(super) struct Found {
    pub header: (usize, usize),
    pub columns: (usize, usize),
    pub body: Vec<Run>,
    pub footer: Option<(usize, usize)>,
    pub basis: Basis,
}

impl Found {
    /// The range a table takes: its header's first row to its footer's last, or else its body's, or else its
    /// header's.
    pub(super) fn area(&self) -> sheet::Rect {
        let bottom = match (self.footer, self.body.last()) {
            (Some((_, last)), _) => last,
            (None, Some(run)) => run.last,
            (None, None) => self.header.1,
        };
        let (first, last) = self.columns;
        sheet::Rect { top: bottom.min(self.header.0), left: last.min(first), bottom: bottom.max(self.header.0), right: last.max(first) }
    }

    pub(super) fn row_under(&self, grid: &Grid) -> Option<usize> {
        self.footer.map(|(first, _)| first).or_else(|| {
            let under = self.last_record()?.saturating_add(1);
            grid.row_has_any(under, self.columns.0, self.columns.1).then_some(under)
        })
    }

    /// The row under a table as it is read: the first of the section titles its reading leaves out at its end,
    /// or else the row under its body.
    pub(super) fn row_under_reading(&self, grid: &Grid, table: Option<&Table>) -> Option<usize> {
        match table {
            Some(t) if self.last_record().is_some_and(|last| t.to < last) => Some(t.to + 1),
            _ => self.row_under(grid),
        }
    }

    pub(super) fn last_record(&self) -> Option<usize> {
        self.body.iter().rev().find(|r| r.role != Role::Blank).map(|r| r.last)
    }

    /// The header and runs as the page tells them for an individual table.
    pub(super) fn reading(&self, grid: &Grid) -> Option<Table> {
        let (first_column, last_column) = self.columns;
        let to = self.last_record()?;
        let header = match self.basis {
            // A header the first record could stand for as well is not sure.
            Basis::Assumed(reason) => grid.table_at(self.header.0, first_column).and_then(|t| {
                t.header.filter(|h| h.first == self.header.0 && h.last <= to).map(|mut h| {
                    h.is_sure &= reason != Reason::EitherOfTwoRowsMayBeTheHeader;
                    h
                })
            }),
            _ => Some(HeaderRows { first: self.header.0, last: self.header.1, is_sure: true }),
        };
        let from = header.map_or(self.header.0, |h| h.last.saturating_add(1));
        if from > to {
            return None;
        }
        let rows = grid.owned_rows(from, to, first_column, last_column);
        // A section's title is a text in the table's first column with nothing else in its row, in a table of more
        // than one column, whether or not it has a header.
        let is_section_title = |row: usize| {
            first_column < last_column
                && grid.filled_columns(row, first_column, last_column) == [first_column]
                && grid.kind(row, first_column) == Kind::Text
        };
        let split_sections = |run: &Run, runs: &mut Vec<TableRun>| {
            let mut next = run.first.max(from);
            let first = rows.partition_point(|&row| row < next);
            for &row in rows[first..].iter().take_while(|&&row| row <= run.last) {
                if is_section_title(row) {
                    if next < row {
                        push_table_run(runs, next, row - 1, TableRole::Record);
                    }
                    push_table_run(runs, row, row, TableRole::Section);
                    next = row.saturating_add(1);
                }
            }
            if next <= run.last {
                push_table_run(runs, next, run.last, TableRole::Record);
            }
        };
        let mut runs = Vec::new();
        if let Some(first) = self.body.first().map(|r| r.first).filter(|&first| from < first) {
            push_table_run(&mut runs, from, first - 1, TableRole::Record);
        }
        for run in self.body.iter().filter(|r| from <= r.last && r.first <= to) {
            let role = match run.role {
                Role::Record => {
                    split_sections(run, &mut runs);
                    continue;
                }
                Role::SectionLabel => TableRole::Section,
                Role::Subtotal => TableRole::Subtotal,
                Role::Blank => TableRole::Spacer,
            };
            push_table_run(&mut runs, run.first.max(from), run.last, role);
        }
        // Section titles with no records after them end the body above them: the first is the row under it.
        while runs.last().is_some_and(|r| r.role == TableRole::Section) {
            runs.pop();
        }
        let to = runs.last()?.last;
        Some(Table { header, first_column, last_column, from, to, runs })
    }
}

/// The classified tables of a sheet, in sheet order.
pub(super) fn found_tables(grid: &Grid, sheet: &WorkbookSheet) -> Vec<Found> {
    Sheet::of(grid).tables(sheet)
}

/// Read an offered declaration against the other tables already declared on the sheet.
pub(super) fn read_declaration(
    grid: &Grid, sheet: &WorkbookSheet, header: (usize, usize), columns: (usize, usize),
    footer: Option<(usize, usize)>,
) -> Found {
    let neighbors: Vec<_> = super::cell_tables::declared_places(grid.workbook(), sheet).into_iter().filter_map(|(_, h, c, f)| {
        (h != header || c != columns || f != footer).then_some(sheet::Rect {
            top: h.0, left: c.0, bottom: f.map_or(h.1, |(_, last)| last), right: c.1,
        })
    }).collect();
    Sheet::of(grid).read_declaration(header, columns, footer, &neighbors, Basis::Recognized)
}

/// The tables of a sheet, as the page reads them.
pub(in crate::session::reads) fn tables_of_sheet(workbook: &Workbook, sheet: &WorkbookSheet) -> Vec<Json> {
    let grid = Grid::of(workbook, sheet);
    let found = found_tables(&grid, sheet);
    found.iter().filter_map(|t| in_ids(workbook, sheet, &grid, t)).collect()
}

/// A table by the ids of its rows and columns, with its columns' names and kinds; none when a row or column it
/// names is gone.
fn in_ids(workbook: &Workbook, sheet: &WorkbookSheet, grid: &Grid, t: &Found) -> Option<Json> {
    let row = |r: usize| sheet.rows.line(r).map(|l| workbook.bases.text(l));
    let column = |c: usize| sheet.columns.line(c).map(|l| workbook.bases.text(l));
    let records: Vec<(usize, usize)> = t.body.iter().filter(|r| r.role == Role::Record).map(|r| (r.first, r.last)).collect();
    let columns = grid.recognized_columns(t.header, t.columns.0, t.columns.1, &records);
    let (h1, h2, c1, c2) = (row(t.header.0)?, row(t.header.1)?, column(t.columns.0)?, column(t.columns.1)?);
    let columns = columns
        .into_iter()
        .map(|c| Some(json!({"c": column(c.column)?, "name": c.name, "kind": c.kind.name()})))
        .collect::<Option<Vec<Json>>>()?;
    let body = t
        .body
        .iter()
        .map(|r| Some(json!({"firstRow": row(r.first)?, "lastRow": row(r.last)?, "role": r.role.name()})))
        .collect::<Option<Vec<Json>>>()?;
    let footer = match t.footer {
        Some((first, last)) => json!({"firstRow": row(first)?, "lastRow": row(last)?}),
        None => Json::Null,
    };
    Some(json!({
        "basis": t.basis.in_json(),
        "headerRows": {"firstRow": h1, "lastRow": h2},
        "firstColumn": c1,
        "lastColumn": c2,
        "columns": columns,
        "body": body,
        "footerRows": footer,
    }))
}

