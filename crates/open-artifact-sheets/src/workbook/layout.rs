//! How a sheet is laid out: merged ranges, column widths and row heights, its settings (frozen rows and columns,
//! gridlines) and its groups of rows and columns.
//!
//! All of it names rows and columns by id, as formulas do, and keeps what it names when they are deleted: what is
//! read back (`readWorkbook`) is where it is now. A range's ends give way toward each other when deleted, and a
//! range with nothing left between them is not read back (it comes back when its rows are undeleted).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use hashbrown::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::formats::id_order;
use super::load::{Lines, Op, Refusal};
use super::{Sheet, Workbook};
use crate::ids::{Axis, Bases, IdRun, LineId};

/// A cell by its row and column ids.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellIds {
    pub r: String,
    pub c: String,
}

/// A range by its corners, as written (they need not be in order).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RangeIds {
    pub top_left: CellIds,
    pub bottom_right: CellIds,
}

/// The key an object's id is kept by: the id itself, so they are ordered by their text.
pub type IdKey = String;

pub fn id_key(id: &str) -> IdKey {
    id.to_owned()
}

/// Where two ends of an axis are now: each snapped toward the other, in order.
pub fn live_ends(axis: &Axis, a: LineId, b: LineId) -> Option<(usize, usize)> {
    let (pa, pb) = (axis.snap_toward(a, b)?, axis.snap_toward(b, a)?);
    Some((pa.min(pb), pa.max(pb)))
}

impl Sheet {
    /// A range's cells now, as a range in order; `None` when it has none left.
    pub fn live_range(&self, bases: &Bases, range: &RangeIds) -> Option<RangeIds> {
        let (t, b) = live_ends(&self.rows, bases.parse(&range.top_left.r)?, bases.parse(&range.bottom_right.r)?)?;
        let (l, r) = live_ends(&self.columns, bases.parse(&range.top_left.c)?, bases.parse(&range.bottom_right.c)?)?;
        let row = |p| bases.text(self.rows.line(p).expect("a live position"));
        let column = |p| bases.text(self.columns.line(p).expect("a live position"));
        Some(RangeIds { top_left: CellIds { r: row(t), c: column(l) }, bottom_right: CellIds { r: row(b), c: column(r) } })
    }

    /// The live positions of a range: (top, bottom, left, right).
    pub fn live_box(&self, bases: &Bases, range: &RangeIds) -> Option<(usize, usize, usize, usize)> {
        let (t, b) = live_ends(&self.rows, bases.parse(&range.top_left.r)?, bases.parse(&range.bottom_right.r)?)?;
        let (l, r) = live_ends(&self.columns, bases.parse(&range.top_left.c)?, bases.parse(&range.bottom_right.c)?)?;
        Some((t, b, l, r))
    }
}

/// Widths of columns (or heights of rows) to set: `null` puts back the default.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnsToSize {
    pub columns: IdRun,
    #[serde(deserialize_with = "written::maybe_null")] 
    pub width_in_pixels: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowsToSize {
    pub rows: IdRun,
    #[serde(deserialize_with = "written::maybe_null")] 
    pub height_in_pixels: Option<u32>,
}

/// How a request's values are read where being left out and being `null` differ (serde reads both as `None`;
/// an operation is refused that leaves out a value it needs, even one that may be `null`).
pub mod written {
    use serde::{Deserialize, Deserializer};

    /// May be left out (`None`), or written as `null` (`Some(None)`). With `#[serde(default)]`.
    pub fn read<'de, T: Deserialize<'de>, D: Deserializer<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }

    /// May be left out, but not written as `null`. With `#[serde(default)]`.
    pub fn not_null<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
        T::deserialize(d).map(Some)
    }

    /// Written, perhaps as `null`: left out, the request is unreadable. Without `default`.
    pub fn maybe_null<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
        Option::<T>::deserialize(d)
    }
}

/// A sheet's settings: the last frozen row and column (`null`: none), and whether gridlines are hidden. As set,
/// only the ones written change.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetSettings {
    #[serde(default, deserialize_with = "written::read", skip_serializing_if = "Option::is_none")]
    pub last_frozen_row: Option<Option<String>>,
    #[serde(default, deserialize_with = "written::read", skip_serializing_if = "Option::is_none")]
    pub last_frozen_column: Option<Option<String>>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub are_gridlines_hidden: Option<bool>,
    #[serde(default, deserialize_with = "written::read", skip_serializing_if = "Option::is_none")]
    pub interactive: Option<Option<String>>,
}

