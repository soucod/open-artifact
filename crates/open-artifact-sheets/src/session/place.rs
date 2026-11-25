//! The place an edit changed (`placeChanged`): a sheet, and the cells in it (`null`: the sheet as a whole), or none
//! (`null`: the workbook as a whole). The page shows another person's edit there, and goes to its own there.

use serde_json::{json, Value as Json};

use crate::ids::{IdRun, LineId};
use crate::workbook::load::Op;
use crate::workbook::layout::{live_ends, RangeIds};
use crate::workbook::{Sheet, Workbook};

/// A box of positions in a sheet: top, left, bottom, right.
type Box4 = (usize, usize, usize, usize);

#[derive(Clone, Debug, PartialEq)]
pub enum Place {
    Nowhere,
    /// A sheet gone after the edit (one it deleted, or an operation on it): nowhere to show, yet the first place, as a
    /// sheet named first is, ahead of the sheets named after it.
    Gone(String),
    /// A sheet, the cells in it, and the placement that is all the place is, when one is.
    Sheet { sheet_id: String, cells: Option<Box4>, placement: Option<String> },
}

/// A place as it was told when an edit of several was made (each told on the workbook that edit left): its sheet,
/// and the place by ids then. Told again (the step taken back or made again), it is none while its sheet is gone; a
/// sheet gone when told is the sheet, its cells none.
#[derive(Clone, Debug)]
pub struct Told {
    sheet_id: Option<String>,
    json: Json,
    whole_rows: bool,
    whole_columns: bool,
}

impl Told {
    pub fn of(place: &Place, workbook: &Workbook) -> Told {
        match place {
            Place::Nowhere => Told::nowhere(),
            Place::Gone(sheet_id) => Told { sheet_id: Some(sheet_id.clone()), json: json!({"sheetId": sheet_id, "cells": null}), ..Told::nowhere() },
            Place::Sheet { sheet_id, cells, .. } => {
                let sheet = workbook.sheet_index(sheet_id).map(|i| &workbook.sheets[i]);
                let (whole_rows, whole_columns) = cells.zip(sheet).map_or((false, false), |((t,l,b,r), s)| {
                    (t == 0 && b + 1 == s.rows.len(), l == 0 && r + 1 == s.columns.len())
                });
                Told { sheet_id: Some(sheet_id.clone()), json: place.to_json(workbook), whole_rows, whole_columns }
            }
        }
    }

    pub fn nowhere() -> Told {
        Told { sheet_id: None, json: Json::Null, whole_rows: false, whole_columns: false }
    }

    /// Whether the place's sheet is in the workbook (a place on no sheet is).
    pub fn is_there(&self, workbook: &Workbook) -> bool {
        self.sheet_id.as_ref().is_none_or(|id| workbook.sheet_index(id).is_some())
    }

    /// Whether the place is told among the places changed before: its sheet is there, and it is a place.
    pub fn is_shown(&self, workbook: &Workbook) -> bool {
        self.is_there(workbook) && !self.json.is_null()
    }

    pub fn to_json(&self, workbook: &Workbook) -> Json {
        let Some(sheet) = self.sheet_id.as_ref().and_then(|id| workbook.sheet_index(id)) else {
            return Json::Null;
        };
        let mut place = self.json.clone();
        if let Some(range) = place.get("cells").filter(|cells| !cells.is_null()) {
            let range: RangeIds = serde_json::from_value(range.clone()).expect("a range written by Place");
            let sheet = &workbook.sheets[sheet];
            let mut live = sheet.live_range(&workbook.bases, &range);
            if let Some(range) = &mut live {
                if self.whole_rows {
                    range.top_left.r = workbook.bases.text(sheet.rows.line(0).unwrap());
                    range.bottom_right.r = workbook.bases.text(sheet.rows.line(sheet.rows.len() - 1).unwrap());
                }
                if self.whole_columns {
                    range.top_left.c = workbook.bases.text(sheet.columns.line(0).unwrap());
                    range.bottom_right.c = workbook.bases.text(sheet.columns.line(sheet.columns.len() - 1).unwrap());
                }
            }
            place["cells"] = json!(live);
        }
        place
    }
}

