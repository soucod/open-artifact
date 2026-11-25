//! What follows lines when they are inserted, deleted or moved: the frozen line, the ends of groups, tables and
//! conditional formats, and what new lines take from the one beside them (formats, groups, formulas).
//!
//! All of it is written as operations of the edit, next to the one that inserts, deletes or moves: the frozen
//! line and what a delete takes away before it, the rest after.

use hashbrown::HashSet;

use super::fit::merged_boxes;
use super::{groups, Lines};
use crate::formula::{Reference, StoredFormula};
use crate::ids::{move_items, Axis, Bases, IdRun, LineId};
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{blocks, Leaf};
use crate::workbook::layout::{
    live_ends, CellIds, EndsOfGroup, GroupPatch, GroupToSet, RangeIds, SheetSettings, SheetToSet,
};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{
    anchored_at, live_cell_table, CellTable, CellTableToSet, ConditionalFormatPatch, ConditionalFormatToSet,
    PlacementToSet,
};
use crate::workbook::{Input, Sheet, Workbook};

/// The frozen line set to another (`None`: none frozen).
fn frozen(sheet: &Sheet, lines: Lines, bases: &Bases, line: Option<LineId>) -> Op {
    let line = Some(line.map(|l| bases.text(l)));
    let settings = match lines {
        Lines::Rows => SheetSettings { last_frozen_row: line, ..SheetSettings::default() },
        Lines::Columns => SheetSettings { last_frozen_column: line, ..SheetSettings::default() },
    };
    Op::SetSheetSettings { sheets: vec![SheetToSet { sheet_id: sheet.id.clone(), settings }] }
}

/// Whether a cell table is shown: some of its header rows and columns are left, and its footer, if any, is under
/// its header.
fn is_table_shown(bases: &Bases, sheet: &Sheet, t: &CellTable) -> bool {
    let Some(live) = live_cell_table(bases, sheet, t) else { return false };
    let row = |id: &str| bases.parse(id).and_then(|l| sheet.rows.position(l));
    match &live.footer_rows {
        Some(f) => row(&f.first_row) > row(&live.header_rows.last_row),
        None => true,
    }
}

/// The groups with lines left, shown or not (one crossing another too), by where they start (the longer first),
/// each with its id, its ends as written and the positions of its first and last lines: the order they are
/// written in.
fn groups_left(workbook: &Workbook, sheet: &Sheet, lines: Lines) -> Vec<(String, (LineId, LineId), (usize, usize))> {
    let bases = &workbook.bases;
    let all = lines.groups(sheet);
    groups::live(bases, sheet, lines)
        .into_iter()
        .filter_map(|g| {
            let (_, group) = all.get(&g.id)?;
            let ends = (bases.parse(&group.ends.first)?, bases.parse(&group.ends.last)?);
            Some((g.id, ends, (g.first, g.last)))
        })
        .collect()
}

/// Of groups (in the order shown, each with the lines it is left with and whether it is collapsed), those taken
/// away: of groups left with the same lines only one stays, the first shown of them collapsed (of them all, when
/// none is).
fn merged_away<T: PartialEq>(groups: &[(Option<T>, bool)]) -> Vec<bool> {
    let beats = |j: usize, i: usize| groups[j].1 && !groups[i].1 || groups[j].1 == groups[i].1 && j < i;
    let is_beaten = |i: usize| (0..groups.len()).any(|j| j != i && groups[j].0 == groups[i].0 && beats(j, i));
    (0..groups.len()).map(|i| groups[i].0.is_some() && is_beaten(i)).collect()
}

fn frozen_line(sheet: &Sheet, lines: Lines) -> Option<LineId> {
    match lines {
        Lines::Rows => sheet.last_frozen_row,
        Lines::Columns => sheet.last_frozen_column,
    }
}

/// A range's ends on one axis, and on the other.
fn ends_of(range: &RangeIds, lines: Lines) -> ((&str, &str), (&str, &str)) {
    let rows = (range.top_left.r.as_str(), range.bottom_right.r.as_str());
    let columns = (range.top_left.c.as_str(), range.bottom_right.c.as_str());
    match lines {
        Lines::Rows => (rows, columns),
        Lines::Columns => (columns, rows),
    }
}

/// A group's ends written again (whether it is collapsed is left as it is).
fn ends_written(group_id: &str, ends: EndsOfGroup) -> GroupToSet {
    GroupToSet { group_id: group_id.to_owned(), group: Some(GroupPatch { ends: Some(ends), is_collapsed: None }) }
}

/// A conditional format's ranges written again, the rest of it left as it is.
fn ranges_written(ranges: Vec<RangeIds>) -> ConditionalFormatPatch {
    ConditionalFormatPatch { ranges: Some(ranges), ..ConditionalFormatPatch::default() }
}

