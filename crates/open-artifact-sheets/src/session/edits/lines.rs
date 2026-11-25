//! Rows and columns: their sizes, inserted, deleted, moved, hidden and grouped; a sheet's settings.
//!
//! Kinds: setColumnWidths, setRowHeights, fitColumns, setSheetSettings, insertRows, insertColumns, deleteRows,
//! deleteColumns, moveRows, moveColumns, hideRows, hideColumns, groupRows, groupColumns, ungroupRows, ungroupColumns,
//! setRowGroupsCollapsed, setColumnGroupsCollapsed, showRowGroupsToDepth, showColumnGroupsToDepth.
//!
//! Lines are named by id: a stretch of them by its two ends (`oneColumn`, `otherColumn`, in either order), which must
//! be in the sheet and not deleted, or as runs of ids (`rows`), of which the ones in the sheet count. Hiding lines
//! is collapsing a group over them. What else follows the lines inserted, deleted or moved (the frozen line, groups,
//! tables, conditional formats) is in `follow`.

use std::collections::BTreeMap;
use hashbrown::HashSet;

use serde::Deserialize;
use serde_json::Value as Json;

use super::{Context, Made, Refused};
use crate::ids::{is_well_formed, runs_of, Axis, Bases, IdRun, LineId};
use crate::session::place::{self, Place};
use crate::workbook::formats::sorted_runs;
use crate::workbook::layout::{
    written, ColumnsToSize, Group, GroupToSet, IdKey, RangeIds, RowsToSize, SheetSettings, SheetToSet,
};
use crate::workbook::load::{ColumnMove, Op, RowMove};
use crate::workbook::{Sheet, Workbook};

pub(in crate::session) mod fit;
pub(super) mod follow;
pub(super) mod groups;

/// The narrowest and widest a column may be, and the lowest and highest a row, in pixels.
pub(super) const NARROWEST_COLUMN: u32 = 8;
pub(super) const WIDEST_COLUMN: u32 = 2000;
const LOWEST_ROW: u32 = 8;
const HIGHEST_ROW: u32 = 2000;
/// How deep groups may nest.
const DEEPEST_GROUP: usize = 7;