impl SheetSettings {
    fn is_empty(&self) -> bool {
        self.last_frozen_row.is_none() && self.last_frozen_column.is_none()
            && self.are_gridlines_hidden.is_none() && self.interactive.is_none()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetToSet {
    pub sheet_id: String,
    pub settings: SheetSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndsOfGroup {
    pub first: String,
    pub last: String,
}

/// A group of rows or columns: its first and last line, and whether it is collapsed. As set, a group already
/// there changes only in what is written.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupPatch {
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub ends: Option<EndsOfGroup>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub is_collapsed: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupToSet {
    pub group_id: String,
    #[serde(deserialize_with = "written::maybe_null")] 
    pub group: Option<GroupPatch>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub ends: EndsOfGroup,
    pub is_collapsed: bool,
}

impl Op {
    pub(super) fn layout_well_formed(&self) -> Option<bool> {
        let run = |r: &IdRun| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32;
        Some(match self {
            Op::MergeCells { ranges, .. } | Op::UnmergeCells { ranges, .. } => !ranges.is_empty(),
            Op::SetColumnWidths { widths, .. } => !widths.is_empty() && widths.iter().all(|w| run(&w.columns)),
            Op::SetRowHeights { heights, .. } => !heights.is_empty() && heights.iter().all(|h| run(&h.rows)),
            Op::SetSheetSettings { sheets } => !sheets.is_empty() && sheets.iter().all(|s| !s.settings.is_empty()),
            Op::SetRowGroups { groups, .. } | Op::SetColumnGroups { groups, .. } => {
                !groups.is_empty() && groups.iter().all(|g| g.group.as_ref().is_none_or(|p| p.ends.is_some() || p.is_collapsed.is_some()))
            }
            _ => return None,
        })
    }
}

impl Workbook {
    /// A live line of the sheet by its id.
    pub(super) fn live_line(&self, sheet: &Sheet, lines: Lines, id: &str) -> Result<LineId, Refusal> {
        self.line(id).filter(|l| lines.axis_of(sheet).contains(*l)).ok_or(lines.unknown())
    }

    /// A line of the sheet by its id, deleted or not.
    pub(super) fn known_line(&self, sheet: &Sheet, lines: Lines, id: &str) -> Result<LineId, Refusal> {
        self.line(id).filter(|l| lines.axis_of(sheet).knows(*l)).ok_or(lines.unknown())
    }

    /// A cell of the sheet by its ids, its row and column deleted or not.
    pub(super) fn known_cell(&self, sheet: &Sheet, cell: &CellIds) -> Result<(LineId, LineId), Refusal> {
        Ok((self.known_line(sheet, Lines::Rows, &cell.r)?, self.known_line(sheet, Lines::Columns, &cell.c)?))
    }

    pub(super) fn apply_layout(&mut self, op: &Op) -> Result<Op, Refusal> {
        match op {
            Op::MergeCells { sheet_id, ranges } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let sheet = &self.sheets[index];
                let mut seen = HashSet::new();
                for range in ranges {
                    self.known_cell(sheet, &range.top_left)?;
                    self.known_cell(sheet, &range.bottom_right)?;
                    if sheet.merged_ranges.contains(range) || !seen.insert(range) {
                        return Err(Refusal::RangeAlreadyMerged);
                    }
                }
                self.sheets[index].merged_ranges.extend(ranges.iter().cloned());
                Ok(Op::UnmergeCells { sheet_id: sheet_id.clone(), ranges: ranges.clone() })
            }
            Op::UnmergeCells { sheet_id, ranges } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let sheet = &mut self.sheets[index];
                let mut seen = HashSet::new();
                if !ranges.iter().all(|r| sheet.merged_ranges.contains(r) && seen.insert(r)) {
                    return Err(Refusal::RangeNotMerged);
                }
                sheet.merged_ranges.retain(|r| !ranges.contains(r));
                Ok(Op::MergeCells { sheet_id: sheet_id.clone(), ranges: ranges.clone() })
            }
            Op::SetColumnWidths { sheet_id, widths } => {
                let sizes: Vec<(&IdRun, Option<u32>)> = widths.iter().map(|w| (&w.columns, w.width_in_pixels)).collect();
                let back = self.set_sizes(sheet_id, Lines::Columns, &sizes)?;
                let widths = back.into_iter().map(|(columns, width_in_pixels)| ColumnsToSize { columns, width_in_pixels }).collect();
                Ok(Op::SetColumnWidths { sheet_id: sheet_id.clone(), widths })
            }
            Op::SetRowHeights { sheet_id, heights } => {
                let sizes: Vec<(&IdRun, Option<u32>)> = heights.iter().map(|h| (&h.rows, h.height_in_pixels)).collect();
                let back = self.set_sizes(sheet_id, Lines::Rows, &sizes)?;
                let heights = back.into_iter().map(|(rows, height_in_pixels)| RowsToSize { rows, height_in_pixels }).collect();
                Ok(Op::SetRowHeights { sheet_id: sheet_id.clone(), heights })
            }
            Op::SetSheetSettings { sheets } => {
                let mut seen = HashSet::new();
                if !sheets.iter().all(|s| seen.insert(&s.sheet_id)) {
                    return Err(Refusal::SheetSettingsSetTwice);
                }
                let mut checked = Vec::with_capacity(sheets.len());
                for s in sheets {
                    let index = self.sheet_index(&s.sheet_id).ok_or(Refusal::UnknownSheet)?;
                    let sheet = &self.sheets[index];
                    let row = match &s.settings.last_frozen_row {
                        Some(Some(id)) => Some(Some(self.live_line(sheet, Lines::Rows, id)?)),
                        Some(None) => Some(None),
                        None => None,
                    };
                    let column = match &s.settings.last_frozen_column {
                        Some(Some(id)) => Some(Some(self.live_line(sheet, Lines::Columns, id)?)),
                        Some(None) => Some(None),
                        None => None,
                    };
                    if let Some(Some(id)) = &s.settings.interactive {
                        if !self.views.contains_key(id.as_str()) {
                            return Err(Refusal::UnknownView);
                        }
                    }
                    checked.push((index, row, column, s.settings.are_gridlines_hidden));
                }
                let mut reverse = Vec::with_capacity(sheets.len());
                for (s, (index, row, column, hidden)) in sheets.iter().zip(checked) {
                    let bases = &self.bases;
                    let sheet = &mut self.sheets[index];
                    let mut old = SheetSettings::default();
                    if let Some(row) = row {
                        old.last_frozen_row = Some(std::mem::replace(&mut sheet.last_frozen_row, row).map(|l| bases.text(l)));
                    }
                    if let Some(column) = column {
                        old.last_frozen_column =
                            Some(std::mem::replace(&mut sheet.last_frozen_column, column).map(|l| bases.text(l)));
                    }
                    if let Some(hidden) = hidden {
                        old.are_gridlines_hidden = Some(std::mem::replace(&mut sheet.are_gridlines_hidden, hidden));
                    }
                    if let Some(interactive) = &s.settings.interactive {
                        old.interactive = Some(std::mem::replace(&mut sheet.interactive, interactive.clone()));
                    }
                    reverse.push(SheetToSet { sheet_id: s.sheet_id.clone(), settings: old });
                }
                Ok(Op::SetSheetSettings { sheets: reverse })
            }
            Op::SetRowGroups { sheet_id, groups } | Op::SetColumnGroups { sheet_id, groups } => {
                let lines = if matches!(op, Op::SetRowGroups { .. }) { Lines::Rows } else { Lines::Columns };
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut seen = HashSet::new();
                if !groups.iter().all(|g| seen.insert(&g.group_id)) {
                    return Err(Refusal::GroupNamedTwice);
                }
                let sheet = &self.sheets[index];
                let existing = match lines {
                    Lines::Rows => &sheet.row_groups,
                    Lines::Columns => &sheet.column_groups,
                };
                for g in groups {
                    if let Some(patch) = &g.group {
                        if let Some(ends) = &patch.ends {
                            self.live_line(sheet, lines, &ends.first)?;
                            self.live_line(sheet, lines, &ends.last)?;
                        }
                        let known = existing.contains_key(&id_key(&g.group_id));
                        if !known && (patch.ends.is_none() || patch.is_collapsed.is_none()) {
                            return Err(Refusal::UnknownGroup);
                        }
                    }
                }
                let sheet = &mut self.sheets[index];
                let existing = match lines {
                    Lines::Rows => &mut sheet.row_groups,
                    Lines::Columns => &mut sheet.column_groups,
                };
                let mut reverse = Vec::with_capacity(groups.len());
                for g in groups {
                    let key = id_key(&g.group_id);
                    let old = existing.get(&key).cloned();
                    let back = match (&g.group, &old) {
                        (_, None) => None,
                        (None, Some((_, old))) => Some(GroupPatch { ends: Some(old.ends.clone()), is_collapsed: Some(old.is_collapsed) }),
                        (Some(patch), Some((_, old))) => Some(GroupPatch {
                            ends: patch.ends.as_ref().map(|_| old.ends.clone()),
                            is_collapsed: patch.is_collapsed.map(|_| old.is_collapsed),
                        }),
                    };
                    match &g.group {
                        None => {
                            existing.remove(&key);
                        }
                        Some(patch) => {
                            let entry = existing.entry(key).or_insert_with(|| {
                                (g.group_id.clone(), Group { ends: EndsOfGroup { first: String::new(), last: String::new() }, is_collapsed: false })
                            });
                            if let Some(ends) = &patch.ends {
                                entry.1.ends = ends.clone();
                            }
                            if let Some(c) = patch.is_collapsed {
                                entry.1.is_collapsed = c;
                            }
                        }
                    }
                    reverse.push(GroupToSet { group_id: g.group_id.clone(), group: back });
                }
                Ok(match lines {
                    Lines::Rows => Op::SetRowGroups { sheet_id: sheet_id.clone(), groups: reverse },
                    Lines::Columns => Op::SetColumnGroups { sheet_id: sheet_id.clone(), groups: reverse },
                })
            }
            _ => unreachable!("not a layout operation"),
        }
    }

    /// Sets widths of columns or heights of rows; answers the old ones, in id order, as runs of the same size.
    fn set_sizes(&mut self, sheet_id: &str, lines: Lines, sizes: &[(&IdRun, Option<u32>)]) -> Result<Vec<(IdRun, Option<u32>)>, Refusal> {
        let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        let sheet = &self.sheets[index];
        let axis = lines.axis_of(sheet);
        let mut named = Vec::new();
        let mut seen = HashSet::new();
        for (run, size) in sizes {
            let ids = self.lines_of(std::slice::from_ref(*run), axis.total()).ok_or(lines.unknown())?;
            for id in ids {
                if !axis.contains(id) {
                    return Err(lines.unknown());
                }
                if !seen.insert(id) {
                    return Err(lines.named_twice());
                }
                named.push((id, *size));
            }
        }
        let bases = &self.bases;
        let sheet = &mut self.sheets[index];
        let map = match lines {
            Lines::Rows => &mut sheet.row_heights,
            Lines::Columns => &mut sheet.column_widths,
        };
        let mut old: Vec<(LineId, Option<u32>)> = Vec::with_capacity(named.len());
        for (id, size) in named {
            let before = match size {
                Some(s) => map.insert(id, s),
                None => map.remove(&id),
            };
            old.push((id, before));
        }
        old.sort_by(|a, b| id_order(bases, a.0, b.0));
        let mut runs: Vec<(IdRun, Option<u32>)> = Vec::new();
        for (id, size) in old {
            if let Some((last, s)) = runs.last_mut() {
                if *s == size && last.base == bases.name(id.base) && last.first as u64 + last.count as u64 == id.n as u64 {
                    last.count += 1;
                    continue;
                }
            }
            runs.push((IdRun { base: bases.name(id.base).to_owned(), first: id.n, count: 1 }, size));
        }
        Ok(runs)
    }
}

/// Sizes of the lines not deleted, in the order of the axis, as runs of ids in a row with the same size.
pub fn sizes_contents(bases: &Bases, axis: &Axis, sizes: &HashMap<LineId, u32>, key: &str, value: &str) -> Vec<Value> {
    let mut runs: Vec<(IdRun, u32)> = Vec::new();
    let mut last_position = None;
    for p in 0..axis.len() {
        let line = axis.line(p).expect("a live position");
        let Some(&size) = sizes.get(&line) else { continue };
        if let Some((run, s)) = runs.last_mut() {
            if last_position == Some(p - 1)
                && *s == size
                && run.base == bases.name(line.base)
                && run.first as u64 + run.count as u64 == line.n as u64
            {
                run.count += 1;
                last_position = Some(p);
                continue;
            }
        }
        runs.push((IdRun { base: bases.name(line.base).to_owned(), first: line.n, count: 1 }, size));
        last_position = Some(p);
    }
    runs.into_iter().map(|(run, size)| json!({ key: run, value: size })).collect()
}

/// A sheet's merged ranges as read back: where they are now, top to bottom and then left to right. A range with
/// nothing left is left out, and so is one that overlaps a range before it: each cell is merged once. Of two that
/// start in one cell, the first is the first by its ids as stored, compared as text (so `row_….10` comes before
/// `row_….3`, and a range given bottom right first goes by the corner given first), not the smaller or the larger.
pub fn merged_contents(bases: &Bases, sheet: &Sheet) -> Vec<Value> {
    let row = |p| bases.text(sheet.rows.line(p).expect("a live position"));
    let column = |p| bases.text(sheet.columns.line(p).expect("a live position"));
    read_back(bases, sheet)
        .into_iter()
        .map(|((t, b, l, r), range)| {
            json!({
                "range": range,
                "liveTopLeft": CellIds { r: row(t), c: column(l) },
                "liveBottomRight": CellIds { r: row(b), c: column(r) },
            })
        })
        .collect()
}

/// Where a sheet's merged ranges are now, as `merged_contents` reads them back: (top, bottom, left, right) of each.
/// The cells of one but its top left are hidden.
pub fn merged_boxes(bases: &Bases, sheet: &Sheet) -> Vec<(usize, usize, usize, usize)> {
    read_back(bases, sheet).into_iter().map(|(at, _)| at).collect()
}

/// The merged ranges read back, each with where it is now (top, bottom, left, right).
fn read_back<'a>(bases: &Bases, sheet: &'a Sheet) -> Vec<((usize, usize, usize, usize), &'a RangeIds)> {
    fn text(range: &RangeIds) -> (&str, &str, &str, &str) {
        let (a, b) = (&range.top_left, &range.bottom_right);
        (&a.r, &a.c, &b.r, &b.c)
    }
    let mut live: Vec<((usize, usize, usize, usize), &RangeIds)> =
        sheet.merged_ranges.iter().filter_map(|range| Some((sheet.live_box(bases, range)?, range))).collect();
    live.sort_by(|((t, _, l, _), x), ((t2, _, l2, _), y)| (t, l).cmp(&(t2, l2)).then_with(|| text(x).cmp(&text(y))));
    let mut kept: Vec<((usize, usize, usize, usize), &RangeIds)> = Vec::new();
    for ((t, b, l, r), range) in live {
        // A range left with one cell merges nothing: it is not read back, and does not hide one it overlaps.
        if t == b && l == r {
            continue;
        }
        if kept.iter().any(|&((t2, b2, l2, r2), _)| t <= b2 && t2 <= b && l <= r2 && l2 <= r) {
            continue;
        }
        kept.push(((t, b, l, r), range));
    }
    kept
}