/// A range from its ends on one axis and on the other.
fn range_of(lines: Lines, (a, b): (String, String), (c, d): (String, String)) -> RangeIds {
    let ((top, bottom), (left, right)) = match lines {
        Lines::Rows => ((a, b), (c, d)),
        Lines::Columns => ((c, d), (a, b)),
    };
    RangeIds { top_left: CellIds { r: top, c: left }, bottom_right: CellIds { r: bottom, c: right } }
}

/// What deleting lines changes besides: the frozen line, when deleted, goes to the line before it left; a group
/// showing lines takes the first and the last of them left, in order (none left, it is taken away), written when
/// that is not how its ends are (so a group written last line first is written again, whatever the delete), and of
/// groups left with the same lines only one stays, as `merged_away` says (those taken away come first, the others
/// changed follow by where they are); a table shown whose header rows or whose columns are all deleted is taken away
/// (one not shown is left); a range of a conditional format with an end deleted takes, at each end, the line left
/// nearest it on the way to the other (none left, the range goes; no range left, the format), the other ranges and
/// the other axis left as they are written. Operations to make before the delete.
pub fn of_delete(workbook: &Workbook, sheet: &Sheet, lines: Lines, deleted: &HashSet<LineId>) -> Vec<Op> {
    let bases = &workbook.bases;
    let axis = lines.axis(sheet);
    let mut left = axis.clone();
    left.delete(&deleted.iter().copied().collect::<Vec<_>>());
    let mut ops = Vec::new();
    if let Some(f) = frozen_line(sheet, lines).filter(|f| deleted.contains(f)) {
        let p = axis.position(f).expect("a deleted line was there");
        let before = (0..p).rev().map(|q| axis.line(q).expect("a live position")).find(|l| !deleted.contains(l));
        ops.push(frozen(sheet, lines, bases, before));
    }
    let id = |axis: &Axis, p: usize| bases.text(axis.line(p).expect("a live position"));
    // Each group with lines, shown or not, with the lines it is left with, and whether its ends change.
    let mut left_with: Vec<(String, Option<(usize, usize)>, bool)> = groups_left(workbook, sheet, lines)
        .into_iter()
        .map(|(group_id, (first, last), _)| match live_ends(&left, first, last) {
            Some((a, b)) => (group_id, Some((a, b)), (left.line(a), left.line(b)) != (Some(first), Some(last))),
            None => (group_id, None, true),
        })
        .collect();
    let all = lines.groups(sheet);
    let is_collapsed = |id: &String| all.get(id).is_some_and(|(_, g)| g.is_collapsed);
    let merging: Vec<(Option<(usize, usize)>, bool)> =
        left_with.iter().map(|(id, ends, _)| (*ends, is_collapsed(id))).collect();
    for (i, is_away) in merged_away(&merging).into_iter().enumerate() {
        if is_away {
            left_with[i].1 = None;
        }
    }
    let gone = left_with.iter().filter(|(_, ends, _)| ends.is_none());
    let mut groups: Vec<GroupToSet> =
        gone.map(|(group_id, ..)| GroupToSet { group_id: group_id.clone(), group: None }).collect();
    let mut changed: Vec<(&String, (usize, usize))> = left_with
        .iter()
        .filter_map(|(group_id, ends, changes)| ends.filter(|_| *changes).map(|ends| (group_id, ends)))
        .collect();
    changed.sort_by_key(|&(_, ends)| ends);
    for (group_id, (a, b)) in changed {
        let ends = EndsOfGroup { first: id(&left, a), last: id(&left, b) };
        groups.push(ends_written(group_id, ends));
    }
    if !groups.is_empty() {
        ops.push(lines.set_groups(&sheet.id, groups));
    }
    let mut tables = Vec::new();
    for (table_id, t) in sheet.cell_tables.values() {
        let (first, last) = match lines {
            Lines::Rows => (&t.header_rows.first_row, &t.header_rows.last_row),
            Lines::Columns => (&t.first_column, &t.last_column),
        };
        let (Some(first), Some(last)) = (bases.parse(first), bases.parse(last)) else { continue };
        if is_table_shown(bases, sheet, t) && live_ends(&left, first, last).is_none() {
            let at = |id: &str, axis: &Axis| bases.parse(id).and_then(|l| axis.position(l)).unwrap_or(usize::MAX);
            let place = (at(&t.header_rows.first_row, &sheet.rows), at(&t.first_column, &sheet.columns));
            tables.push((place, CellTableToSet { cell_table_id: table_id.clone(), cell_table: None }));
        }
    }
    // In the order of their places in the sheet, top first.
    tables.sort_by_key(|(place, _)| *place);
    let tables: Vec<CellTableToSet> = tables.into_iter().map(|(_, t)| t).collect();
    if !tables.is_empty() {
        ops.push(Op::SetCellTables { sheet_id: sheet.id.clone(), cell_tables: tables });
    }
    let mut formats = Vec::new();
    // An end deleted before is read as the line nearest it toward the other: deleting that line deletes the end.
    let ends_deleted = |range: &RangeIds| {
        let ((a, b), _) = ends_of(range, lines);
        let (Some(a), Some(b)) = (bases.parse(a), bases.parse(b)) else { return false };
        let read_as = |end: LineId, other: LineId| axis.snap_toward(end, other).and_then(|p| axis.line(p));
        [read_as(a, b), read_as(b, a)].iter().any(|l| l.is_some_and(|l| deleted.contains(&l)))
    };
    for (format_id, f) in sheet.conditional_formats.values() {
        if !f.ranges.iter().any(ends_deleted) {
            continue;
        }
        let ranges: Vec<RangeIds> = f
            .ranges
            .iter()
            .filter_map(|range| {
                if !ends_deleted(range) {
                    return Some(range.clone());
                }
                let ((a, b), (c, d)) = ends_of(range, lines);
                let (a, b) = (bases.parse(a)?, bases.parse(b)?);
                let (p, q) = (left.snap_toward(a, b)?, left.snap_toward(b, a)?);
                Some(range_of(lines, (id(&left, p), id(&left, q)), (c.to_owned(), d.to_owned())))
            })
            .collect();
        let conditional_format = (!ranges.is_empty()).then(|| ranges_written(ranges));
        formats.push(ConditionalFormatToSet { conditional_format_id: format_id.clone(), conditional_format });
    }
    if !formats.is_empty() {
        ops.push(Op::SetConditionalFormats { sheet_id: sheet.id.clone(), conditional_formats: formats });
    }
    ops
}

