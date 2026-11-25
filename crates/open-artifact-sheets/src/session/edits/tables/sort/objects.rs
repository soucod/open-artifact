//! What a sort does to the groups of rows: they follow what the rows hold, split where that parts. Each group that
//! changes is set again, and its id has to be well formed. (Conditional formats, placements and widgets' ranges keep
//! naming the places they named: putting rows in order keeps them, `reorder.rs`; sorting cells leaves them.)

use super::super::well_formed;
use super::Refused;
use crate::ids::LineId;
use crate::workbook::layout::{live_ends, EndsOfGroup, GroupPatch, GroupToSet};
use crate::workbook::load::Op;
use crate::workbook::{Sheet, Workbook};

/// How a sort moved what the rows from `top` hold: `order[k]` is the position of the row whose cells are now at
/// `top + k`. Sorting rows moves the rows themselves; sorting cells moves only what they hold.
pub(super) struct Moved<'a> {
    pub sheet: &'a Sheet,
    pub top: usize,
    pub order: &'a [usize],
    pub rows_move: bool,
    /// Where what each sorted row held goes.
    new_place: Vec<usize>,
    /// The positions from the first that changes to the last (what `moveRows` moves).
    block: Option<(usize, usize)>,
}

impl<'a> Moved<'a> {
    pub fn new(sheet: &'a Sheet, top: usize, order: &'a [usize], rows_move: bool) -> Moved<'a> {
        let mut new_place = vec![0; order.len()];
        for (k, &p) in order.iter().enumerate() {
            new_place[p - top] = top + k;
        }
        let changed = |(k, &p): (usize, &usize)| p != top + k;
        let first = order.iter().enumerate().position(changed);
        let last = order.iter().enumerate().rposition(changed);
        let block = first.zip(last).map(|(i, j)| (top + i, top + j));
        Moved { sheet, top, order, rows_move, new_place, block }
    }

    fn sorts(&self, p: usize) -> bool {
        (self.top..self.top + self.order.len()).contains(&p)
    }

    /// Where what the row at `p` held is now.
    fn destination(&self, p: usize) -> usize {
        if self.sorts(p) { self.new_place[p - self.top] } else { p }
    }

    /// The row at `p` once sorted.
    fn row_after(&self, p: usize) -> LineId {
        let p = if self.rows_move && self.sorts(p) { self.order[p - self.top] } else { p };
        self.sheet.rows.line(p).expect("a live row")
    }
}

/// The rows of each group that meets what moved, where what they held went: a group whose rows stay together gets
/// its new ends; one that parts keeps its id for its first piece and the others get new ones (`rgr_<code>.<n>`),
/// each as collapsed as it was. Sorting rows sets every group that has an end among the rows moved or lies within
/// them; sorting cells, those that change.
pub(super) fn groups(workbook: &Workbook, moved: &Moved, code: &str) -> Result<Option<Op>, Refused> {
    let (s, bases) = (moved.sheet, &workbook.bases);
    let mut out = Vec::new();
    let mut new_ids = 0;
    for (id, g) in s.row_groups.values() {
        let (Some(a), Some(b)) = (bases.parse(&g.ends.first), bases.parse(&g.ends.last)) else { continue };
        let Some((first, last)) = live_ends(&s.rows, a, b) else { continue };
        let mut places: Vec<usize> = (first..=last).map(|p| moved.destination(p)).collect();
        places.sort_unstable();
        let mut pieces: Vec<(usize, usize)> = Vec::new();
        for p in places {
            match pieces.last_mut() {
                Some(piece) if piece.1 + 1 == p => piece.1 = p,
                _ => pieces.push((p, p)),
            }
        }
        let counts = match moved.block {
            _ if !moved.rows_move => pieces != [(first, last)],
            // One holding every row moved, its ends outside them, is left as it is.
            Some((i, j)) => first <= j && i <= last && !(first < i && j < last),
            None => false,
        };
        if !counts {
            continue;
        }
        well_formed(id, "rgr")?;
        let ends = |(f, l): (usize, usize)| EndsOfGroup {
            first: bases.text(moved.row_after(f)),
            last: bases.text(moved.row_after(l)),
        };
        if let [piece] = pieces[..] {
            let group = GroupPatch { ends: Some(ends(piece)), is_collapsed: None };
            out.push(GroupToSet { group_id: id.clone(), group: Some(group) });
            continue;
        }
        for (k, piece) in pieces.into_iter().enumerate() {
            let group_id = if k == 0 {
                id.clone()
            } else {
                new_ids += 1;
                format!("rgr_{code}.{}", new_ids - 1)
            };
            let group = GroupPatch { ends: Some(ends(piece)), is_collapsed: Some(g.is_collapsed) };
            out.push(GroupToSet { group_id, group: Some(group) });
        }
    }
    Ok((!out.is_empty()).then(|| Op::SetRowGroups { sheet_id: s.id.clone(), groups: out }))
}
