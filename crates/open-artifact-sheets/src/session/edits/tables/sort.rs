//! Sorting rows (the whole rows move) and sorting cells (the cells' inputs and formats move, their formulas'
//! references along with them).
//!
//! Values sort so: numbers, then texts (whatever their case), then booleans, reversed when
//! descending; errors and then empty cells come last either way. Rows that tie keep their order. When the sorted
//! cells of a key column hold options of one dropdown of the sheet (and of no other), the texts there sort by the
//! dropdown: an option by its place in it, a text by the place of the option labelled so (capitals aside), and
//! before the texts that label none, which sort as texts. Options of two dropdowns or more, each is its label.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use hashbrown::HashMap;

use super::{live_column, live_row, sheet, Direction, Made, Refused};
use crate::calculate::SpillOutcome;
use crate::coerce::{compare_numbers, compare_texts};
use crate::ids::{Axis, IdRun, LineId};
use crate::session::place::Place;
use crate::session::reads::tables::values::SheetValues;
use crate::value::Value;
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{self, sorted_runs, write_format, Leaf, LEAVES};
use crate::workbook::layout::{live_ends, merged_boxes, CellIds, RangeIds};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::reorder::{self, rewritten, KeyDirection, SortedBy};
use crate::workbook::{Input, Sheet, Workbook};

mod objects;

use objects::Moved;

fn sort_rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(t) if !t.is_empty() => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) => 3,
        Value::Blank | Value::Text(_) => 4,
    }
}

fn sort_order(a: &Value, b: &Value, direction: Direction) -> Ordering {
    let (x, y) = (sort_rank(a), sort_rank(b));
    if x >= 3 || y >= 3 {
        return x.cmp(&y);
    }
    let o = match (a, b) {
        _ if x != y => x.cmp(&y),
        (Value::Number(p), Value::Number(q)) => compare_numbers(*p, *q),
        (Value::Text(p), Value::Text(q)) => compare_texts(p, q),
        (Value::Boolean(p), Value::Boolean(q)) => p.cmp(q),
        _ => Ordering::Equal,
    };
    match direction {
        Direction::Ascending => o,
        Direction::Descending => o.reverse(),
    }
}

/// For each key column whose sorted cells hold options of one dropdown of the sheet (and of no other): the
/// dropdown's labels without capitals and their places (the first of a label), and the options' places by position.
struct Options {
    at: HashMap<(usize, usize), usize>,
    labels: HashMap<usize, HashMap<String, usize>>,
}

impl Options {
    fn of(s: &Sheet, columns: &[usize], top: usize, bottom: usize) -> Options {
        let mut by_id: HashMap<&str, (usize, usize)> = HashMap::new();
        for (d, (_, options)) in s.dropdowns.values().enumerate() {
            for (i, o) in options.iter().enumerate() {
                by_id.entry(o.option_id.as_str()).or_insert((d, i));
            }
        }
        let mut found: HashMap<usize, Vec<(usize, usize, usize)>> = HashMap::new();
        for (&(r, c), cell) in &s.cells {
            let Input::DropdownOption { option_id, .. } = &cell.input else { continue };
            let (Some(row), Some(column)) = (s.rows.position(r), s.columns.position(c)) else { continue };
            if (top..=bottom).contains(&row) && columns.contains(&column) {
                if let Some(&(d, i)) = by_id.get(option_id.as_str()) {
                    found.entry(column).or_default().push((row, d, i));
                }
            }
        }
        let mut options = Options { at: HashMap::new(), labels: HashMap::new() };
        for (column, cells) in found {
            let d = cells[0].1;
            if cells.iter().any(|&(_, e, _)| e != d) {
                continue;
            }
            let (_, of_d) = s.dropdowns.values().nth(d).expect("a dropdown of the sheet");
            let mut labels = HashMap::new();
            for (i, o) in of_d.iter().enumerate() {
                labels.entry(o.label.to_lowercase()).or_insert(i);
            }
            options.labels.insert(column, labels);
            options.at.extend(cells.into_iter().map(|(row, _, i)| ((row, column), i)));
        }
        options
    }

