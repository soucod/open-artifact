//! A sheet duplicated: a new sheet after it with everything it holds, under new ids made of the edit's code (the
//! sheet `sht_<code>.0`, its rows `row_<code>.<n>` and columns `col_<code>.<n>` in the order of the sheet's lines,
//! deleted ones too, and its objects numbered from 0 each).
//!
//! The copy is named as asked when no sheet has that name, else the name and the first number from 2 that makes
//! one no sheet has.
//!
//! The copy is made with the checks of an edit, so what operations may leave in a sheet but an edit may not
//! make (a frozen row deleted, groups out of order, merged ranges overlapping or covering cells, …) refuses it.

use std::collections::BTreeMap;
use hashbrown::{HashMap, HashSet};

use serde_json::Value as Json;

use super::cell_tables::is_shown;
use super::{sheet, CopiedWidgetNode, Made, PlacedViews, Refused};
use crate::formula::{Reference, StoredFormula};
use crate::ids::{Axis, Bases, IdRun, LineId};
use crate::session::place::Place;
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{self, Leaf};
use crate::workbook::layout::{
    CellIds, ColumnsToSize, EndsOfGroup, Group, GroupPatch, GroupToSet, IdKey, RangeIds, RowsToSize,
    SheetSettings, SheetToSet,
};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{
    CellCondition, CellTable, CellTableToSet, ConditionalFormatPatch, ConditionalFormatToSet,
    DropdownOption, DropdownToSet, NamedViewToSet, NumberOperand, Placement, PlacementToSet,
    RowsOfACellTable, ShownByAPlacement, TestedCell, View, ViewToSet,
};
use crate::workbook::{Input, Sheet, Workbook};

const LONGEST_SHEET_NAME: usize = 100;
const DEEPEST_GROUP: usize = 7;
const SMALLEST_SIDE_OF_A_PLACEMENT: u32 = 40;
const LARGEST_SIDE_OF_A_PLACEMENT: u32 = 4000;
const LARGEST_OFFSET_OF_A_PLACEMENT: u32 = 2000;

fn is_taken(workbook: &Workbook, name: &str) -> bool {
    let name = name.to_lowercase();
    workbook.sheets.iter().any(|s| s.name.to_lowercase() == name)
}

/// At most `room` characters of a name, without the space around them.
fn cut(name: &str, room: usize) -> String {
    name.chars().take(room).collect::<String>().trim().to_owned()
}

/// The name a copy gets: the name asked for without its control characters and the space around it, cut to the
/// longest a name may be; when another sheet has that, it with the first of " 2", " 3", … no sheet has, cut to
/// make room for it. Nothing left of the name asked for gives none.
pub(in crate::session::edits) fn copy_name(workbook: &Workbook, asked: &str) -> Option<String> {
    let name = cut(asked.chars().filter(|c| !c.is_control()).collect::<String>().trim(), LONGEST_SHEET_NAME);
    if name.is_empty() {
        return None;
    }
    if !is_taken(workbook, &name) {
        return Some(name);
    }
    (2..).map(|n| format!(" {n}")).find_map(|suffix| {
        let copy = cut(&name, LONGEST_SHEET_NAME - suffix.chars().count()) + &suffix;
        (!is_taken(workbook, &copy)).then_some(copy)
    })
}

/// The ids of a sheet's lines in the copy: the `n`th line (deleted or not) is `<base>.<n>`.
struct Lines {
    base: String,
    numbers: HashMap<LineId, u32>,
}

impl Lines {
    fn of(base: String, lines: &[LineId]) -> Lines {
        Lines { base, numbers: lines.iter().enumerate().map(|(i, l)| (*l, i as u32)).collect() }
    }

    fn number(&self, bases: &Bases, id: &str) -> Option<u32> {
        self.numbers.get(&bases.parse(id)?).copied()
    }

    /// The id in the copy, or the id itself when it is not one of the sheet's lines.
    fn id(&self, bases: &Bases, id: &str) -> String {
        match self.number(bases, id) {
            Some(n) => format!("{}.{n}", self.base),
            None => id.to_owned(),
        }
    }

    fn line(&self, line: LineId) -> String {
        format!("{}.{}", self.base, self.numbers[&line])
    }

    fn run(&self, first: u32, count: u32) -> IdRun {
        IdRun { base: self.base.clone(), first, count }
    }
}

