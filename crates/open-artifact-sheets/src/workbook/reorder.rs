//! Rows put in an order among themselves (`reorderRows`, format 42): what a sort of rows records
//! now, where it recorded a move of rows (and cells set again for the formulas) before.
//!
//! The rows are named by id, grouped by base (each base once, its runs ascending and apart, each `[first, count]`),
//! and `order` puts them in order: the `k`th of the places they take (by position) goes to the row of index
//! `order[k]` among the ids as named. Rows need not be next to each other; a deleted row (or one of another sheet)
//! among them is refused (`unknownRow`). The order is written in base 64 (`A`–`Z`, `a`–`z`, `0`–`9`, `-`, `_`), each index in as many digits as the
//! last index takes (one at least), a rising run of indices as its first and `+` and how many follow it; anything
//! else (a run written index by index, `+` and nothing following, an index twice or missing) is unreadable.
//! `sortedBy` tells the keys of the sort that recorded it (each a column, ascending or descending); the reverse of
//! one is the same rows in the order they had, sorted by nothing.
//!
//! Formulas, conditional formats, placements and widgets' ranges keep the places they name (groups, merged ranges,
//! tables and the frozen rows follow their rows): a reference to the sheet's rows names the rows at those places once they
//! are in order, and the rows of a formula among the rows that move (its rows not fixed) move as far as it does,
//! around the end of the sheet (what would leave it at the top comes in at the bottom, and the other way round).

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};

use super::load::{Op, Refusal};
use super::{Cell, Input, Workbook};
use crate::formula::{Reference, StoredFormula};
use crate::ids::{Axis, LineId};

/// The rows put in order and their order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RowsInOrder {
    pub ids: Vec<IdsOfBase>,
    pub order: String,
}

/// The rows of one base: runs of `[first, count]`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdsOfBase {
    pub base: String,
    pub runs: Vec<(u32, u32)>,
}

/// A key of the sort that put the rows in order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SortedBy {
    pub c: String,
    pub direction: KeyDirection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyDirection {
    Ascending,
    Descending,
}

const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// How many digits each index of an order of `n` rows takes.
fn width(n: usize) -> usize {
    let (mut w, mut x) = (1, n.saturating_sub(1) / 64);
    while x > 0 {
        w += 1;
        x /= 64;
    }
    w
}

fn write_number(out: &mut String, mut x: usize, w: usize) {
    let mut digits = vec![b'A'; w];
    for d in digits.iter_mut().rev() {
        *d = DIGITS[x % 64];
        x /= 64;
    }
    out.extend(digits.into_iter().map(char::from));
}

/// An order (the index of the row going to each place) as written.
pub fn encode(order: &[usize]) -> String {
    let w = width(order.len());
    let mut out = String::new();
    let mut k = 0;
    while k < order.len() {
        let mut j = k;
        while j + 1 < order.len() && order[j + 1] == order[j] + 1 {
            j += 1;
        }
        write_number(&mut out, order[k], w);
        if j > k {
            out.push('+');
            write_number(&mut out, j - k, w);
        }
        k = j + 1;
    }
    out
}

/// An order of `n` rows as read, in rising runs (first index, how many): `None` unless it is written as `encode`
/// writes it, and puts each of the `n` in one place.
fn decode_runs(text: &str, n: usize) -> Option<Vec<(usize, usize)>> {
    let w = width(n);
    let digit = |b: u8| DIGITS.iter().position(|&d| d == b);
    let bytes = text.as_bytes();
    let number = |at: usize| -> Option<usize> {
        let piece = bytes.get(at..at + w)?;
        piece.iter().try_fold(0usize, |x, &b| x.checked_mul(64)?.checked_add(digit(b)?))
    };
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let first = number(at)?;
        at += w;
        let mut count = 1;
        if bytes.get(at) == Some(&b'+') {
            let more = number(at + 1)?;
            if more == 0 {
                return None;
            }
            count = more.checked_add(1)?;
            at += 1 + w;
        }
        // A run that goes on from the one before is written as one.
        if runs.last().is_some_and(|&(f, c)| f + c == first) {
            return None;
        }
        runs.push((first, count));
    }
    let mut tiles = runs.clone();
    tiles.sort_unstable();
    let mut next = 0usize;
    for (first, count) in tiles {
        if first != next {
            return None;
        }
        next = first.checked_add(count)?;
    }
    (next == n && n > 0).then_some(runs)
}

