//! History: edits taken back and made again.
//!
//! - On a direct session (the server's), `undo {ops, reverse}` takes back operations applied earlier, when what they
//!   did is still so (`changedSince` otherwise), and `replay {edit}` applies a recorded edit again. The server's
//!   reads of the history (`editsThatTakeBackAllSince`, `editsThatUndo`, `historyOfACell`, `historyOfARow`) are in
//!   `history_reads`.
//! - In step with the server, each of the page's own edits is a step it can take back (`queueNextUndo`) and make
//!   again (`queueNextRedo`), and so are the edits that take others back (`queueEditsThatTakeBack`, one step). The
//!   page keeps 100 steps of each. A step taken back is queued as edits of their own under the request's op id (one
//!   edit: the op id; more: `<opId>.0`, `.1`, … with the op id as their action), the reverses of the step's edits,
//!   last first; the step made again is those edits, and taking it back takes them back in turn. A new edit empties
//!   what can be made again.
//! - A step is taken back on the workbook shown, whatever others changed since, when what each of its edits did is
//!   still so (`edit_holds`) and the reverse applies; otherwise it is given up (`stepGivenUp`: `changedSince`,
//!   `sheetNameTaken`, `noSheetLeft`, …) and left out of the history. An edit of it sent and no longer applying is
//!   not taken back yet (`stepToReverseNotMadeHere`); one confirmed though it did not apply is never
//!   (`reverseOfStepNeverKnown`, given up even while a load is due).
//! - What an edit did is looked at for all its operations before anything is taken back. An operation need only hold
//!   for what a later one of the edit did not set again (cells, names, settings, sizes, formats, groups, dropdowns,
//!   tables, views: each by what it sets; lines inserted may hold the cells, formats, sizes, groups and conditional
//!   formats later ones put there), and what a later one deleted (a sheet, rows, columns) is looked at as it was then.
//!   Taking back is refused (`changedSince`) when its reverse would leave lines in the way of others or a group
//!   nested too deep.
//! - An edit the server refuses, or one dropped because it no longer applies, empties the history; a load does not.
//! - An op id is in use while an edit of the queue or of the history has it (or it is the action of a queued one).

use std::borrow::Cow;
use hashbrown::HashSet;

use serde_json::{json, Value as Json};

use super::new_ids;
use crate::ids::{IdRun, LineId};
use crate::workbook::load::{CellToSet, Op, Refusal, SheetName};
use crate::workbook::layout::{CellIds, RangeIds, SheetSettings, SheetToSet};
use crate::workbook::{objects, version, Workbook};

/// How many steps the page can take back.
const STEPS_KEPT: usize = 100;

/// Whether what an operation set is still so in the workbook: setting it again would change nothing. A sheet
/// inserted keeps the name it was given; rows and columns inserted hold nothing. What deletes, undeletes or moves
/// sheets, rows and columns sets nothing to check: its reverse applies or it does not.
pub fn holds(workbook: &Workbook, op: &Op) -> bool {
    match op {
        Op::InsertSheet { sheet_id, name, .. } => {
            workbook.sheet_index(sheet_id).is_none_or(|i| workbook.sheets[i].name == *name)
        }
        // Rows or columns inserted hold nothing yet, and nothing is tied to them: taking them back loses nothing.
        Op::InsertRows { sheet_id, rows: run, .. } => holds_nothing(workbook, sheet_id, run, true),
        Op::InsertColumns { sheet_id, columns: run, .. } => holds_nothing(workbook, sheet_id, run, false),
        Op::DeleteSheet { .. }
        | Op::UndeleteSheet { .. }
        | Op::DeleteRows { .. }
        | Op::DeleteColumns { .. }
        | Op::UndeleteRows { .. }
        | Op::UndeleteColumns { .. } => true,
        // The browser's zone adopted is not told from one set since: taking it back sets the zone as it was.
        Op::AdoptTimeZone { .. } => true,
        // What is moved is where the move put it: right after what it was put after, deleted ones aside.
        Op::MoveSheets { moves } => {
            let deleted = |id: &String| workbook.sheet_index(id).is_none();
            workbook.clone().apply(std::slice::from_ref(op)).is_ok()
                && moves.iter().all(|m| in_place(&workbook.sheet_order, deleted, &m.sheet_ids, m.after.as_ref()))
        }
        Op::MoveRows { sheet_id, .. } | Op::MoveColumns { sheet_id, .. } => {
            let Some(i) = workbook.sheet_index(sheet_id) else { return false };
            let (sheet, bases) = (&workbook.sheets[i], &workbook.bases);
            let moves: Vec<(&Vec<IdRun>, &Option<String>)> = match op {
                Op::MoveRows { moves, .. } => moves.iter().map(|m| (&m.rows, &m.after)).collect(),
                Op::MoveColumns { moves, .. } => moves.iter().map(|m| (&m.columns, &m.after)).collect(),
                _ => unreachable!(),
            };
            let axis = if matches!(op, Op::MoveRows { .. }) { &sheet.rows } else { &sheet.columns };
            let lines = |runs: &Vec<IdRun>| -> Option<Vec<LineId>> {
                runs.iter()
                    .flat_map(|run| (0..run.count).map(move |k| (run, run.first + k)))
                    .map(|(run, n)| Some(LineId { base: bases.find(&run.base)?, n }))
                    .collect()
            };
            workbook.clone().apply(std::slice::from_ref(op)).is_ok()
                && moves.iter().all(|(runs, after)| {
                    let after = match after { Some(a) => bases.parse(a), None => None };
                    lines(runs).is_some_and(|moved| {
                        in_place(axis.every(), |&l| axis.is_deleted(l), &moved, after.as_ref())
                    })
                })
        }
        // The rows are in the order it put them in.
        Op::ReorderRows { sheet_id, rows, .. } => {
            let Some(i) = workbook.sheet_index(sheet_id) else { return false };
            let axis = &workbook.sheets[i].rows;
            let lines: Option<Vec<LineId>> = rows
                .ids
                .iter()
                .flat_map(|b| b.runs.iter().flat_map(move |&(f, c)| (f..f.saturating_add(c)).map(move |n| (b, n))))
                .map(|(b, n)| Some(LineId { base: workbook.bases.find(&b.base)?, n }))
                .collect();
            let Some(lines) = lines.filter(|l| l.iter().all(|&r| axis.contains(r))) else { return false };
            let mut in_order = lines.clone();
            in_order.sort_by_key(|&l| axis.position(l));
            let index: hashbrown::HashMap<LineId, usize> = lines.iter().enumerate().map(|(k, &l)| (l, k)).collect();
            let order: Vec<usize> = in_order.iter().map(|l| index[l]).collect();
            crate::workbook::reorder::encode(&order) == rows.order
        }
        Op::MergeCells { sheet_id, ranges } | Op::UnmergeCells { sheet_id, ranges } => {
            let merges = matches!(op, Op::MergeCells { .. });
            workbook
                .sheet_index(sheet_id)
                .is_some_and(|i| ranges.iter().all(|r| workbook.sheets[i].merged_ranges.contains(r) == merges))
        }
        // Settings as they are kept, a frozen line since deleted included.
        Op::SetSheetSettings { sheets } => sheets.iter().all(|set| {
            let Some(i) = workbook.sheet_index(&set.sheet_id) else { return false };
            let (sheet, text) = (&workbook.sheets[i], |l: Option<LineId>| l.map(|l| workbook.bases.text(l)));
            let kept = |l, given: &Option<Option<String>>| given.as_ref().is_none_or(|g| *g == text(l));
            let s = &set.settings;
            kept(sheet.last_frozen_row, &s.last_frozen_row)
                && kept(sheet.last_frozen_column, &s.last_frozen_column)
                && s.are_gridlines_hidden.is_none_or(|h| h == sheet.are_gridlines_hidden)
                && s.interactive.as_ref().is_none_or(|view| *view == sheet.interactive)
        }),
        // A table not shown (its footer not under its header) is not there to take back.
        Op::SetCellTables { sheet_id, cell_tables } => {
            sets_nothing_new(workbook, op)
                && workbook.sheet_index(sheet_id).is_some_and(|i| {
                    let sheet = &workbook.sheets[i];
                    cell_tables
                        .iter()
                        .filter_map(|c| c.cell_table.as_ref())
                        .all(|t| objects::shown_cell_table(&workbook.bases, sheet, t).is_some())
                })
        }
        op => sets_nothing_new(workbook, op),
    }
}