/// A column fitted no narrower than this.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoNarrowerThan {
    column: String,
    width_in_pixels: u32,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    SetColumnWidths { sheet_id: String, one_column: String, other_column: String, width_in_pixels: u32 },
    #[serde(rename_all = "camelCase")]
    SetRowHeights {
        sheet_id: String,
        rows: Vec<IdRun>,
        #[serde(deserialize_with = "written::maybe_null")]
        height_in_pixels: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    FitColumns { sheet_id: String, one_column: String, other_column: String, no_narrower_than: Vec<NoNarrowerThan> },
    #[serde(rename_all = "camelCase")]
    SetSheetSettings { sheet_id: String, settings: SheetSettings },
    #[serde(rename_all = "camelCase")]
    InsertRows {
        sheet_id: String,
        #[serde(deserialize_with = "written::maybe_null")]
        after_row: Option<String>,
        count: u32,
        #[serde(default)]
        formats_from_row: Option<String>,
        #[serde(default)]
        groups_from_row: Option<String>,
        #[serde(default)]
        formulas_from_row: Option<String>,
        #[serde(default)]
        values_from_filter: Option<Json>,
    },
    #[serde(rename_all = "camelCase")]
    InsertColumns {
        sheet_id: String,
        #[serde(deserialize_with = "written::maybe_null")]
        after_column: Option<String>,
        count: u32,
        #[serde(default)]
        formats_from_column: Option<String>,
        #[serde(default)]
        groups_from_column: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    DeleteRows { sheet_id: String, rows: Vec<IdRun> },
    #[serde(rename_all = "camelCase")]
    DeleteColumns { sheet_id: String, one_column: String, other_column: String },
    #[serde(rename_all = "camelCase")]
    MoveRows {
        sheet_id: String,
        one_row: String,
        other_row: String,
        #[serde(deserialize_with = "written::maybe_null")]
        after_row: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    MoveColumns {
        sheet_id: String,
        one_column: String,
        other_column: String,
        #[serde(deserialize_with = "written::maybe_null")]
        after_column: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    HideRows { sheet_id: String, rows: Vec<IdRun> },
    #[serde(rename_all = "camelCase")]
    HideColumns { sheet_id: String, one_column: String, other_column: String },
    #[serde(rename_all = "camelCase")]
    GroupRows { sheet_id: String, one_row: String, other_row: String },
    #[serde(rename_all = "camelCase")]
    GroupColumns { sheet_id: String, one_column: String, other_column: String },
    #[serde(rename_all = "camelCase")]
    UngroupRows { sheet_id: String, one_row: String, other_row: String },
    #[serde(rename_all = "camelCase")]
    UngroupColumns { sheet_id: String, one_column: String, other_column: String },
    #[serde(rename_all = "camelCase")]
    SetRowGroupsCollapsed { sheet_id: String, group_ids: Vec<String>, is_collapsed: bool },
    #[serde(rename_all = "camelCase")]
    SetColumnGroupsCollapsed { sheet_id: String, group_ids: Vec<String>, is_collapsed: bool },
    #[serde(rename_all = "camelCase")]
    ShowRowGroupsToDepth { sheet_id: String, depth: u32 },
    #[serde(rename_all = "camelCase")]
    ShowColumnGroupsToDepth { sheet_id: String, depth: u32 },
}

impl Edit {
    /// Whether the edit measures what cells show (`fitColumns`): formulas waiting for `calculate` are worked out
    /// first, as `calculate` would.
    pub fn measures_values(&self) -> bool {
        matches!(self, Edit::FitColumns { .. })
    }
}

/// Whether runs read: some, none of no ids or of ids past the largest.
fn are_readable(runs: &[IdRun]) -> bool {
    !runs.is_empty() && runs.iter().all(|r| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32)
}

/// The edit as the session reads it, before anything else about it: no runs, no settings, no groups or no lines to
/// insert is unreadable, and so are values from a filter (not supported).
pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    let readable = match &edit {
        Edit::SetRowHeights { rows, .. } | Edit::DeleteRows { rows, .. } | Edit::HideRows { rows, .. } => {
            are_readable(rows)
        }
        Edit::SetSheetSettings { settings, .. } => {
            settings.last_frozen_row.is_some()
                || settings.last_frozen_column.is_some()
                || settings.are_gridlines_hidden.is_some()
                || settings.interactive.is_some()
        }
        Edit::InsertRows { count, values_from_filter, .. } => *count > 0 && values_from_filter.is_none(),
        Edit::InsertColumns { count, .. } => *count > 0,
        Edit::SetRowGroupsCollapsed { group_ids, .. } | Edit::SetColumnGroupsCollapsed { group_ids, .. } => {
            !group_ids.is_empty()
        }
        _ => true,
    };
    readable.then_some(edit)
}

/// Rows or columns: what an edit of either works on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lines {
    Rows,
    Columns,
}

impl Lines {
    pub fn axis(self, sheet: &Sheet) -> &Axis {
        match self {
            Lines::Rows => &sheet.rows,
            Lines::Columns => &sheet.columns,
        }
    }

    pub fn other(self) -> Lines {
        match self {
            Lines::Rows => Lines::Columns,
            Lines::Columns => Lines::Rows,
        }
    }

    pub fn groups(self, sheet: &Sheet) -> &BTreeMap<IdKey, (String, Group)> {
        match self {
            Lines::Rows => &sheet.row_groups,
            Lines::Columns => &sheet.column_groups,
        }
    }

    pub fn set_groups(self, sheet_id: &str, groups: Vec<GroupToSet>) -> Op {
        let sheet_id = sheet_id.to_owned();
        match self {
            Lines::Rows => Op::SetRowGroups { sheet_id, groups },
            Lines::Columns => Op::SetColumnGroups { sheet_id, groups },
        }
    }

    /// What the ids of new groups start with.
    pub fn group_prefix(self) -> &'static str {
        match self {
            Lines::Rows => "rgr",
            Lines::Columns => "cgr",
        }
    }

    /// What the ids of new lines start with.
    fn line_prefix(self) -> &'static str {
        match self {
            Lines::Rows => "row",
            Lines::Columns => "col",
        }
    }

    fn unknown(self) -> Refused {
        Refused::Because(match self {
            Lines::Rows => "unknownRow",
            Lines::Columns => "unknownColumn",
        })
    }

    /// The whole lines from `first` to `last` (positions), across the sheet.
    fn whole(self, sheet: &Sheet, (first, last): (usize, usize)) -> Place {
        let across = match self.other().axis(sheet).len() {
            0 => return Place::sheet(&sheet.id),
            n => n - 1,
        };
        match self {
            Lines::Rows => Place::cells(&sheet.id, first, 0, last, across),
            Lines::Columns => Place::cells(&sheet.id, 0, first, across, last),
        }
    }
}

pub fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let made = make_ops(workbook, edit, context)?;
    if !ids_well_formed(&made.ops) {
        return Err(Refused::Because("idNotWellFormed"));
    }
    Ok(made)
}