/// An order of `n` rows as read: the index of the row going to each place.
pub fn decode(text: &str, n: usize) -> Option<Vec<usize>> {
    Some(decode_runs(text, n)?.into_iter().flat_map(|(f, c)| f..f + c).collect())
}

impl RowsInOrder {
    /// How many rows are named.
    fn count(&self) -> u64 {
        self.ids.iter().flat_map(|b| &b.runs).map(|&(_, c)| c as u64).sum()
    }

    /// Whether the rows are named in the form that reads: some rows, the bases in the order of their text (each once), its runs some, none empty,
    /// ascending and apart, none past the largest id; the order one of as many rows.
    pub fn is_well_formed(&self) -> bool {
        let ids_ok = !self.ids.is_empty()
            && self.ids.windows(2).all(|w| w[0].base < w[1].base)
            && self.ids.iter().all(|b| {
                !b.runs.is_empty()
                    && b.runs.iter().all(|&(f, c)| c > 0 && f as u64 + c as u64 <= 1 << 32)
                    && b.runs.windows(2).all(|w| w[0].0 as u64 + (w[0].1 as u64) < w[1].0 as u64)
            });
        ids_ok && usize::try_from(self.count()).is_ok_and(|n| decode_runs(&self.order, n).is_some())
    }

    /// The rows named, in the order named.
    fn lines(&self, workbook: &Workbook) -> Option<Vec<LineId>> {
        let mut lines = Vec::new();
        for b in &self.ids {
            let base = workbook.bases.find(&b.base)?;
            for &(first, count) in &b.runs {
                lines.extend((first as u64..first as u64 + count as u64).map(|n| LineId { base, n: n as u32 }));
            }
        }
        Some(lines)
    }
}

/// Rows named in their written form: by base, the bases in the order of their text, each base's runs ascending.
/// Answers the ids and the rows in that order.
pub(crate) fn ids_of(workbook: &Workbook, lines: &[LineId]) -> (Vec<IdsOfBase>, Vec<LineId>) {
    let mut sorted: Vec<(String, u32, LineId)> = lines.iter().map(|&l| (workbook.bases.name(l.base).to_owned(), l.n, l)).collect();
    sorted.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
    let mut ids: Vec<IdsOfBase> = Vec::new();
    for (base, n, _) in &sorted {
        match ids.last_mut() {
            Some(b) if b.base == *base => match b.runs.last_mut() {
                Some((f, c)) if *f + *c == *n => *c += 1,
                _ => b.runs.push((*n, 1)),
            },
            _ => ids.push(IdsOfBase { base: base.clone(), runs: vec![(*n, 1)] }),
        }
    }
    (ids, sorted.into_iter().map(|x| x.2).collect())
}

/// The operation putting `lines` (rows of the sheet, not deleted) in the order given: the first where the first of
/// them is now, and so on.
pub(crate) fn op_for(workbook: &Workbook, sheet_id: &str, in_order: &[LineId], sorted_by: Vec<SortedBy>) -> Op {
    let (ids, named) = ids_of(workbook, in_order);
    let index: HashMap<LineId, usize> = named.iter().enumerate().map(|(k, &l)| (l, k)).collect();
    let order: Vec<usize> = in_order.iter().map(|l| index[l]).collect();
    Op::ReorderRows { sheet_id: sheet_id.to_owned(), rows: RowsInOrder { ids, order: encode(&order) }, sorted_by }
}