/// Whether what an edit did is still so: each of its operations holds, all looked at before any is taken back, but
/// for what a later one of the edit sets again (that one tells): cells set again, a sheet named again, a sheet's
/// setting set again, the zone, the locale or the seed set again, a range merged or unmerged again, and sheets moved
/// before sheets are moved again (any of them), a sheet's rows or columns before its rows or columns are. Rows or
/// columns inserted may hold the cells a later operation sets. What a later operation deletes (a sheet, rows or
/// columns) is looked at as it was then: deleted, it keeps what it held and its place.
pub fn edit_holds(workbook: &Workbook, ops: &[Op]) -> bool {
    let mut restored: Option<(Vec<usize>, Workbook)> = None;
    ops.iter().enumerate().all(|(i, op)| {
        let later = &ops[i + 1..];
        let deletes: Vec<usize> = (i + 1..ops.len()).filter(|&j| undeleting(&ops[j]).is_some()).collect();
        let workbook = if deletes.is_empty() {
            workbook
        } else {
            if restored.as_ref().is_none_or(|(at, _)| *at != deletes) {
                // Undeleted, last first; what is not deleted now (undeleted since) stays as it is.
                let mut back = workbook.clone();
                for undelete in deletes.iter().rev().filter_map(|&j| undeleting(&ops[j])) {
                    let _ = back.apply(&[undelete]);
                }
                restored = Some((deletes, back));
            }
            &restored.as_ref().expect("just restored").1
        };
        match op {
            Op::InsertRows { sheet_id, .. } | Op::InsertColumns { sheet_id, .. } => {
                match set_later_left_out(workbook, sheet_id, later) {
                    Some(without) => holds(&without, op),
                    None => holds(workbook, op),
                }
            }
            _ if sets_alike(op, op) => {
                let again: Vec<Op> = later.iter().filter(|l| sets_alike(op, l)).cloned().collect();
                if again.is_empty() { holds(workbook, op) } else { holds_but_for(workbook, op, &again) }
            }
            _ => left_to_hold(workbook, op, later).is_none_or(|left| holds(workbook, &left)),
        }
    })
}

/// A sheet with what later operations of an edit set on it left out: the cells they set, the formats and sizes,
/// and the groups and conditional formats they name (none when they set nothing there). Lines inserted may hold
/// those: the edit put them there.
fn set_later_left_out(workbook: &Workbook, sheet_id: &str, later: &[Op]) -> Option<Workbook> {
    let on_sheet: Vec<&Op> = later.iter().filter(|op| op_sheet(op) == Some(sheet_id)).collect();
    if on_sheet.is_empty() {
        return None;
    }
    let cells = cells_set(workbook, sheet_id, later);
    let mut without = workbook.clone();
    let i = without.sheet_index(sheet_id)?;
    let (bases, sheet) = (&workbook.bases, &mut without.sheets[i]);
    let lines = |run: &IdRun| -> Vec<LineId> {
        let Some(base) = bases.find(&run.base) else { return vec![] };
        (run.first..run.first.saturating_add(run.count)).map(|n| LineId { base, n }).collect()
    };
    sheet.cells.retain(|cell, _| !cells.contains(cell));
    for op in on_sheet {
        match op {
            Op::SetCellFormats { formats, .. } => {
                for f in formats {
                    let leaves = crate::workbook::formats::read_format(&f.format).unwrap_or_default();
                    let rows: Vec<LineId> = f.rows.iter().flat_map(|r| lines(r)).collect();
                    for c in f.columns.iter().flat_map(|c| lines(c)) {
                        for &r in &rows {
                            for (leaf, _) in &leaves {
                                sheet.formats.set(*leaf, (r, c), leaf.default_value());
                            }
                        }
                    }
                }
            }
            Op::SetColumnWidths { widths, .. } => {
                widths.iter().flat_map(|w| lines(&w.columns)).for_each(|l| _ = sheet.column_widths.remove(&l));
            }
            Op::SetRowHeights { heights, .. } => {
                heights.iter().flat_map(|h| lines(&h.rows)).for_each(|l| _ = sheet.row_heights.remove(&l));
            }
            Op::SetRowGroups { groups, .. } => {
                sheet.row_groups.retain(|_, (id, _)| !groups.iter().any(|g| g.group_id == *id));
            }
            Op::SetColumnGroups { groups, .. } => {
                sheet.column_groups.retain(|_, (id, _)| !groups.iter().any(|g| g.group_id == *id));
            }
            Op::SetConditionalFormats { conditional_formats: set, .. } => {
                sheet.conditional_formats.retain(|_, (id, _)| !set.iter().any(|f| f.conditional_format_id == *id));
            }
            _ => {}
        }
    }
    Some(without)
}