    /// Two texts of a column in ascending order, either of them a dropdown's option or not.
    fn compare(&self, (p, a): (&str, (usize, usize)), (q, b): (&str, (usize, usize))) -> Ordering {
        let Some(labels) = self.labels.get(&a.1) else { return compare_texts(p, q) };
        let place = |t: &str, at| self.at.get(&at).or_else(|| labels.get(&t.to_lowercase())).copied();
        match (place(p, a), place(q, b)) {
            (Some(i), Some(j)) => i.cmp(&j),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => compare_texts(p, q),
        }
    }
}

/// The rows from `top` to `bottom` sorted by the keys (column positions): for each place, the row that goes there.
fn sorted(s: &Sheet, values: &SheetValues, top: usize, bottom: usize, keys: &[(usize, Direction)]) -> Vec<usize> {
    let columns: Vec<usize> = keys.iter().map(|&(c, _)| c).collect();
    let options = Options::of(s, &columns, top, bottom);
    let mut order: Vec<usize> = (top..=bottom).collect();
    order.sort_by(|&a, &b| {
        keys.iter()
            .map(|&(c, d)| match (values.get(a, c), values.get(b, c)) {
                (Value::Text(p), Value::Text(q)) if !p.is_empty() && !q.is_empty() => {
                    let o = options.compare((p, (a, c)), (q, (b, c)));
                    if d == Direction::Ascending { o } else { o.reverse() }
                }
                (x, y) => sort_order(x, y, d),
            })
            .find(|o| o.is_ne())
            .unwrap_or(Ordering::Equal)
    });
    order
}

/// The key columns' positions, each a column of the sheet.
fn key_columns(
    workbook: &Workbook,
    s: &Sheet,
    keys: &[(String, Direction)],
) -> Result<Vec<(usize, Direction)>, Refused> {
    keys.iter().map(|(c, d)| Ok((live_column(workbook, s, c)?.1, *d))).collect()
}

/// Sorting cannot reorder a key's values that come from one formula spanning rows, or a formula in a
/// column outside the sorted cells.
fn check_spilled_keys(
    workbook: &Workbook,
    sheet: &Sheet,
    top: usize,
    bottom: usize,
    left: usize,
    keys: &[(usize, Direction)],
) -> Result<(), Refused> {
    let mut spills_down = false;
    for ((sheet_id, r, c), outcome) in &workbook.outcomes {
        if sheet_id != &sheet.id {
            continue;
        }
        let Some(SpillOutcome::Fills { to, .. }) = &outcome.spill else { continue };
        let Some((row, column)) = sheet.rows.position(*r).zip(sheet.columns.position(*c)) else { continue };
        if row > bottom || to.0 < top || !keys.iter().any(|&(key, _)| (column..=to.1).contains(&key)) {
            continue;
        }
        if column < left {
            return Err(Refused::Because("sortColumnFilledFromOutsideTheCells"));
        }
        spills_down |= to.0 > row;
    }
    if spills_down {
        return Err(Refused::Because("sortColumnFilledDownByOneFormula"));
    }
    Ok(())
}

/// The first row a sort may move: rows frozen at the top stay where they are.
fn first_unfrozen(s: &Sheet) -> usize {
    s.last_frozen_row.and_then(|r| s.rows.position(r)).map_or(0, |p| p + 1)
}