impl Workbook {
    pub(super) fn reorder_rows(&mut self, sheet_id: &str, rows: &RowsInOrder, sorted_by: &[SortedBy]) -> Result<Op, Refusal> {
        let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        let sheet = &self.sheets[index];
        if rows.count() > sheet.rows.total() as u64 {
            return Err(Refusal::UnknownRow);
        }
        let lines = rows.lines(self).filter(|l| l.iter().all(|&r| sheet.rows.contains(r))).ok_or(Refusal::UnknownRow)?;
        for key in sorted_by {
            self.line(&key.c).filter(|&c| sheet.columns.contains(c)).ok_or(Refusal::UnknownColumn)?;
        }
        let order = decode(&rows.order, lines.len()).ok_or(Refusal::UnreadableRequest)?;
        let in_order: Vec<LineId> = order.iter().map(|&k| lines[k]).collect();
        let mut places: Vec<usize> = lines.iter().map(|&l| sheet.rows.position(l).expect("a live row")).collect();
        places.sort_unstable();
        // The reverse: the rows as they are now.
        let index_of: HashMap<LineId, usize> = lines.iter().enumerate().map(|(k, &l)| (l, k)).collect();
        let was: Vec<usize> = places.iter().map(|&p| index_of[&sheet.rows.line(p).expect("a live row")]).collect();
        let reverse = Op::ReorderRows {
            sheet_id: sheet_id.to_owned(),
            rows: RowsInOrder { ids: rows.ids.clone(), order: encode(&was) },
            sorted_by: Vec::new(),
        };
        let mut after = sheet.rows.clone();
        after.reorder(&in_order);
        let deltas: HashMap<LineId, i64> = in_order
            .iter()
            .zip(&places)
            .map(|(&l, &to)| (l, to as i64 - sheet.rows.position(l).expect("a live row") as i64))
            .collect();
        let rewrites = formulas_kept_in_place(self, index, &deltas, &after);
        self.objects_kept_in_place(index, &after);
        self.sheets[index].rows = after;
        for (k, at, formula) in rewrites {
            let sheet = match k {
                Kept::Live(k) => &mut self.sheets[k],
                Kept::Deleted(k) => &mut self.deleted_sheets[k],
            };
            let id = sheet.id.clone();
            sheet.cells.insert(at, Cell::new(Input::Formula { formula }));
            self.outcomes.remove(&super::OutcomeAt(&id, at.0, at.1));
        }
        Ok(reverse)
    }
}

impl Workbook {
    /// Conditional formats' ranges, placements' anchors and widgets' ranges on sheet `index` keep naming the places
    /// they named once its rows are as `after` has them: a corner (or an anchor) at a place another row takes now
    /// names that row, a deleted one as the row it gives way to (toward the other corner; an anchor, forward).
    fn objects_kept_in_place(&mut self, index: usize, after: &Axis) {
        let rows = self.sheets[index].rows.clone();
        let bases = &self.bases;
        // Each end on a live row names the row that comes to its place; an end on a deleted row is left as it is.
        let moved = |id: &mut String| {
            let Some(line) = bases.parse(id) else { return };
            if let Some(l) = rows.position(line).and_then(|p| after.line(p)) {
                *id = bases.text(l);
            }
        };
        let kept = |range: &mut super::layout::RangeIds| {
            moved(&mut range.top_left.r);
            moved(&mut range.bottom_right.r);
        };
        let sheet = &mut self.sheets[index];
        for (_, cf) in sheet.conditional_formats.values_mut() {
            cf.ranges.iter_mut().for_each(&kept);
        }
        for (_, placement) in sheet.placements.values_mut() {
            moved(&mut placement.top_left.r);
        }
        let sheet_id = sheet.id.clone();
        let sheet_index = |id: &str| self.sheets.iter().position(|s| s.id == id);
        let on_sheet: Vec<bool> = self
            .views
            .values()
            .flat_map(|(_, v)| v.elements.iter().flat_map(|e| e.parts().2.iter().map(|i| sheet_index(&i.range.sheet_id))))
            .map(|i| i == sheet_index(&sheet_id))
            .collect();
        let mut k = 0;
        for (_, view) in self.views.values_mut() {
            for element in &mut view.elements {
                for input in element.parts_mut().2 {
                    if on_sheet[k] {
                        let mut range = super::layout::RangeIds {
                            top_left: input.range.top_left.clone(),
                            bottom_right: input.range.bottom_right.clone(),
                        };
                        kept(&mut range);
                        (input.range.top_left, input.range.bottom_right) = (range.top_left, range.bottom_right);
                    }
                    k += 1;
                }
            }
        }
    }
}