/// The sheet an operation on a sheet's cells or lines works on.
fn op_sheet(op: &Op) -> Option<&str> {
    match op {
        Op::SetCells { sheet_id, .. }
        | Op::SetCellFormats { sheet_id, .. }
        | Op::SetColumnWidths { sheet_id, .. }
        | Op::SetRowHeights { sheet_id, .. }
        | Op::SetRowGroups { sheet_id, .. }
        | Op::SetColumnGroups { sheet_id, .. }
        | Op::SetConditionalFormats { sheet_id, .. } => Some(sheet_id),
        _ => None,
    }
}

/// The operation undeleting what an operation deletes (a sheet, rows or columns).
fn undeleting(op: &Op) -> Option<Op> {
    match op {
        Op::DeleteSheet { sheet_id } => Some(Op::UndeleteSheet { sheet_id: sheet_id.clone() }),
        Op::DeleteRows { sheet_id, rows } => Some(Op::UndeleteRows { sheet_id: sheet_id.clone(), rows: rows.clone() }),
        Op::DeleteColumns { sheet_id, columns } => {
            Some(Op::UndeleteColumns { sheet_id: sheet_id.clone(), columns: columns.clone() })
        }
        _ => None,
    }
}

/// Whether two operations set things of a kind that one can set again over the other: formats, sizes, groups,
/// dropdowns, conditional formats, placements or cell tables of the same sheet, or views.
fn sets_alike(op: &Op, other: &Op) -> bool {
    let sheet = |op: &Op| match op {
        Op::SetCellFormats { sheet_id, .. }
        | Op::SetColumnWidths { sheet_id, .. }
        | Op::SetRowHeights { sheet_id, .. }
        | Op::SetRowGroups { sheet_id, .. }
        | Op::SetColumnGroups { sheet_id, .. }
        | Op::SetDropdowns { sheet_id, .. }
        | Op::SetConditionalFormats { sheet_id, .. }
        | Op::SetPlacements { sheet_id, .. }
        | Op::SetNamedViews { sheet_id, .. }
        | Op::SetCellTables { sheet_id, .. } => Some(Some(sheet_id.clone())),
        Op::SetViews { .. } => Some(None),
        _ => None,
    };
    std::mem::discriminant(op) == std::mem::discriminant(other) && sheet(op).is_some() && sheet(op) == sheet(other)
}

/// Whether what an operation set is still so but for what later operations of its edit set again (`again`, setting
/// things of its kind): setting it and then them changes nothing they alone do not. A cell table it sets and they do
/// not must still be shown.
fn holds_but_for(workbook: &Workbook, op: &Op, again: &[Op]) -> bool {
    let (mut alone, mut with) = (workbook.clone(), workbook.clone());
    if with.apply(std::slice::from_ref(op)).is_err() {
        return false;
    }
    if alone.apply(again).is_err() || with.apply(again).is_err() {
        return holds(workbook, op);
    }
    let shown = match op {
        Op::SetCellTables { sheet_id, cell_tables } => {
            let set_again = |id: &String| {
                again.iter().any(|l| match l {
                    Op::SetCellTables { cell_tables, .. } => cell_tables.iter().any(|c| c.cell_table_id == *id),
                    _ => false,
                })
            };
            workbook.sheet_index(sheet_id).is_some_and(|i| {
                let sheet = &workbook.sheets[i];
                cell_tables
                    .iter()
                    .filter(|c| !set_again(&c.cell_table_id))
                    .filter_map(|c| c.cell_table.as_ref())
                    .all(|t| objects::shown_cell_table(&workbook.bases, sheet, t).is_some())
            })
        }
        _ => true,
    };
    shown && same_set(op, &alone, &with)
}

/// The cells of a sheet that operations set.
fn cells_set(workbook: &Workbook, sheet_id: &str, ops: &[Op]) -> HashSet<(LineId, LineId)> {
    let bases = &workbook.bases;
    ops.iter()
        .filter_map(|op| match op {
            Op::SetCells { sheet_id: s, cells, .. } if s == sheet_id => Some(cells),
            _ => None,
        })
        .flatten()
        .filter_map(|cell| Some((bases.parse(&cell.r)?, bases.parse(&cell.c)?)))
        .collect()
}