/// Lines moving: the axis before and after the move (deleted lines stay where they are), the lines moved, and the
/// lines not deleted after the move.
struct Moving<'a> {
    axis: &'a Axis,
    after: Axis,
    moved: HashSet<LineId>,
    order: Vec<LineId>,
}

impl Moving<'_> {
    /// The first and the last line, after the move, of the lines from `first` to `last` (positions): from the first to
    /// the last of the ones that stay, and the moved ones of them that land beside those, deleted lines between them
    /// counting for nothing (the first and the last of the moved ones, when all move).
    fn ends_in_order(&self, (first, last): (usize, usize)) -> (LineId, LineId) {
        let lines: HashSet<LineId> = (first..=last).map(|p| self.axis.line(p).expect("a live position")).collect();
        let order = &self.order;
        let takes = |p: usize| lines.contains(&order[p]) && self.moved.contains(&order[p]);
        let stays: Vec<usize> = (0..order.len()).filter(|&p| lines.contains(&order[p]) && !takes(p)).collect();
        let (mut a, mut b) = match (stays.first(), stays.last()) {
            (Some(&a), Some(&b)) => (a, b),
            _ => {
                let moved: Vec<usize> = (0..order.len()).filter(|&p| takes(p)).collect();
                (moved[0], moved[moved.len() - 1])
            }
        };
        while a > 0 && takes(a - 1) {
            a -= 1;
        }
        while b + 1 < order.len() && takes(b + 1) {
            b += 1;
        }
        (order[a], order[b])
    }

    /// The new ends of what goes from one line to another (they may be written in either order, and be deleted): the
    /// lines it shows go as `ends_in_order` says, and the first and the last of them after the move are its new ends,
    /// when its ends as written would not now be read as those two. A deleted end is read as the nearest line not
    /// deleted toward the other, so lines moved in beside it change what it is read as.
    fn ends(&self, one: LineId, other: LineId) -> Option<(LineId, LineId)> {
        let (i, j) = (self.axis.index(one)?, self.axis.index(other)?);
        let (low, high) = if i <= j { (one, other) } else { (other, one) };
        let (x, y) = self.ends_in_order((self.axis.snap_toward(low, high)?, self.axis.snap_toward(high, low)?));
        let after = &self.after;
        let read = |one: LineId, other: LineId| after.line(after.snap_toward(one, other)?);
        // Nothing is read, when every line between its ends has gone.
        if read(low, high).zip(read(high, low)) == Some((x, y)) {
            return None;
        }
        Some(if i <= j { (x, y) } else { (y, x) })
    }

    /// The new first line of what goes from a line (maybe deleted) to the end of the axis, when it is another: a
    /// deleted one that every line after has moved away from reads as nothing now.
    fn first_to_the_end(&self, first: LineId) -> Option<LineId> {
        let (x, _) = self.ends_in_order((self.axis.snap_forward(first)?, self.axis.len() - 1));
        let after = &self.after;
        (after.snap_forward(first).and_then(|p| after.line(p)) != Some(x)).then_some(x)
    }
}