impl Place {
    pub fn cells(sheet_id: &str, top: usize, left: usize, bottom: usize, right: usize) -> Place {
        Place::Sheet { sheet_id: sheet_id.to_owned(), cells: Some((top, left, bottom, right)), placement: None }
    }

    pub fn sheet(sheet_id: &str) -> Place {
        Place::Sheet { sheet_id: sheet_id.to_owned(), cells: None, placement: None }
    }

    /// The box around these boxes of a sheet (top, bottom, left, right); the sheet when there are none.
    fn around(sheet_id: &str, boxes: impl Iterator<Item = (usize, usize, usize, usize)>) -> Place {
        boxes.map(|(t, b, l, r)| Place::cells(sheet_id, t, l, b, r)).fold(Place::Nowhere, Place::and).or_sheet(sheet_id)
    }

    fn or_sheet(self, sheet_id: &str) -> Place {
        match self {
            Place::Nowhere => Place::sheet(sheet_id),
            place => place,
        }
    }

    /// The place as the page reads it, its corners by id in the workbook as it is.
    pub fn to_json(&self, workbook: &Workbook) -> Json {
        match self {
            Place::Nowhere | Place::Gone(_) => Json::Null,
            Place::Sheet { sheet_id, cells, placement } => {
                let cells = cells.and_then(|(t, l, b, r)| {
                    let sheet = &workbook.sheets[workbook.sheet_index(sheet_id)?];
                    let id = |row: usize, column: usize| -> Option<Json> {
                        Some(json!({
                            "r": workbook.bases.text(sheet.rows.line(row)?),
                            "c": workbook.bases.text(sheet.columns.line(column)?),
                        }))
                    };
                    Some(json!({"topLeft": id(t, l)?, "bottomRight": id(b, r)?}))
                });
                let mut out = json!({"sheetId": sheet_id, "cells": cells});
                if let Some(placement) = placement {
                    out["placementId"] = json!(placement);
                }
                out
            }
        }
    }

    /// Both places as one: the box around both in one sheet (no longer one placement's); a sheet as a whole takes in
    /// its cells; of two sheets, the first.
    pub(crate) fn and(self, other: Place) -> Place {
        match (self, other) {
            (Place::Nowhere, p) | (p, Place::Nowhere) => p,
            (first, Place::Gone(_)) | (first @ Place::Gone(_), _) => first,
            (first @ Place::Sheet { .. }, Place::Sheet { sheet_id: b, cells: y, .. }) => {
                let Place::Sheet { sheet_id: a, cells: x, placement } = first else { unreachable!() };
                if a != b {
                    return Place::Sheet { sheet_id: a, cells: x, placement };
                }
                let cells = match (x, y) {
                    (Some(x), Some(y)) => Some((x.0.min(y.0), x.1.min(y.1), x.2.max(y.2), x.3.max(y.3))),
                    _ => None,
                };
                Place::Sheet { sheet_id: a, cells, placement: None }
            }
        }
    }
}

fn lines_of(workbook: &Workbook, runs: &[&IdRun]) -> Vec<LineId> {
    runs.iter()
        .flat_map(|r| (r.first..r.first.saturating_add(r.count)).map(move |n| (r.base.as_str(), n)))
        .filter_map(|(b, n)| Some(LineId { base: workbook.bases.find(b)?, n }))
        .collect()
}

/// The span of positions of these lines (the live ones) on an axis.
fn span(positions: impl Iterator<Item = Option<usize>>) -> Option<(usize, usize)> {
    positions.flatten().fold(None, |s, p| Some(s.map_or((p, p), |(a, b): (usize, usize)| (a.min(p), b.max(p)))))
}

/// Where deleted lines were, among the `left` lines left: each block of lines that were side by side takes as many
/// lines where it was, less the lines deleted before it (past the end, the last line).
fn deleted_span(positions: impl Iterator<Item = usize>, left: usize) -> Option<(usize, usize)> {
    let mut positions: Vec<usize> = positions.collect();
    positions.sort_unstable();
    positions.dedup();
    let last = left.checked_sub(1)?;
    let mut place: Option<(usize, usize)> = None;
    let mut i = 0;
    while i < positions.len() {
        let mut j = i;
        while j + 1 < positions.len() && positions[j + 1] == positions[j] + 1 {
            j += 1;
        }
        let top = positions[i] - i;
        let block = (top, top + (j - i));
        place = Some(place.map_or(block, |(a, b)| (a.min(block.0), b.max(block.1))));
        i = j + 1;
    }
    place.map(|(a, b)| (a.min(last), b.min(last)))
}