/// What of an operation must still hold, once what later operations of its edit set again is left out (none: all
/// of it is set again).
fn left_to_hold<'a>(workbook: &Workbook, op: &'a Op, later: &[Op]) -> Option<Cow<'a, Op>> {
    let any_later = |is: &dyn Fn(&Op) -> bool| later.iter().any(is);
    let kept = || Some(Cow::Borrowed(op));
    match op {
        Op::SetCells { sheet_id, cells, form } => {
            let again = cells_set(workbook, sheet_id, later);
            let at = |cell: &CellToSet| Some((workbook.bases.parse(&cell.r)?, workbook.bases.parse(&cell.c)?));
            let left: Vec<CellToSet> =
                cells.iter().filter(|cell| at(cell).is_none_or(|at| !again.contains(&at))).cloned().collect();
            match left.len() {
                0 => None,
                n if n == cells.len() => kept(),
                _ => Some(Cow::Owned(Op::SetCells { sheet_id: sheet_id.clone(), cells: left, form: *form })),
            }
        }
        Op::MoveSheets { .. } if any_later(&|l| matches!(l, Op::MoveSheets { .. })) => None,
        Op::MoveRows { sheet_id, .. }
            if any_later(&|l| matches!(l, Op::MoveRows { sheet_id: s, .. } if s == sheet_id)) =>
        {
            None
        }
        Op::ReorderRows { sheet_id, .. }
            if any_later(&|l| matches!(l, Op::ReorderRows { sheet_id: s, .. } if s == sheet_id)) =>
        {
            None
        }
        Op::MoveColumns { sheet_id, .. }
            if any_later(&|l| matches!(l, Op::MoveColumns { sheet_id: s, .. } if s == sheet_id)) =>
        {
            None
        }
        Op::SetTimeZone { .. } | Op::SetLocale { .. } | Op::Reseed { .. }
            if any_later(&|l| std::mem::discriminant(l) == std::mem::discriminant(op)) =>
        {
            None
        }
        Op::SetSheetNames { names } => {
            let named_later = |n: &&SheetName| {
                any_later(&|l| match l {
                    Op::SetSheetNames { names } => names.iter().any(|m| m.sheet_id == n.sheet_id),
                    _ => false,
                })
            };
            let left: Vec<SheetName> = names.iter().filter(|n| !named_later(n)).cloned().collect();
            (!left.is_empty()).then(|| Cow::Owned(Op::SetSheetNames { names: left }))
        }
        Op::SetSheetSettings { sheets } => {
            let set_later = |sheet_id: &String, given: fn(&SheetSettings) -> bool| {
                let sets = |s: &SheetToSet| s.sheet_id == *sheet_id && given(&s.settings);
                any_later(&|l| matches!(l, Op::SetSheetSettings { sheets } if sheets.iter().any(sets)))
            };
            let left = sheets
                .iter()
                .map(|set| {
                    let mut settings = set.settings.clone();
                    if set_later(&set.sheet_id, |s| s.last_frozen_row.is_some()) {
                        settings.last_frozen_row = None;
                    }
                    if set_later(&set.sheet_id, |s| s.last_frozen_column.is_some()) {
                        settings.last_frozen_column = None;
                    }
                    if set_later(&set.sheet_id, |s| s.are_gridlines_hidden.is_some()) {
                        settings.are_gridlines_hidden = None;
                    }
                    if set_later(&set.sheet_id, |s| s.interactive.is_some()) {
                        settings.interactive = None;
                    }
                    SheetToSet { sheet_id: set.sheet_id.clone(), settings }
                })
                .collect();
            Some(Cow::Owned(Op::SetSheetSettings { sheets: left }))
        }
        Op::MergeCells { sheet_id, ranges } | Op::UnmergeCells { sheet_id, ranges } => {
            let again = |range: &&RangeIds| {
                any_later(&|l| match l {
                    Op::MergeCells { sheet_id: s, ranges } | Op::UnmergeCells { sheet_id: s, ranges } => {
                        s == sheet_id && ranges.contains(range)
                    }
                    _ => false,
                })
            };
            let left: Vec<RangeIds> = ranges.iter().filter(|range| !again(range)).cloned().collect();
            let sheet_id = sheet_id.clone();
            match (left.len(), op) {
                (0, _) => None,
                (n, _) if n == ranges.len() => kept(),
                (_, Op::MergeCells { .. }) => Some(Cow::Owned(Op::MergeCells { sheet_id, ranges: left })),
                _ => Some(Cow::Owned(Op::UnmergeCells { sheet_id, ranges: left })),
            }
        }
        _ => kept(),
    }
}

/// Whether the rows (or columns) of a run hold nothing and nothing is tied to them: no cell, no cell format, no size,
/// and no merged range, group, frozen line, placement or conditional format that starts or ends on one of them (or,
/// for a column, whose tests read it). Tables, views and formulas that name them do not count: they only read there.
fn holds_nothing(workbook: &Workbook, sheet_id: &str, run: &IdRun, rows: bool) -> bool {
    let (Some(i), Some(base)) = (workbook.sheet_index(sheet_id), workbook.bases.find(&run.base)) else { return true };
    let (sheet, bases) = (&workbook.sheets[i], &workbook.bases);
    let of_run = |l: LineId| l.base == base && (run.first..run.first.saturating_add(run.count)).contains(&l.n);
    let named = |id: &str| bases.parse(id).is_some_and(of_run);
    let line = |cell: (LineId, LineId)| if rows { cell.0 } else { cell.1 };
    let at = |cell: &CellIds| named(if rows { &cell.r } else { &cell.c });
    let ends = |range: &RangeIds| at(&range.top_left) || at(&range.bottom_right);
    let (sizes, groups, frozen) = if rows {
        (&sheet.row_heights, &sheet.row_groups, sheet.last_frozen_row)
    } else {
        (&sheet.column_widths, &sheet.column_groups, sheet.last_frozen_column)
    };
    !(sheet.cells.keys().any(|&cell| of_run(line(cell)))
        || sheet.formats.iter().any(|(_, cell, _)| of_run(line(cell)))
        || sizes.keys().any(|&l| of_run(l))
        || frozen.is_some_and(of_run)
        || groups.values().any(|(_, g)| named(&g.ends.first) || named(&g.ends.last))
        || sheet.merged_ranges.iter().any(ends)
        || sheet.placements.values().any(|(_, p)| at(&p.top_left))
        || sheet.conditional_formats.values().any(|(_, f)| {
            f.ranges.iter().any(ends) || (!rows && f.effect.columns().into_iter().any(named))
        }))
}

/// Whether moving or deleting rows or columns (`op`) takes the last frozen one (moved anywhere, even where it is), or
/// deletes the end of a group, as they are kept: a group deleted whole included, a merged range or a table not.
fn takes_what_is_held(workbook: &Workbook, op: &Op) -> bool {
    let (sheet_id, runs, rows, deletes): (&String, Vec<&IdRun>, bool, bool) = match op {
        Op::DeleteRows { sheet_id, rows } => (sheet_id, rows.iter().collect(), true, true),
        Op::DeleteColumns { sheet_id, columns } => (sheet_id, columns.iter().collect(), false, true),
        Op::MoveRows { sheet_id, moves } => (sheet_id, moves.iter().flat_map(|m| &m.rows).collect(), true, false),
        Op::MoveColumns { sheet_id, moves } => {
            (sheet_id, moves.iter().flat_map(|m| &m.columns).collect(), false, false)
        }
        _ => return false,
    };
    let Some(i) = workbook.sheet_index(sheet_id) else { return false };
    let (sheet, bases) = (&workbook.sheets[i], &workbook.bases);
    let (frozen, groups) = match rows {
        true => (sheet.last_frozen_row, &sheet.row_groups),
        false => (sheet.last_frozen_column, &sheet.column_groups),
    };
    let named = |l: LineId| {
        runs.iter().any(|run| {
            bases.find(&run.base) == Some(l.base) && (run.first..run.first.saturating_add(run.count)).contains(&l.n)
        })
    };
    let ends = |g: &crate::workbook::layout::Group| [g.ends.first.clone(), g.ends.last.clone()];
    frozen.is_some_and(named)
        || deletes && groups.values().any(|(_, g)| ends(g).iter().any(|end| bases.parse(end).is_some_and(named)))
}

