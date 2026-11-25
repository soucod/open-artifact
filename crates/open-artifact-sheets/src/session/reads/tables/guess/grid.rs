//! The sheet as the guess reads it (`Grid`): what each cell shows, the merged ranges that carry their top left's
//! value down their left column, which cells look like a header's (a fill, or bold), which hold a formula, which
//! columns are narrow, and the number format each number shows in.

use std::collections::BTreeMap;
use hashbrown::{HashMap, HashSet};
use std::rc::Rc;

use crate::brought::Brought;
use crate::calculate::SpillOutcome;
use crate::locale::Locale;
use crate::number_format::{Kind as FormatKind, NumberFormat, Room};
use crate::shown::{shown, ShownValue};
use crate::value::{CellError, Value};
use crate::workbook::formats::Leaf;
use crate::workbook::layout::{live_ends, merged_boxes};
use crate::formula::Reference;
use crate::workbook::rich::Mark;
use crate::workbook::{Input, Sheet, Workbook};

/// What a cell shows: a text (as written, spaces kept), a number (dates and times too), a boolean or an error.
/// A cell showing nothing, or only spaces, has none.
#[derive(Clone, Debug)]
pub(super) enum Shown {
    Text(Rc<str>),
    Number(f64),
    Boolean(bool),
    Error(CellError),
}

/// The kind of what a cell shows, in this order: kinds are counted by it, and a tie goes to the later.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum Kind {
    Boolean,
    Error,
    Number,
    Text,
    Nothing,
}

impl Kind {
    /// A number or a boolean: what a header's text names rather than repeats.
    pub(super) fn is_value(self) -> bool {
        matches!(self, Kind::Boolean | Kind::Number)
    }
}

impl Shown {
    fn of(value: &Value) -> Option<Shown> {
        match value {
            Value::Blank => None,
            Value::Number(n) => Some(Shown::Number(*n)),
            Value::Text(t) if t.trim().is_empty() => None,
            Value::Text(t) => Some(Shown::Text(t.clone())),
            Value::Boolean(b) => Some(Shown::Boolean(*b)),
            Value::Error(e) => Some(Shown::Error(*e)),
        }
    }

    pub(super) fn kind(&self) -> Kind {
        match self {
            Shown::Text(_) => Kind::Text,
            Shown::Number(_) => Kind::Number,
            Shown::Boolean(_) => Kind::Boolean,
            Shown::Error(_) => Kind::Error,
        }
    }

    /// Whether two cells show the same: texts whatever their capitals and the spaces around them, equal numbers,
    /// the same boolean or error.
    pub(super) fn is_like(&self, other: &Shown) -> bool {
        match (self, other) {
            (Shown::Text(a), Shown::Text(b)) => {
                a.trim().chars().flat_map(char::to_lowercase).eq(b.trim().chars().flat_map(char::to_lowercase))
            }
            (Shown::Number(a), Shown::Number(b)) => a == b,
            (Shown::Boolean(a), Shown::Boolean(b)) => a == b,
            (Shown::Error(a), Shown::Error(b)) => a == b,
            _ => false,
        }
    }

    /// What a cell shows as a label: a text trimmed and in small letters, a number as Rust writes it, `true` or
    /// `false`, an error's name.
    pub(super) fn label(&self) -> String {
        match self {
            Shown::Text(t) => t.trim().chars().flat_map(char::to_lowercase).collect(),
            Shown::Number(n) => n.to_string(),
            Shown::Boolean(b) => b.to_string(),
            Shown::Error(e) => e.to_string(),
        }
    }

    /// A whole number that reads as a year (1900 to 2100) or as a day from 1990 to 2100.
    pub(super) fn is_year(&self) -> bool {
        match self {
            Shown::Number(n) if n - n.trunc() == 0.0 => (1900.0..=2100.0).contains(n) || (32874.0..=73415.0).contains(n),
            _ => false,
        }
    }
}

/// A reference of a formula, by position: a cell's row and column, or a range's top, left, bottom and right.
#[derive(Clone, Copy, Debug)]
pub(super) enum Spot {
    Cell(usize, usize),
    Range(usize, usize, usize, usize),
}

/// A merged range: its top, left, bottom and right.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Merge {
    pub top: usize,
    pub left: usize,
    pub bottom: usize,
    pub right: usize,
}

/// A number format a cell's number shows in: its pattern and its kind.
pub(super) struct Pattern {
    pub text: Rc<str>,
    pub kind: FormatKind,
}