/// Numbers as runs of consecutive numbers.
fn runs(base: &str, numbers: impl Iterator<Item = u32>) -> Vec<IdRun> {
    let mut runs: Vec<IdRun> = Vec::new();
    for n in numbers {
        match runs.last_mut() {
            Some(run) if run.first + run.count == n => run.count += 1,
            _ => runs.push(IdRun { base: base.to_owned(), first: n, count: 1 }),
        }
    }
    runs
}

/// Sizes of lines as runs: consecutive lines of one size make one.
fn sizes(lines: &Lines, every: &[LineId], sizes: &HashMap<LineId, u32>) -> Vec<(IdRun, u32)> {
    let mut out: Vec<(IdRun, u32)> = Vec::new();
    for (i, line) in every.iter().enumerate() {
        let Some(&size) = sizes.get(line) else { continue };
        let n = i as u32;
        match out.last_mut() {
            Some((run, s)) if *s == size && run.first + run.count == n => run.count += 1,
            _ => out.push((lines.run(n, 1), size)),
        }
    }
    out
}

/// The views placed on the sheet, copied: each placement (in the order of their ids) shows a copy of its view on
/// the copy, `plc_<code>.<k>` showing `viw_<code>.<k>`, whose widgets (`vel_<code>.<n>`) show the nodes given for
/// theirs and read the copy where theirs read the sheet. A node no other view shows, and views and placements as
/// an edit may set them: one widget a view.
fn copied_views(
    workbook: &Workbook,
    s: &Sheet,
    nodes: &[CopiedWidgetNode],
    code: &str,
    new_id: &str,
    cell: &dyn Fn(&CellIds) -> CellIds,
) -> Result<(Vec<ViewToSet>, Vec<PlacementToSet>, Option<String>), Refused> {
    let copies: HashMap<&str, &str> = nodes.iter().map(|n| (n.source.as_str(), n.copy.as_str())).collect();
    let mut shown: HashSet<String> = workbook
        .views
        .values()
        .flat_map(|(_, v)| v.elements.iter().map(|element| element.parts().1.reference.clone()))
        .collect();
    let (mut views, mut placements, mut n) = (Vec::new(), Vec::new(), 0);
    let mut interactive = None;
    let shown_by = s.placements.values().map(|(_, placement)| (placement.shows.view_id(), Some(placement)))
        .chain(s.interactive.as_deref().map(|id| (id, None)));
    for (k, (id, placement)) in shown_by.enumerate() {
        let Some((_, view)) = workbook.views.get(id) else { continue };
        let mut elements = Vec::new();
        for original in &view.elements {
            let mut element = original.clone();
            let (element_id, embed, inputs) = element.parts_mut();
            let copy = *copies.get(embed.reference.as_str()).ok_or(Refused::Because("widgetNodeNotCopied"))?;
            if !shown.insert(copy.to_owned()) {
                return Err(Refused::Because("widgetNodeOfAnotherView"));
            }
            if placement.is_some() {
                for input in inputs.iter_mut().filter(|input| input.range.sheet_id == s.id) {
                    input.range.sheet_id = new_id.to_owned();
                    input.range.top_left = cell(&input.range.top_left);
                    input.range.bottom_right = cell(&input.range.bottom_right);
                }
            }
            embed.reference = copy.to_owned();
            *element_id = format!("vel_{code}.{n}");
            elements.push(element);
            n += 1;
        }
        let view_id = format!("viw_{code}.{k}");
        views.push(ViewToSet { view_id: view_id.clone(), view: Some(View { name: view.name.clone(), elements }) });
        if let Some(p) = placement {
            let placement = Placement {
                shows: ShownByAPlacement::View { view_id },
                top_left: cell(&p.top_left),
                offset_from_anchor_cell: p.offset_from_anchor_cell.clone(),
                width_in_pixels: p.width_in_pixels,
                height_in_pixels: p.height_in_pixels,
            };
            placements.push(PlacementToSet { placement_id: format!("plc_{code}.{k}"), placement: Some(placement) });
        } else {
            interactive = Some(view_id);
        }
    }
    for v in views.iter().filter_map(|v| v.view.as_ref()) {
        match v.elements.len() {
            0 => return Err(Refused::Because("viewHasNoElement")),
            1 => {}
            _ => return Err(Refused::Because("tooManyElementsInView")),
        }
    }
    let sides = SMALLEST_SIDE_OF_A_PLACEMENT..=LARGEST_SIDE_OF_A_PLACEMENT;
    for p in placements.iter().filter_map(|p| p.placement.as_ref()) {
        if !sides.contains(&p.width_in_pixels) || !sides.contains(&p.height_in_pixels) {
            return Err(Refused::Because("sizeOfPlacementNotAllowed"));
        }
        let offset = p.offset_from_anchor_cell.as_ref();
        if offset.is_some_and(|o| o.x_in_pixels.max(o.y_in_pixels) > LARGEST_OFFSET_OF_A_PLACEMENT) {
            return Err(Refused::Because("offsetOfPlacementNotAllowed"));
        }
    }
    Ok((views, placements, interactive))
}