/// Whether the ids of the groups, conditional formats and tables the operations change are well formed.
/// Operations take any id, but an edit that would write one of another kind (`grp_…` for a group of rows) is
/// refused, whatever else it does.
pub(crate) fn ids_well_formed(ops: &[Op]) -> bool {
    ops.iter().all(|op| match op {
        Op::SetRowGroups { groups, .. } => groups.iter().all(|g| is_well_formed(&g.group_id, "rgr")),
        Op::SetColumnGroups { groups, .. } => groups.iter().all(|g| is_well_formed(&g.group_id, "cgr")),
        Op::SetConditionalFormats { conditional_formats, .. } => {
            conditional_formats.iter().all(|f| is_well_formed(&f.conditional_format_id, "cfm"))
        }
        Op::SetCellTables { cell_tables, .. } => cell_tables.iter().all(|t| is_well_formed(&t.cell_table_id, "ctb")),
        Op::SetPlacements { placements, .. } => placements.iter().all(|p| is_well_formed(&p.placement_id, "plc")),
        _ => true,
    })
}

fn make_ops(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let code = context.code;
    let (rows, columns) = (Lines::Rows, Lines::Columns);
    match edit {
        Edit::SetColumnWidths { sheet_id, one_column, other_column, width_in_pixels } => {
            set_column_widths(workbook, sheet_of(workbook, &sheet_id)?, (&one_column, &other_column), width_in_pixels)
        }
        Edit::SetRowHeights { sheet_id, rows: runs, height_in_pixels } => {
            set_row_heights(workbook, sheet_of(workbook, &sheet_id)?, &runs, height_in_pixels)
        }
        Edit::FitColumns { sheet_id, one_column, other_column, no_narrower_than } => {
            fit_columns(workbook, sheet_of(workbook, &sheet_id)?, (&one_column, &other_column), &no_narrower_than)
        }
        Edit::SetSheetSettings { sheet_id, settings } => {
            set_sheet_settings(workbook, sheet_of(workbook, &sheet_id)?, settings)
        }
        Edit::InsertRows { sheet_id, after_row, count, formats_from_row, groups_from_row, formulas_from_row, .. } => {
            let from = From { formats: formats_from_row, groups: groups_from_row, formulas: formulas_from_row };
            insert(workbook, sheet_of(workbook, &sheet_id)?, rows, after_row, count, from, code)
        }
        Edit::InsertColumns { sheet_id, after_column, count, formats_from_column, groups_from_column } => {
            let from = From { formats: formats_from_column, groups: groups_from_column, formulas: None };
            insert(workbook, sheet_of(workbook, &sheet_id)?, columns, after_column, count, from, code)
        }
        Edit::DeleteRows { sheet_id, rows: runs } => {
            let sheet = sheet_of(workbook, &sheet_id)?;
            let named = named(&workbook.bases, &sheet.rows, &runs);
            delete(workbook, sheet, rows, named)
        }
        Edit::DeleteColumns { sheet_id, one_column, other_column } => {
            let sheet = sheet_of(workbook, &sheet_id)?;
            let (a, b) = span(workbook, sheet, columns, (&one_column, &other_column))?;
            delete(workbook, sheet, columns, (a..=b).map(|p| at(&sheet.columns, p)).collect())
        }
        Edit::MoveRows { sheet_id, one_row, other_row, after_row } => {
            move_lines(workbook, sheet_of(workbook, &sheet_id)?, rows, (&one_row, &other_row), after_row, context.is_among_several)
        }
        Edit::MoveColumns { sheet_id, one_column, other_column, after_column } => {
            move_lines(workbook, sheet_of(workbook, &sheet_id)?, columns, (&one_column, &other_column), after_column, context.is_among_several)
        }
        Edit::HideRows { sheet_id, rows: runs } => {
            let sheet = sheet_of(workbook, &sheet_id)?;
            let named = named(&workbook.bases, &sheet.rows, &runs);
            hide(workbook, sheet, rows, &named, code)
        }
        Edit::HideColumns { sheet_id, one_column, other_column } => {
            let sheet = sheet_of(workbook, &sheet_id)?;
            let (a, b) = span(workbook, sheet, columns, (&one_column, &other_column))?;
            hide(workbook, sheet, columns, &(a..=b).map(|p| at(&sheet.columns, p)).collect::<Vec<_>>(), code)
        }
        Edit::GroupRows { sheet_id, one_row, other_row } => {
            group(workbook, sheet_of(workbook, &sheet_id)?, rows, (&one_row, &other_row), code)
        }
        Edit::GroupColumns { sheet_id, one_column, other_column } => {
            group(workbook, sheet_of(workbook, &sheet_id)?, columns, (&one_column, &other_column), code)
        }
        Edit::UngroupRows { sheet_id, one_row, other_row } => {
            ungroup(workbook, sheet_of(workbook, &sheet_id)?, rows, (&one_row, &other_row))
        }
        Edit::UngroupColumns { sheet_id, one_column, other_column } => {
            ungroup(workbook, sheet_of(workbook, &sheet_id)?, columns, (&one_column, &other_column))
        }
        Edit::SetRowGroupsCollapsed { sheet_id, group_ids, is_collapsed } => {
            let ids: HashSet<String> = group_ids.into_iter().collect();
            let want = |g: &groups::Shown| ids.contains(&g.id).then_some(is_collapsed);
            collapse(workbook, sheet_of(workbook, &sheet_id)?, rows, true, want)
        }
        Edit::SetColumnGroupsCollapsed { sheet_id, group_ids, is_collapsed } => {
            let ids: HashSet<String> = group_ids.into_iter().collect();
            let want = |g: &groups::Shown| ids.contains(&g.id).then_some(is_collapsed);
            collapse(workbook, sheet_of(workbook, &sheet_id)?, columns, true, want)
        }
        Edit::ShowRowGroupsToDepth { sheet_id, depth } => {
            let want = |g: &groups::Shown| Some(g.depth as u64 > depth as u64);
            collapse(workbook, sheet_of(workbook, &sheet_id)?, rows, false, want)
        }
        Edit::ShowColumnGroupsToDepth { sheet_id, depth } => {
            let want = |g: &groups::Shown| Some(g.depth as u64 > depth as u64);
            collapse(workbook, sheet_of(workbook, &sheet_id)?, columns, false, want)
        }
    }
}