/// What moving lines changes besides: operations to make before the move (the frozen line, when moved, goes to the
/// line before the ones moved), and after it. What goes from one line to another takes the lines of it that stay,
/// and those moved that land next to them (all of them, when all move): groups, the references of formulas (in
/// every sheet), the ranges of conditional formats. References and ranges keep the way round they are written; a
/// group is written first line first, and so written again whenever it is not (or an end of it is deleted).
pub fn of_move(workbook: &Workbook, sheet: &Sheet, lines: Lines, moved: &[LineId], after: Option<LineId>)
    -> (Vec<Op>, Vec<Op>) {
    let bases = &workbook.bases;
    let axis = lines.axis(sheet);
    let set: HashSet<LineId> = moved.iter().copied().collect();
    let mut before = Vec::new();
    if frozen_line(sheet, lines).is_some_and(|f| set.contains(&f)) {
        let first = axis.position(moved[0]).expect("a live line");
        before.push(frozen(sheet, lines, bases, first.checked_sub(1).and_then(|p| axis.line(p))));
    }
    let live: Vec<LineId> = (0..axis.len()).map(|p| axis.line(p).expect("a live position")).collect();
    let (order, _) = move_items(&live, &[(moved.to_vec(), after)]);
    let mut moved_axis = axis.clone();
    moved_axis.move_lines(&[(moved.to_vec(), after)]);
    let moving = Moving { axis, after: moved_axis, moved: set, order };
    let ends = |a: &str, b: &str| moving.ends(bases.parse(a)?, bases.parse(b)?);
    let mut after_ops = Vec::new();
    // Each group (shown or not) with its lines after the move; of groups left with the same lines one stays, as on a
    // delete (those taken away come first), and the others changed are written by where they now are.
    let now: Vec<(String, (LineId, LineId), bool)> = groups_left(workbook, sheet, lines)
        .into_iter()
        .map(|(group_id, written, span)| {
            let ends = moving.ends_in_order(span);
            (group_id, ends, ends != written)
        })
        .collect();
    let all = lines.groups(sheet);
    let is_collapsed = |id: &String| all.get(id).is_some_and(|(_, g)| g.is_collapsed);
    let away = merged_away(&now.iter().map(|(id, ends, _)| (Some(*ends), is_collapsed(id))).collect::<Vec<_>>());
    let mut groups: Vec<GroupToSet> = (0..now.len())
        .filter(|&i| away[i])
        .map(|i| GroupToSet { group_id: now[i].0.clone(), group: None })
        .collect();
    let mut changed: Vec<&(String, (LineId, LineId), bool)> =
        (0..now.len()).filter(|&i| now[i].2 && !away[i]).map(|i| &now[i]).collect();
    changed.sort_by_key(|(_, (a, b), _)| (moving.after.position(*a), moving.after.position(*b)));
    for (group_id, (a, b), _) in changed {
        let ends = EndsOfGroup { first: bases.text(*a), last: bases.text(*b) };
        groups.push(ends_written(group_id, ends));
    }
    if !groups.is_empty() {
        after_ops.push(lines.set_groups(&sheet.id, groups));
    }
    after_ops.extend(formulas_after_move(workbook, sheet, lines, &moving));
    if matches!(lines, Lines::Columns) {
        let tables: Vec<_> = sheet.cell_tables.values().filter_map(|(id, table)| {
            if !is_table_shown(bases, sheet, table) {
                return None;
            }
            let (first, last) = ends(&table.first_column, &table.last_column)?;
            let mut table = table.clone();
            table.first_column = bases.text(first);
            table.last_column = bases.text(last);
            Some(CellTableToSet { cell_table_id: id.clone(), cell_table: Some(table) })
        }).collect();
        if !tables.is_empty() {
            after_ops.push(Op::SetCellTables { sheet_id: sheet.id.clone(), cell_tables: tables });
        }
    }
    let mut formats = Vec::new();
    for (format_id, f) in sheet.conditional_formats.values() {
        let mut changed = false;
        let ranges: Vec<RangeIds> = f
            .ranges
            .iter()
            .map(|range| {
                let ((a, b), (c, d)) = ends_of(range, lines);
                match ends(a, b) {
                    Some((a, b)) => {
                        changed = true;
                        range_of(lines, (bases.text(a), bases.text(b)), (c.to_owned(), d.to_owned()))
                    }
                    None => range.clone(),
                }
            })
            .collect();
        if changed {
            let conditional_format = Some(ranges_written(ranges));
            formats.push(ConditionalFormatToSet { conditional_format_id: format_id.clone(), conditional_format });
        }
    }
    if !formats.is_empty() {
        after_ops.push(Op::SetConditionalFormats { sheet_id: sheet.id.clone(), conditional_formats: formats });
    }
    // A placement with no offset from its cell stays where it is shown: at the line now where its line was (a
    // deleted one, where it is shown). One with an offset goes with its cell.
    let mut placements = Vec::new();
    for (placement_id, p) in sheet.placements.values() {
        if p.offset_from_anchor_cell.is_some() {
            continue;
        }
        let line = match lines {
            Lines::Rows => &p.top_left.r,
            Lines::Columns => &p.top_left.c,
        };
        let Some(line) = bases.parse(line) else { continue };
        let Some(position) = anchored_at(axis, line) else { continue };
        // Where it is shown after the move: a deleted line stays where it is, shown at the line after it then (or the
        // last line, with none after it).
        if anchored_at(&moving.after, line) == Some(position) {
            continue;
        }
        let now = moving.order[position];
        let mut placement = p.clone();
        match lines {
            Lines::Rows => placement.top_left.r = bases.text(now),
            Lines::Columns => placement.top_left.c = bases.text(now),
        }
        placements.push(PlacementToSet { placement_id: placement_id.clone(), placement: Some(placement) });
    }
    if !placements.is_empty() {
        after_ops.push(Op::SetPlacements { sheet_id: sheet.id.clone(), placements });
    }
    (before, after_ops)
}

