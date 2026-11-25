//! What an answer tells the page has changed since its last answer (`changes`), so it shows those again: everything,
//! or per sheet its cells, whether its layout changed, whether what its conditional formats give may have changed
//! (`areFormatsGivenChanged`, for `readFormatsGiven`), and the views.

use std::collections::BTreeSet;
use hashbrown::{HashMap, HashSet};

use serde_json::{json, Value as Json};

use crate::ids::LineId;
use crate::workbook::formats::Leaf;
use crate::workbook::layout::RangeIds;
use crate::workbook::load::Op;
use crate::workbook::objects::{RangeOnASheet, View};
use crate::workbook::{Sheet, Workbook};

/// The most cells an answer tells of one by one, in all sheets; past it, it tells of everything, unless they are no
/// more than a quarter of the cells the workbook holds.
const MOST_CELLS_TOLD: usize = 1000;

#[derive(Default)]
struct SheetChanges {
    cells: HashSet<(String, String)>,
    is_layout_changed: bool,
    /// Whether the formats the sheet's conditional formats give may have changed.
    are_formats_given_changed: bool,
    /// Rows or columns inserted, deleted or moved: what reads the sheet's cells may read others now (its conditional
    /// formats, the views with an input on it).
    are_lines_changed: bool,
}

#[derive(Default)]
pub struct Changes {
    everything: bool,
    /// The cells holding something given a checkbox, no control or a number format, and the rows holding them, as
    /// `of_op` counts them: once for each of those a format gives. A third of them, and one, are held to cells told
    /// as the cells changed are (3,000 of them tell everything in a small workbook).
    shown_again: usize,
    sheets: HashMap<String, SheetChanges>,
    views: BTreeSet<String>,
    /// The workbook's time zone changed: the page shows again what it reads (told apart from the cells changed).
    is_time_zone_changed: bool,
    /// The sheets renamed: the formulas of other sheets reading them are told when the answer is written
    /// (`Session::tell_formulas_reading`).
    pub renamed: BTreeSet<String>,
}

impl Changes {
    pub fn everything(&mut self) {
        self.everything = true;
    }

    pub fn is_nothing(&self) -> bool {
        !self.everything && !self.is_time_zone_changed && self.sheets.is_empty() && self.views.is_empty()
    }

    fn sheet(&mut self, sheet_id: &str) -> &mut SheetChanges {
        self.sheets.entry(sheet_id.to_owned()).or_default()
    }

    pub fn cell(&mut self, sheet_id: &str, r: &str, c: &str) {
        self.sheet(sheet_id).cells.insert((r.to_owned(), c.to_owned()));
    }

    pub fn layout(&mut self, sheet_id: &str) {
        self.sheet(sheet_id).is_layout_changed = true;
    }

    /// Rows or columns of a sheet inserted, deleted or moved.
    fn lines(&mut self, sheet_id: &str) {
        let sheet = self.sheet(sheet_id);
        sheet.is_layout_changed = true;
        sheet.are_lines_changed = true;
    }

    pub fn lines_changed(&self) -> bool {
        self.sheets.values().any(|sheet| sheet.are_lines_changed)
    }

    /// What the sheet's conditional formats give may have changed, whatever cells changed.
    pub fn formats_given(&mut self, sheet_id: &str) {
        self.sheet(sheet_id).are_formats_given_changed = true;
    }

    /// The cells held in rows (or columns) of runs, deleted or not.
    fn cells_of_lines(&mut self, sheet_id: &str, runs: &[crate::ids::IdRun], rows: bool, after: &Workbook) {
        let Some(i) = after.sheet_index(sheet_id) else { return };
        let lines: HashSet<LineId> = runs
            .iter()
            .filter_map(|run| Some((after.bases.find(&run.base)?, run)))
            .flat_map(|(base, run)| (run.first..run.first.saturating_add(run.count)).map(move |n| LineId { base, n }))
            .collect();
        let sheet = &after.sheets[i];
        // Not those of the other lines that are deleted.
        let cells: Vec<(String, String)> = sheet
            .cells
            .keys()
            .filter(|&&(r, c)| match rows {
                true => lines.contains(&r) && sheet.columns.contains(c),
                false => lines.contains(&c) && sheet.rows.contains(r),
            })
            .map(|&(r, c)| (after.bases.text(r), after.bases.text(c)))
            .collect();
        for (r, c) in cells {
            self.cell(sheet_id, &r, &c);
        }
    }