/// The rows a sort of rows would order, in the order it would put them (readRowsInSortedOrder): those not frozen
/// at the top from one row to the other, whether or not the sort would move any. Unlike the sort, the read is
/// refused where a merged range across rows meets the rows (`mergedRangeAmongSortedCells`, before the keys are
/// read), and, while formulas wait for `calculate`, where a key column holds a formula among them
/// (`sortKeysNotCalculated`), whether or not that one waits.
pub(super) fn rows_in_sorted_order(
    workbook: &Workbook,
    sheet_id: &str,
    one: &str,
    other: &str,
    keys: &[(String, Direction)],
    is_calculation_due: bool,
) -> Result<Vec<LineId>, Refused> {
    let s = sheet(workbook, sheet_id)?;
    let (_, a) = live_row(workbook, s, one)?;
    let (_, b) = live_row(workbook, s, other)?;
    let (top, bottom) = (a.min(b).max(first_unfrozen(s)), a.max(b));
    if merged_boxes(&workbook.bases, s).iter().any(|&(t, b, _, _)| t < b && t <= bottom && top <= b) {
        return Err(Refused::Because("mergedRangeAmongSortedCells"));
    }
    let keys = key_columns(workbook, s, keys)?;
    if top > bottom {
        return Ok(Vec::new());
    }
    let holds_formula = |(r, c): (usize, usize)| {
        let (Some(r), Some(c)) = (s.rows.line(r), s.columns.line(c)) else { return false };
        s.cells.get(&(r, c)).is_some_and(|cell| matches!(cell.input, Input::Formula { .. }))
    };
    if is_calculation_due && keys.iter().any(|&(c, _)| (top..=bottom).any(|r| holds_formula((r, c)))) {
        return Err(Refused::Because("sortKeysNotCalculated"));
    }
    check_spilled_keys(workbook, s, top, bottom, 0, &keys)?;
    let order = sorted(s, &SheetValues::of(workbook, s), top, bottom, &keys);
    Ok(order.into_iter().map(|p| s.rows.line(p).expect("a live row")).collect())
}

pub(super) fn sort_rows(
    workbook: &Workbook,
    sheet_id: &str,
    one: &str,
    other: &str,
    keys: &[(String, Direction)],
    code: &str,
) -> Result<Made, Refused> {
    let s = sheet(workbook, sheet_id)?;
    let (_, a) = live_row(workbook, s, one)?;
    let (_, b) = live_row(workbook, s, other)?;
    let (top, bottom) = (a.min(b).max(first_unfrozen(s)), a.max(b));
    // Rows all frozen are left as they are, whatever the keys.
    if top > bottom {
        return Ok(Made::nothing());
    }
    let keys = key_columns(workbook, s, keys)?;
    check_spilled_keys(workbook, s, top, bottom, 0, &keys)?;
    let order = sorted(s, &SheetValues::of(workbook, s), top, bottom, &keys);
    let Some(i) = order.iter().enumerate().position(|(k, &p)| p != top + k) else { return Ok(Made::nothing()) };
    let j = order.iter().enumerate().rposition(|(k, &p)| p != top + k).expect("a row that moves");
    // What else the sheet holds goes along (its ids checked before anything else is).
    let moved = Moved::new(s, top, &order, true);
    let groups = objects::groups(workbook, &moved, code)?;
    // Conditional formats, placements and widgets' ranges keep their places as the rows are put in order.
    // Where each row of the sorted ones goes; a merged range across rows has to stay whole, in its order.
    let mut new_place: Vec<usize> = vec![0; order.len()];
    for (k, &p) in order.iter().enumerate() {
        new_place[p - top] = top + k;
    }
    let place = |p: usize| if (top..=bottom).contains(&p) { new_place[p - top] } else { p };
    for range in &s.merged_ranges {
        let Some((t, b, _, _)) = s.live_box(&workbook.bases, range) else { continue };
        if (t..b).any(|p| place(p + 1) != place(p) + 1) {
            return Err(Refused::Because("moveSplitsMergedRange"));
        }
    }
    // The rows from the first that moves to the last, in their new order; they keep the places they take.
    let in_order: Vec<LineId> = order[i..=j].iter().map(|&p| s.rows.line(p).expect("a live row")).collect();
    let mut rows_after = s.rows.clone();
    rows_after.reorder(&in_order);
    let mut ops = merged_again(workbook, s, &rows_after)?;
    // A formula among them one of whose references would leave the sheet as its row moves is written again first,
    // that reference as text (the move moves the rest).
    let index = workbook.sheet_index(sheet_id).expect("a sheet");
    let boxes = merged_boxes(&workbook.bases, s);
    let covered = |r: usize, c: usize| {
        boxes.iter().any(|&(t, b, l, x)| (t..=b).contains(&r) && (l..=x).contains(&c) && (r, c) != (t, l))
    };
    let mut cells: Vec<((usize, usize), CellToSet)> = Vec::new();
    for (&(r, c), cell) in &s.cells {
        let Input::Formula { formula } = &cell.input else { continue };
        let (Some(at_r), Some(at_c)) = (s.rows.position(r), s.columns.position(c)) else { continue };
        if !(top..=bottom).contains(&at_r) || place(at_r) == at_r || covered(at_r, at_c) {
            continue;
        }
        let delta = place(at_r) as i64 - at_r as i64;
        if let Some(new) = reorder::unshiftable(workbook, formula, index, delta) {
            let (r, c) = (workbook.bases.text(r), workbook.bases.text(c));
            cells.push(((at_r, at_c), CellToSet { r, c, input: Some(Input::Formula { formula: new }) }));
        }
    }
    if !cells.is_empty() {
        cells.sort_by_key(|x| x.0);
        let cells = cells.into_iter().map(|x| x.1).collect();
        ops.push(Op::SetCells { sheet_id: sheet_id.to_owned(), cells, form: CellForm::Auto });
    }
    // The keys it was sorted by, a column again left out.
    let mut seen = BTreeSet::new();
    let sorted_by = keys
        .iter()
        .filter(|&&(c, _)| seen.insert(c))
        .map(|&(c, d)| SortedBy {
            c: workbook.bases.text(s.columns.line(c).expect("a live column")),
            direction: match d {
                Direction::Ascending => KeyDirection::Ascending,
                Direction::Descending => KeyDirection::Descending,
            },
        })
        .collect();
    ops.push(reorder::op_for(workbook, sheet_id, &in_order, sorted_by));
    ops.extend(groups);
    let span = Place::cells(sheet_id, top + i, 0, top + j, s.columns.len().saturating_sub(1));
    Ok(Made { ops, place: Some(span) })
}