fn sheet_of<'a>(workbook: &'a Workbook, sheet_id: &str) -> Result<&'a Sheet, Refused> {
    workbook.sheet_index(sheet_id).map(|i| &workbook.sheets[i]).ok_or(Refused::Because("unknownSheet"))
}

/// The line at a live position.
fn at(axis: &Axis, p: usize) -> LineId {
    axis.line(p).expect("a live position")
}

/// The position of a line named by id, in the sheet and not deleted.
fn position(workbook: &Workbook, sheet: &Sheet, lines: Lines, id: &str) -> Result<usize, Refused> {
    let axis = lines.axis(sheet);
    workbook.bases.parse(id).and_then(|l| axis.position(l)).ok_or(lines.unknown())
}

/// The positions from one end to the other, in order.
fn span(workbook: &Workbook, sheet: &Sheet, lines: Lines, (one, other): (&str, &str))
    -> Result<(usize, usize), Refused> {
    let (a, b) = (position(workbook, sheet, lines, one)?, position(workbook, sheet, lines, other)?);
    Ok((a.min(b), a.max(b)))
}

/// The lines of runs that are in the sheet and not deleted, each once, in the order named.
fn named(bases: &Bases, axis: &Axis, runs: &[IdRun]) -> Vec<LineId> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for run in runs {
        let Some(base) = bases.find(&run.base) else { continue };
        let end = run.first as u64 + run.count as u64;
        let lines: Vec<LineId> = if run.count as usize > axis.len() {
            let is_named = |l: &LineId| l.base == base && l.n >= run.first && (l.n as u64) < end;
            (0..axis.len()).map(|p| at(axis, p)).filter(is_named).collect()
        } else {
            (run.first as u64..end).map(|n| LineId { base, n: n as u32 }).filter(|l| axis.contains(*l)).collect()
        };
        out.extend(lines.into_iter().filter(|l| seen.insert(*l)));
    }
    out
}

/// Every column from one end to the other takes the width.
fn set_column_widths(workbook: &Workbook, sheet: &Sheet, ends: (&str, &str), width: u32) -> Result<Made, Refused> {
    let (a, b) = span(workbook, sheet, Lines::Columns, ends)?;
    if !(NARROWEST_COLUMN..=WIDEST_COLUMN).contains(&width) {
        return Err(Refused::Because("columnWidthNotAllowed"));
    }
    let mut columns: Vec<LineId> = (a..=b).map(|p| at(&sheet.columns, p)).collect();
    if columns.iter().all(|c| sheet.column_widths.get(c).copied().unwrap_or(fit::DEFAULT_WIDTH) == width) {
        return Ok(Made::nothing());
    }
    let widths = sorted_runs(&workbook.bases, &mut columns)
        .into_iter()
        .map(|columns| ColumnsToSize { columns, width_in_pixels: Some(width) })
        .collect();
    Ok(Made::ops(vec![Op::SetColumnWidths { sheet_id: sheet.id.clone(), widths }]))
}