fn whole_rows(sheet: &Sheet, rows: (usize, usize), id: &str) -> Place {
    match sheet.columns.len() {
        0 => Place::sheet(id),
        n => Place::cells(id, rows.0, 0, rows.1, n - 1),
    }
}

fn whole_columns(sheet: &Sheet, columns: (usize, usize), id: &str) -> Place {
    match sheet.rows.len() {
        0 => Place::sheet(id),
        n => Place::cells(id, 0, columns.0, n - 1, columns.1),
    }
}

/// Where another person's operations changed the workbook, before and after them. Rows or columns moved are the
/// place, whatever else the operations did. Otherwise an operation on a sheet but none of its cells (its name,
/// settings, place among the sheets, dropdowns or groups) names its place only until another operation on that sheet
/// changes cells there (and so do lines undeleted that the page does not know); such places named one after another
/// are taken together. Conditional formats and groups are the place only when nothing else is: the first sheet they
/// name, the boxes they give there taken together (a sheet as a whole, as when groups have none open, gives none). A
/// sheet inserted or undeleted (one shown) makes the place the sheet first named, as a whole. A sheet gone
/// afterwards, named first, leaves no place.
pub fn of_ops(before: &Workbook, after: &Workbook, ops: &[Op]) -> Place {
    let names_only = |op: &Op| {
        matches!(
            op,
            Op::SetSheetNames { .. }
                | Op::SetSheetSettings { .. }
                | Op::MoveSheets { .. }
                | Op::SetDropdowns { .. }
        )
    };
    let weak = |op: &Op| {
        matches!(op, Op::SetConditionalFormats { .. } | Op::SetRowGroups { .. } | Op::SetColumnGroups { .. })
    };
    // Where conditional formats and groups are: the place when nothing else is.
    let mut weakly = Place::Nowhere;
    // Lines undeleted that the page does not know (a load forgot them) name their sheet only; lines inserted or
    // deleted there make it the place as a whole.
    let forgot = |op: &Op, here: &Place| {
        *here == Place::Nowhere && matches!(op, Op::UndeleteRows { .. } | Op::UndeleteColumns { .. })
    };
    let forgotten: Vec<&str> =
        ops.iter().filter(|op| forgot(op, &of_op(before, after, op))).filter_map(|op| lines_of_sheet(op)).collect();
    let mut place = Place::Nowhere;
    let mut moved = Place::Nowhere;
    let mut is_named_only = false;
    for op in ops {
        let mut here = of_op(before, after, op);
        if weak(op) {
            // Groups with none open: their sheet, as a whole.
            if let (Op::SetRowGroups { sheet_id, .. } | Op::SetColumnGroups { sheet_id, .. }, Place::Nowhere) = (op, &here) {
                if after.sheet_index(sheet_id).is_some() {
                    here = Place::sheet(sheet_id);
                }
            }
            weakly = match (weakly, here) {
                (Place::Sheet { sheet_id: a, cells: None, .. }, Place::Sheet { sheet_id: b, cells, .. }) if a == b => {
                    Place::Sheet { sheet_id: a, cells, placement: None }
                }
                (first @ Place::Sheet { .. }, Place::Sheet { sheet_id: b, cells: None, .. })
                    if matches!(&first, Place::Sheet { sheet_id: a, .. } if *a == b) =>
                {
                    first
                }
                (first, here) => first.and(here),
            };
            continue;
        }
        let named = names_only(op) || forgot(op, &here);
        if let Some(sheet_id) = lines_of_sheet(op).filter(|id| forgotten.contains(id)) {
            here = Place::sheet(sheet_id);
        }
        if matches!(op, Op::MoveRows { .. } | Op::ReorderRows { .. } | Op::MoveColumns { .. }) {
            moved = moved.and(here);
            continue;
        }
        match (&place, op) {
            (Place::Nowhere, _) => {
                is_named_only = named;
                place = here;
            }
            (Place::Sheet { sheet_id, .. }, Op::InsertSheet { sheet_id: new, .. })
            | (Place::Sheet { sheet_id, .. }, Op::UndeleteSheet { sheet_id: new }) => {
                if after.sheet_index(new).is_some() {
                    place = Place::sheet(&sheet_id.clone());
                    is_named_only = false;
                }
            }
            _ if named && is_named_only => place = place.and(here),
            _ if named => {}
            (Place::Sheet { sheet_id: a, .. }, _) if is_named_only => {
                if matches!(&here, Place::Sheet { sheet_id: b, .. } if a == b) {
                    place = here;
                    is_named_only = false;
                }
            }
            _ => place = place.and(here),
        }
    }
    match (moved, place) {
        (Place::Nowhere, Place::Nowhere) => weakly,
        (Place::Nowhere, place) => place,
        (moved, _) => moved,
    }
}