    /// Another's changes, added to these.
    pub fn extend(&mut self, other: Changes) {
        self.everything |= other.everything;
        self.is_time_zone_changed |= other.is_time_zone_changed;
        self.shown_again = self.shown_again.max(other.shown_again);
        for (sheet_id, changes) in other.sheets {
            let sheet = self.sheet(&sheet_id);
            sheet.cells.extend(changes.cells);
            sheet.is_layout_changed |= changes.is_layout_changed;
            sheet.are_formats_given_changed |= changes.are_formats_given_changed;
            sheet.are_lines_changed |= changes.are_lines_changed;
        }
        self.views.extend(other.views);
        self.renamed.extend(other.renamed);
    }

    /// What an operation tried and taken back changes (`workbook` as it is again): as `of_op`, but rows or columns
    /// deleted or undeleted tell only that the lines changed, not the cells in them.
    pub fn of_op_taken_back(&mut self, op: &Op, workbook: &Workbook) {
        match op {
            Op::DeleteRows { sheet_id, .. }
            | Op::UndeleteRows { sheet_id, .. }
            | Op::DeleteColumns { sheet_id, .. }
            | Op::UndeleteColumns { sheet_id, .. } => self.lines(sheet_id),
            _ => self.of_op(op, workbook),
        }
    }

    /// What applying an operation changes, the workbook as it is after it.
    pub fn of_op(&mut self, op: &Op, after: &Workbook) {
        match op {
            Op::SetCells { sheet_id, cells, .. } => {
                for cell in cells {
                    self.cell(sheet_id, &cell.r, &cell.c);
                }
            }
            Op::SetCellFormats { sheet_id, formats } => {
                self.layout(sheet_id);
                // A number format changes how the cells with something in them show it: every such
                // cell is told from the first row and column given to the last, as they are placed, between them too.
                let Some(i) = after.sheet_index(sheet_id) else { return };
                let sheet = &after.sheets[i];
                for f in formats {
                    let leaves = crate::workbook::formats::read_format(&f.format).unwrap_or_default();
                    let lines = |runs: &[crate::ids::IdRun]| -> Vec<LineId> {
                        runs.iter()
                            .flat_map(|r| (r.first..r.first + r.count).map(move |n| (r.base.as_str(), n)))
                            .filter_map(|(b, n)| Some(LineId { base: after.bases.find(b)?, n }))
                            .collect()
                    };
                    let (rows, columns) = (lines(&f.rows), lines(&f.columns));
                    // A checkbox, no control or a number format over many cells with something in them:
                    // everything is told once a third of those cells and the rows holding them, and one, come to more
                    // than MOST_CELLS_TOLD and to more than a quarter of the cells the workbook holds (see `to_json`).
                    // They are counted once for each of those given, over the formats of all the operations told of
                    // (a paste that takes a number format away and gives another counts twice). The cells are those
                    // from the first row and column given to the last, as they are placed, between them too.
                    let shows_again = |(l, v): &&(Leaf, Json)| {
                        *l == Leaf::NumberFormat || (*l == Leaf::CellControl && v["kind"] != "dropdown")
                    };
                    let times = leaves.iter().filter(shows_again).count();
                    let span = |axis: &crate::ids::Axis, lines: &[LineId]| {
                        let at: Vec<usize> = lines.iter().filter_map(|&l| axis.position(l)).collect();
                        Some((*at.iter().min()?, *at.iter().max()?))
                    };
                    let spans = (span(&sheet.rows, &rows), span(&sheet.columns, &columns));
                    if let (true, (Some((top, bottom)), Some((left, right)))) = (times > 0, spans) {
                        let filled: Vec<LineId> = sheet
                            .cells
                            .keys()
                            .filter(|&&(r, c)| {
                                let at = (sheet.rows.position(r), sheet.columns.position(c));
                                matches!(at, (Some(r), Some(c)) if (top..=bottom).contains(&r) && (left..=right).contains(&c))
                            })
                            .map(|&(r, _)| r)
                            .collect();
                        let holding: HashSet<LineId> = filled.iter().copied().collect();
                        self.shown_again += (filled.len() + holding.len()) * times;
                    }
                    // A cell control changes how the cells holding an option show it, told across the box from the
                    // first row and column to the last.
                    if leaves.iter().any(|(l, _)| *l == Leaf::CellControl) {
                        if let (Some((top, bottom)), Some((left, right))) = spans {
                            for ((r, c), cell) in &sheet.cells {
                                let crate::workbook::Input::DropdownOption { .. } = &cell.input else { continue };
                                let at = (sheet.rows.position(*r), sheet.columns.position(*c));
                                let (Some(row), Some(column)) = at else { continue };
                                if (top..=bottom).contains(&row) && (left..=right).contains(&column) {
                                    self.cell(sheet_id, &after.bases.text(*r), &after.bases.text(*c));
                                }
                            }
                        }
                    }
                    if !leaves.iter().any(|(l, _)| *l == Leaf::NumberFormat) {
                        continue;
                    }
                    let (Some(rows), Some(columns)) = spans else { continue };
                    for &(r, c) in sheet.cells.keys() {
                        let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
                        if (rows.0..=rows.1).contains(&row) && (columns.0..=columns.1).contains(&column) {
                            self.cell(sheet_id, &after.bases.text(r), &after.bases.text(c));
                        }
                    }
                }
            }
            Op::MergeCells { sheet_id, .. }
            | Op::UnmergeCells { sheet_id, .. }
            | Op::SetColumnWidths { sheet_id, .. }
            | Op::SetRowHeights { sheet_id, .. }
            | Op::SetRowGroups { sheet_id, .. }
            | Op::SetColumnGroups { sheet_id, .. }
            | Op::SetPlacements { sheet_id, .. }
            | Op::SetNamedViews { sheet_id, .. }
            | Op::SetCellTables { sheet_id, .. } => self.layout(sheet_id),
            Op::SetDropdowns { sheet_id, dropdowns } => {
                self.layout(sheet_id);
                // The cells holding an option that is not one of the dropdowns the operation leaves alone show it
                // otherwise now; not a cell of a deleted row or column, which shows nothing.
                let Some(i) = after.sheet_index(sheet_id) else { return };
                let sheet = &after.sheets[i];
                let set: HashSet<&str> = dropdowns.iter().map(|d| d.dropdown_id.as_str()).collect();
                let untouched: HashSet<&str> = sheet
                    .dropdowns
                    .values()
                    .filter(|(id, _)| !set.contains(id.as_str()))
                    .flat_map(|(_, options)| options.iter().map(|o| o.option_id.as_str()))
                    .collect();
                for ((r, c), cell) in &sheet.cells {
                    if sheet.rows.position(*r).is_none() || sheet.columns.position(*c).is_none() {
                        continue;
                    }
                    if let crate::workbook::Input::DropdownOption { option_id, .. } = &cell.input {
                        if !untouched.contains(option_id.as_str()) {
                            self.cell(sheet_id, &after.bases.text(*r), &after.bases.text(*c));
                        }
                    }
                }
            }
            Op::SetConditionalFormats { sheet_id, .. } => {
                self.layout(sheet_id);
                self.sheet(sheet_id).are_formats_given_changed = true;
            }
            Op::SetSheetSettings { sheets } => {
                for s in sheets {
                    self.layout(&s.sheet_id);
                }
            }
            Op::SetViews { views } => {
                for v in views {
                    self.views.insert(v.view_id.clone());
                }
            }
            // A time zone adopted too.
            Op::SetTimeZone { .. } | Op::AdoptTimeZone { .. } => self.is_time_zone_changed = true,
            // Rows or columns inserted, deleted or moved, a sheet renamed: the sheet's layout, the cells of the lines
            // deleted or brought back, and (told as values are, see `Told`) the formulas whose text or value changes.
            Op::InsertRows { sheet_id, .. }
            | Op::InsertColumns { sheet_id, .. }
            | Op::MoveRows { sheet_id, .. }
            | Op::MoveColumns { sheet_id, .. } => self.lines(sheet_id),
            Op::DeleteRows { sheet_id, rows: runs } | Op::UndeleteRows { sheet_id, rows: runs } => {
                self.lines(sheet_id);
                self.cells_of_lines(sheet_id, runs, true, after);
            }
            Op::DeleteColumns { sheet_id, columns: runs } | Op::UndeleteColumns { sheet_id, columns: runs } => {
                self.lines(sheet_id);
                self.cells_of_lines(sheet_id, runs, false, after);
            }
            Op::SetSheetNames { names } => {
                for name in names {
                    self.layout(&name.sheet_id);
                    self.renamed.insert(name.sheet_id.clone());
                }
            }
            Op::Reseed { .. } => {}
            _ => self.everything(),
        }
    }