/// Whether moving rows or columns (`op`, which turned `before` into `after`) changed the lines of a merged range, or
/// of a group one of whose ends it moved: took some of them and not all, put others between them, or changed their
/// order. A move that leaves them as they were (an end moved where it already is, the whole group moved) is fine.
fn moved_what_is_held(before: &Workbook, after: &Workbook, op: &Op) -> bool {
    let (sheet_id, moved, rows): (&String, Vec<&IdRun>, bool) = match op {
        Op::MoveRows { sheet_id, moves } => (sheet_id, moves.iter().flat_map(|m| &m.rows).collect(), true),
        Op::MoveColumns { sheet_id, moves } => (sheet_id, moves.iter().flat_map(|m| &m.columns).collect(), false),
        _ => return false,
    };
    let (Some(i), Some(j)) = (before.sheet_index(sheet_id), after.sheet_index(sheet_id)) else { return false };
    let (was, now, bases) = (&before.sheets[i], &after.sheets[j], &before.bases);
    let (was_axis, now_axis) = if rows { (&was.rows, &now.rows) } else { (&was.columns, &now.columns) };
    // The lines of a range where it is now, from one end to the other.
    let between = |axis: &crate::ids::Axis, ends: (&String, &String)| -> Option<Vec<LineId>> {
        let (a, b) = (bases.parse(ends.0)?, bases.parse(ends.1)?);
        let (a, b) = (axis.snap_toward(a, b)?, axis.snap_toward(b, a)?);
        (a.min(b)..=a.max(b)).map(|p| axis.line(p)).collect()
    };
    let changed = |ends: (&String, &String)| between(was_axis, ends) != between(now_axis, ends);
    let moves = |id: &String| {
        bases.parse(id).is_some_and(|l| {
            moved.iter().any(|run| {
                bases.find(&run.base) == Some(l.base) && (run.first..run.first.saturating_add(run.count)).contains(&l.n)
            })
        })
    };
    let groups = if rows { &was.row_groups } else { &was.column_groups };
    groups.values().map(|(_, g)| (&g.ends.first, &g.ends.last)).any(|(a, b)| (moves(a) || moves(b)) && changed((a, b)))
        // A merged range all of whose rows or columns are deleted is not shown and holds nothing.
        || was.merged_ranges.iter().filter(|range| was.live_box(bases, range).is_some()).any(|range| match rows {
            true => changed((&range.top_left.r, &range.bottom_right.r)),
            false => changed((&range.top_left.c, &range.bottom_right.c)),
        })
}

/// Whether applying an operation again would change nothing: its reverse is itself, or what it sets is as it was. (A
/// reverse comes in a shape of its own: formats in other blocks, sizes in other runs, objects whole where the
/// operation set some of what they are.)
fn sets_nothing_new(workbook: &Workbook, op: &Op) -> bool {
    let mut again = workbook.clone();
    let Ok(reverse) = again.apply(std::slice::from_ref(op)) else { return false };
    serde_json::to_value(&reverse).ok() == serde_json::to_value(std::slice::from_ref(op)).ok()
        || same_set(op, workbook, &again)
}

/// Whether what an operation sets (formats, sizes, group ends or objects) is the same in two workbooks.
fn same_set(op: &Op, workbook: &Workbook, again: &Workbook) -> bool {
    let sheet_id = match op {
        Op::SetCellFormats { sheet_id, .. }
        | Op::SetColumnWidths { sheet_id, .. }
        | Op::SetRowHeights { sheet_id, .. }
        | Op::SetRowGroups { sheet_id, .. }
        | Op::SetColumnGroups { sheet_id, .. }
        | Op::SetDropdowns { sheet_id, .. }
        | Op::SetConditionalFormats { sheet_id, .. }
        | Op::SetPlacements { sheet_id, .. }
        | Op::SetNamedViews { sheet_id, .. }
        | Op::SetCellTables { sheet_id, .. } => sheet_id,
        Op::SetViews { .. } => return workbook.views == again.views,
        _ => return false,
    };
    let (Some(i), Some(j)) = (workbook.sheet_index(sheet_id), again.sheet_index(sheet_id)) else { return false };
    let (was, is) = (&workbook.sheets[i], &again.sheets[j]);
    match op {
        Op::SetCellFormats { .. } => {
            let formats = |sheet: &crate::workbook::Sheet| -> hashbrown::HashMap<_, _> {
                sheet.formats.iter().map(|(leaf, cell, value)| ((leaf, cell), value.clone())).collect()
            };
            formats(was) == formats(is)
        }
        Op::SetColumnWidths { .. } => was.column_widths == is.column_widths,
        Op::SetRowHeights { .. } => was.row_heights == is.row_heights,
        // A group collapsed or expanded since still holds: only its ends are looked at.
        Op::SetRowGroups { .. } | Op::SetColumnGroups { .. } => {
            let rows = matches!(op, Op::SetRowGroups { .. });
            let ends = |sheet: &crate::workbook::Sheet| -> Vec<_> {
                let groups = if rows { &sheet.row_groups } else { &sheet.column_groups };
                groups.iter().map(|(key, (_, group))| (key.clone(), group.ends.clone())).collect()
            };
            ends(was) == ends(is)
        }
        Op::SetDropdowns { .. } => was.dropdowns == is.dropdowns,
        Op::SetConditionalFormats { .. } => was.conditional_formats == is.conditional_formats,
        Op::SetPlacements { .. } => was.placements == is.placements,
        Op::SetNamedViews { .. } => was.named_views == is.named_views,
        _ => was.cell_tables == is.cell_tables,
    }
}

/// Whether items moved are where the move put them in `order`: one after the other, the first right after `after`
/// (first of all when none), with nothing between but items deleted.
fn in_place<T: PartialEq>(order: &[T], is_deleted: impl Fn(&T) -> bool, moved: &[T], after: Option<&T>) -> bool {
    let kept: Vec<&T> = order.iter().filter(|&x| !is_deleted(x) || Some(x) == after).collect();
    let start = match after {
        None => 0,
        Some(after) => match kept.iter().position(|&x| x == after) {
            Some(i) => i + 1,
            None => return false,
        },
    };
    moved.len() <= kept.len() - start && moved.iter().zip(&kept[start..]).all(|(m, &k)| m == k)
}