/// The formulas, in every sheet, with a reference to lines of the sheet from one to another that takes other lines
/// when lines move: one `setCells` of a sheet's, its cells in the order of their ids (the row's, then the
/// column's, as text: `row_….10` before `row_….2`), as they are kept. Cells deleted, or hidden under a
/// merged range, are left as they are.
fn formulas_after_move(workbook: &Workbook, sheet: &Sheet, lines: Lines, moving: &Moving) -> Vec<Op> {
    let bases = &workbook.bases;
    let ends = |a: &mut String, b: &mut String| -> bool {
        let Some((x, y)) = bases.parse(a).zip(bases.parse(b)).and_then(|(a, b)| moving.ends(a, b)) else {
            return false;
        };
        (*a, *b) = (bases.text(x), bases.text(y));
        true
    };
    let to_the_end = |a: &mut String| -> bool {
        let Some(x) = bases.parse(a).and_then(|a| moving.first_to_the_end(a)) else { return false };
        *a = bases.text(x);
        true
    };
    let mut ops = Vec::new();
    for other in &workbook.sheets {
        let mut cells: Vec<CellToSet> = Vec::new();
        let merged = merged_boxes(workbook, other);
        for (&(r, c), cell) in &other.cells {
            let Input::Formula { formula } = &cell.input else { continue };
            let (Some(row), Some(column)) = (other.rows.position(r), other.columns.position(c)) else { continue };
            let covered = |&(t, b, l, r): &(usize, usize, usize, usize)| {
                (t..=b).contains(&row) && (l..=r).contains(&column) && (row, column) != (t, l)
            };
            if merged.iter().any(covered) {
                continue;
            }
            let mut formula = formula.clone();
            let mut changed = false;
            for reference in formula.references.iter_mut() {
                let here = |sheet_id: &String| *sheet_id == sheet.id;
                changed |= match (reference, lines) {
                    (Reference::Range { sheet_id, top_left, bottom_right }, Lines::Rows) if here(sheet_id) => {
                        ends(&mut top_left.r, &mut bottom_right.r)
                    }
                    (Reference::Range { sheet_id, top_left, bottom_right }, Lines::Columns) if here(sheet_id) => {
                        ends(&mut top_left.c, &mut bottom_right.c)
                    }
                    (Reference::Rows { sheet_id, top, bottom, .. }, Lines::Rows) if here(sheet_id) => {
                        ends(&mut top.r, &mut bottom.r)
                    }
                    (Reference::Rows { sheet_id, left: Some(left), .. }, Lines::Columns) if here(sheet_id) => {
                        to_the_end(&mut left.c)
                    }
                    (Reference::Columns { sheet_id, left, right, .. }, Lines::Columns) if here(sheet_id) => {
                        ends(&mut left.c, &mut right.c)
                    }
                    (Reference::Columns { sheet_id, top: Some(top), .. }, Lines::Rows) if here(sheet_id) => {
                        to_the_end(&mut top.r)
                    }
                    _ => false,
                };
            }
            if changed {
                let input = Some(Input::Formula { formula });
                cells.push(CellToSet { r: bases.text(r), c: bases.text(c), input });
            }
        }
        if !cells.is_empty() {
            cells.sort_by(|x, y| (&x.r, &x.c).cmp(&(&y.r, &y.c)));
            ops.push(Op::SetCells { sheet_id: other.id.clone(), cells, form: CellForm::Auto });
        }
    }
    ops
}