    /// The changes as the page reads them, the cells where they are now (by row, then column), the sheets in their
    /// order.
    pub fn to_json(&self, workbook: &Workbook) -> Json {
        // More cells than the page would show again one by one, and more than a quarter of those the workbook holds
        // (in sheets, rows and columns not deleted): it shows everything again. So with formats shown again over
        // many cells.
        let many = |cells: usize| cells > MOST_CELLS_TOLD && cells * 4 > cells_held(workbook);
        let told = self.sheets.values().map(|s| s.cells.len()).sum::<usize>();
        if self.everything || many(told) || many(self.shown_again / 3 + 1) {
            return json!({"kind": "everything"});
        }
        if self.is_nothing() {
            return json!({"kind": "nothing"});
        }
        let mut sheets = Vec::new();
        let mut views = self.views.clone();
        for sheet in &workbook.sheets {
            let Some(changes) = self.sheets.get(&sheet.id) else { continue };
            let mut cells: Vec<(usize, usize, &String, &String)> = Vec::new();
            // Cells of rows or columns deleted are told after the others, in the order of the ids of their row and
            // column as texts (`.10` before `.2`; not where they stand).
            let mut deleted: Vec<(&String, &String)> = Vec::new();
            for (r, c) in &changes.cells {
                let (Some(row_id), Some(column_id)) = (workbook.bases.parse(r), workbook.bases.parse(c)) else { continue };
                match (sheet.rows.position(row_id), sheet.columns.position(column_id)) {
                    (Some(row), Some(column)) => cells.push((row, column, r, c)),
                    _ => deleted.push((r, c)),
                }
            }
            cells.sort();
            deleted.sort();
            // A cell a conditional format reads changed: what it gives may have too.
            let formats_given_changed = changes.are_formats_given_changed
                || (changes.are_lines_changed && !sheet.conditional_formats.is_empty())
                || cells.iter().any(|&(row, column, _, _)| reads_a_conditional_format(workbook, sheet, (row, column)));
            // And a view an input of which reads one: what it shows may have too.
            let positions: Vec<(usize, usize)> = cells.iter().map(|&(row, column, _, _)| (row, column)).collect();
            views.extend(views_reading(workbook, sheet, &positions));
            // Rows or columns changed: every view with an input on the sheet; its layout (formats, widths): every
            // interactive with one, which shows its inputs' cells as they look.
            if changes.are_lines_changed {
                views.extend(views_on(workbook, sheet, false));
            } else if changes.is_layout_changed {
                views.extend(views_on(workbook, sheet, true));
            }
            let cells: Vec<Json> =
                cells.into_iter().map(|(_, _, r, c)| (r, c)).chain(deleted).map(|(r, c)| json!({"r": r, "c": c})).collect();
            let mut out = json!({"sheetId": sheet.id, "cells": cells, "isLayoutChanged": changes.is_layout_changed});
            if formats_given_changed {
                out["areFormatsGivenChanged"] = json!(true);
            }
            sheets.push(out);
        }
        let mut out = json!({"kind": "inSheets", "sheets": sheets});
        if !views.is_empty() {
            out["views"] = json!(views);
        }
        if self.is_time_zone_changed {
            out["isTimeZoneChanged"] = json!(true);
        }
        out
    }
}