/// Groups as an edit may leave them, looked at from the top (the outer of two that start together first): each
/// one's first end before its last; two the same, or overlapping but neither holding the other, refused; and no
/// deeper than the deepest.
fn check_groups(bases: &Bases, groups: &BTreeMap<IdKey, (String, Group)>, axis: &Axis) -> Result<(), Refused> {
    let at = |id: &str| bases.parse(id).and_then(|l| axis.position(l));
    let mut ends: Vec<(usize, usize)> =
        groups.values().filter_map(|(_, g)| Some((at(&g.ends.first)?, at(&g.ends.last)?))).collect();
    ends.sort_by_key(|&(f, l)| (f.min(l), std::cmp::Reverse(f.max(l))));
    let mut open: Vec<(usize, usize)> = Vec::new();
    for (first, last) in ends {
        if first > last {
            return Err(Refused::Because("groupEndsOutOfOrder"));
        }
        while open.last().is_some_and(|&(_, l)| l < first) {
            open.pop();
        }
        if let Some(&outer) = open.last() {
            if outer == (first, last) {
                return Err(Refused::Because("groupsCoverTheSame"));
            }
            if last > outer.1 {
                return Err(Refused::Because("groupsPartlyOverlap"));
            }
        }
        open.push((first, last));
        if open.len() > DEEPEST_GROUP {
            return Err(Refused::Because("groupsTooDeep"));
        }
    }
    Ok(())
}

/// What the edit's checks find in the copy, as the sheet holds it, in the order they are found: the lines
/// deleted taking the last frozen row or column or an end of a group, then groups, merged ranges overlapping, and cells under merged ranges (all but their top left) holding something.
fn check_copy(bases: &Bases, s: &Sheet) -> Result<(), Refused> {
    let ends_deleted = |groups: &BTreeMap<IdKey, (String, Group)>, axis: &Axis| {
        groups.values().any(|(_, g)| {
            [&g.ends.first, &g.ends.last].into_iter().any(|e| bases.parse(e).is_some_and(|l| axis.is_deleted(l)))
        })
    };
    if s.last_frozen_row.is_some_and(|r| s.rows.is_deleted(r)) {
        return Err(Refused::Because("lastFrozenRowWouldLeave"));
    }
    if ends_deleted(&s.row_groups, &s.rows) {
        return Err(Refused::Because("deleteTakesEndOfGroup"));
    }
    if s.last_frozen_column.is_some_and(|c| s.columns.is_deleted(c)) {
        return Err(Refused::Because("lastFrozenColumnWouldLeave"));
    }
    if ends_deleted(&s.column_groups, &s.columns) {
        return Err(Refused::Because("deleteTakesEndOfGroup"));
    }
    check_groups(bases, &s.row_groups, &s.rows)?;
    check_groups(bases, &s.column_groups, &s.columns)?;
    // A range left with one cell merges nothing, and overlaps nothing.
    let boxes: Vec<_> =
        s.merged_ranges.iter().filter_map(|m| s.live_box(bases, m)).filter(|&(t, b, l, r)| (t, l) != (b, r)).collect();
    for (i, &(t, b, l, r)) in boxes.iter().enumerate() {
        if boxes[i + 1..].iter().any(|&(t2, b2, l2, r2)| t <= b2 && t2 <= b && l <= r2 && l2 <= r) {
            return Err(Refused::Because("mergedRangesOverlap"));
        }
    }
    let covered = |r: usize, c: usize| {
        boxes.iter().any(|&(t, b, l, x)| (t..=b).contains(&r) && (l..=x).contains(&c) && (r, c) != (t, l))
    };
    let at = |&(r, c): &(LineId, LineId)| Some((s.rows.position(r)?, s.columns.position(c)?));
    if s.cells.keys().filter_map(at).any(|(r, c)| covered(r, c)) {
        return Err(Refused::Because("cellCoveredByMergedRange"));
    }
    Ok(())
}