/// The rows named take the height (`None`: the default).
fn set_row_heights(workbook: &Workbook, sheet: &Sheet, runs: &[IdRun], height: Option<u32>) -> Result<Made, Refused> {
    let mut rows = named(&workbook.bases, &sheet.rows, runs);
    if rows.is_empty() {
        return Err(Lines::Rows.unknown());
    }
    if height.is_some_and(|h| !(LOWEST_ROW..=HIGHEST_ROW).contains(&h)) {
        return Err(Refused::Because("rowHeightNotAllowed"));
    }
    if rows.iter().all(|r| sheet.row_heights.get(r).copied() == height) {
        return Ok(Made::nothing());
    }
    let heights = sorted_runs(&workbook.bases, &mut rows)
        .into_iter()
        .map(|rows| RowsToSize { rows, height_in_pixels: height })
        .collect();
    Ok(Made::ops(vec![Op::SetRowHeights { sheet_id: sheet.id.clone(), heights }]))
}

/// Each column from one end to the other with something to show is as wide as it needs to show it (and as wide as
/// it is asked to be at least), as far as the widest a column may be.
fn fit_columns(workbook: &Workbook, sheet: &Sheet, ends: (&str, &str), at_least: &[NoNarrowerThan])
    -> Result<Made, Refused> {
    let (a, b) = span(workbook, sheet, Lines::Columns, ends)?;
    let columns: Vec<LineId> = (a..=b).map(|p| at(&sheet.columns, p)).collect();
    let needed = fit::widths_needed(workbook, sheet, &columns);
    let mut widths: Vec<(LineId, u32)> = Vec::new();
    for column in columns {
        let Some(&width) = needed.get(&column) else { continue };
        let asked = at_least.iter().filter(|n| workbook.bases.parse(&n.column) == Some(column));
        let width = asked.map(|n| n.width_in_pixels).fold(width, u32::max).min(WIDEST_COLUMN);
        if width != sheet.column_widths.get(&column).copied().unwrap_or(fit::DEFAULT_WIDTH) {
            widths.push((column, width));
        }
    }
    let sizes = column_width_runs(workbook, widths);
    if sizes.is_empty() {
        return Ok(Made::nothing());
    }
    Ok(Made::ops(vec![Op::SetColumnWidths { sheet_id: sheet.id.clone(), widths: sizes }]))
}

/// Packs consecutive column IDs with equal widths into the run used by setColumnWidths.
pub(super) fn column_width_runs(workbook: &Workbook, widths: impl IntoIterator<Item = (LineId, u32)>) -> Vec<ColumnsToSize> {
    let mut sizes: Vec<ColumnsToSize> = Vec::new();
    let mut last: Option<LineId> = None;
    for (column, width) in widths {
        let is_next = last.is_some_and(|l| l.base == column.base && l.n as u64 + 1 == column.n as u64);
        match sizes.last_mut() {
            Some(size) if is_next && size.width_in_pixels == Some(width) => {
                size.columns.count += 1;
            }
            _ => sizes.push(ColumnsToSize {
                columns: IdRun { base: workbook.bases.name(column.base).to_owned(), first: column.n, count: 1 },
                width_in_pixels: Some(width),
            }),
        }
        last = Some(column);
    }
    sizes
}

/// The settings asked for that are not as they are.
fn set_sheet_settings(workbook: &Workbook, sheet: &Sheet, asked: SheetSettings) -> Result<Made, Refused> {
    let mut settings = SheetSettings::default();
    let frozen = |lines: Lines, id: &Option<String>| -> Result<Option<LineId>, Refused> {
        id.as_deref().map(|id| position(workbook, sheet, lines, id).map(|p| at(lines.axis(sheet), p))).transpose()
    };
    if let Some(row) = asked.last_frozen_row {
        if frozen(Lines::Rows, &row)? != sheet.last_frozen_row {
            settings.last_frozen_row = Some(row);
        }
    }
    if let Some(column) = asked.last_frozen_column {
        if frozen(Lines::Columns, &column)? != sheet.last_frozen_column {
            settings.last_frozen_column = Some(column);
        }
    }
    if let Some(hidden) = asked.are_gridlines_hidden {
        if hidden != sheet.are_gridlines_hidden {
            settings.are_gridlines_hidden = Some(hidden);
        }
    }
    if let Some(view) = asked.interactive.filter(|view| *view != sheet.interactive) {
        if let Some(id) = &view {
            let (_, view) = workbook.views.get(id).ok_or(Refused::Because("unknownView"))?;
            if !view.is_interactive() {
                return Err(Refused::Because("viewIsNoInteractive"));
            }
            if !sheet.cells.is_empty() || !sheet.placements.is_empty() {
                return Err(Refused::Because("sheetForInteractiveIsNotEmpty"));
            }
        }
        settings.interactive = Some(view);
    }
    let is_any_set = settings.last_frozen_row.is_some()
        || settings.last_frozen_column.is_some()
        || settings.are_gridlines_hidden.is_some()
        || settings.interactive.is_some();
    if !is_any_set {
        return Ok(Made::nothing());
    }
    Ok(Made::ops(vec![Op::SetSheetSettings { sheets: vec![SheetToSet { sheet_id: sheet.id.clone(), settings }] }]))
}