/// The formats of new lines: the ones of the line given (in the lines across not deleted). New lines right next to
/// it leave out its border on their side: right after it (`after` being it), the one before them; right before it
/// (after the line before it, or first of all, with no line left between), the one after them. A cell keeps that
/// border, though, when a line next to the one given (before or after it, deleted lines passed over) has the same
/// border in that cell: the border runs on over the lines, and the new ones are in it. New columns leave out what a
/// cell does when clicked (a dropdown, a checkbox): it goes down a column, not across.
pub fn formats_of_new(
    workbook: &Workbook,
    sheet: &Sheet,
    lines: Lines,
    from: LineId,
    after: Option<LineId>,
    new: &IdRun,
) -> Option<Op> {
    let mut bases = workbook.bases.clone();
    let first = LineId { base: bases.intern(&new.base), n: new.first };
    let axis = lines.axis(sheet);
    let across = lines.other().axis(sheet);
    let at = axis.position(from);
    let is_before = match after {
        None => at == Some(0),
        Some(after) => axis.position(after).is_some_and(|p| Some(p + 1) == at),
    };
    let border = match (lines, after == Some(from), is_before) {
        (Lines::Rows, true, _) => Some(Leaf::BorderTop),
        (Lines::Rows, _, true) => Some(Leaf::BorderBottom),
        (Lines::Columns, true, _) => Some(Leaf::BorderLeft),
        (Lines::Columns, _, true) => Some(Leaf::BorderRight),
        _ => None,
    };
    let neighbours: Vec<LineId> = match at {
        Some(p) => [p.checked_sub(1), Some(p + 1)].into_iter().flatten().filter_map(|p| axis.line(p)).collect(),
        None => Vec::new(),
    };
    // The cell across a line: (row, column).
    let cell = |line: LineId, across: LineId| match lines {
        Lines::Rows => (line, across),
        Lines::Columns => (across, line),
    };
    let is_left_out = |leaf: Leaf, (r, c): (LineId, LineId), v: &serde_json::Value| {
        let across = if lines == Lines::Rows { c } else { r };
        let runs_on = || neighbours.iter().any(|&n| sheet.formats.value(leaf, cell(n, across)) == *v);
        (Some(leaf) == border && !runs_on()) || (lines == Lines::Columns && leaf == Leaf::CellControl)
    };
    let cells = sheet.formats.iter().filter(|&(leaf, at, v)| !is_left_out(leaf, at, v)).filter_map(|(leaf, (r, c), v)| {
        match lines {
            Lines::Rows => (r == from && across.contains(c)).then_some((leaf, (first, c), v)),
            Lines::Columns => (c == from && across.contains(r)).then_some((leaf, (r, first), v)),
        }
    });
    let formats: Vec<CellsToFormat> = blocks(&bases, cells)
        .into_iter()
        .map(|(mut rows, mut columns, format)| {
            // Every new line is formatted alike: the one measured stands for all of them.
            let runs = match lines {
                Lines::Rows => &mut rows,
                Lines::Columns => &mut columns,
            };
            *runs = vec![new.clone()];
            CellsToFormat { rows, columns, format }
        })
        .collect();
    (!formats.is_empty()).then(|| Op::SetCellFormats { sheet_id: sheet.id.clone(), formats })
}

/// What new rows' cells hold when the formats of the row given give them a checkbox: `false` where the row given holds
/// a boolean (`true` too), but in the cells of a merged range other than its top left. In order of the rows, then of
/// the columns. `formatted`: the workbook with the rows inserted and their formats set (new columns take no checkbox).
pub fn checkboxes_of_new(sheet: &Sheet, from: LineId, formatted: &Workbook, new: &IdRun) -> Option<Op> {
    let after = &formatted.sheets[formatted.sheet_index(&sheet.id)?];
    let base = formatted.bases.find(&new.base)?;
    let boxes = crate::workbook::layout::merged_boxes(&formatted.bases, after);
    let is_covered =
        |(r, c): (usize, usize)| boxes.iter().any(|&(t, b, l, rr)| (t..=b).contains(&r) && (l..=rr).contains(&c) && (r, c) != (t, l));
    let mut columns: Vec<(usize, LineId)> = sheet
        .formats
        .iter()
        .filter(|&(leaf, (r, _), v)| leaf == Leaf::CellControl && r == from && v["kind"] == "checkbox")
        .filter(|&(_, (_, c), _)| matches!(sheet.cells.get(&(from, c)).map(|cell| &cell.input), Some(Input::Boolean { .. })))
        .filter_map(|(_, (_, c), _)| Some((after.columns.position(c)?, c)))
        .collect();
    columns.sort_unstable_by_key(|&(p, _)| p);
    let mut cells = Vec::new();
    for n in new.first..new.first.saturating_add(new.count) {
        let r = LineId { base, n };
        let Some(row) = after.rows.position(r) else { continue };
        for &(column, c) in &columns {
            if !is_covered((row, column)) {
                let (r, c) = (formatted.bases.text(r), formatted.bases.text(c));
                cells.push(CellToSet { r, c, input: Some(Input::Boolean { value: false }) });
            }
        }
    }
    (!cells.is_empty()).then(|| Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto })
}