/// Whether the workbook has two sheets of one name, whatever its case.
fn has_names_twice(workbook: &Workbook) -> bool {
    let mut names = HashSet::new();
    !workbook.sheets.iter().all(|s| names.insert(s.name.to_lowercase()))
}

/// Why a step cannot be taken back.
#[derive(Debug)]
pub enum NotTaken {
    /// The reverse does not apply to the workbook: it is not one.
    NotAReverse,
    /// What the step did is no longer so.
    ChangedSince,
    /// Taking it back would give a sheet a name another sheet has: the sheet in the way.
    SheetNameTaken(Json),
}

impl NotTaken {
    pub fn refusal(&self) -> &'static str {
        match self {
            NotTaken::NotAReverse => "notAReverse",
            NotTaken::ChangedSince => "changedSince",
            NotTaken::SheetNameTaken(_) => "sheetNameTaken",
        }
    }
}

/// Whether a reverse takes back by moving or deleting lines that something was tied to since (the last frozen line, a
/// group's end, a merged range's lines). Each operation is looked at where the ones before it leave things: what it
/// takes before it is applied, what its moves changed after.
pub fn lines_in_the_way(workbook: &Workbook, reverse: &[Op]) -> bool {
    let moves_or_deletes = |op: &Op| {
        matches!(op, Op::MoveRows { .. } | Op::MoveColumns { .. } | Op::DeleteRows { .. } | Op::DeleteColumns { .. })
    };
    if !reverse.iter().any(moves_or_deletes) {
        return false;
    }
    let mut on_the_way = workbook.clone();
    for op in reverse {
        if takes_what_is_held(&on_the_way, op) {
            return true;
        }
        let before = on_the_way.clone();
        if on_the_way.apply(std::slice::from_ref(op)).is_err() {
            return false;
        }
        if moved_what_is_held(&before, &on_the_way, op) {
            return true;
        }
    }
    false
}

/// How deep groups nest at most.
const GROUP_DEPTH: usize = 7;

/// Whether a sheet's groups on one axis nest: each in order (its first line not after its last), none on the same
/// lines as another or crossing one (sharing some of its lines, not all), at most seven deep. A group with no lines
/// left is no matter.
fn groups_nest(sheet: &crate::workbook::Sheet, bases: &crate::ids::Bases, rows: bool) -> bool {
    let (axis, groups) = match rows {
        true => (&sheet.rows, &sheet.row_groups),
        false => (&sheet.columns, &sheet.column_groups),
    };
    let mut spans = Vec::with_capacity(groups.len());
    for (_, g) in groups.values() {
        let (Some(a), Some(b)) = (bases.parse(&g.ends.first), bases.parse(&g.ends.last)) else { continue };
        let (Some(first), Some(last)) = (axis.snap_toward(a, b), axis.snap_toward(b, a)) else { continue };
        if first > last {
            return false;
        }
        spans.push((first, last));
    }
    // Outer ones first: by first line, the longest first.
    spans.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    let mut open: Vec<usize> = Vec::new();
    for (i, &(first, last)) in spans.iter().enumerate() {
        if i > 0 && spans[i - 1] == (first, last) {
            return false;
        }
        while open.last().is_some_and(|&end| end < first) {
            open.pop();
        }
        if open.last().is_some_and(|&end| end < last) {
            return false;
        }
        open.push(last);
        if open.len() > GROUP_DEPTH {
            return false;
        }
    }
    true
}

/// Whether taking back a reverse (`before` into `after`) left the groups it sets nesting where they did, on each
/// sheet and axis it sets groups on. (Groups that did not nest before are no matter: taking back does not mend them.
/// Nor are lines brought back or moved that change how groups lie: only groups set are looked at.)
pub fn groups_still_nest(before: &Workbook, after: &Workbook, reverse: &[Op]) -> bool {
    reverse.iter().all(|op| {
        let (sheet_id, rows) = match op {
            Op::SetRowGroups { sheet_id, .. } => (sheet_id, true),
            Op::SetColumnGroups { sheet_id, .. } => (sheet_id, false),
            _ => return true,
        };
        let (Some(i), Some(j)) = (before.sheet_index(sheet_id), after.sheet_index(sheet_id)) else { return true };
        !groups_nest(&before.sheets[i], &before.bases, rows) || groups_nest(&after.sheets[j], &after.bases, rows)
    })
}

/// Takes back operations applied earlier (`ops`) by their reverse (`reverse`, last first, as applying them answered),
/// when what the operations did is still so (`edit_holds`) and the reverse applies. Answers the reverse of what it
/// applied.
pub fn take_back(workbook: &mut Workbook, ops: &[Op], reverse: &[Op]) -> Result<Vec<Op>, NotTaken> {
    if !edit_holds(workbook, ops) {
        return Err(NotTaken::ChangedSince);
    }
    put_back(workbook, reverse)
}

/// Applies a reverse, what it takes back known to hold: the reverse's own reverse, or why it is not taken.
pub fn put_back(workbook: &mut Workbook, reverse: &[Op]) -> Result<Vec<Op>, NotTaken> {
    if lines_in_the_way(workbook, reverse) {
        return Err(NotTaken::ChangedSince);
    }
    let mut next = workbook.clone();
    // A reverse the workbook no longer takes (what it names is gone, in use, taken, merged or not) means the workbook
    // changed since. One refused for what it is itself (something named or moved twice, an id already held) is no
    // reverse.
    let again = next.apply(reverse).map_err(|refusal| match refusal {
        Refusal::UnknownSheet
        | Refusal::UnknownRow
        | Refusal::UnknownColumn
        | Refusal::UnknownDropdown
        | Refusal::UnknownGroup
        | Refusal::UnknownConditionalFormat
        | Refusal::UnknownView
        | Refusal::DropdownInUse
        | Refusal::ViewInUse
        | Refusal::DropdownIdTaken
        | Refusal::DropdownOptionIdTaken
        | Refusal::RangeAlreadyMerged
        | Refusal::RangeNotMerged => NotTaken::ChangedSince,
        _ => NotTaken::NotAReverse,
    })?;
    if has_names_twice(&next) {
        return Err(name_in_the_way(workbook, reverse));
    }
    // A cell table brought back where it cannot be shown (its footer not under its header): not as it was.
    let shown = |sheet_id: &String, t: &objects::CellTable| {
        next.sheet_index(sheet_id).is_some_and(|i| objects::shown_cell_table(&next.bases, &next.sheets[i], t).is_some())
    };
    let tables_shown = reverse.iter().all(|op| match op {
        Op::SetCellTables { sheet_id, cell_tables } => {
            cell_tables.iter().filter_map(|c| c.cell_table.as_ref()).all(|t| shown(sheet_id, t))
        }
        _ => true,
    });
    // Groups brought back that cross others, sit on their lines or nest too deep: not as they were.
    if !tables_shown || !groups_still_nest(workbook, &next, reverse) {
        return Err(NotTaken::ChangedSince);
    }
    *workbook = next;
    Ok(again)
}