/// The cells the workbook holds in its sheets, rows and columns not deleted.
fn cells_held(workbook: &Workbook) -> usize {
    let held = |sheet: &Sheet| {
        sheet.cells.keys().filter(|&&(r, c)| sheet.rows.contains(r) && sheet.columns.contains(c)).count()
    };
    workbook.sheets.iter().map(held).sum()
}

/// Whether one of the sheet's conditional formats reads the cell at a position: one of its cells, or a cell in the
/// same row as one of them in a column its tests name.
fn reads_a_conditional_format(workbook: &Workbook, sheet: &Sheet, (row, column): (usize, usize)) -> bool {
    sheet.conditional_formats.values().any(|(_, format)| {
        let columns: Vec<usize> = format
            .effect
            .columns()
            .into_iter()
            .filter_map(|c| sheet.columns.position(workbook.bases.parse(c)?))
            .collect();
        format.ranges.iter().filter_map(|range| sheet.live_box(&workbook.bases, range)).any(|(t, b, l, r)| {
            (t..=b).contains(&row) && ((l..=r).contains(&column) || columns.contains(&column))
        })
    })
}

/// The views, placed or not, with an input on the sheet (only the interactives, when asked).
fn views_on(workbook: &Workbook, sheet: &Sheet, interactives: bool) -> Vec<String> {
    let on = |view: &View| {
        (!interactives || view.is_interactive())
            && view.elements.iter().any(|element| element.parts().2.iter().any(|i| i.range.sheet_id == sheet.id))
    };
    workbook.views.values().filter(|(_, view)| on(view)).map(|(id, _)| id.clone()).collect()
}

/// The views, placed or not, an input of which reads one of the cells of a sheet at these positions.
fn views_reading(workbook: &Workbook, sheet: &Sheet, cells: &[(usize, usize)]) -> Vec<String> {
    if cells.is_empty() {
        return Vec::new();
    }
    let reads = |range: &RangeOnASheet| {
        let corners = RangeIds { top_left: range.top_left.clone(), bottom_right: range.bottom_right.clone() };
        range.sheet_id == sheet.id
            && sheet.live_box(&workbook.bases, &corners).is_some_and(|(t, b, l, r)| {
                cells.iter().any(|(row, column)| (t..=b).contains(row) && (l..=r).contains(column))
            })
    };
    let reads_one = |view: &View| {
        view.elements.iter().any(|element| element.parts().2.iter().any(|i| reads(&i.range)))
    };
    workbook.views.values().filter(|(_, view)| reads_one(view)).map(|(id, _)| id.clone()).collect()
}