/// The groups that take in new lines: one that ends with the line given, when they go right after it, or starts
/// with it, when they go right before it (its ends taken as written, the first maybe after the last).
pub fn groups_of_new(
    workbook: &Workbook,
    sheet: &Sheet,
    lines: Lines,
    from: LineId,
    after: Option<LineId>,
    new: &IdRun,
) -> Option<Op> {
    let bases = &workbook.bases;
    let axis = lines.axis(sheet);
    let at = axis.position(from)?;
    // Right before it: after the line before it (or first of all), with no line between.
    let is_before = match after {
        None => at == 0,
        Some(after) => axis.position(after).is_some_and(|p| p + 1 == at) || after_is_just_before(axis, after, from),
    };
    let first_new = format!("{}.{}", new.base, new.first);
    let last_new = format!("{}.{}", new.base, new.first + new.count - 1);
    let mut groups = Vec::new();
    // Every group with lines left, shown or not (one crossing another too), in the order of their ids.
    for (group_id, group) in lines.groups(sheet).values() {
        let (Some(first), Some(last)) = (bases.parse(&group.ends.first), bases.parse(&group.ends.last)) else {
            continue;
        };
        // Its ends as written: one written last line first takes in new lines after its first, or before its last.
        let (Some(f), Some(l)) = (axis.snap_toward(first, last), axis.snap_toward(last, first)) else { continue };
        let ends = EndsOfGroup { first: bases.text(axis.line(f)?), last: bases.text(axis.line(l)?) };
        let (mut ends, mut changed) = (ends, false);
        if l == at && after == Some(from) {
            ends.last = last_new.clone();
            changed = true;
        }
        if f == at && is_before {
            ends.first = first_new.clone();
            changed = true;
        }
        if changed {
            groups.push(ends_written(group_id, ends));
        }
    }
    (!groups.is_empty()).then(|| lines.set_groups(&sheet.id, groups))
}

/// The ranges of conditional formats that take in new lines: a range of more than one line that ends with the line
/// given, when they go right after it, or starts with it, when they go right before it (after the line before it,
/// not deleted, or first of all). The end written there becomes the last new line, or the first, and its other end
/// the line it reaches now (when the one written is deleted); the other ranges are left as they are written.
pub fn conditional_formats_of_new(
    workbook: &Workbook,
    sheet: &Sheet,
    lines: Lines,
    from: LineId,
    after: Option<LineId>,
    new: &IdRun,
) -> Option<Op> {
    let bases = &workbook.bases;
    let axis = lines.axis(sheet);
    let at = axis.position(from)?;
    let is_before = match after {
        None => at == 0,
        Some(after) => axis.position(after).is_some_and(|p| p + 1 == at),
    };
    let first_new = format!("{}.{}", new.base, new.first);
    let last_new = format!("{}.{}", new.base, new.first + new.count - 1);
    // A range taking in the new lines, as it is to be written.
    let taking = |range: &RangeIds| -> Option<RangeIds> {
        let ((a, b), (c, d)) = ends_of(range, lines);
        let (a_line, b_line) = (bases.parse(a)?, bases.parse(b)?);
        let (p, q) = (axis.snap_toward(a_line, b_line)?, axis.snap_toward(b_line, a_line)?);
        if p == q {
            return None;
        }
        let (mut a, mut b) = (a.to_owned(), b.to_owned());
        let (first, last) = if p < q { (&mut a, &mut b) } else { (&mut b, &mut a) };
        let live = |p: usize| axis.line(p).map(|l| bases.text(l));
        if p.max(q) == at && after == Some(from) {
            *last = last_new.clone();
            *first = live(p.min(q))?;
        } else if p.min(q) == at && is_before {
            *first = first_new.clone();
            *last = live(p.max(q))?;
        } else {
            return None;
        }
        Some(range_of(lines, (a, b), (c.to_owned(), d.to_owned())))
    };
    let mut formats = Vec::new();
    for (format_id, f) in sheet.conditional_formats.values() {
        if !f.ranges.iter().any(|range| taking(range).is_some()) {
            continue;
        }
        let ranges = f.ranges.iter().map(|range| taking(range).unwrap_or_else(|| range.clone()));
        let conditional_format = Some(ranges_written(ranges.collect()));
        formats.push(ConditionalFormatToSet { conditional_format_id: format_id.clone(), conditional_format });
    }
    let sheet_id = sheet.id.clone();
    (!formats.is_empty()).then(|| Op::SetConditionalFormats { sheet_id, conditional_formats: formats })
}

/// Whether `after`, deleted, is right before `line`: no line between them that is not deleted.
fn after_is_just_before(axis: &Axis, after: LineId, line: LineId) -> bool {
    !axis.contains(after) && axis.snap_forward(after) == axis.position(line)
}