/// The lines new ones take from: their formats, the groups they are in, their formulas (rows only).
struct From {
    formats: Option<String>,
    groups: Option<String>,
    formulas: Option<String>,
}

/// New lines after one (deleted or not; first of all when `None`), named `row_<code>.0` … (or `col_…`).
fn insert(workbook: &Workbook, sheet: &Sheet, lines: Lines, after: Option<String>, count: u32, from: From, code: &str)
    -> Result<Made, Refused> {
    let axis = lines.axis(sheet);
    let after_line = match &after {
        Some(id) => Some(workbook.bases.parse(id).filter(|l| axis.knows(*l)).ok_or(lines.unknown())?),
        None => None,
    };
    let live = |id: Option<String>| -> Result<Option<LineId>, Refused> {
        id.map(|id| position(workbook, sheet, lines, &id).map(|p| at(axis, p))).transpose()
    };
    let (formats_from, groups_from, formulas_from) = (live(from.formats)?, live(from.groups)?, live(from.formulas)?);
    let new = IdRun { base: format!("{}_{code}", lines.line_prefix()), first: 0, count };
    let sheet_id = sheet.id.clone();
    let mut ops = vec![match lines {
        Lines::Rows => Op::InsertRows { sheet_id, after, rows: new.clone() },
        Lines::Columns => Op::InsertColumns { sheet_id, after, columns: new.clone() },
    }];
    let mut inserted = workbook.clone();
    inserted.apply(&ops)?;
    if let Some(from) = formats_from {
        ops.extend(follow::formats_of_new(workbook, sheet, lines, from, after_line, &new));
    }
    if let Some(from) = groups_from {
        ops.extend(follow::groups_of_new(workbook, sheet, lines, from, after_line, &new));
    }
    if let Some(from) = formats_from {
        // New cells given a checkbox hold `false`.
        if lines == Lines::Rows {
            let mut formatted = workbook.clone();
            formatted.apply(&ops)?;
            ops.extend(follow::checkboxes_of_new(sheet, from, &formatted, &new));
        }
        ops.extend(follow::conditional_formats_of_new(workbook, sheet, lines, from, after_line, &new));
    }
    if let Some(from) = formulas_from {
        ops.extend(follow::formulas_of_new(workbook, sheet, from, &inserted, &new));
    }
    let sheet_after = &inserted.sheets[inserted.sheet_index(&sheet.id).expect("the sheet inserted in")];
    let base = inserted.bases.find(&new.base).expect("the new lines' base");
    let axis_after = lines.axis(sheet_after);
    let first = axis_after.position(LineId { base, n: 0 }).expect("a new line");
    let place = lines.whole(sheet_after, (first, first + count as usize - 1));
    Ok(Made { ops, place: Some(place) })
}

/// Deletes lines, and first what they take with them.
fn delete(workbook: &Workbook, sheet: &Sheet, lines: Lines, deleted: Vec<LineId>) -> Result<Made, Refused> {
    if deleted.is_empty() {
        return Err(lines.unknown());
    }
    let set: HashSet<LineId> = deleted.iter().copied().collect();
    let mut ops = follow::of_delete(workbook, sheet, lines, &set);
    // What the lines take with them is worked out, and its ids checked, before whether any line is left.
    if deleted.len() == lines.axis(sheet).len() {
        return Err(Refused::Because(match lines {
            _ if !ids_well_formed(&ops) => "idNotWellFormed",
            Lines::Rows => "noRowLeft",
            Lines::Columns => "noColumnLeft",
        }));
    }
    let mut ids = deleted;
    let runs = sorted_runs(&workbook.bases, &mut ids);
    let sheet_id = sheet.id.clone();
    let op = match lines {
        Lines::Rows => Op::DeleteRows { sheet_id, rows: crate::ids::listed_runs::RowRuns::written(runs) },
        Lines::Columns => Op::DeleteColumns { sheet_id, columns: runs },
    };
    ops.push(op.clone());
    // And before whether any line is left in sight.
    if !ids_well_formed(&ops) {
        return Err(Refused::Because("idNotWellFormed"));
    }
    let mut after = workbook.clone();
    after.apply(&ops)?;
    is_any_left_in_sight(workbook, &after, &sheet.id, lines)?;
    let place = place::of_ops(workbook, &after, &[op]);
    Ok(Made { ops, place: Some(place) })
}