/// The formulas of the workbook that name the rows of sheet `index` as they will be named once the rows are in
/// order (`after`), each formula of the rows that move (`deltas`) moving as far as its row: (sheet, cell, formula).
fn formulas_kept_in_place(
    workbook: &Workbook,
    index: usize,
    deltas: &HashMap<LineId, i64>,
    after: &Axis,
) -> Vec<(Kept, (LineId, LineId), StoredFormula)> {
    let line = |p: usize| after.line(p);
    let live = workbook.sheets[index].rows.len();
    let mut out = Vec::new();
    // Every formula naming the sheet, those of deleted rows and columns and of deleted sheets too:
    // they name the same places once they come back.
    let sheets = workbook.sheets.iter().enumerate().map(|(k, s)| (Kept::Live(k), s));
    let deleted = workbook.deleted_sheets.iter().enumerate().map(|(k, s)| (Kept::Deleted(k), s));
    for (k, other) in sheets.chain(deleted) {
        let mut cells: Vec<((LineId, LineId), StoredFormula)> = Vec::new();
        for (&(r, c), cell) in &other.cells {
            let Input::Formula { formula } = &cell.input else { continue };
            if !formula.references.iter().any(|x| workbook.sheet_index(x.sheet_id()) == Some(index)) {
                continue;
            }
            let delta = if k == Kept::Live(index) { deltas.get(&r).copied() } else { None };
            let new = rewritten(workbook, formula, index, delta, &line, after, Some(live));
            if new != *formula {
                cells.push(((r, c), new));
            }
        }
        cells.sort_by_key(|x| x.0);
        out.extend(cells.into_iter().map(|(at, f)| (k, at, f)));
    }
    out
}

/// The sheet a formula kept in place is on: a live one or a deleted one, by index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kept {
    Live(usize),
    Deleted(usize),
}

/// Why a reference of a formula among rows that move cannot move as far as they do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    /// Its rows would go above the first row.
    Above,
    /// Below the last.
    Below,
}

/// Where a reference to sheet `sheet` would go, moved `delta` rows, when it cannot: its rows not fixed leaving the
/// sheet.
fn failure(workbook: &Workbook, reference: &Reference, delta: i64) -> Option<Failure> {
    let at = workbook.locate(reference)?;
    let n = workbook.sheets[at.sheet].rows.len() as i64;
    let ends = match reference {
        Reference::Columns { top: None, .. } => vec![],
        Reference::Columns { .. } => vec![at.top],
        _ => vec![at.top, at.bottom],
    };
    let moved: Vec<i64> = ends.into_iter().filter(|&(_, fixed)| !fixed).map(|(p, _)| p as i64 + delta).collect();
    if moved.iter().any(|&p| p < 0) {
        Some(Failure::Above)
    } else if moved.iter().any(|&p| p >= n) {
        Some(Failure::Below)
    } else {
        None
    }
}