/// The sheet whose rows or columns an operation inserts, deletes or undeletes.
fn lines_of_sheet(op: &Op) -> Option<&str> {
    match op {
        Op::InsertRows { sheet_id, .. }
        | Op::InsertColumns { sheet_id, .. }
        | Op::DeleteRows { sheet_id, .. }
        | Op::DeleteColumns { sheet_id, .. }
        | Op::UndeleteRows { sheet_id, .. }
        | Op::UndeleteColumns { sheet_id, .. } => Some(sheet_id),
        _ => None,
    }
}

fn of_op(before: &Workbook, after: &Workbook, op: &Op) -> Place {
    let sheet_after = |id: &str| after.sheet_index(id).map(|i| &after.sheets[i]);
    let line = |id: &str| after.bases.parse(id);
    match op {
        // Cells, formats and sizes: of the lines left (none when a later operation deleted them all).
        Op::SetCells { sheet_id, cells, .. } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let rows = span(cells.iter().map(|c| line(&c.r).and_then(|l| sheet.rows.position(l))));
            let columns = span(cells.iter().map(|c| line(&c.c).and_then(|l| sheet.columns.position(l))));
            match (rows, columns) {
                (Some(r), Some(c)) => Place::cells(sheet_id, r.0, c.0, r.1, c.1),
                _ => Place::Nowhere,
            }
        }
        Op::SetCellFormats { sheet_id, formats } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let rows: Vec<&IdRun> = formats.iter().flat_map(|f| &f.rows).collect();
            let columns: Vec<&IdRun> = formats.iter().flat_map(|f| &f.columns).collect();
            let rows = span(lines_of(after, &rows).into_iter().map(|l| sheet.rows.position(l)));
            let columns = span(lines_of(after, &columns).into_iter().map(|l| sheet.columns.position(l)));
            match (rows, columns) {
                (Some(r), Some(c)) => Place::cells(sheet_id, r.0, c.0, r.1, c.1),
                _ => Place::Nowhere,
            }
        }
        // Ranges: the cells left of each (a deleted corner taken toward the other one).
        Op::MergeCells { sheet_id, ranges } | Op::UnmergeCells { sheet_id, ranges } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            Place::around(sheet_id, ranges.iter().filter_map(|r| sheet.live_box(&after.bases, r)))
        }
        Op::SetColumnWidths { sheet_id, widths } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<&IdRun> = widths.iter().map(|w| &w.columns).collect();
            match span(lines_of(after, &runs).into_iter().map(|l| sheet.columns.position(l))) {
                Some(c) => whole_columns(sheet, c, sheet_id),
                None => Place::Nowhere,
            }
        }
        Op::SetRowHeights { sheet_id, heights } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<&IdRun> = heights.iter().map(|h| &h.rows).collect();
            match span(lines_of(after, &runs).into_iter().map(|l| sheet.rows.position(l))) {
                Some(r) => whole_rows(sheet, r, sheet_id),
                None => Place::Nowhere,
            }
        }
        Op::InsertRows { sheet_id, rows, .. } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            match span(lines_of(after, &[rows]).into_iter().map(|l| sheet.rows.position(l))) {
                Some(r) => whole_rows(sheet, r, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        Op::InsertColumns { sheet_id, columns, .. } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            match span(lines_of(after, &[columns]).into_iter().map(|l| sheet.columns.position(l))) {
                Some(c) => whole_columns(sheet, c, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        // Lines undeleted that the page does not know (a load forgot them): nowhere of them.
        Op::UndeleteRows { sheet_id, rows } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<&IdRun> = rows.iter().collect();
            match span(lines_of(after, &runs).into_iter().map(|l| sheet.rows.position(l))) {
                Some(r) => whole_rows(sheet, r, sheet_id),
                None => Place::Nowhere,
            }
        }
        Op::UndeleteColumns { sheet_id, columns } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<&IdRun> = columns.iter().collect();
            match span(lines_of(after, &runs).into_iter().map(|l| sheet.columns.position(l))) {
                Some(c) => whole_columns(sheet, c, sheet_id),
                None => Place::Nowhere,
            }
        }
        Op::MoveRows { sheet_id, moves } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<&IdRun> = moves.iter().flat_map(|m| &m.rows).collect();
            match span(lines_of(after, &runs).into_iter().map(|l| sheet.rows.position(l))) {
                Some(r) => whole_rows(sheet, r, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        Op::ReorderRows { sheet_id, rows, .. } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<IdRun> = rows
                .ids
                .iter()
                .flat_map(|b| b.runs.iter().map(|&(first, count)| IdRun { base: b.base.clone(), first, count }))
                .collect();
            match span(lines_of(after, &runs.iter().collect::<Vec<_>>()).into_iter().map(|l| sheet.rows.position(l))) {
                Some(r) => whole_rows(sheet, r, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        Op::MoveColumns { sheet_id, moves } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let runs: Vec<&IdRun> = moves.iter().flat_map(|m| &m.columns).collect();
            match span(lines_of(after, &runs).into_iter().map(|l| sheet.columns.position(l))) {
                Some(c) => whole_columns(sheet, c, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        // Deleted lines: where each was, among the lines left (past the last one, the last one).
        Op::DeleteRows { sheet_id, rows } => {
            let (Some(old), Some(sheet)) = (before.sheet_index(sheet_id).map(|i| &before.sheets[i]), sheet_after(sheet_id)) else {
                return Place::Gone(sheet_id.to_string());
            };
            let runs: Vec<&IdRun> = rows.iter().collect();
            match deleted_span(lines_of(before, &runs).into_iter().filter_map(|l| old.rows.position(l)), sheet.rows.len()) {
                Some(r) => whole_rows(sheet, r, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        Op::DeleteColumns { sheet_id, columns } => {
            let (Some(old), Some(sheet)) = (before.sheet_index(sheet_id).map(|i| &before.sheets[i]), sheet_after(sheet_id)) else {
                return Place::Gone(sheet_id.to_string());
            };
            let runs: Vec<&IdRun> = columns.iter().collect();
            let positions = lines_of(before, &runs).into_iter().filter_map(|l| old.columns.position(l));
            match deleted_span(positions, sheet.columns.len()) {
                Some(c) => whole_columns(sheet, c, sheet_id),
                None => Place::sheet(sheet_id),
            }
        }
        Op::InsertSheet { sheet_id, .. } | Op::UndeleteSheet { sheet_id } => Place::sheet(sheet_id),
        Op::SetSheetNames { names } => names.first().map_or(Place::Nowhere, |n| Place::sheet(&n.sheet_id)),
        Op::SetSheetSettings { sheets } => sheets.first().map_or(Place::Nowhere, |s| Place::sheet(&s.sheet_id)),
        Op::MoveSheets { moves } => moves
            .first()
            .and_then(|m| m.sheet_ids.first())
            .map_or(Place::Nowhere, |id| Place::sheet(id)),
        // Objects, as they are after the edit (an edit may set only some of what they are): the cells of the ones
        // there, the sheet when there are none.
        Op::SetConditionalFormats { sheet_id, conditional_formats } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let set = conditional_formats.iter().filter_map(|f| sheet.conditional_formats.get(&f.conditional_format_id));
            Place::around(sheet_id, set.flat_map(|(_, f)| &f.ranges).filter_map(|r| sheet.live_box(&after.bases, r)))
        }
        // Groups: the whole rows (or columns) of the ones open; a collapsed group shows none of them (nowhere: see
        // `of_ops`).
        Op::SetRowGroups { sheet_id, groups } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let open = groups.iter().filter_map(|g| sheet.row_groups.get(&g.group_id)).filter(|(_, g)| !g.is_collapsed);
            let spans = open.filter_map(|(_, g)| live_ends(&sheet.rows, line(&g.ends.first)?, line(&g.ends.last)?));
            let columns = sheet.columns.len().checked_sub(1);
            let boxes = spans.filter_map(|(t, b)| Some((t, b, 0, columns?)));
            boxes.map(|(t, b, l, r)| Place::cells(sheet_id, t, l, b, r)).fold(Place::Nowhere, Place::and)
        }
        Op::SetColumnGroups { sheet_id, groups } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let open = groups.iter().filter_map(|g| sheet.column_groups.get(&g.group_id)).filter(|(_, g)| !g.is_collapsed);
            let spans = open.filter_map(|(_, g)| live_ends(&sheet.columns, line(&g.ends.first)?, line(&g.ends.last)?));
            let rows = sheet.rows.len().checked_sub(1);
            let boxes = spans.filter_map(|(l, r)| Some((0, rows?, l, r)));
            boxes.map(|(t, b, l, r)| Place::cells(sheet_id, t, l, b, r)).fold(Place::Nowhere, Place::and)
        }
        // Tables: from the header rows to the footer rows (or the header's last), across their columns; a table whose
        // footer does not start below its header has none.
        Op::SetCellTables { sheet_id, cell_tables } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let ends = |axis: &crate::ids::Axis, a: &str, b: &str| live_ends(axis, line(a)?, line(b)?);
            let boxes = cell_tables.iter().filter_map(|t| sheet.cell_tables.get(&t.cell_table_id)).filter_map(|(_, t)| {
                let header = ends(&sheet.rows, &t.header_rows.first_row, &t.header_rows.last_row)?;
                let columns = ends(&sheet.columns, &t.first_column, &t.last_column)?;
                let bottom = match t.footer_rows.as_ref().and_then(|f| ends(&sheet.rows, &f.first_row, &f.last_row)) {
                    Some(footer) if footer.0 <= header.1 => return None,
                    Some(footer) => footer.1,
                    None => header.1,
                };
                Some((header.0, bottom, columns.0, columns.1))
            });
            Place::around(sheet_id, boxes)
        }
        // Placements: the cell at the corner of each (a deleted line taken as the next one, or the last); one
        // placement alone is named.
        Op::SetPlacements { sheet_id, placements } => {
            let Some(sheet) = sheet_after(sheet_id) else { return Place::Gone(sheet_id.to_string()) };
            let at = |axis: &crate::ids::Axis, id: &str| {
                let line = line(id)?;
                axis.snap_forward(line).or_else(|| axis.knows(line).then(|| axis.len().checked_sub(1)).flatten())
            };
            placements
                .iter()
                .filter_map(|p| Some((&p.placement_id, &sheet.placements.get(&p.placement_id)?.1)))
                .filter_map(|(id, p)| {
                    let (row, column) = (at(&sheet.rows, &p.top_left.r)?, at(&sheet.columns, &p.top_left.c)?);
                    let cells = Some((row, column, row, column));
                    Some(Place::Sheet { sheet_id: sheet_id.clone(), cells, placement: Some(id.clone()) })
                })
                .fold(Place::Nowhere, Place::and)
                .or_sheet(sheet_id)
        }
        Op::SetDropdowns { sheet_id, .. } | Op::SetNamedViews { sheet_id, .. } => Place::sheet(sheet_id),
        Op::DeleteSheet { sheet_id } if after.sheet_index(sheet_id).is_none() => Place::Gone(sheet_id.clone()),
        Op::DeleteSheet { .. }
        | Op::SetViews { .. }
        | Op::Reseed { .. }
        | Op::SetTimeZone { .. }
        | Op::AdoptTimeZone { .. }
        | Op::SetLocale { .. } => Place::Nowhere,
    }
}