/// The sheet whose name is in the way of a sheet a reverse names or brings back.
fn name_in_the_way(before: &Workbook, reverse: &[Op]) -> NotTaken {
    let taken_by = |name: &str, own: &str| {
        let taken_by = |s: &&crate::workbook::Sheet| s.id != own && s.name.to_lowercase() == name.to_lowercase();
        before.sheets.iter().find(taken_by).map(|s| s.name.clone())
    };
    let way = reverse.iter().find_map(|back| match back {
        Op::SetSheetNames { names } => names
            .iter()
            .find_map(|n| taken_by(&n.name, &n.sheet_id))
            .map(|taken_by| json!({"kind": "ofSheetToName", "takenBy": taken_by})),
        Op::UndeleteSheet { sheet_id } => before
            .deleted_sheets
            .iter()
            .find(|s| s.id == *sheet_id)
            .and_then(|s| taken_by(&s.name, sheet_id))
            .map(|taken_by| json!({"kind": "ofSheetToBringBack", "takenBy": taken_by})),
        _ => None,
    });
    match way {
        Some(way) => NotTaken::SheetNameTaken(way),
        None => NotTaken::ChangedSince,
    }
}

/// A recorded edit replayed (`replay {edit}`): its operations, or why they are not taken. The version is read
/// first, whatever else the edit holds.
pub fn replayed(edit: &Json) -> Result<Vec<Op>, &'static str> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Recorded {
        #[allow(dead_code)]
        v: u32,
        #[allow(dead_code)]
        base: u64,
        ops: Vec<Op>,
    }
    let Some(v) = edit.get("v").and_then(Json::as_u64) else { return Err("unreadableEdit") };
    let v = u32::try_from(v).unwrap_or(u32::MAX);
    if v < version::OLDEST {
        return Err("formatVersionNoLongerTaken");
    }
    if !version::is_known(v) {
        return Err("unknownFormatVersion");
    }
    let Ok(Recorded { ops, .. }) = serde_json::from_value::<Recorded>(edit.clone()) else {
        return Err("unreadableEdit");
    };
    if ops.is_empty() || !ops.iter().all(Op::is_well_formed) {
        return Err("unreadableEdit");
    }
    if version::of_ops(&ops) != v {
        return Err("formatVersionDoesNotFitOperations");
    }
    Ok(ops)
}

/// One edit of a step: the queued edit it was made by (its op id), its operations, and how to take it back. While
/// the edit is queued, how to take it back is the queued edit's (on the workbook shown); once confirmed, it is how
/// it was taken back on the confirmed workbook, unknown when it did not apply there.
#[derive(Clone, Debug)]
pub struct Part {
    pub op_id: String,
    pub ops: Vec<Op>,
    pub reverse: Option<Vec<Op>>,
}

/// Which of the edits of a step made of several a part is of (`Step::roles`): the edit asked for, an edit before it
/// (pointed at or not), or one that went along with it, by its index among the step's edits; or the widths the edit
/// asked for made room with (`makesRoomForNumbersIn`), which change no place told as the step is taken back or made
/// again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Asked,
    Before { index: usize, is_pointed_at: bool },
    Along(usize),
    Room,
}

/// A step of the page's history: one edit, or the edits one action made (taking edits back, or a step taken back
/// or made again).
#[derive(Clone, Debug)]
pub struct Step {
    pub parts: Vec<Part>,
    /// The op id of the edit that first made it, kept as it is taken back and made again: what the page is told
    /// was reversed (`stepReversed`).
    pub name: String,
    /// For a step made of several edits (`editsBefore`, `editsThatGoAlong`): which edit each part is of, in the
    /// order of the parts. Taken back or made again, each edit's parts tell the place they change then: the edit
    /// asked for its `placeChanged`, the edits before it pointed at their `placesChangedBefore`.
    pub roles: Option<Vec<Role>>,
    /// Whether its parts are one action (`actionId`): an edit too large to send whole, or edits taking others back;
    /// not the edits of a step made of several, nor an edit and what it adds once made.
    pub is_one_action: bool,
}

/// Which of its steps the page takes back: the last it made (undo), or the last it took back (redo).
#[derive(Clone, Copy, Debug)]
pub enum Stack {
    Undo,
    Redo,
}

/// The page's history: the steps it can take back, the latest last, and those it took back, to make again.
#[derive(Debug, Default)]
pub struct Steps {
    pub undo: Vec<Step>,
    pub redo: Vec<Step>,
}

impl Steps {
    /// A step the page made: the steps taken back are not to be made again.
    pub fn made(&mut self, step: Step) {
        self.redo.clear();
        self.push_undo(step);
    }

    pub fn push_undo(&mut self, step: Step) {
        self.undo.push(step);
        if self.undo.len() > STEPS_KEPT {
            self.undo.remove(0);
        }
    }

    pub fn push_redo(&mut self, step: Step) {
        self.redo.push(step);
        if self.redo.len() > STEPS_KEPT {
            self.redo.remove(0);
        }
    }

    pub fn last(&self, stack: Stack) -> Option<&Step> {
        match stack {
            Stack::Undo => self.undo.last(),
            Stack::Redo => self.redo.last(),
        }
    }

    pub fn pop(&mut self, stack: Stack) -> Option<Step> {
        match stack {
            Stack::Undo => self.undo.pop(),
            Stack::Redo => self.redo.pop(),
        }
    }

    /// A step taken back from one stack goes on the other: made again, it is a step to take back again.
    pub fn taken_back(&mut self, from: Stack, step: Step) {
        match from {
            Stack::Undo => self.push_redo(step),
            Stack::Redo => self.push_undo(step),
        }
    }