/// A reference to sheet `sheet` whose ends not fixed on deleted rows are put on the rows they give way to (toward the
/// other end; the top of columns, forward), as putting the rows in order would not move them; `None` when it has
/// none such (or a cell's, which gives way to nothing).
fn given_way(workbook: &Workbook, reference: &Reference, sheet: usize) -> Option<Reference> {
    let (rows, bases) = (&workbook.sheets[sheet].rows, &workbook.bases);
    let deleted = |r: &str| bases.parse(r).is_some_and(|l| rows.is_deleted(l));
    let toward = |a: &str, b: &str| Some(bases.text(rows.line(rows.snap_toward(bases.parse(a)?, bases.parse(b)?)?)?));
    let mut r = reference.clone();
    let mut changed = false;
    let mut end = |at: &mut String, fixed: bool, to: Option<String>| {
        if !fixed && deleted(at) {
            if let Some(to) = to {
                *at = to;
                changed = true;
            }
        }
    };
    match &mut r {
        Reference::Cell { .. } => {}
        Reference::Range { top_left: a, bottom_right: b, .. } => {
            let (ta, tb) = (toward(&a.r, &b.r), toward(&b.r, &a.r));
            end(&mut a.r, a.is_row_absolute, ta);
            end(&mut b.r, b.is_row_absolute, tb);
        }
        Reference::Rows { top: a, bottom: b, .. } => {
            let (ta, tb) = (toward(&a.r, &b.r), toward(&b.r, &a.r));
            end(&mut a.r, a.is_row_absolute, ta);
            end(&mut b.r, b.is_row_absolute, tb);
        }
        Reference::Columns { top: Some(t), .. } => {
            let to = bases.parse(&t.r).and_then(|l| rows.snap_forward(l)).and_then(|p| rows.line(p)).map(|l| bases.text(l));
            end(&mut t.r, t.is_row_absolute, to);
        }
        Reference::Columns { top: None, .. } => {}
    }
    changed.then_some(r)
}

/// A formula among the rows a sort moves (`delta` rows, in sheet `sheet`) that putting the rows in order cannot move
/// as it moves, as the sort writes it before: a reference to the sheet whose rows would leave it as text (`#REF!`
/// above the first row; below the last, the reference moved, its rows past the end), one with an end not fixed on a
/// deleted row with that end on the row it gives way to, and the other references as they are (the rows' move moves
/// those to the sheet; keeps those to other sheets too, which an older format wrote as text). `None` when the
/// move moves every reference.
pub(crate) fn unshiftable(workbook: &Workbook, formula: &StoredFormula, sheet: usize, delta: i64) -> Option<StoredFormula> {
    let own = |r: &Reference| workbook.sheet_index(r.sheet_id()) == Some(sheet);
    let failures: Vec<Option<Failure>> =
        formula.references.iter().map(|r| if own(r) { failure(workbook, r, delta) } else { None }).collect();
    let given: Vec<Option<Reference>> =
        formula.references.iter().map(|r| if own(r) { given_way(workbook, r, sheet) } else { None }).collect();
    if failures.iter().all(Option::is_none) && given.iter().all(Option::is_none) {
        return None;
    }
    let mut pieces = vec![formula.text_between_references[0].clone()];
    let mut references = Vec::new();
    for (i, reference) in formula.references.iter().enumerate() {
        let next = &formula.text_between_references[i + 1];
        let text = match failures[i] {
            Some(Failure::Above) => Some("#REF!".to_owned()),
            Some(Failure::Below) => Some(workbook.reference_text_moved(sheet, reference, delta)),
            None => None,
        };
        match text {
            Some(text) => {
                let last = pieces.last_mut().expect("a piece");
                last.push_str(&text);
                last.push_str(next);
            }
            None => {
                references.push(given[i].clone().unwrap_or_else(|| reference.clone()));
                pieces.push(next.clone());
            }
        }
    }
    Some(StoredFormula { text_between_references: pieces, references })
}

/// A formula as rows of sheet `sheet` move. Its references to the sheet keep the places they name: each row not
/// fixed moves by `delta` (as far as the formula's cell moves, when it is among the rows that move), and the
/// reference then names the rows at those places (`line`); one that would leave the sheet becomes `#REF!`, unless
/// the rows go round its end (`wrap`, the rows there are). A reference whose ends would be at those places anyway
/// (with the rows as they are after, `after`) stays as it is, its deleted rows too; putting rows in order (`wrap`)
/// leaves an end on a deleted row as it is whatever the other end does. References to other sheets stay as they are.
pub(crate) fn rewritten(
    workbook: &Workbook,
    formula: &StoredFormula,
    sheet: usize,
    delta: Option<i64>,
    line: &dyn Fn(usize) -> Option<LineId>,
    after: &Axis,
    wrap: Option<usize>,
) -> StoredFormula {
    let mut pieces = vec![formula.text_between_references[0].clone()];
    let mut references = Vec::new();
    for (i, reference) in formula.references.iter().enumerate() {
        let next = &formula.text_between_references[i + 1];
        let moved = if workbook.sheet_index(reference.sheet_id()) != Some(sheet) {
            Some(reference.clone())
        } else {
            moved_reference(workbook, reference, sheet, delta, line, after, wrap)
        };
        match moved {
            Some(r) => {
                references.push(r);
                pieces.push(next.clone());
            }
            None => {
                let last = pieces.last_mut().expect("a piece");
                last.push_str("#REF!");
                last.push_str(next);
            }
        }
    }
    StoredFormula { text_between_references: pieces, references }
}