/// Refuses an edit that leaves no line of the axis in sight (every one held by a collapsed group), when there was
/// one (and the groups were well).
fn is_any_left_in_sight(workbook: &Workbook, after: &Workbook, sheet_id: &str, lines: Lines) -> Result<(), Refused> {
    let sheet_of = |workbook: &Workbook| workbook.sheet_index(sheet_id).expect("the sheet edited");
    let is_any_left = groups::is_any_in_sight(&after.bases, &after.sheets[sheet_of(after)], lines);
    match groups::leaves_none_in_sight(&workbook.bases, &workbook.sheets[sheet_of(workbook)], lines, is_any_left) {
        true => Err(Refused::Because("nothingLeftInSight")),
        false => Ok(()),
    }
}

/// The lines left from one line to another (either first), in order: deleted lines between them count for nothing.
fn lines_left_between(axis: &Axis, one: LineId, other: LineId) -> Vec<LineId> {
    let (Some(i), Some(j)) = (axis.index(one), axis.index(other)) else { return Vec::new() };
    axis.all()[i.min(j)..=i.max(j)].iter().copied().filter(|&l| !axis.is_deleted(l)).collect()
}

/// Whether no cell left in a box (top, bottom, left, right), but its first, is filled.
fn is_filled_only_first(sheet: &Sheet, (top, bottom, left, right): (usize, usize, usize, usize)) -> bool {
    sheet.cells.keys().all(|&(r, c)| match (sheet.rows.position(r), sheet.columns.position(c)) {
        (Some(row), Some(column)) => {
            (row, column) == (top, left) || !(top..=bottom).contains(&row) || !(left..=right).contains(&column)
        }
        _ => true,
    })
}

/// Moves the lines from one end to the other after a line (first of all when `None`).
fn move_lines(workbook: &Workbook, sheet: &Sheet, lines: Lines, ends: (&str, &str), after: Option<String>, among_several: bool)
    -> Result<Made, Refused> {
    let (a, b) = span(workbook, sheet, lines, ends)?;
    let axis = lines.axis(sheet);
    let to = after.as_deref().map(|id| position(workbook, sheet, lines, id)).transpose()?;
    let stays = match to {
        Some(p) => (a..=b).contains(&p) || p + 1 == a,
        None => a == 0,
    };
    if stays || (a == 0 && b + 1 == axis.len()) {
        return Ok(Made::nothing());
    }
    if among_several {
        return Err(Refused::Because("moveAmongSeveralEdits"));
    }
    let moved: Vec<LineId> = (a..=b).map(|p| at(axis, p)).collect();
    let after_line = to.map(|p| at(axis, p));
    let (mut ops, after_ops) = follow::of_move(workbook, sheet, lines, &moved, after_line);
    // What follows the lines is worked out, and its ids checked, before the merged ranges are.
    if !ids_well_formed(&ops) || !ids_well_formed(&after_ops) {
        return Err(Refused::Because("idNotWellFormed"));
    }
    // A merged range moves whole or not at all, and nothing goes inside one: from one of its ends as written to the
    // other, the lines left are to be the same after the move, in the same order. Every range merged counts, shown
    // or not. One whose ends have been deleted is let be all the same when the lines left between its ends now are
    // (it moves whole, or lines go in between them and a deleted end), and nothing but its first cell is filled: it
    // is merged again first, over the cells left.
    let mut moved_axis = axis.clone();
    moved_axis.move_lines(&[(moved.clone(), after_line)]);
    let bases = &workbook.bases;
    let mut remerged: Vec<((usize, usize, usize, usize), &RangeIds)> = Vec::new();
    for range in &sheet.merged_ranges {
        let Some(live) = sheet.live_box(bases, range) else { continue };
        let ends = match lines {
            Lines::Rows => (&range.top_left.r, &range.bottom_right.r),
            Lines::Columns => (&range.top_left.c, &range.bottom_right.c),
        };
        let (Some(one), Some(other)) = (bases.parse(ends.0), bases.parse(ends.1)) else { continue };
        if lines_left_between(axis, one, other) == lines_left_between(&moved_axis, one, other) {
            continue;
        }
        let (first, last) = match lines {
            Lines::Rows => (live.0, live.1),
            Lines::Columns => (live.2, live.3),
        };
        let (first, last) = (at(axis, first), at(axis, last));
        let is_kept = lines_left_between(axis, first, last) == lines_left_between(&moved_axis, first, last);
        if !(is_kept && is_filled_only_first(sheet, live)) {
            return Err(Refused::Because("moveSplitsMergedRange"));
        }
        remerged.push((live, range));
    }
    if !remerged.is_empty() {
        // A range left with one cell merges nothing: those come last, after the others in the order they are read.
        let is_one_cell = |&(t, b, l, r): &(usize, usize, usize, usize)| t == b && l == r;
        remerged.sort_by_key(|&(live @ (t, b, l, r), _)| (is_one_cell(&live), t, l, b, r));
        // Nor is one merged again over another range.
        let overlaps = |(t, b, l, r): (usize, usize, usize, usize), (t2, b2, l2, r2): (usize, usize, usize, usize)| {
            t <= b2 && t2 <= b && l <= r2 && l2 <= r
        };
        for &(live, range) in remerged.iter().filter(|(live, _)| !is_one_cell(live)) {
            let others = sheet.merged_ranges.iter().filter(|other| !std::ptr::eq(*other, range));
            if others.filter_map(|other| sheet.live_box(bases, other)).any(|other| overlaps(live, other)) {
                return Err(Refused::Because("moveSplitsMergedRange"));
            }
        }
        let unmerged = remerged.iter().map(|(_, range)| (*range).clone()).collect();
        ops.push(Op::UnmergeCells { sheet_id: sheet.id.clone(), ranges: unmerged });
        let merged: Vec<RangeIds> = remerged
            .iter()
            .filter(|(live, _)| !is_one_cell(live))
            .map(|(_, range)| sheet.live_range(bases, range).expect("a live range"))
            .collect();
        if !merged.is_empty() {
            ops.push(Op::MergeCells { sheet_id: sheet.id.clone(), ranges: merged });
        }
    }
    let runs = runs_of(&moved, &workbook.bases);
    let sheet_id = sheet.id.clone();
    let op = match lines {
        Lines::Rows => Op::MoveRows { sheet_id, moves: vec![RowMove { rows: runs, after }] },
        Lines::Columns => Op::MoveColumns { sheet_id, moves: vec![ColumnMove { columns: runs, after }] },
    };
    ops.push(op.clone());
    ops.extend(after_ops);
    let mut moved_workbook = workbook.clone();
    moved_workbook.apply(&ops)?;
    is_any_left_in_sight(workbook, &moved_workbook, &sheet.id, lines)?;
    let place = place::of_ops(workbook, &moved_workbook, &[op]);
    Ok(Made { ops, place: Some(place) })
}

