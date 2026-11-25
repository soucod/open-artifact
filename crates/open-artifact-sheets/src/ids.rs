//! Ids: a workbook names its sheets, rows and columns by ids, never by position, so that edits made on different
//! revisions (another tab's, an agent's) land on the same cells.
//!
//! A sheet id is a string (`sht_<code>.<n>`). Rows and columns come in runs: an edit that inserts 1000 rows names
//! them `row_<code>.0` … `row_<code>.999`, written as one run `{base: "row_<code>", first: 0, count: 1000}`. The
//! `<code>` is the `newIdCode` the page gave the edit (ten letters), so ids made on different pages never meet.

use hashbrown::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// A run of row (or column) ids: `base.first`, `base.(first+1)`, …, `base.(first+count-1)`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdRun {
    pub base: String,
    pub first: u32,
    pub count: u32,
}

/// One row or column id, its base interned: `base.n`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LineId {
    pub base: u32,
    pub n: u32,
}

/// The bases of a workbook's row and column ids, each kept once.
#[derive(Clone, Debug, Default)]
pub struct Bases {
    names: Vec<String>,
    index: HashMap<String, u32>,
}

impl Bases {
    pub fn intern(&mut self, base: &str) -> u32 {
        if let Some(&i) = self.index.get(base) {
            return i;
        }
        let i = self.names.len() as u32;
        self.names.push(base.to_owned());
        self.index.insert(base.to_owned(), i);
        i
    }

    pub fn find(&self, base: &str) -> Option<u32> {
        self.index.get(base).copied()
    }

    pub fn name(&self, base: u32) -> &str {
        &self.names[base as usize]
    }

    /// `row_<code>.12` as a line id, when its base is known.
    pub fn parse(&self, id: &str) -> Option<LineId> {
        let (base, n) = split_id(id)?;
        Some(LineId { base: self.find(base)?, n })
    }

    /// The text of a line id: `base.n`.
    pub fn text(&self, id: LineId) -> String {
        // Written by hand: a workbook's every cell is told by its row's and its column's id.
        let name = self.name(id.base);
        let mut digits = [0u8; 10];
        let mut at = digits.len();
        let mut n = id.n;
        loop {
            at -= 1;
            digits[at] = b'0' + (n % 10) as u8;
            n /= 10;
            if n == 0 {
                break;
            }
        }
        let mut text = String::with_capacity(name.len() + 1 + digits.len() - at);
        text.push_str(name);
        text.push('.');
        text.push_str(std::str::from_utf8(&digits[at..]).expect("ascii digits"));
        text
    }
}

/// `row_<code>.12` → (`row_<code>`, 12).
pub fn split_id(id: &str) -> Option<(&str, u32)> {
    let dot = id.rfind('.')?;
    let n = &id[dot + 1..];
    if n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) || (n.len() > 1 && n.starts_with('0')) {
        return None;
    }
    Some((&id[..dot], n.parse().ok()?))
}