/// A sheet's cells as the guess reads them.
pub(super) struct Grid<'a> {
    workbook: &'a Workbook,
    sheet: &'a Sheet,
    /// What each row's cells show, by column.
    rows: HashMap<usize, BTreeMap<usize, Shown>>,
    formulas: HashSet<(usize, usize)>,
    /// What the numbers arrays fill cells with bring, by the cells.
    spilled_formats: HashMap<(usize, usize), Brought>,
    /// The merged ranges by their left column, each column's from the top.
    by_left: BTreeMap<usize, Vec<Merge>>,
    /// The last row and column the sheet has.
    pub last_row: usize,
    pub last_column: usize,
}

impl<'a> Grid<'a> {
    pub(super) fn of(workbook: &'a Workbook, sheet: &'a Sheet) -> Grid<'a> {
        let mut rows: HashMap<usize, BTreeMap<usize, Shown>> = HashMap::new();
        let mut spilled = Vec::new();
        let mut formulas = HashSet::new();
        for (&(r, c), cell) in &sheet.cells {
            let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
            let value = match &cell.input {
                Input::Number { value } => Value::Number(*value),
                Input::Text { value } => Value::text(value.as_str()),
                Input::Boolean { value } => Value::Boolean(*value),
                Input::DropdownOption { option_id, label } => {
                    Value::text(sheet.dropdown_option(option_id).map_or(label.as_str(), |o| o.label.as_str()))
                }
                Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                    Value::text(cell.input.reads_as_text().unwrap_or_default().as_str())
                }
                Input::Formula { .. } => {
                    formulas.insert((row, column));
                    match workbook.outcome(&sheet.id, r, c) {
                        Some(outcome) => {
                            if let Some(SpillOutcome::Fills { array, formats, .. }) = &outcome.spill {
                                for ((i, j), value) in array.stored_entries().filter(|(position, _)| *position != (0, 0)) {
                                    let brought = formats.as_ref().and_then(|f| f.get(array.columns(), (i, j))).cloned();
                                    spilled.push(((row + i, column + j), value.clone(), brought));
                                }
                            }
                            // A formula that reads an empty cell shows 0.
                            match &outcome.value {
                                Value::Blank => Value::Number(0.0),
                                value => value.clone(),
                            }
                        }
                        None => Value::Blank,
                    }
                }
            };
            if let Some(shown) = Shown::of(&value) {
                rows.entry(row).or_default().insert(column, shown);
            }
        }
        let mut spilled_formats = HashMap::new();
        for ((row, column), value, brought) in spilled {
            if sheet.rows.line(row).is_none() || sheet.columns.line(column).is_none() {
                continue;
            }
            let line = rows.entry(row).or_default();
            if let (false, Some(shown)) = (line.contains_key(&column), Shown::of(&value)) {
                line.insert(column, shown);
                if let Some(brought) = brought {
                    spilled_formats.insert((row, column), brought);
                }
            }
        }
        let mut by_left: BTreeMap<usize, Vec<Merge>> = BTreeMap::new();
        for (top, bottom, left, right) in merged_boxes(&workbook.bases, sheet) {
            by_left.entry(left).or_default().push(Merge { top, left, bottom, right });
        }
        for merges in by_left.values_mut() {
            merges.sort_by_key(|m| m.top);
        }
        Grid {
            workbook,
            sheet,
            rows,
            formulas,
            spilled_formats,
            by_left,
            last_row: sheet.rows.len().wrapping_sub(1),
            last_column: sheet.columns.len().wrapping_sub(1),
        }
    }

    /// What the cell itself shows.
    pub(super) fn own(&self, row: usize, column: usize) -> Option<&Shown> {
        self.rows.get(&row)?.get(&column)
    }

    /// The cells of a row that show something themselves, from one column to the other.
    pub(super) fn owned(&self, row: usize, first: usize, last: usize) -> impl Iterator<Item = (usize, &Shown)> {
        let cells = self.rows.get(&row).filter(|_| first <= last);
        cells.into_iter().flat_map(move |cells| cells.range(first..=last)).map(|(&c, shown)| (c, shown))
    }

    /// Rows containing one of their own visible cells in the given columns.
    pub(super) fn owned_rows(&self, top: usize, bottom: usize, first: usize, last: usize) -> Vec<usize> {
        let (first, last) = (first.min(last), first.max(last));
        let mut rows: Vec<_> = self.rows.iter().filter_map(|(&row, cells)| {
            (top <= row && row <= bottom && cells.range(first..=last).next().is_some()).then_some(row)
        }).collect();
        rows.sort_unstable();
        rows
    }

    /// The number format a cell's number shows in: the cell's own, else the one its formula's number or its array's
    /// brings (neither `General` nor for text); none for General.
    pub(super) fn number_format(&self, row: usize, column: usize) -> Option<Pattern> {
        let (r, c) = (self.sheet.rows.line(row)?, self.sheet.columns.line(column)?);
        if let Some(format) = self.sheet.formats.get(Leaf::NumberFormat, (r, c)) {
            let text = format.get("pattern").and_then(|p| p.as_str()).unwrap_or("General");
            let kind = NumberFormat::parse(text).map_or(FormatKind::General, |f| f.kind());
            return Some(Pattern { text: text.into(), kind });
        }
        let brought = if self.formulas.contains(&(row, column)) {
            self.workbook.outcome(&self.sheet.id, r, c)?.brought.as_ref()
        } else {
            self.spilled_formats.get(&(row, column))
        }?;
        Some(Pattern { text: brought.pattern.clone(), kind: brought.kind })
    }

    /// A cell's number as its number format shows it, as text in a locale; none when it can't be shown.
    pub(super) fn shown_number(&self, row: usize, column: usize, number: f64, locale: &Locale) -> Option<String> {
        let pattern = self.number_format(row, column);
        match shown(&Value::Number(number), pattern.as_ref().map(|p| &*p.text), Room::AsText, locale) {
            Ok(ShownValue::Text { text, .. }) => Some(text),
            _ => None,
        }
    }

    /// The cells showing something, row by row from the top and each row's from the left (readTablesOfSheet).
    pub(super) fn shown_cells(&self) -> Vec<(usize, usize, &Shown)> {
        let mut rows: Vec<(&usize, &BTreeMap<usize, Shown>)> = self.rows.iter().collect();
        rows.sort_unstable_by_key(|(&row, _)| row);
        rows.into_iter().flat_map(|(&row, cells)| cells.iter().map(move |(&c, shown)| (row, c, shown))).collect()
    }

    /// What a person put in a cell, if anything.
    pub(super) fn input(&self, row: usize, column: usize) -> Option<&Input> {
        let (r, c) = (self.sheet.rows.line(row)?, self.sheet.columns.line(column)?);
        self.sheet.cells.get(&(r, c)).map(|cell| &cell.input)
    }

    /// Whether a cell is given a checkbox.
    pub(super) fn has_checkbox(&self, row: usize, column: usize) -> bool {
        let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else { return false };
        self.sheet.formats.get(Leaf::CellControl, (r, c)).is_some_and(|control| control["kind"] == "checkbox")
    }

    /// The merged ranges, top down and then left to right.
    pub(super) fn merges_in_order(&self) -> impl Iterator<Item = Merge> {
        merged_boxes(&self.workbook.bases, self.sheet).into_iter().map(|(top, bottom, left, right)| Merge { top, left, bottom, right })
    }

    /// The references of the formula a cell holds to cells and ranges of its own sheet, by position; references
    /// to other sheets, to whole rows or columns, to cells on lines gone, ranges with no cells left, or ranges
    /// reaching the cell's own row or below are left out.
    pub(super) fn formula_spots(&self, row: usize, column: usize) -> Vec<Spot> {
        let Some(Input::Formula { formula }) = self.input(row, column) else { return Vec::new() };
        let bases = &self.workbook.bases;
        let at = |p: &crate::formula::CellPoint| -> Option<(usize, usize)> {
            Some((self.sheet.rows.position(bases.parse(&p.r)?)?, self.sheet.columns.position(bases.parse(&p.c)?)?))
        };
        let mut spots = Vec::new();
        for reference in &formula.references {
            if reference.sheet_id() != self.sheet.id {
                continue;
            }
            match reference {
                Reference::Cell { cell, .. } => {
                    if let Some((r, c)) = at(cell) {
                        spots.push(Spot::Cell(r, c));
                    }
                }
                Reference::Range { top_left, bottom_right, .. } => {
                    // Deleted ends give way toward each other; a range reaching down to the formula's own row or
                    // past it is left out.
                    let ends = |axis, a: &str, b: &str| live_ends(axis, bases.parse(a)?, bases.parse(b)?);
                    let rows = ends(&self.sheet.rows, &top_left.r, &bottom_right.r);
                    let columns = ends(&self.sheet.columns, &top_left.c, &bottom_right.c);
                    if let (Some((top, bottom)), Some((left, right))) = (rows, columns) {
                        if bottom < row {
                            spots.push(Spot::Range(top, left, bottom, right));
                        }
                    }
                }
                Reference::Columns { .. } | Reference::Rows { .. } => {}
            }
        }
        spots
    }

    /// Whether a cell is bold: its format, or else its text with looks all bold.
    pub(super) fn is_bold(&self, row: usize, column: usize) -> bool {
        let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else { return false };
        if self.sheet.formats.get(Leaf::Bold, (r, c)).and_then(|v| v.as_bool()).unwrap_or(false) {
            return true;
        }
        match self.input(row, column) {
            Some(Input::RichText { paragraphs }) => {
                let mut runs = paragraphs.iter().flat_map(|p| &p.runs).peekable();
                runs.peek().is_some() && runs.all(|run| run.marks.contains(&Mark::Bold))
            }
            _ => false,
        }
    }

    /// Whether a cell is filled with a color.
    pub(super) fn is_filled(&self, row: usize, column: usize) -> bool {
        let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else { return false };
        self.sheet.formats.get(Leaf::FillColor, (r, c)).and_then(|v| v.get("kind")).is_some_and(|k| k != "none")
    }

    /// The sheet's last frozen row, where it is.
    pub(super) fn last_frozen_row(&self) -> Option<usize> {
        self.sheet.rows.position(self.sheet.last_frozen_row?)
    }

    /// The workbook the sheet is in.
    pub(super) fn workbook(&self) -> &'a Workbook {
        self.workbook
    }

    /// How many rows the sheet has.
    pub(super) fn row_count(&self) -> usize {
        self.sheet.rows.len()
    }

    /// The workbook's locale.
    pub(super) fn locale(&self) -> &'static Locale {
        crate::locale::find(&self.workbook.locale).unwrap_or_else(crate::locale::en_us)
    }

    /// The merged range whose left column holds the cell below its top.
    fn merge_over(&self, row: usize, column: usize) -> Option<Merge> {
        let merges = self.by_left.get(&column)?;
        let i = merges.partition_point(|m| m.top <= row);
        let m = *merges.get(i.checked_sub(1)?)?;
        (m.top < row && row <= m.bottom && m.left <= column && column <= m.right).then_some(m)
    }

    /// What the cell shows: its own, or, down a merged range's left column, the top left's.
    pub(super) fn content(&self, row: usize, column: usize) -> Option<&Shown> {
        match self.own(row, column) {
            Some(shown) => Some(shown),
            None => self.merge_over(row, column).and_then(|m| self.own(m.top, m.left)),
        }
    }

    /// The cell whose value shows at a cell: itself, or the top left of the merged range it is under.
    pub(super) fn source(&self, row: usize, column: usize) -> (usize, usize) {
        if self.own(row, column).is_some() {
            return (row, column);
        }
        self.merge_over(row, column).map_or((row, column), |m| (m.top, m.left))
    }

    /// The merged ranges, by left column and then from the top.
    pub(super) fn merges(&self) -> impl Iterator<Item = &Merge> {
        self.by_left.values().flatten()
    }

    /// The columns from one to the other where a row shows something, its own or a merged range's.
    pub(super) fn filled_columns(&self, row: usize, first: usize, last: usize) -> Vec<usize> {
        if row > self.last_row || first > last {
            return Vec::new();
        }
        let mut columns: Vec<usize> = match self.rows.get(&row) {
            Some(cells) => cells.range(first..=last).map(|(&c, _)| c).collect(),
            None => Vec::new(),
        };
        if self.by_left.is_empty() {
            return columns;
        }
        for &left in self.by_left.range(first..=last).map(|(c, _)| c) {
            if self.merge_over(row, left).is_some_and(|m| self.own(m.top, m.left).is_some()) {
                columns.push(left);
            }
        }
        columns.sort_unstable();
        columns.dedup();
        columns
    }

    /// Whether a row's own cells (not a merged range's) show something from one column to the other.
    pub(super) fn owns_any(&self, row: usize, first: usize, last: usize) -> bool {
        first <= last && self.rows.get(&row).is_some_and(|cells| cells.range(first..=last).next().is_some())
    }

    /// How many columns from one to the other show something in a row.
    pub(super) fn count(&self, row: usize, first: usize, last: usize) -> usize {
        self.filled_columns(row, first, last).len()
    }

    /// Whether a row shows something from one column to the other.
    pub(super) fn row_has_any(&self, row: usize, first: usize, last: usize) -> bool {
        row <= self.last_row && !self.filled_columns(row, first, last).is_empty()
    }

    /// Whether a column shows something from one row to the other.
    pub(super) fn column_has_any(&self, column: usize, top: usize, bottom: usize) -> bool {
        if column > self.last_column {
            return false;
        }
        let bottom = bottom.min(self.last_row);
        top <= bottom && (top..=bottom).any(|r| self.content(r, column).is_some())
    }

    pub(super) fn kind(&self, row: usize, column: usize) -> Kind {
        self.content(row, column).map_or(Kind::Nothing, Shown::kind)
    }

    /// Whether two cells show the same.
    pub(super) fn alike(&self, (r1, c1): (usize, usize), (r2, c2): (usize, usize)) -> bool {
        match (self.content(r1, c1), self.content(r2, c2)) {
            (Some(a), Some(b)) => a.is_like(b),
            _ => false,
        }
    }

    /// What a cell shows as a label.
    pub(super) fn label(&self, row: usize, column: usize) -> Option<String> {
        self.content(row, column).map(Shown::label)
    }

    /// Whether a cell looks like a header's: filled with a color, or bold.
    pub(super) fn is_marked(&self, row: usize, column: usize) -> bool {
        let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else { return false };
        let filled = self.sheet.formats.get(Leaf::FillColor, (r, c)).and_then(|v| v.get("kind")).is_some_and(|k| k != "none");
        filled || self.sheet.formats.get(Leaf::Bold, (r, c)).and_then(|v| v.as_bool()).unwrap_or(false)
    }

    /// Whether the cell whose value shows at a cell is marked.
    pub(super) fn shows_marked(&self, row: usize, column: usize) -> bool {
        let (r, c) = self.source(row, column);
        self.is_marked(r, c)
    }

    pub(super) fn holds_formula(&self, row: usize, column: usize) -> bool {
        self.formulas.contains(&(row, column))
    }

    /// A column narrower than 41.6 pixels, the gutter between two tables.
    pub(super) fn is_narrow(&self, column: usize) -> bool {
        let Some(c) = self.sheet.columns.line(column) else { return false };
        self.sheet.column_widths.get(&c).is_some_and(|&w| (w as u64) * 100 < 4160)
    }

    /// The merged ranges meeting a range whose top left shows something, wherever their left column is.
    fn showing_merges(&self, top: usize, bottom: usize, first: usize, last: usize) -> impl Iterator<Item = &Merge> {
        self.merges().filter(move |m| {
            m.top <= bottom && top <= m.bottom && m.left <= last && first <= m.right && self.own(m.top, m.left).is_some()
        })
    }

    /// The runs of rows, from one row to another, that show something from one column to another (a cell's own, or a
    /// merged range's meeting them): each from its first row to its last, top down.
    pub(super) fn rows_showing(&self, top: usize, bottom: usize, first: usize, last: usize) -> Vec<(usize, usize)> {
        let (top, bottom) = (top.min(bottom), top.max(bottom));
        let (first, last) = (first.min(last), first.max(last));
        let mut rows: Vec<(usize, usize)> = self
            .rows
            .iter()
            .filter(|(&row, cells)| top <= row && row <= bottom && cells.range(first..=last).next().is_some())
            .map(|(&row, _)| (row, row))
            .collect();
        rows.extend(self.showing_merges(top, bottom, first, last).map(|m| (m.top.max(top), m.bottom.min(bottom))));
        joined(rows)
    }

    /// The runs of columns, from one column to another, where a row shows something: each from its first column to
    /// its last, left to right.
    pub(super) fn columns_showing(&self, row: usize, first: usize, last: usize) -> Vec<(usize, usize)> {
        let mut columns: Vec<(usize, usize)> = self.owned(row, first, last).map(|(c, _)| (c, c)).collect();
        columns.extend(self.showing_merges(row, row, first, last).map(|m| (m.left.max(first), m.right.min(last))));
        joined(columns)
    }

    /// The last row of the block of rows showing something from one column to another that starts at a row, down to
    /// another row at most; none when the row shows nothing.
    pub(super) fn block_end(&self, from: usize, to: usize, first: usize, last: usize) -> Option<usize> {
        if from > to {
            return None;
        }
        self.rows_showing(from, to, first, last).first().filter(|&&(start, _)| start == from).map(|&(_, end)| end)
    }
}

/// Runs from their first to their last, in order, those overlapping or next to each other made one.
fn joined(mut runs: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    runs.sort_unstable();
    let mut joined: Vec<(usize, usize)> = Vec::with_capacity(runs.len());
    for (first, last) in runs {
        match joined.last_mut() {
            Some(run) if first <= run.1.saturating_add(1) => run.1 = run.1.max(last),
            _ => joined.push((first, last)),
        }
    }
    joined
}