/// A merged range whose end row is deleted would take in other rows once the rows move (or lose the ones it has):
/// it is unmerged and what is left of it merged again (a single cell is not), before the rows move. Refused when
/// that would hide what a cell holds, a cell it covers holding an input, or when what is left of it meets another
/// merged range (one the page shows or not).
fn merged_again(workbook: &Workbook, s: &Sheet, rows_after: &Axis) -> Result<Vec<Op>, Refused> {
    let bases = &workbook.bases;
    let boxes: Vec<_> = s.merged_ranges.iter().map(|m| s.live_box(bases, m)).collect();
    let mut again: Vec<(RangeIds, Option<RangeIds>)> = Vec::new();
    for (k, range) in s.merged_ranges.iter().enumerate() {
        let (Some(a), Some(b)) = (bases.parse(&range.top_left.r), bases.parse(&range.bottom_right.r)) else { continue };
        let Some((t, b_, l, r)) = s.live_box(bases, range) else { continue };
        let before: Vec<_> = (t..=b_).map(|p| s.rows.line(p)).collect();
        let after = live_ends(rows_after, a, b).map(|(t, b)| (t..=b).map(|p| rows_after.line(p)).collect::<Vec<_>>());
        if after.as_ref() == Some(&before) {
            continue;
        }
        let holds = |r, c| s.rows.line(r).zip(s.columns.line(c)).is_some_and(|at| s.cells.contains_key(&at));
        let meets = |(k2, b): (usize, &Option<(usize, usize, usize, usize)>)| {
            k2 != k && b.is_some_and(|(t2, b2, l2, r2)| t <= b2 && t2 <= b_ && l <= r2 && l2 <= r)
        };
        if (t..=b_).any(|p| (l..=r).any(|q| (p, q) != (t, l) && holds(p, q))) || boxes.iter().enumerate().any(meets) {
            return Err(Refused::Because("moveSplitsMergedRange"));
        }
        let left = (t, l) != (b_, r);
        again.push((range.clone(), left.then(|| s.live_range(bases, range).expect("a live range"))));
    }
    if again.is_empty() {
        return Ok(Vec::new());
    }
    // In the order they are kept: by their ends' ids, compared as text.
    let key = |m: &RangeIds| [&m.top_left.r, &m.top_left.c, &m.bottom_right.r, &m.bottom_right.c].map(|t| t.clone());
    again.sort_by(|x, y| key(&x.0).cmp(&key(&y.0)));
    let sheet_id = s.id.clone();
    let left: Vec<RangeIds> = again.iter().filter_map(|x| x.1.clone()).collect();
    let ranges = again.into_iter().map(|x| x.0).collect();
    let mut ops = vec![Op::UnmergeCells { sheet_id: sheet_id.clone(), ranges }];
    if !left.is_empty() {
        ops.push(Op::MergeCells { sheet_id, ranges: left });
    }
    Ok(ops)
}