/// A sheet's groups on one axis as read back: where they are now, outer ones first, each with its depth. A group
/// with no lines left, or that crosses the end of one it starts in, is left out.
pub fn groups_contents(bases: &Bases, axis: &Axis, groups: &BTreeMap<IdKey, (String, Group)>) -> Vec<Value> {
    let mut live: Vec<(usize, usize, &String, &Group)> = groups
        .values()
        .filter_map(|(id, g)| {
            let (first, last) = live_ends(axis, bases.parse(&g.ends.first)?, bases.parse(&g.ends.last)?)?;
            Some((first, last, id, g))
        })
        .collect();
    live.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)).then_with(|| Ordering::Equal));
    let mut open: Vec<usize> = Vec::new();
    let mut out = Vec::new();
    for (first, last, id, g) in live {
        while open.last().is_some_and(|&end| end < first) {
            open.pop();
        }
        if open.last().is_some_and(|&end| end < last) {
            continue;
        }
        open.push(last);
        // Groups nest at most seven deep: deeper ones are left out.
        if open.len() > 7 {
            open.pop();
            continue;
        }
        let text = |p: usize| bases.text(axis.line(p).expect("a live position"));
        out.push(json!({
            "groupId": id,
            "ends": {"first": text(first), "last": text(last)},
            "isCollapsed": g.is_collapsed,
            "depth": open.len(),
        }));
    }
    out
}