/// A formula's references moved down `by` rows of its own sheet (up, when negative): ones to other sheets, or
/// fixed, stay. `None` when a reference would leave the sheet, or is to another sheet's rows that are not fixed.
fn moved_down(workbook: &Workbook, sheet: &Sheet, axis: &Axis, formula: &StoredFormula, by: isize)
    -> Option<StoredFormula> {
    let bases = &workbook.bases;
    let row = |r: &str, is_absolute: bool, sheet_id: &str| -> Option<String> {
        if is_absolute {
            return Some(r.to_owned());
        }
        if sheet_id != sheet.id {
            return None;
        }
        let p = axis.position(bases.parse(r)?)? as isize + by;
        Some(bases.text(axis.line(usize::try_from(p).ok()?)?))
    };
    let references = formula
        .references
        .iter()
        .map(|reference| {
            let mut reference = reference.clone();
            match &mut reference {
                Reference::Cell { sheet_id, cell } => cell.r = row(&cell.r, cell.is_row_absolute, sheet_id)?,
                Reference::Range { sheet_id, top_left, bottom_right } => {
                    top_left.r = row(&top_left.r, top_left.is_row_absolute, sheet_id)?;
                    bottom_right.r = row(&bottom_right.r, bottom_right.is_row_absolute, sheet_id)?;
                }
                Reference::Columns { sheet_id, top, .. } => {
                    if let Some(top) = top {
                        top.r = row(&top.r, top.is_row_absolute, sheet_id)?;
                    }
                }
                Reference::Rows { sheet_id, top, bottom, .. } => {
                    top.r = row(&top.r, top.is_row_absolute, sheet_id)?;
                    bottom.r = row(&bottom.r, bottom.is_row_absolute, sheet_id)?;
                }
            }
            Some(reference)
        })
        .collect::<Option<Vec<Reference>>>()?;
    Some(StoredFormula { text_between_references: formula.text_between_references.clone(), references })
}

/// Whether the rows a formula points at by where it is (not fixed), in its own sheet, are all its own.
fn points_at_own_row(bases: &Bases, sheet: &Sheet, formula: &StoredFormula, row: LineId) -> bool {
    let own = |r: &str, is_absolute: bool, sheet_id: &str| {
        is_absolute || sheet_id != sheet.id || bases.parse(r) == Some(row)
    };
    formula.references.iter().all(|reference| match reference {
        Reference::Cell { sheet_id, cell } => own(&cell.r, cell.is_row_absolute, sheet_id),
        Reference::Range { sheet_id, top_left, bottom_right } => {
            own(&top_left.r, top_left.is_row_absolute, sheet_id)
                && own(&bottom_right.r, bottom_right.is_row_absolute, sheet_id)
        }
        Reference::Columns { sheet_id, top, .. } => {
            top.as_ref().is_none_or(|top| own(&top.r, top.is_row_absolute, sheet_id))
        }
        Reference::Rows { sheet_id, top, bottom, .. } => {
            own(&top.r, top.is_row_absolute, sheet_id) && own(&bottom.r, bottom.is_row_absolute, sheet_id)
        }
    })
}

/// The formulas of new rows: each of the row given that points at no other row of its sheet by where it is, and
/// that the row beside it (above or below) has too, moved to the row it is in. `after_insert`: the workbook with the
/// rows inserted.
pub fn formulas_of_new(workbook: &Workbook, sheet: &Sheet, from: LineId, after_insert: &Workbook, new: &IdRun)
    -> Option<Op> {
    let at = sheet.rows.position(from)?;
    let formula_at = |p: usize, c: LineId| match sheet.rows.line(p).and_then(|r| sheet.cells.get(&(r, c))) {
        Some(cell) => match &cell.input {
            Input::Formula { formula } => Some(formula),
            _ => None,
        },
        None => None,
    };
    let inserted = &after_insert.sheets[after_insert.sheet_index(&sheet.id)?];
    let base = after_insert.bases.find(&new.base)?;
    let from_after = inserted.rows.position(from)? as isize;
    let new_rows: Vec<(LineId, isize)> = (new.first..new.first + new.count)
        .filter_map(|n| {
            let line = LineId { base, n };
            Some((line, inserted.rows.position(line)? as isize - from_after))
        })
        .collect();
    let mut columns: Vec<(usize, LineId, Vec<StoredFormula>)> = Vec::new();
    for (&(r, c), cell) in &sheet.cells {
        let Input::Formula { formula } = &cell.input else { continue };
        let (true, Some(position)) = (r == from, sheet.columns.position(c)) else { continue };
        if !points_at_own_row(&workbook.bases, sheet, formula, from) {
            continue;
        }
        let beside = [at.checked_sub(1).map(|p| (p, -1)), Some((at + 1, 1))];
        let is_filled = beside.iter().flatten().any(|&(p, by)| {
            let moved = moved_down(workbook, sheet, &sheet.rows, formula, by);
            formula_at(p, c).is_some_and(|other| moved.as_ref() == Some(other))
        });
        if !is_filled {
            continue;
        }
        let formulas: Option<Vec<StoredFormula>> =
            new_rows.iter().map(|&(_, by)| moved_down(after_insert, inserted, &inserted.rows, formula, by)).collect();
        if let Some(formulas) = formulas {
            columns.push((position, c, formulas));
        }
    }
    columns.sort_by_key(|(p, ..)| *p);
    let bases = &after_insert.bases;
    let cells: Vec<CellToSet> = new_rows
        .iter()
        .enumerate()
        .flat_map(|(i, &(row, _))| {
            columns.iter().map(move |(_, c, formulas)| CellToSet {
                r: bases.text(row),
                c: bases.text(*c),
                input: Some(Input::Formula { formula: formulas[i].clone() }),
            })
        })
        .collect();
    (!cells.is_empty()).then(|| Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto })
}