/// Whether an id of a kind is well formed, `<prefix>_<code>.<n>`: a code of 8 to 16 small letters and
/// digits, a number without leading zeros. Operations take any id, but an edit writing one of another kind (or not
/// so made) is refused `idNotWellFormed`.
pub fn is_well_formed(id: &str, prefix: &str) -> bool {
    let Some((base, _)) = split_id(id) else { return false };
    let Some(code) = base.strip_prefix(prefix).and_then(|rest| rest.strip_prefix('_')) else { return false };
    (8..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// The rows (or the columns) of a sheet, in order. A deleted line keeps its place (undeleting it puts it back
/// there, and lines can be inserted or moved after it) but has no position: positions count the lines not deleted.
#[derive(Clone, Debug, Default)]
pub struct Axis {
    /// Every line the sheet has had, deleted or not, in order.
    all: Vec<LineId>,
    /// Each line's index in `all`.
    indices: HashMap<LineId, usize>,
    deleted: HashSet<LineId>,
    /// The lines not deleted, in order, and their positions.
    lines: Vec<LineId>,
    positions: HashMap<LineId, usize>,
    /// For each index of `all` (and one past the end), how many lines before it are not deleted.
    live_before: Vec<usize>,
}

impl Axis {
    /// Builds a snapshot axis in one pass, keeping deleted lines in their original positions.
    pub(crate) fn from_snapshot(all: Vec<LineId>, deleted: HashSet<LineId>) -> Option<Self> {
        let mut axis = Self { all, deleted, ..Self::default() };
        axis.reindex();
        (axis.all.len() == axis.indices.len() && axis.deleted.iter().all(|&id| axis.knows(id))).then_some(axis)
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    /// Every line the sheet has had, deleted or not, in order.
    pub fn every(&self) -> &[LineId] {
        &self.all
    }

    /// How many lines the sheet has had, deleted or not.
    pub fn total(&self) -> usize {
        self.all.len()
    }

    /// Every line the sheet has had, deleted or not, in order.
    pub fn every_line(&self) -> &[LineId] {
        &self.all
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    pub fn line(&self, position: usize) -> Option<LineId> {
        self.lines.get(position).copied()
    }

    /// A line's position, when it is not deleted.
    pub fn position(&self, line: LineId) -> Option<usize> {
        self.positions.get(&line).copied()
    }

    /// Whether the line is in the sheet and not deleted.
    pub fn contains(&self, line: LineId) -> bool {
        self.positions.contains_key(&line)
    }

    /// Every line the sheet has had, deleted or not, in order.
    pub fn all(&self) -> &[LineId] {
        &self.all
    }

    /// A line's index in `all`, deleted or not.
    pub fn index(&self, line: LineId) -> Option<usize> {
        self.indices.get(&line).copied()
    }

    /// Whether the line is in the sheet, deleted or not.
    pub fn knows(&self, line: LineId) -> bool {
        self.indices.contains_key(&line)
    }

    pub fn is_deleted(&self, line: LineId) -> bool {
        self.deleted.contains(&line)
    }

    /// The lines deleted, in no order.
    pub fn deleted(&self) -> impl Iterator<Item = LineId> + '_ {
        self.deleted.iter().copied()
    }

    /// The position of the line, or of the nearest line not deleted from it toward `toward` (the other end of a
    /// range), `toward` included; `None` when every line from one to the other is deleted.
    pub fn snap_toward(&self, line: LineId, toward: LineId) -> Option<usize> {
        if let Some(p) = self.position(line) {
            return Some(p);
        }
        let (i, j) = (*self.indices.get(&line)?, *self.indices.get(&toward)?);
        if j >= i {
            let p = self.live_before[i];
            (p < self.live_before[j + 1]).then_some(p)
        } else {
            let after = self.live_before[i + 1];
            (after > self.live_before[j]).then(|| after - 1)
        }
    }

    /// The position of the line, or of the first line not deleted after it; `None` when there is none.
    pub fn snap_forward(&self, line: LineId) -> Option<usize> {
        if let Some(p) = self.position(line) {
            return Some(p);
        }
        let p = self.live_before[*self.indices.get(&line)?];
        (p < self.lines.len()).then_some(p)
    }

    /// Inserts a run of new lines after `after` (deleted or not; at the start when `None`).
    pub fn insert_after(&mut self, after: Option<LineId>, base: u32, first: u32, count: u32) -> Result<(), AxisError> {
        let at = match after {
            None => 0,
            Some(line) => *self.indices.get(&line).ok_or(AxisError::Unknown)? + 1,
        };
        let new: Vec<LineId> = (first as u64..first as u64 + count as u64).map(|n| LineId { base, n: n as u32 }).collect();
        if new.iter().any(|l| self.indices.contains_key(l)) {
            return Err(AxisError::Taken);
        }
        self.all.splice(at..at, new);
        self.reindex();
        Ok(())
    }

    /// Deletes lines (each one in the sheet and not deleted).
    pub fn delete(&mut self, lines: &[LineId]) {
        self.deleted.extend(lines.iter().copied());
        self.reindex();
    }

    /// Undeletes lines (each one deleted).
    pub fn undelete(&mut self, lines: &[LineId]) {
        for line in lines {
            self.deleted.remove(line);
        }
        self.reindex();
    }

    /// Moves lines: each move's lines, in its order, go after its line (at the start when `None`). The lines
    /// moved are all taken out first, so no move's line is one that moves, and no two moves go to one place.
    /// Answers the moves that put them back: the moved lines in their old order, each stretch of them after the
    /// line that was before it.
    pub fn move_lines(&mut self, moves: &[(Vec<LineId>, Option<LineId>)]) -> Vec<(Vec<LineId>, Option<LineId>)> {
        let (all, back) = move_items(&self.all, moves);
        self.all = all;
        self.reindex();
        back
    }

    /// Puts lines (each in the axis) in an order among themselves, in the places they take: the first of `lines`
    /// where the first of them is, and so on; every other line (deleted ones too) stays where it is.
    pub fn reorder(&mut self, lines: &[LineId]) {
        let mut places: Vec<usize> = lines.iter().map(|l| self.indices[l]).collect();
        places.sort_unstable();
        for (&place, &line) in places.iter().zip(lines) {
            self.all[place] = line;
        }
        self.reindex();
    }

    /// The lines as runs: consecutive ids of one base make one run.
    pub fn runs(&self, bases: &Bases) -> Vec<IdRun> {
        runs_of(&self.lines, bases)
    }

    /// The axis with its lines from `from` on (not deleted) in another order, `lines`: the deleted lines where they
    /// were.
    pub(crate) fn reordered(&self, from: usize, lines: &[LineId]) -> Axis {
        let mut all = self.all.clone();
        let mut p = 0;
        for line in all.iter_mut() {
            if self.deleted.contains(line) {
                continue;
            }
            if (from..from + lines.len()).contains(&p) {
                *line = lines[p - from];
            }
            p += 1;
        }
        let mut axis = Axis { all, deleted: self.deleted.clone(), ..Axis::default() };
        axis.reindex();
        axis
    }

    fn reindex(&mut self) {
        self.indices.clear();
        self.lines.clear();
        self.positions.clear();
        self.live_before.clear();
        for (i, &line) in self.all.iter().enumerate() {
            self.indices.insert(line, i);
            self.live_before.push(self.lines.len());
            if !self.deleted.contains(&line) {
                self.positions.insert(line, self.lines.len());
                self.lines.push(line);
            }
        }
        self.live_before.push(self.lines.len());
    }
}

/// Moves items of a list: each move's items, in its order, go after its item (at the start when `None`). The items
/// moved are all taken out first (no move goes after an item that moves, and no two moves go to one place). Answers
/// the list, and the moves that put it back: the moved items in their old order, each stretch of them after the
/// item that was before it.
pub fn move_items<T: Copy + Eq + std::hash::Hash>(items: &[T], moves: &[(Vec<T>, Option<T>)]) -> (Vec<T>, Vec<(Vec<T>, Option<T>)>) {
    let moved: HashSet<T> = moves.iter().flat_map(|(items, _)| items.iter().copied()).collect();
    let mut back: Vec<(Vec<T>, Option<T>)> = Vec::new();
    let mut previous: Option<T> = None;
    let mut in_stretch = false;
    for &item in items {
        if moved.contains(&item) {
            if in_stretch {
                back.last_mut().expect("a stretch").0.push(item);
            } else {
                back.push((vec![item], previous));
                in_stretch = true;
            }
        } else {
            in_stretch = false;
        }
        previous = Some(item);
    }
    let after: HashMap<Option<T>, &[T]> = moves.iter().map(|(items, a)| (*a, items.as_slice())).collect();
    let mut out = Vec::with_capacity(items.len());
    if let Some(m) = after.get(&None) {
        out.extend_from_slice(m);
    }
    for &item in items {
        if moved.contains(&item) {
            continue;
        }
        out.push(item);
        if let Some(m) = after.get(&Some(item)) {
            out.extend_from_slice(m);
        }
    }
    (out, back)
}

/// Lines as runs: consecutive ids of one base make one run.
pub fn runs_of(lines: &[LineId], bases: &Bases) -> Vec<IdRun> {
    let mut runs: Vec<IdRun> = Vec::new();
    let mut last: Option<LineId> = None;
    for &line in lines {
        match (runs.last_mut(), last) {
            (Some(run), Some(prev)) if prev.base == line.base && prev.n.checked_add(1) == Some(line.n) => run.count += 1,
            _ => runs.push(IdRun { base: bases.name(line.base).to_owned(), first: line.n, count: 1 }),
        }
        last = Some(line);
    }
    runs
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AxisError {
    /// The line to insert after is not in the sheet.
    Unknown,
    /// One of the new ids is already in the sheet.
    Taken,
}

/// Runs of ids as a list of runs of each base (format 43): `{base, runs: [[first, count], …]}`, each base once, its
/// runs in order with a gap between them; a list holds runs in this form or none. The rows of cells to format are
/// written so when there are 100 runs or more; rows deleted or undeleted are read so too.
pub mod listed_runs {
    use super::IdRun;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use serde_json::Value as Json;

    /// The fewest runs written as lists.
    pub const FEWEST: usize = 100;

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<IdRun>, D::Error> {
        let items = Vec::<Json>::deserialize(deserializer)?;
        read(items).ok_or_else(|| serde::de::Error::custom("runs not readable"))
    }

    fn read(items: Vec<Json>) -> Option<Vec<IdRun>> {
        if !items.iter().any(|item| item.get("runs").is_some()) {
            return items.into_iter().map(|item| IdRun::deserialize(item).ok()).collect();
        }
        let mut bases = Vec::new();
        let mut out = Vec::new();
        for item in items {
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Listed {
                base: String,
                runs: Vec<(u32, u32)>,
            }
            let Listed { base, runs } = Listed::deserialize(item).ok()?;
            if runs.is_empty() || bases.contains(&base) {
                return None;
            }
            let mut end: Option<u64> = None;
            for &(first, count) in &runs {
                if count == 0 || end.is_some_and(|end| u64::from(first) <= end) {
                    return None;
                }
                end = Some(u64::from(first) + u64::from(count));
                out.push(IdRun { base: base.clone(), first, count });
            }
            bases.push(base);
        }
        Some(out)
    }

    pub fn serialize<S: Serializer>(runs: &[IdRun], serializer: S) -> Result<S::Ok, S::Error> {
        if runs.len() < FEWEST {
            return runs.serialize(serializer);
        }
        written(runs).serialize(serializer)
    }

    /// Rows deleted or undeleted, and whether they are written as lists of runs: as they were read, and from
    /// `FEWEST` runs on in an edit made here. The reverse of an operation keeps its form (the rows of `apply` are given back as
    /// they were given, 100 runs written one by one too).
    #[derive(Clone, Debug, Default, PartialEq, Eq)]
    pub struct RowRuns {
        pub runs: Vec<IdRun>,
        pub listed: bool,
    }

    impl RowRuns {
        /// Rows an edit deletes or undeletes, listed from `FEWEST` runs on.
        pub fn written(runs: Vec<IdRun>) -> Self {
            let listed = runs.len() >= FEWEST;
            RowRuns { runs, listed }
        }

        /// Other runs in the same form.
        pub fn like(&self, runs: Vec<IdRun>) -> Self {
            RowRuns { runs, listed: self.listed }
        }
    }

    impl std::ops::Deref for RowRuns {
        type Target = Vec<IdRun>;
        fn deref(&self) -> &Vec<IdRun> {
            &self.runs
        }
    }

    impl std::ops::DerefMut for RowRuns {
        fn deref_mut(&mut self) -> &mut Vec<IdRun> {
            &mut self.runs
        }
    }

    impl Serialize for RowRuns {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            match self.listed {
                true => written(&self.runs).serialize(serializer),
                false => self.runs.serialize(serializer),
            }
        }
    }

    impl<'de> Deserialize<'de> for RowRuns {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            let items = Vec::<Json>::deserialize(deserializer)?;
            let listed = items.iter().any(|item| item.get("runs").is_some());
            let runs = read(items).ok_or_else(|| serde::de::Error::custom("runs not readable"))?;
            Ok(RowRuns { runs, listed })
        }
    }

    /// The runs as lists of each base, in the order the bases come.
    fn written(runs: &[IdRun]) -> Vec<Json> {
        let mut bases: Vec<(&str, Vec<[u32; 2]>)> = Vec::new();
        for run in runs {
            match bases.iter_mut().find(|(base, _)| *base == run.base) {
                Some((_, list)) => list.push([run.first, run.count]),
                None => bases.push((&run.base, vec![[run.first, run.count]])),
            }
        }
        bases.into_iter().map(|(base, runs)| serde_json::json!({"base": base, "runs": runs})).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_ids() {
        assert_eq!(split_id("row_abc.12"), Some(("row_abc", 12)));
        assert_eq!(split_id("row_abc.012"), None);
        assert_eq!(split_id("row_abc"), None);
    }

    #[test]
    fn writes_ids() {
        let mut bases = Bases::default();
        let base = bases.intern("row_abc");
        for n in [0, 7, 10, 99, 1000, 123_456_789, u32::MAX] {
            assert_eq!(bases.text(LineId { base, n }), format!("row_abc.{n}"));
        }
    }

    #[test]
    fn keeps_runs() {
        let mut bases = Bases::default();
        let a = bases.intern("row_a");
        let b = bases.intern("row_b");
        let mut axis = Axis::default();
        axis.insert_after(None, a, 0, 10).unwrap();
        axis.insert_after(Some(LineId { base: a, n: 4 }), b, 0, 2).unwrap();
        let runs = axis.runs(&bases);
        assert_eq!(runs.len(), 3);
        assert_eq!(axis.position(LineId { base: a, n: 5 }), Some(7));
    }

    #[test]
    fn deleted_lines_keep_their_place() {
        let mut bases = Bases::default();
        let a = bases.intern("row_a");
        let l = |n| LineId { base: a, n };
        let mut axis = Axis::default();
        axis.insert_after(None, a, 0, 6).unwrap();
        axis.delete(&[l(1), l(2)]);
        assert_eq!(axis.len(), 4);
        assert_eq!(axis.position(l(3)), Some(1));
        assert_eq!(axis.snap_toward(l(1), l(4)), Some(1));
        assert_eq!(axis.snap_toward(l(2), l(0)), Some(0));
        assert_eq!(axis.snap_toward(l(1), l(2)), None);
        assert_eq!(axis.snap_forward(l(1)), Some(1));
        axis.insert_after(Some(l(1)), bases.intern("row_b"), 0, 1).unwrap();
        axis.undelete(&[l(1)]);
        assert_eq!(axis.position(l(1)), Some(1));
        assert_eq!(axis.line(2).map(|x| x.base), Some(1));
    }

    #[test]
    fn moves_and_moves_back() {
        let items: Vec<u32> = (0..8).collect();
        let (moved, back) = move_items(&items, &[(vec![2, 0], Some(5)), (vec![6], None)]);
        assert_eq!(moved, vec![6, 1, 3, 4, 5, 2, 0, 7]);
        assert_eq!(back, vec![(vec![0], None), (vec![2], Some(1)), (vec![6], Some(5))]);
        let (again, _) = move_items(&moved, &back);
        assert_eq!(again, items);
    }
}