pub(super) fn duplicate(
    workbook: &Workbook,
    sheet_id: &str,
    name: &str,
    placed_views: Option<&PlacedViews>,
    code: &str,
) -> Result<Made, Refused> {
    let s = sheet(workbook, sheet_id)?;
    let bases = &workbook.bases;
    let new_id = format!("sht_{code}.0");
    let rows = Lines::of(format!("row_{code}"), s.rows.every_line());
    let columns = Lines::of(format!("col_{code}"), s.columns.every_line());
    let cell = |c: &CellIds| CellIds { r: rows.id(bases, &c.r), c: columns.id(bases, &c.c) };
    let range = |r: &RangeIds| RangeIds { top_left: cell(&r.top_left), bottom_right: cell(&r.bottom_right) };
    let sheet_id_of = |id: &str| if id == sheet_id { new_id.clone() } else { id.to_owned() };
    let (views, placements, interactive) = match placed_views {
        Some(PlacedViews::Copied { copied_widget_nodes }) => {
            copied_views(workbook, s, copied_widget_nodes, code, &new_id, &cell)?
        }
        _ if s.interactive.is_some() => return Err(Refused::Because("widgetNodeNotCopied")),
        _ => (Vec::new(), Vec::new(), None),
    };
    let copy_name = copy_name(workbook, name).ok_or(Refused::Because("sheetNameNotAllowed"))?;

    let mut ops = vec![
        Op::InsertSheet { sheet_id: new_id.clone(), name: copy_name, after: Some(sheet_id.to_owned()) },
        Op::InsertRows { sheet_id: new_id.clone(), after: None, rows: rows.run(0, s.rows.total() as u32) },
        Op::InsertColumns { sheet_id: new_id.clone(), after: None, columns: columns.run(0, s.columns.total() as u32) },
    ];
    let widths = sizes(&columns, s.columns.every_line(), &s.column_widths);
    if !widths.is_empty() {
        let widths =
            widths.into_iter().map(|(columns, w)| ColumnsToSize { columns, width_in_pixels: Some(w) }).collect();
        ops.push(Op::SetColumnWidths { sheet_id: new_id.clone(), widths });
    }
    let heights = sizes(&rows, s.rows.every_line(), &s.row_heights);
    if !heights.is_empty() {
        let heights = heights.into_iter().map(|(rows, h)| RowsToSize { rows, height_in_pixels: Some(h) }).collect();
        ops.push(Op::SetRowHeights { sheet_id: new_id.clone(), heights });
    }

    // Dropdowns: each numbered in the order of their ids, their options numbered on through all of them; only the
    // ones the sheet's cells use are copied.
    let mut dropdown_ids: HashMap<&str, String> = HashMap::new();
    let mut option_ids: HashMap<&str, (String, &str)> = HashMap::new();
    let mut m = 0;
    for (k, (id, options)) in s.dropdowns.values().enumerate() {
        dropdown_ids.insert(id, format!("ddn_{code}.{k}"));
        for o in options {
            option_ids.insert(&o.option_id, (format!("opt_{code}.{m}"), id));
            m += 1;
        }
    }
    let live = |(r, c): (LineId, LineId)| s.rows.contains(r) && s.columns.contains(c);
    let mut used: Vec<&str> = Vec::new();
    for (leaf, at, v) in s.formats.iter() {
        if leaf == Leaf::CellControl && live(at) {
            if let Some(id) = v["dropdownId"].as_str() {
                used.push(id);
            }
        }
    }
    let mut cells: Vec<((usize, usize), LineId, LineId, &Input)> = s
        .cells
        .iter()
        .filter_map(|(&(r, c), cell)| Some(((s.rows.position(r)?, s.columns.position(c)?), r, c, &cell.input)))
        .collect();
    cells.sort_by_key(|x| x.0);
    for (.., input) in &cells {
        if let Input::DropdownOption { option_id, .. } = input {
            let (_, dropdown) = option_ids.get(option_id.as_str()).ok_or(Refused::Because("idNotWellFormed"))?;
            used.push(dropdown);
        }
    }
    let dropdowns: Vec<DropdownToSet> = s
        .dropdowns
        .values()
        .filter(|(id, _)| used.contains(&id.as_str()))
        .map(|(id, options)| DropdownToSet {
            dropdown_id: dropdown_ids[id.as_str()].clone(),
            options: Some(
                options
                    .iter()
                    .map(|o| DropdownOption { option_id: option_ids[o.option_id.as_str()].0.clone(), ..o.clone() })
                    .collect(),
            ),
        })
        .collect();
    if !dropdowns.is_empty() {
        ops.push(Op::SetDropdowns { sheet_id: new_id.clone(), dropdowns });
    }

    // Formats, as blocks of the copy's ids: those of deleted lines too, but for number formats. A block with one is
    // split where its runs of rows, or of columns, are all deleted: those parts keep the rest of its format.
    let mut new_bases = bases.clone();
    let (row_base, column_base) = (new_bases.intern(&rows.base), new_bases.intern(&columns.base));
    let copied: Vec<(Leaf, (LineId, LineId), Json)> = s
        .formats
        .iter()
        .filter(|(leaf, (r, c), v)| {
            // A dropdown is copied only when a cell shown uses it: a deleted cell's control of another is left behind.
            let control = *leaf == Leaf::CellControl && v["dropdownId"].as_str().is_some_and(|id| !used.contains(&id));
            rows.numbers.contains_key(r) && columns.numbers.contains_key(c) && !control
        })
        .map(|(leaf, (r, c), v)| {
            let at =
                (LineId { base: row_base, n: rows.numbers[&r] }, LineId { base: column_base, n: columns.numbers[&c] });
            let mut v = v.clone();
            if leaf == Leaf::CellControl {
                if let Some(id) = v["dropdownId"].as_str().and_then(|id| dropdown_ids.get(id)) {
                    v["dropdownId"] = Json::String(id.clone());
                }
            }
            (leaf, at, v)
        })
        .collect();
    let (every_row, every_column) = (s.rows.every_line(), s.columns.every_line());
    let is_any_left = |run: &IdRun, every: &[LineId], axis: &Axis| {
        (run.first..run.first + run.count).any(|n| every.get(n as usize).is_some_and(|&l| axis.contains(l)))
    };
    let mut blocks = Vec::new();
    for (r, c, leaves) in formats::leaf_blocks(&new_bases, copied.iter().map(|(l, at, v)| (*l, *at, v))) {
        if !leaves.contains_key(&Leaf::NumberFormat) {
            blocks.push((r, c, formats::write_format(&leaves)));
            continue;
        }
        let mut rest = leaves.clone();
        rest.remove(&Leaf::NumberFormat);
        let (left_r, gone_r): (Vec<IdRun>, Vec<IdRun>) =
            r.iter().cloned().partition(|run| is_any_left(run, every_row, &s.rows));
        let (left_c, gone_c): (Vec<IdRun>, Vec<IdRun>) =
            c.iter().cloned().partition(|run| is_any_left(run, every_column, &s.columns));
        if left_r.is_empty() || left_c.is_empty() {
            if !rest.is_empty() {
                blocks.push((r, c, formats::write_format(&rest)));
            }
            continue;
        }
        blocks.push((left_r.clone(), left_c, formats::write_format(&leaves)));
        if !rest.is_empty() {
            if !gone_r.is_empty() {
                blocks.push((gone_r, c, formats::write_format(&rest)));
            }
            if !gone_c.is_empty() {
                blocks.push((left_r, gone_c, formats::write_format(&rest)));
            }
        }
    }
    if !blocks.is_empty() {
        let formats =
            blocks.into_iter().map(|(rows, columns, format)| CellsToFormat { rows, columns, format }).collect();
        ops.push(Op::SetCellFormats { sheet_id: new_id.clone(), formats });
    }

    // A frozen row or column deleted is copied too (and refused when the copy deletes it).
    let frozen_row = s.last_frozen_row.filter(|r| rows.numbers.contains_key(r));
    let frozen_column = s.last_frozen_column.filter(|c| columns.numbers.contains_key(c));
    if frozen_row.is_some() || frozen_column.is_some() || s.are_gridlines_hidden {
        let settings = SheetSettings {
            last_frozen_row: frozen_row.map(|r| Some(rows.line(r))),
            last_frozen_column: frozen_column.map(|c| Some(columns.line(c))),
            are_gridlines_hidden: s.are_gridlines_hidden.then_some(true),
            interactive: None,
        };
        ops.push(Op::SetSheetSettings { sheets: vec![SheetToSet { sheet_id: new_id.clone(), settings }] });
    }

    let groups = |groups: &std::collections::BTreeMap<IdKey, (String, Group)>, lines: &Lines, prefix: &str| {
        groups
            .values()
            .enumerate()
            .map(|(k, (_, g))| GroupToSet {
                group_id: format!("{prefix}_{code}.{k}"),
                group: Some(GroupPatch {
                    ends: Some(EndsOfGroup {
                        first: lines.id(bases, &g.ends.first),
                        last: lines.id(bases, &g.ends.last),
                    }),
                    is_collapsed: Some(g.is_collapsed),
                }),
            })
            .collect::<Vec<_>>()
    };
    if !s.row_groups.is_empty() {
        ops.push(Op::SetRowGroups { sheet_id: new_id.clone(), groups: groups(&s.row_groups, &rows, "rgr") });
    }
    if !s.column_groups.is_empty() {
        ops.push(Op::SetColumnGroups { sheet_id: new_id.clone(), groups: groups(&s.column_groups, &columns, "cgr") });
    }

    if !s.conditional_formats.is_empty() {
        let mut all: Vec<_> = s.conditional_formats.iter().collect();
        all.sort_by(|a, b| (a.1 .1.priority, a.0).cmp(&(b.1 .1.priority, b.0)));
        let conditional_formats = all
            .into_iter()
            .enumerate()
            .map(|(k, (_, (_, cf)))| {
                let mut effect = cf.effect.clone();
                if let crate::workbook::objects::Effect::FormatWhere { all_of, .. } = &mut effect {
                    for test in all_of {
                        if let TestedCell::SameRowInColumn { c } = &mut test.tested {
                            *c = columns.id(bases, c);
                        }
                        let operands = match &mut test.condition {
                            CellCondition::NumberIs { operand, .. } => vec![operand],
                            CellCondition::NumberIsBetween { one_end, other_end }
                            | CellCondition::NumberIsNotBetween { one_end, other_end } => vec![one_end, other_end],
                            _ => vec![],
                        };
                        for operand in operands {
                            if let NumberOperand::SameRowInColumn { c } = operand {
                                *c = columns.id(bases, c);
                            }
                        }
                    }
                }
                ConditionalFormatToSet {
                    conditional_format_id: format!("cfm_{code}.{k}"),
                    conditional_format: Some(ConditionalFormatPatch {
                        ranges: Some(cf.ranges.iter().map(range).collect()),
                        priority: Some(k as i32),
                        effect: Some(effect),
                    }),
                }
            })
            .collect();
        ops.push(Op::SetConditionalFormats { sheet_id: new_id.clone(), conditional_formats });
    }

    let deleted = |every: &[LineId], is_deleted: &dyn Fn(LineId) -> bool| {
        (0..every.len() as u32).filter(|&i| is_deleted(every[i as usize])).collect::<Vec<u32>>()
    };
    let deleted_rows = deleted(s.rows.every_line(), &|l| s.rows.is_deleted(l));
    if !deleted_rows.is_empty() {
        ops.push(Op::DeleteRows { sheet_id: new_id.clone(), rows: crate::ids::listed_runs::RowRuns::written(runs(&rows.base, deleted_rows.into_iter())) });
    }
    let deleted_columns = deleted(s.columns.every_line(), &|l| s.columns.is_deleted(l));
    if !deleted_columns.is_empty() {
        let columns = runs(&columns.base, deleted_columns.into_iter());
        ops.push(Op::DeleteColumns { sheet_id: new_id.clone(), columns });
    }

    if !s.merged_ranges.is_empty() {
        // The copy's merges are kept by their corners' ids, compared as text.
        let mut ranges: Vec<RangeIds> = s.merged_ranges.iter().map(range).collect();
        let key =
            |m: &RangeIds| [&m.top_left.r, &m.top_left.c, &m.bottom_right.r, &m.bottom_right.c].map(|t| t.clone());
        ranges.sort_by_key(key);
        ops.push(Op::MergeCells { sheet_id: new_id.clone(), ranges });
    }

    // The cell tables the sheet shows, each numbered by its place among all the sheet holds.
    let shown: Vec<_> = s.cell_tables.values().enumerate().filter(|(_, (_, t))| is_shown(bases, s, t)).collect();
    let named_views = s.named_views.values().enumerate().map(|(n, (_, view))| {
        let mut view = view.clone();
        if let Some((table, _)) = shown.iter().find(|(_, (id, _))| *id == view.cell_table_id) {
            view.cell_table_id = format!("ctb_{code}.{table}");
        }
        view.move_columns(|id| Some(columns.id(bases, id)));
        NamedViewToSet { named_view_id: format!("nvw_{code}.{n}"), named_view: Some(view) }
    }).collect::<Vec<_>>();
    if !named_views.is_empty() {
        ops.push(Op::SetNamedViews { sheet_id: new_id.clone(), named_views });
    }
    if !shown.is_empty() {
        let rows_of = |r: &RowsOfACellTable| RowsOfACellTable {
            first_row: rows.id(bases, &r.first_row),
            last_row: rows.id(bases, &r.last_row),
        };
        let cell_tables = shown
            .iter()
            .map(|(k, (_, t))| CellTableToSet {
                cell_table_id: format!("ctb_{code}.{k}"),
                cell_table: Some(CellTable {
                    header_rows: rows_of(&t.header_rows),
                    first_column: columns.id(bases, &t.first_column),
                    last_column: columns.id(bases, &t.last_column),
                    footer_rows: t.footer_rows.as_ref().map(rows_of),
                }),
            })
            .collect();
        ops.push(Op::SetCellTables { sheet_id: new_id.clone(), cell_tables });
    }

    let point = |sheet: &str, r: &mut String, c: &mut String| {
        if sheet == sheet_id {
            *r = rows.id(bases, r);
            *c = columns.id(bases, c);
        }
    };
    // The cells go in the order of their ids' text.
    let mut cells: Vec<CellToSet> = cells
        .into_iter()
        .map(|(_, r, c, input)| {
            let input = match input {
                Input::Formula { formula } => {
                    let references = formula
                        .references
                        .iter()
                        .map(|reference| {
                            let mut reference = reference.clone();
                            match &mut reference {
                                Reference::Cell { sheet_id: id, cell } => {
                                    point(id, &mut cell.r, &mut cell.c);
                                    *id = sheet_id_of(id);
                                }
                                Reference::Range { sheet_id: id, top_left, bottom_right } => {
                                    point(id, &mut top_left.r, &mut top_left.c);
                                    point(id, &mut bottom_right.r, &mut bottom_right.c);
                                    *id = sheet_id_of(id);
                                }
                                Reference::Columns { sheet_id: id, left, right, top } => {
                                    if id == sheet_id {
                                        left.c = columns.id(bases, &left.c);
                                        right.c = columns.id(bases, &right.c);
                                        if let Some(top) = top {
                                            top.r = rows.id(bases, &top.r);
                                        }
                                    }
                                    *id = sheet_id_of(id);
                                }
                                Reference::Rows { sheet_id: id, top, bottom, left } => {
                                    if id == sheet_id {
                                        top.r = rows.id(bases, &top.r);
                                        bottom.r = rows.id(bases, &bottom.r);
                                        if let Some(left) = left {
                                            left.c = columns.id(bases, &left.c);
                                        }
                                    }
                                    *id = sheet_id_of(id);
                                }
                            }
                            reference
                        })
                        .collect();
                    let text_between_references = formula.text_between_references.clone();
                    Input::Formula { formula: StoredFormula { text_between_references, references } }
                }
                Input::DropdownOption { option_id, label } => {
                    Input::DropdownOption { option_id: option_ids[option_id.as_str()].0.clone(), label: label.clone() }
                }
                input => input.clone(),
            };
            CellToSet { r: rows.line(r), c: columns.line(c), input: Some(input) }
        })
        .collect();
    cells.sort_by(|a, b| (&a.r, &a.c).cmp(&(&b.r, &b.c)));
    if !cells.is_empty() {
        ops.push(Op::SetCells { sheet_id: new_id.clone(), cells, form: CellForm::Auto });
    }
    if !views.is_empty() {
        ops.push(Op::SetViews { views });
    }
    if !placements.is_empty() {
        ops.push(Op::SetPlacements { sheet_id: new_id.clone(), placements });
    }
    if let Some(interactive) = interactive {
        let settings = SheetSettings { interactive: Some(Some(interactive)), ..SheetSettings::default() };
        ops.push(Op::SetSheetSettings { sheets: vec![SheetToSet { sheet_id: new_id.clone(), settings }] });
    }
    check_copy(bases, s)?;
    Ok(Made { ops, place: Some(Place::sheet(&new_id)) })
}