fn moved_reference(
    workbook: &Workbook,
    reference: &Reference,
    sheet: usize,
    delta: Option<i64>,
    line: &dyn Fn(usize) -> Option<LineId>,
    after: &Axis,
    wrap: Option<usize>,
) -> Option<Reference> {
    let rows = &workbook.sheets[sheet].rows;
    let bases = &workbook.bases;
    // Each end of the rows where it is now (a deleted one gives way toward the other end), moved, and read again; an
    // end that is nowhere stays as it is. Where the end would be after the move as it is (`now`) tells whether it
    // changes.
    let changed = std::cell::Cell::new(false);
    let somewhere = std::cell::Cell::new(false);
    let row = |r: &mut String, fixed: bool, (place, now): (Option<usize>, Option<usize>)| -> Option<()> {
        somewhere.set(somewhere.get() || now.is_some());
        // Putting rows in order leaves an end on a deleted row as it is.
        if wrap.is_some() && bases.parse(r).is_some_and(|l| rows.is_deleted(l)) {
            return Some(());
        }
        let Some(p) = place else { return Some(()) };
        let to = p as i64 + if fixed { 0 } else { delta.unwrap_or(0) };
        let to = match wrap {
            Some(n) if n > 0 => to.rem_euclid(n as i64) as usize,
            _ => usize::try_from(to).ok()?,
        };
        let new = line(to)?;
        changed.set(changed.get() || now != Some(to));
        *r = bases.text(new);
        Some(())
    };
    let snap = |axis: &Axis, a: &str, b: &str| axis.snap_toward(bases.parse(a)?, bases.parse(b)?);
    let toward = |a: &str, b: &str| (snap(rows, a, b), snap(after, a, b));
    let mut r = reference.clone();
    let moved = (|| -> Option<()> {
        match &mut r {
            Reference::Cell { cell, .. } => {
                let place = toward(&cell.r, &cell.r);
                row(&mut cell.r, cell.is_row_absolute, place)?;
            }
            Reference::Range { top_left: a, bottom_right: b, .. } => {
                let (pa, pb) = (toward(&a.r, &b.r), toward(&b.r, &a.r));
                row(&mut a.r, a.is_row_absolute, pa)?;
                row(&mut b.r, b.is_row_absolute, pb)?;
            }
            Reference::Columns { top, .. } => {
                if let Some(top) = top {
                    let line = bases.parse(&top.r);
                    let place = (line.and_then(|l| rows.snap_forward(l)), line.and_then(|l| after.snap_forward(l)));
                    row(&mut top.r, top.is_row_absolute, place)?;
                }
            }
            Reference::Rows { top: a, bottom: b, .. } => {
                let (pa, pb) = (toward(&a.r, &b.r), toward(&b.r, &a.r));
                row(&mut a.r, a.is_row_absolute, pa)?;
                row(&mut b.r, b.is_row_absolute, pb)?;
            }
        }
        Some(())
    })();
    match moved {
        Some(()) if changed.get() => Some(r),
        Some(()) => Some(reference.clone()),
        // One already `#REF!` (its columns deleted, say), or that names no row once the rows move, stays as it is
        // when its rows would leave the sheet.
        None => (workbook.locate(reference).is_none() || !somewhere.get()).then(|| reference.clone()),
    }
}