/// Hides the lines named: each stretch of them side by side is a collapsed group.
fn hide(workbook: &Workbook, sheet: &Sheet, lines: Lines, named: &[LineId], code: &str) -> Result<Made, Refused> {
    let axis = lines.axis(sheet);
    let mut positions: Vec<usize> = named.iter().filter_map(|l| axis.position(*l)).collect();
    if positions.is_empty() {
        return Err(lines.unknown());
    }
    positions.sort_unstable();
    positions.dedup();
    let mut stretches: Vec<(usize, usize)> = Vec::new();
    for p in positions {
        match stretches.last_mut() {
            Some(s) if s.1 + 1 == p => s.1 = p,
            _ => stretches.push((p, p)),
        }
    }
    let set = groups::hide(workbook, sheet, lines, &stretches, code)?;
    if set.is_empty() {
        return Ok(Made::nothing());
    }
    Ok(Made::ops(vec![lines.set_groups(&sheet.id, set)]))
}

/// A new group from one end to the other; the place is its lines in sight.
fn group(workbook: &Workbook, sheet: &Sheet, lines: Lines, ends: (&str, &str), code: &str) -> Result<Made, Refused> {
    let span = span(workbook, sheet, lines, ends)?;
    let grouped = groups::group(workbook, sheet, lines, span, code)?;
    grouped_made(sheet, lines, grouped)
}

fn ungroup(workbook: &Workbook, sheet: &Sheet, lines: Lines, ends: (&str, &str)) -> Result<Made, Refused> {
    let span = span(workbook, sheet, lines, ends)?;
    let set = groups::ungroup(workbook, sheet, lines, span);
    if set.is_empty() {
        return Ok(Made::nothing());
    }
    Ok(Made::ops(vec![lines.set_groups(&sheet.id, set)]))
}

fn collapse(
    workbook: &Workbook,
    sheet: &Sheet,
    lines: Lines,
    by_id: bool,
    want: impl Fn(&groups::Shown) -> Option<bool>,
) -> Result<Made, Refused> {
    let grouped = groups::collapse(workbook, sheet, lines, by_id, want)?;
    grouped_made(sheet, lines, grouped)
}

/// Groups set, at the lines they show (the sheet when they show none).
fn grouped_made(sheet: &Sheet, lines: Lines, grouped: groups::Grouped) -> Result<Made, Refused> {
    if grouped.groups.is_empty() {
        return Ok(Made::nothing());
    }
    let place = match grouped.shows {
        Some(shows) => lines.whole(sheet, shows),
        None => Place::sheet(&sheet.id),
    };
    Ok(Made { ops: vec![lines.set_groups(&sheet.id, grouped.groups)], place: Some(place) })
}
