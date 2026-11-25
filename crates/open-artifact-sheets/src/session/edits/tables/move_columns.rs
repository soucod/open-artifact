//! Reorder cells within a rectangle without moving the sheet's column IDs.

use std::collections::BTreeMap;

use crate::calculate::SpillOutcome;
use crate::formula::{CellPoint, Reference, StoredFormula};
use crate::ids::{IdRun, LineId};
use crate::session::place::Place;
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{self, sorted_runs, write_format};
use crate::workbook::layout::{live_ends, merged_boxes, ColumnsToSize, RangeIds};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{
    CellCondition, ConditionalFormatPatch, ConditionalFormatToSet, Effect, NamedViewToSet, NumberOperand, TestedCell,
    ViewElement, ViewToSet,
};
use crate::workbook::{Input, Sheet, Workbook};

use super::{live_column, live_row, sheet, CellsBetween, Made, Refused};

type Area = (usize, usize, usize, usize);

struct Move<'a> {
    workbook: &'a Workbook,
    sheet: &'a Sheet,
    area: Area,
    destinations: Vec<usize>,
    dragged: (usize, usize),
}

impl Move<'_> {
    fn column(&self, place: usize) -> String {
        self.workbook.bases.text(self.line(place))
    }

    fn line(&self, place: usize) -> LineId {
        self.sheet.columns.line(place).expect("a live column")
    }

    fn position(&self, id: &str) -> Option<usize> {
        self.workbook
            .bases
            .parse(id)
            .and_then(|line| self.sheet.columns.position(line))
    }

    fn destination(&self, column: usize) -> usize {
        column
            .checked_sub(self.area.2)
            .and_then(|offset| self.destinations.get(offset))
            .copied()
            .unwrap_or(column)
    }

    fn change_column(&self, id: &str) -> Option<String> {
        let at = self.position(id)?;
        let to = self.destination(at);
        (to != at).then(|| self.column(to))
    }

    fn contains(&self, row: usize, column: usize) -> bool {
        let (top, bottom, left, right) = self.area;
        (top..=bottom).contains(&row) && (left..=right).contains(&column)
    }

    fn intersects(&self, (t, b, l, r): Area) -> bool {
        let (top, bottom, left, right) = self.area;
        t <= bottom && top <= b && l <= right && left <= r
    }

    fn row_in_move(&self, id: &str) -> bool {
        self.workbook
            .bases
            .parse(id)
            .and_then(|r| self.sheet.rows.position(r))
            .is_some_and(|r| (self.area.0..=self.area.1).contains(&r))
    }

    /// A reference follows its data when all its rows are within the move. A split range keeps
    /// the segment alongside the stationary columns.
    fn range(&self, (a_row, b_row): (&str, &str), (a_col, b_col): (&str, &str)) -> Option<(String, String)> {
        if !self.row_in_move(a_row) || !self.row_in_move(b_row) {
            return None;
        }
        let (a, b) = (self.position(a_col)?, self.position(b_col)?);
        let (left, right) = (a.min(b), a.max(b));
        let mut next = (left..=right).map(|c| self.destination(c)).collect::<Vec<_>>();
        next.sort_unstable();
        if next.windows(2).any(|w| w[1] != w[0] + 1) {
            let (drag_left, drag_right) = self.dragged;
            next = (left..=right)
                .filter(|c| !(drag_left..=drag_right).contains(c))
                .map(|c| self.destination(c))
                .collect();
            next.sort_unstable();
        }
        let (left, right) = (*next.first()?, *next.last()?);
        let (new_a, new_b) = if a <= b { (left, right) } else { (right, left) };
        (a != new_a || b != new_b).then(|| (self.column(new_a), self.column(new_b)))
    }

    fn formula(&self, original: &StoredFormula) -> Option<StoredFormula> {
        let mut formula = original.clone();
        for reference in formula.references.iter_mut().filter(|r| r.sheet_id() == self.sheet.id) {
            let move_point = |point: &mut CellPoint| {
                if self.row_in_move(&point.r) {
                    if let Some(c) = self.change_column(&point.c) {
                        point.c = c;
                    }
                }
            };
            match reference {
                Reference::Cell { cell, .. } => move_point(cell),
                Reference::Range {
                    top_left, bottom_right, ..
                } => {
                    if let Some((a, b)) = self.range((&top_left.r, &bottom_right.r), (&top_left.c, &bottom_right.c)) {
                        top_left.c = a;
                        bottom_right.c = b;
                    }
                }
                Reference::Columns { .. } | Reference::Rows { .. } => {}
            }
        }
        (formula != *original).then_some(formula)
    }

    fn cells(&self) -> Vec<Op> {
        let mut ops = Vec::new();
        let sheet = self.sheet;
        for s in std::iter::once(sheet).chain(self.workbook.sheets.iter().filter(|s| s.id != sheet.id)) {
            let mut landed = BTreeMap::new();
            let mut followed = BTreeMap::new();
            let covered = crate::session::edits::objects::dropdowns::hidden_by_merges(self.workbook, s);
            for (&(r, c), cell) in &s.cells {
                let Some(at) = s.rows.position(r).zip(s.columns.position(c)) else {
                    continue;
                };
                let moved = s.id == sheet.id && self.contains(at.0, at.1);
                let new_formula = match &cell.input {
                    Input::Formula { formula } if moved || !covered(at) => self.formula(formula),
                    _ => None,
                };
                if moved {
                    landed.entry(at).or_insert(None);
                    landed.insert(
                        (at.0, self.destination(at.1)),
                        Some(new_formula.map_or_else(|| cell.input.clone(), |formula| Input::Formula { formula })),
                    );
                } else if let Some(formula) = new_formula {
                    followed.insert(at, Some(Input::Formula { formula }));
                }
            }
            let bases = &self.workbook.bases;
            let cells = landed
                .into_iter()
                .chain(followed)
                .map(|((r, c), input)| CellToSet {
                    r: bases.text(s.rows.line(r).expect("a live row")),
                    c: bases.text(s.columns.line(c).expect("a live column")),
                    input,
                })
                .collect::<Vec<_>>();
            if !cells.is_empty() {
                ops.push(Op::SetCells {
                    sheet_id: s.id.clone(),
                    cells,
                    form: CellForm::List,
                });
            }
        }
        ops
    }

    fn formats(&self) -> Vec<Op> {
        let sheet = self.sheet;
        let bases = &self.workbook.bases;
        let affected = sheet
            .formats
            .iter()
            .filter(|(_, (r, c), _)| {
                sheet
                    .rows
                    .position(*r)
                    .zip(sheet.columns.position(*c))
                    .is_some_and(|(r, c)| self.contains(r, c))
            })
            .collect::<Vec<_>>();
        if affected.is_empty() {
            return Vec::new();
        }
        let defaults = affected
            .iter()
            .map(|(leaf, _, _)| (*leaf, leaf.default_value()))
            .collect();
        let (top, bottom, left, right) = self.area;
        let rows = sorted_runs(bases, &mut (top..=bottom).filter_map(|r| sheet.rows.line(r)).collect());
        let columns = sorted_runs(bases, &mut (left..=right).map(|c| self.line(c)).collect());
        let format = write_format(&defaults);
        let clear = Op::SetCellFormats {
            sheet_id: sheet.id.clone(),
            formats: vec![CellsToFormat { rows, columns, format }],
        };
        let mut blocks = formats::blocks(bases, affected.into_iter());
        let lines = |run: &IdRun| {
            let base = bases.find(&run.base).expect("a known base");
            (run.first..run.first + run.count).map(move |n| LineId { base, n })
        };
        let places = |axis: &crate::ids::Axis, runs: &[IdRun]| {
            let mut out = runs
                .iter()
                .flat_map(lines)
                .filter_map(|l| axis.position(l))
                .collect::<Vec<_>>();
            out.sort_unstable();
            out
        };
        blocks.sort_by_cached_key(|(rows, columns, _)| (places(&sheet.columns, columns), places(&sheet.rows, rows)));
        let formats = blocks
            .into_iter()
            .map(|(rows, columns, format)| {
                let mut columns = places(&sheet.columns, &columns)
                    .into_iter()
                    .map(|c| self.line(self.destination(c)))
                    .collect();
                CellsToFormat {
                    rows,
                    columns: sorted_runs(bases, &mut columns),
                    format,
                }
            })
            .collect();
        vec![
            clear,
            Op::SetCellFormats {
                sheet_id: sheet.id.clone(),
                formats,
            },
        ]
    }

    fn widths(&self) -> Option<Op> {
        let sheet = self.sheet;
        let widths = (self.area.2..=self.area.3)
            .filter_map(|column| {
                let (old, new) = (self.line(column), self.line(self.destination(column)));
                let width_in_pixels = sheet.column_widths.get(&old).copied();
                if width_in_pixels.is_none() && !sheet.column_widths.contains_key(&new) {
                    return None;
                }
                let columns = IdRun {
                    base: self.workbook.bases.name(new.base).to_owned(),
                    first: new.n,
                    count: 1,
                };
                Some(ColumnsToSize {
                    columns,
                    width_in_pixels,
                })
            })
            .collect::<Vec<_>>();
        (!widths.is_empty()).then(|| Op::SetColumnWidths {
            sheet_id: sheet.id.clone(),
            widths,
        })
    }

    fn conditional_formats(&self) -> Option<Op> {
        let point = |id: &mut String| {
            if let Some(column) = self.change_column(id) {
                *id = column;
            }
        };
        let operand = |operand: &mut NumberOperand| {
            if let NumberOperand::SameRowInColumn { c } = operand {
                point(c);
            }
        };
        let mut conditional_formats = Vec::new();
        for (id, before) in self.sheet.conditional_formats.values() {
            if !before
                .ranges
                .iter()
                .all(|range| self.row_in_move(&range.top_left.r) && self.row_in_move(&range.bottom_right.r))
            {
                continue;
            }
            let ranges: Vec<_> = before
                .ranges
                .iter()
                .flat_map(|range| self.format_ranges(range))
                .collect();
            let mut effect = before.effect.clone();
            if let Effect::FormatWhere { all_of, .. } = &mut effect {
                for test in all_of {
                    if let TestedCell::SameRowInColumn { c } = &mut test.tested {
                        point(c);
                    }
                    match &mut test.condition {
                        CellCondition::NumberIs { operand: value, .. } => operand(value),
                        CellCondition::NumberIsBetween { one_end, other_end }
                        | CellCondition::NumberIsNotBetween { one_end, other_end } => {
                            operand(one_end);
                            operand(other_end);
                        }
                        _ => {}
                    }
                }
            }
            let ranges = (ranges != before.ranges).then_some(ranges);
            let effect = (effect != before.effect).then_some(effect);
            if ranges.is_some() || effect.is_some() {
                conditional_formats.push(ConditionalFormatToSet {
                    conditional_format_id: id.clone(),
                    conditional_format: Some(ConditionalFormatPatch {
                        ranges,
                        effect,
                        priority: None,
                    }),
                });
            }
        }
        (!conditional_formats.is_empty()).then(|| Op::SetConditionalFormats {
            sheet_id: self.sheet.id.clone(),
            conditional_formats,
        })
    }

    fn format_ranges(&self, range: &RangeIds) -> Vec<RangeIds> {
        let Some((a, b)) = self
            .position(&range.top_left.c)
            .zip(self.position(&range.bottom_right.c))
        else {
            return vec![range.clone()];
        };
        let (left, right) = (a.min(b), a.max(b));
        let mut columns: Vec<_> = (left..=right).map(|column| self.destination(column)).collect();
        columns.sort_unstable();
        if (left..=right).eq(columns.iter().copied()) {
            return vec![range.clone()];
        }
        let mut ranges = Vec::<(usize, usize)>::new();
        for column in columns {
            match ranges.last_mut() {
                Some((_, last)) if *last + 1 == column => *last = column,
                _ => ranges.push((column, column)),
            }
        }
        ranges
            .into_iter()
            .map(|(first, last)| {
                let mut range = range.clone();
                let (a, b) = if a <= b { (first, last) } else { (last, first) };
                range.top_left.c = self.column(a);
                range.bottom_right.c = self.column(b);
                range
            })
            .collect()
    }

    fn named_views(&self) -> Option<Op> {
        let sheet = self.sheet;
        let move_view = |(id, original): &(String, crate::workbook::objects::NamedView)| {
            if let Some((_, table)) = sheet.cell_tables.get(&original.cell_table_id) {
                let bases = &self.workbook.bases;
                let ends = (&table.header_rows.first_row, &table.header_rows.last_row);
                let header = bases
                    .parse(ends.0)
                    .zip(bases.parse(ends.1))
                    .and_then(|(a, b)| live_ends(&sheet.rows, a, b));
                if header.is_some_and(|(top, bottom)| top < self.area.0 || bottom > self.area.1) {
                    return None;
                }
            }
            let mut named_view = original.clone();
            named_view.move_columns(|id| self.change_column(id));
            (named_view != *original).then(|| NamedViewToSet {
                named_view_id: id.clone(),
                named_view: Some(named_view),
            })
        };
        let named_views = sheet.named_views.values().filter_map(move_view).collect::<Vec<_>>();
        (!named_views.is_empty()).then(|| Op::SetNamedViews {
            sheet_id: sheet.id.clone(),
            named_views,
        })
    }

    fn views(&self) -> Option<Op> {
        let views = self
            .workbook
            .views
            .values()
            .filter_map(|(id, before)| {
                let mut view = before.clone();
                for element in &mut view.elements {
                    let (_, _, inputs) = element.parts_mut();
                    for input in inputs.iter_mut().filter(|input| input.range.sheet_id == self.sheet.id) {
                        let (a, b) = (&mut input.range.top_left, &mut input.range.bottom_right);
                        if let Some((first, last)) = self.range((&a.r, &b.r), (&a.c, &b.c)) {
                            a.c = first;
                            b.c = last;
                        }
                    }
                    if let ViewElement::Interactive { inputs, writes, .. } = element {
                        for write in writes {
                            if inputs
                                .iter()
                                .any(|input| input.name == write.input && input.range.sheet_id == self.sheet.id)
                            {
                                for cell in &mut write.saved {
                                    if self.row_in_move(&cell.r) {
                                        if let Some(column) = self.change_column(&cell.c) {
                                            cell.c = column;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                (view != *before).then(|| ViewToSet {
                    view_id: id.clone(),
                    view: Some(view),
                })
            })
            .collect::<Vec<_>>();
        (!views.is_empty()).then_some(Op::SetViews { views })
    }
}

pub(super) fn make(
    workbook: &Workbook,
    cells: &CellsBetween,
    one: &str,
    other: &str,
    after: Option<&str>,
    widths_go_along: bool,
) -> Result<Made, Refused> {
    let sheet = sheet(workbook, &cells.sheet_id)?;
    let row = |id: &str| live_row(workbook, sheet, id).map(|(_, place)| place);
    let column = |id: &str| live_column(workbook, sheet, id).map(|(_, place)| place);
    let (a, b) = (row(&cells.one_corner.r)?, row(&cells.other_corner.r)?);
    let (l, r) = (column(&cells.one_corner.c)?, column(&cells.other_corner.c)?);
    let (one, other) = (column(one)?, column(other)?);
    let (top, bottom, left, right) = (a.min(b), a.max(b), l.min(r), l.max(r));
    let (start, end) = (one.min(other), other.max(one));
    let after = after.map(column).transpose()?;
    if start < left || end > right || after.is_some_and(|c| !(left..=right).contains(&c)) {
        return Err(Refused::Because("movedColumnOutsideTheCells"));
    }
    let boundary = after.map_or(left, |column| column + 1);
    if (start..=end + 1).contains(&boundary) {
        return Ok(Made::nothing());
    }
    let count = end - start + 1;
    let lands = if boundary < start { boundary } else { boundary - count };
    let (first, last) = (start.min(lands), end.max(lands + count - 1));
    let destinations = (first..=last)
        .map(|column| {
            if (start..=end).contains(&column) {
                lands + column - start
            } else if lands < start {
                column + count
            } else {
                column - count
            }
        })
        .collect();
    let moving = Move {
        workbook,
        sheet,
        area: (top, bottom, first, last),
        destinations,
        dragged: (start, end),
    };
    if merged_boxes(&workbook.bases, sheet)
        .into_iter()
        .any(|rect| moving.intersects(rect))
    {
        return Err(Refused::Because("mergedRangeAmongMovedColumnsOfCells"));
    }
    if crate::session::edits::lines::groups::shown(&workbook.bases, sheet, crate::session::edits::lines::Lines::Columns)
        .iter()
        .any(|g| g.is_collapsed && g.first <= last && first <= g.last)
    {
        return Err(Refused::Because("columnOutOfSightAmongMovedColumnsOfCells"));
    }
    for ((id, r, c), outcome) in &workbook.outcomes {
        if id != &sheet.id {
            continue;
        }
        let Some(SpillOutcome::Fills { to, .. }) = &outcome.spill else {
            continue;
        };
        let Some((r, c)) = sheet.rows.position(*r).zip(sheet.columns.position(*c)) else {
            continue;
        };
        let height_overlaps = r <= bottom && top <= to.0;
        let width_overlaps = c <= last && first <= to.1;
        let keeps_spill_whole = r >= top
            && to.0 <= bottom
            && c >= first
            && to.1 <= last
            && (c..to.1).all(|c| moving.destination(c) + 1 == moving.destination(c + 1));
        if height_overlaps && width_overlaps && !keeps_spill_whole {
            return Err(Refused::Because("spilledValuesAmongMovedColumnsOfCells"));
        }
    }
    let mut ops = moving.cells();
    ops.extend(moving.formats());
    if widths_go_along {
        ops.extend(moving.widths());
    }
    ops.extend(moving.conditional_formats());
    ops.extend(moving.views());
    ops.extend(moving.named_views());
    let place = Place::cells(&sheet.id, top, lands, bottom, lands + count - 1);
    Ok(Made {
        ops,
        place: Some(place),
    })
}