    /// How a queued edit, confirmed, is taken back: as it was taken back on the confirmed workbook, unknown when it
    /// did not apply there.
    pub fn reverse_now(&mut self, op_id: &str, reverse: Option<&Vec<Op>>) {
        for part in self.undo.iter_mut().chain(&mut self.redo).flat_map(|s| &mut s.parts) {
            if part.op_id == op_id {
                part.reverse = reverse.cloned();
            }
        }
    }

    /// Whether an op id is one of an edit of the history.
    pub fn uses(&self, op_id: &str) -> bool {
        self.undo.iter().chain(&self.redo).any(|s| s.name == op_id || s.parts.iter().any(|p| p.op_id == op_id))
    }

    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }
}

/// Why a step of the page's history is not taken back.
#[derive(Debug)]
pub enum StepNotTaken {
    /// Not now: the step is kept (one of its edits is sent and no longer applies to the workbook shown, and how to
    /// take it back is known once the server says what became of it).
    Refused(&'static str),
    /// Never: the step is left out of the history. With the sheet whose name is in the way, when that is why.
    GivenUp(&'static str, Json),
}

impl StepNotTaken {
    pub fn answer(&self) -> String {
        match self {
            StepNotTaken::Refused(why) => json!({"kind": "refused", "refusal": why}).to_string(),
            StepNotTaken::GivenUp(why, way) => {
                json!({"kind": "stepGivenUp", "refusal": why, "sheetNameInTheWay": way}).to_string()
            }
        }
    }
}

/// The edits of a step with how to take each back now: a queued edit's as it is queued (`queued`, by op id: none
/// when it is not queued), a confirmed one's as it was confirmed.
pub fn reverses_of(
    step: &Step,
    queued: impl Fn(&str) -> Option<Option<Vec<Op>>>,
) -> Result<Vec<(Vec<Op>, Vec<Op>)>, StepNotTaken> {
    let mut parts = Vec::with_capacity(step.parts.len());
    for part in &step.parts {
        let reverse = match queued(&part.op_id) {
            Some(Some(reverse)) => reverse,
            Some(None) => return Err(StepNotTaken::Refused("stepToReverseNotMadeHere")),
            None => match &part.reverse {
                Some(reverse) => reverse.clone(),
                None => return Err(StepNotTaken::GivenUp("reverseOfStepNeverKnown", Json::Null)),
            },
        };
        parts.push((part.ops.clone(), reverse));
    }
    Ok(parts)
}

/// What an edit made leaves with nothing in it, by the first of its operations that does, as it is after the whole
/// edit: a sheet still there without rows (`noRowLeft`) or columns (`noColumnLeft`), or the workbook without a sheet
/// (`noSheetLeft`).
pub fn emptied(after: &Workbook, ops: &[Op]) -> Option<&'static str> {
    let sheet = |id: &str| after.sheet_index(id).map(|i| &after.sheets[i]);
    ops.iter().find_map(|op| match op {
        Op::DeleteRows { sheet_id, .. } if sheet(sheet_id).is_some_and(|s| s.rows.len() == 0) => Some("noRowLeft"),
        Op::DeleteColumns { sheet_id, .. } if sheet(sheet_id).is_some_and(|s| s.columns.len() == 0) => {
            Some("noColumnLeft")
        }
        Op::DeleteSheet { .. } if after.sheets.is_empty() => Some("noSheetLeft"),
        _ => None,
    })
}

/// An edit's operations and reverse without what adopts the browser's time zone and the reverse of it (the one as far
/// from the reverse's end as it is from the start): taking the edit back leaves the zone adopted. A reverse not one
/// operation for each is left as it is.
pub fn zone_kept(ops: &[Op], reverse: &[Op]) -> (Vec<Op>, Vec<Op>) {
    let adopts = |op: &Op| matches!(op, Op::AdoptTimeZone { .. });
    if ops.len() != reverse.len() || !ops.iter().any(adopts) {
        return (ops.to_vec(), reverse.to_vec());
    }
    let kept = |i: usize| !adopts(&ops[i]);
    let n = ops.len();
    let ops_kept = (0..n).filter(|&i| kept(i)).map(|i| ops[i].clone()).collect();
    let reverse_kept = (0..n).filter(|&j| kept(n - 1 - j)).map(|j| reverse[j].clone()).collect();
    (ops_kept, reverse_kept)
}

/// Takes a step back on the workbook shown: its edits (operations and how to take them back), last first, each
/// where the ones after it leave the workbook (`take_back`), the browser's zone adopted kept (`zone_kept`). Answers
/// the edits to queue, in that order: each one's operations (the reverse) and how to take them back in turn. A sheet
/// whose name is in the way of one brought back is not named (the page has it in the sheets it shows); one in the way
/// of a sheet named is. A reverse that names an id not well formed gives the step up before anything else is looked
/// at. A workbook left with no sheet gives it up (`noSheetLeft`), unless it had none before.
pub fn take_back_step(
    workbook: &mut Workbook,
    parts: &[(Vec<Op>, Vec<Op>)],
) -> Result<Vec<(Vec<Op>, Vec<Op>)>, StepNotTaken> {
    if !parts.iter().all(|(_, reverse)| new_ids::are_well_formed(reverse)) {
        return Err(StepNotTaken::GivenUp("idNotWellFormed", Json::Null));
    }
    let had_sheets = !workbook.sheets.is_empty();
    let mut made = Vec::with_capacity(parts.len());
    for (ops, reverse) in parts.iter().rev() {
        let (ops, reverse) = zone_kept(ops, reverse);
        if reverse.is_empty() {
            continue;
        }
        match take_back(workbook, &ops, &reverse) {
            Ok(again) => made.push((reverse, again)),
            Err(NotTaken::SheetNameTaken(mut way)) => {
                if way["kind"] == "ofSheetToBringBack" {
                    way = json!({"kind": "ofSheetToBringBack"});
                }
                return Err(StepNotTaken::GivenUp("sheetNameTaken", way));
            }
            Err(why) => return Err(StepNotTaken::GivenUp(why.refusal(), Json::Null)),
        }
    }
    if had_sheets && workbook.sheets.is_empty() {
        return Err(StepNotTaken::GivenUp("noSheetLeft", Json::Null));
    }
    Ok(made)
}