pub(super) fn sort_cells(
    workbook: &Workbook,
    sheet_id: &str,
    one: &CellIds,
    other: &CellIds,
    keys: &[(String, Direction)],
    code: &str,
) -> Result<Made, Refused> {
    let s = sheet(workbook, sheet_id)?;
    let index = workbook.sheet_index(sheet_id).expect("a sheet");
    let (_, r1) = live_row(workbook, s, &one.r)?;
    let (_, c1) = live_column(workbook, s, &one.c)?;
    let (_, r2) = live_row(workbook, s, &other.r)?;
    let (_, c2) = live_column(workbook, s, &other.c)?;
    let (top, bottom, left, right) = (r1.min(r2), r1.max(r2), c1.min(c2), c1.max(c2));
    // Each key in turn: a column of the sheet, among the cells.
    let keys = keys
        .iter()
        .map(|(c, d)| match live_column(workbook, s, c)? {
            (_, c) if c < left || c > right => Err(Refused::Because("sortColumnOutsideTheCells")),
            (_, c) => Ok((c, *d)),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let place = Place::cells(sheet_id, top, left, bottom, right);
    let top = top.max(first_unfrozen(s));
    if top > bottom {
        return Ok(Made::nothing());
    }
    let bases = &workbook.bases;
    // Of the merged ranges, those the page shows (sorting rows minds every one).
    let meets = |&(t, b, l, r): &(usize, usize, usize, usize)| t <= bottom && top <= b && l <= right && left <= r;
    if merged_boxes(bases, s).iter().any(meets) {
        return Err(Refused::Because("mergedRangeAmongSortedCells"));
    }
    check_spilled_keys(workbook, s, top, bottom, left, &keys)?;
    let order = sorted(s, &SheetValues::of(workbook, s), top, bottom, &keys);
    if order.iter().enumerate().all(|(k, &p)| p == top + k) {
        return Ok(Made::nothing());
    }
    // Groups of rows follow what the rows held.
    let groups = objects::groups(workbook, &Moved::new(s, top, &order, false), code)?;
    let row = |p: usize| s.rows.line(p).expect("a live row");
    let column = |p: usize| s.columns.line(p).expect("a live column");
    let mut cells = Vec::new();
    let mut formats_change = false;
    for (k, &q) in order.iter().enumerate() {
        let p = top + k;
        if p == q {
            continue;
        }
        for c in left..=right {
            let (to, from) = ((row(p), column(c)), (row(q), column(c)));
            let new = s.cells.get(&from).map(|cell| match &cell.input {
                Input::Formula { formula } => {
                    let (delta, line) = (p as i64 - q as i64, |p| s.rows.line(p));
                    Input::Formula { formula: rewritten(workbook, formula, index, Some(delta), &line, &s.rows, None) }
                }
                input => input.clone(),
            });
            let old = s.cells.get(&to).map(|cell| &cell.input);
            if new.as_ref() != old {
                // An option's id is written again only when it is well formed.
                if let Some(Input::DropdownOption { option_id, .. }) = &new {
                    super::well_formed(option_id, "opt")?;
                }
                cells.push(CellToSet { r: bases.text(to.0), c: bases.text(to.1), input: new });
            }
            formats_change |= LEAVES.iter().any(|&leaf| s.formats.get(leaf, to) != s.formats.get(leaf, from));
        }
    }
    let mut ops = Vec::new();
    if !cells.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet_id.to_owned(), cells, form: CellForm::Auto });
    }
    if formats_change {
        // Formats change in the rows from the first that changes to the last.
        let changed = |(k, &q): &(usize, &usize)| top + k != q;
        let i = order.iter().enumerate().position(|x| changed(&x)).expect("a row that changes");
        let j = order.iter().enumerate().rposition(|x| changed(&x)).expect("a row that changes");
        let mut rows: Vec<LineId> = (top + i..=top + j).map(row).collect();
        let mut columns: Vec<LineId> = (left..=right).map(column).collect();
        let (rows, columns) = (sorted_runs(bases, &mut rows), sorted_runs(bases, &mut columns));
        // Every property set in the cells goes back to its default, and then the cells take theirs in their order.
        let mut set: BTreeSet<Leaf> = BTreeSet::new();
        let mut moved: Vec<(Leaf, (LineId, LineId), serde_json::Value)> = Vec::new();
        let mut to: HashMap<LineId, LineId> = HashMap::new();
        for (k, &q) in order.iter().enumerate().take(j + 1).skip(i) {
            to.insert(row(q), row(top + k));
            for c in left..=right {
                for leaf in LEAVES {
                    if s.formats.get(leaf, (row(top + k), column(c))).is_some() {
                        set.insert(leaf);
                    }
                    if let Some(v) = s.formats.get(leaf, (row(q), column(c))) {
                        moved.push((leaf, (row(q), column(c)), v.clone()));
                    }
                }
            }
        }
        let defaults: BTreeMap<Leaf, serde_json::Value> = set.into_iter().map(|l| (l, l.default_value())).collect();
        let format = write_format(&defaults);
        let formats = vec![CellsToFormat { rows, columns, format }];
        ops.push(Op::SetCellFormats { sheet_id: sheet_id.to_owned(), formats });
        // The formats are grouped where they come from, the groups ordered by the places of their columns and then of
        // their rows there; each group then goes where its rows go.
        let lines = |runs: &[IdRun]| -> Vec<LineId> {
            let base = |r: &IdRun| bases.find(&r.base).expect("a known base");
            runs.iter().flat_map(|r| (0..r.count).map(move |i| LineId { base: base(r), n: r.first + i })).collect()
        };
        let places = |axis: &Axis, runs: &[IdRun]| -> Vec<usize> {
            let mut places: Vec<usize> = lines(runs).into_iter().filter_map(|l| axis.position(l)).collect();
            places.sort_unstable();
            places
        };
        let mut blocks = formats::blocks(bases, moved.iter().map(|(l, at, v)| (*l, *at, v)));
        blocks.sort_by_cached_key(|(rows, columns, _)| (places(&s.columns, columns), places(&s.rows, rows)));
        let moved_to = |runs: &[IdRun]| sorted_runs(bases, &mut lines(runs).into_iter().map(|l| to[&l]).collect());
        let formats: Vec<CellsToFormat> = blocks
            .into_iter()
            .map(|(rows, columns, format)| CellsToFormat { rows: moved_to(&rows), columns, format })
            .collect();
        if !formats.is_empty() {
            ops.push(Op::SetCellFormats { sheet_id: sheet_id.to_owned(), formats });
        }
    }
    ops.extend(groups);
    Ok(Made { ops, place: Some(place) })
}
