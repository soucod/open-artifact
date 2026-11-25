//! A workbook: its sheets, each with its rows and columns (by id) and its cells.
//!
//! Everything that changes a workbook is an operation (`workbook/load.rs`): the page loads a workbook as the list
//! of operations that made it, and every edit is more operations.

pub mod formats;
pub mod grid;
pub mod layout;
pub mod load;
pub mod objects;
pub mod reorder;
pub mod rich;
pub(crate) mod snapshot;
pub mod version;

use std::collections::BTreeMap;
use hashbrown::HashMap;
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::calculate::{Outcome, SpillOutcome};
use crate::formula::{self, column_letters, sheet_name_text, Expr, ParseError, Reference, StoredFormula};
use crate::ids::{Axis, Bases, LineId};
use crate::value::{CellError, Value};

/// What a cell holds, as typed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Input {
    Number { value: f64 },
    Text { value: String },
    Boolean { value: bool },
    Formula { formula: StoredFormula },
    /// An option of a dropdown: the cell reads as the option's label now, or as this one when the option is gone.
    #[serde(rename_all = "camelCase")]
    DropdownOption { option_id: String, label: String },
    /// A person (`workbook/rich.rs`): the cell reads as their label.
    #[serde(rename_all = "camelCase")]
    User { user_id: String, label: String },
    /// Several people: the cell reads as their labels, joined by `, `.
    Users { users: Vec<rich::Person> },
    /// Text with looks: the cell reads as its text.
    RichText { paragraphs: Vec<rich::Paragraph> },
}

impl Input {
    /// The text a person, people or text with looks read as (`None` for the other inputs).
    pub fn reads_as_text(&self) -> Option<String> {
        match self {
            Input::User { label, .. } => Some(label.clone()),
            Input::Users { users } => Some(rich::labels(users)),
            Input::RichText { paragraphs } => Some(rich::plain_text(paragraphs)),
            _ => None,
        }
    }
}

/// A cell: its input, and its formula read once.
#[derive(Clone, Debug)]
pub struct Cell {
    pub input: Input,
    pub parsed: Option<Rc<Result<Expr, ParseError>>>,
}

impl Cell {
    /// A cell holding the input: a formula read once, and lines of lists at the levels a cell keeps them.
    pub fn new(mut input: Input) -> Cell {
        if let Input::RichText { paragraphs } = &mut input {
            rich::kept_levels(paragraphs);
        }
        let parsed = match &input {
            Input::Formula { formula } => Some(Rc::new(formula::parse(&formula.text_between_references))),
            _ => None,
        };
        Cell { input, parsed }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Sheet {
    pub id: String,
    pub name: String,
    pub rows: Axis,
    pub columns: Axis,
    pub cells: HashMap<(LineId, LineId), Cell>,
    pub formats: formats::CellFormats,
    pub merged_ranges: Vec<layout::RangeIds>,
    pub column_widths: HashMap<LineId, u32>,
    pub row_heights: HashMap<LineId, u32>,
    pub last_frozen_row: Option<LineId>,
    pub last_frozen_column: Option<LineId>,
    pub are_gridlines_hidden: bool,
    pub row_groups: BTreeMap<layout::IdKey, (String, layout::Group)>,
    pub column_groups: BTreeMap<layout::IdKey, (String, layout::Group)>,
    pub dropdowns: BTreeMap<layout::IdKey, (String, Vec<objects::DropdownOption>)>,
    pub conditional_formats: BTreeMap<layout::IdKey, (String, objects::ConditionalFormat)>,
    pub cell_tables: BTreeMap<layout::IdKey, (String, objects::CellTable)>,
    pub named_views: BTreeMap<layout::IdKey, (String, objects::NamedView)>,
    pub placements: BTreeMap<layout::IdKey, (String, objects::Placement)>,
    pub interactive: Option<String>,
}

impl Sheet {
    pub fn shown_views(&self) -> impl Iterator<Item = &str> {
        self.placements.values().map(|(_, p)| p.shows.view_id()).chain(self.interactive.as_deref())
    }
}

#[derive(Clone, Debug)]
pub struct Workbook {
    pub revision: u64,
    pub bases: Bases,
    /// The sheets not deleted, in order.
    pub sheets: Vec<Sheet>,
    /// The deleted sheets, kept whole so that undeleting one brings it back as it was.
    pub deleted_sheets: Vec<Sheet>,
    /// Every sheet's id, deleted or not, in order: a deleted sheet keeps its place.
    pub sheet_order: Vec<String>,
    /// What the last calculation worked out, by sheet id and cell.
    pub outcomes: HashMap<(String, LineId, LineId), Outcome>,
    /// Whether the outcomes are out of date.
    pub needs_calculation: bool,
    /// `NOW()` as the last calculation read it (none: no clock reading counted).
    pub calculated_at: Option<f64>,
    /// The workbook's time zone, when it has one, by the name it was given.
    pub time_zone: Option<String>,
    /// The workbook's locale.
    pub locale: String,
    /// What random numbers are drawn from.
    pub seed: u32,
    pub views: BTreeMap<layout::IdKey, (String, objects::View)>,
}

impl Default for Workbook {
    fn default() -> Workbook {
        Workbook {
            revision: 0,
            bases: Bases::default(),
            sheets: Vec::new(),
            deleted_sheets: Vec::new(),
            sheet_order: Vec::new(),
            outcomes: HashMap::new(),
            needs_calculation: false,
            calculated_at: None,
            time_zone: None,
            locale: DEFAULT_LOCALE.to_owned(),
            seed: 0,
            views: BTreeMap::new(),
        }
    }
}

pub const DEFAULT_LOCALE: &str = "en-US";

/// The room a cell's shown General number takes, as `readWorkbook` tells it: 11 characters (`0.520833333`,
/// `1.23457E+11`), as a cell fits one (`lines/fit.rs`).
const ROOM_OF_A_SHOWN_NUMBER: crate::number_format::Room = crate::number_format::Room::InACell { most_characters: 11 };

/// What a locale changes in how numbers are read and written, as `readWorkbook` tells it: each of its signs, sizes of
/// groups and pattern of a time of day that is not en-US's (`None`: not a locale known).
pub fn locale_facts(tag: &str) -> Option<Vec<(&'static str, &'static str)>> {
    let locale = crate::locale::find(tag)?;
    let en_us = crate::locale::en_us();
    let mut facts = Vec::new();
    if locale.decimal_sign != en_us.decimal_sign {
        facts.push(("decimalSign", locale.decimal_sign.name()));
    }
    if locale.group_sign != en_us.group_sign {
        facts.push(("groupSign", locale.group_sign.name()));
    }
    if locale.sizes_of_groups != en_us.sizes_of_groups {
        facts.push(("sizesOfGroups", locale.sizes_of_groups.name()));
    }
    if locale.pattern_of_a_time_of_day != en_us.pattern_of_a_time_of_day {
        facts.push(("patternOfATimeOfDay", locale.pattern_of_a_time_of_day));
    }
    Some(facts)
}

/// A time zone's name as it is kept (another name of a zone is the zone's), when the zone is known.
pub fn time_zone_named(name: &str) -> Option<String> {
    crate::time_zone::named(name).map(str::to_owned)
}

/// A cell of a sheet, by the sheet's id, as `outcomes` is keyed but without a copy of the id: hashed as the key is.
#[derive(Hash)]
pub(crate) struct OutcomeAt<'a>(&'a str, LineId, LineId);

impl hashbrown::Equivalent<(String, LineId, LineId)> for OutcomeAt<'_> {
    fn equivalent(&self, (sheet_id, r, c): &(String, LineId, LineId)) -> bool {
        self.0 == sheet_id && self.1 == *r && self.2 == *c
    }
}

impl Workbook {
    /// What the last calculation worked out in a cell.
    pub fn outcome(&self, sheet_id: &str, r: LineId, c: LineId) -> Option<&Outcome> {
        self.outcomes.get(&OutcomeAt(sheet_id, r, c))
    }

    pub fn sheet_index(&self, sheet_id: &str) -> Option<usize> {
        self.sheets.iter().position(|s| s.id == sheet_id)
    }

    /// A formula's text as it reads now: its references written from where their rows and columns are, with the
    /// sheet's name when they are on another sheet.
    pub fn formula_text(&self, sheet: usize, formula: &StoredFormula) -> String {
        let mut out = String::new();
        for (i, piece) in formula.text_between_references.iter().enumerate() {
            out.push_str(piece);
            if let Some(reference) = formula.references.get(i) {
                out.push_str(&self.reference_text(sheet, reference));
            }
        }
        out
    }

    fn reference_text(&self, from_sheet: usize, reference: &Reference) -> String {
        self.reference_text_moved(from_sheet, reference, 0)
    }

    /// A reference's text as `reference_text` writes it, its rows not fixed moved `delta` rows (past the sheet's
    /// end, as they would be written).
    pub(crate) fn reference_text_moved(&self, from_sheet: usize, reference: &Reference, delta: i64) -> String {
        let Some(at) = self.locate(reference) else {
            return CellError::Reference.text().to_owned();
        };
        let sheet = &self.sheets[at.sheet];
        let prefix = if at.sheet == from_sheet { String::new() } else { format!("{}!", sheet_name_text(&sheet.name)) };
        let row = |(p, absolute): End| {
            format!("{}{}", if absolute { "$" } else { "" }, p as i64 + 1 + if absolute { 0 } else { delta })
        };
        let column = |(p, absolute): End| format!("{}{}", if absolute { "$" } else { "" }, column_letters(p));
        let text = match reference {
            Reference::Cell { .. } => format!("{}{}", column(at.left), row(at.top)),
            Reference::Range { .. } => format!("{}{}:{}{}", column(at.left), row(at.top), column(at.right), row(at.bottom)),
            Reference::Columns { top, .. } => {
                let top = if top.is_some() { row(at.top) } else { String::new() };
                format!("{}{}:{}", column(at.left), top, column(at.right))
            }
            Reference::Rows { left, .. } => {
                let left = if left.is_some() { column(at.left) } else { String::new() };
                format!("{}{}:{}", left, row(at.top), row(at.bottom))
            }
        };
        format!("{prefix}{text}")
    }

    /// Where a reference's cells are now. Its ends follow their rows and columns by id; an end whose row or column
    /// is deleted gives way to the nearest one left toward the other end (a cell has none to give way to), and the
    /// ends of each axis are put in order, each keeping its `$`. `None` when the reference has lost all its cells,
    /// or its sheet.
    pub fn locate(&self, reference: &Reference) -> Option<Located> {
        let s = self.sheet_index(reference.sheet_id())?;
        let sheet = &self.sheets[s];
        let line = |id: &str| self.bases.parse(id);
        // Both ends on one axis, each snapped toward the other, in order.
        let ends = |axis: &Axis, a: (&str, bool), b: (&str, bool)| -> Option<(End, End)> {
            let (la, lb) = (line(a.0)?, line(b.0)?);
            let (pa, pb) = (axis.snap_toward(la, lb)?, axis.snap_toward(lb, la)?);
            Some(if pb < pa { ((pb, b.1), (pa, a.1)) } else { ((pa, a.1), (pb, b.1)) })
        };
        let whole = |axis: &Axis| -> Option<(End, End)> { Some(((0, false), (axis.len().checked_sub(1)?, false))) };
        let ((top, bottom), (left, right)) = match reference {
            Reference::Cell { cell, .. } => (
                ends(&sheet.rows, (&cell.r, cell.is_row_absolute), (&cell.r, cell.is_row_absolute))?,
                ends(&sheet.columns, (&cell.c, cell.is_column_absolute), (&cell.c, cell.is_column_absolute))?,
            ),
            Reference::Range { top_left: a, bottom_right: b, .. } => (
                ends(&sheet.rows, (&a.r, a.is_row_absolute), (&b.r, b.is_row_absolute))?,
                ends(&sheet.columns, (&a.c, a.is_column_absolute), (&b.c, b.is_column_absolute))?,
            ),
            Reference::Columns { left, right, top, .. } => {
                let rows = match top {
                    Some(t) => {
                        let p = sheet.rows.snap_forward(line(&t.r)?)?;
                        ((p, t.is_row_absolute), whole(&sheet.rows)?.1)
                    }
                    None => whole(&sheet.rows)?,
                };
                (rows, ends(&sheet.columns, (&left.c, left.is_column_absolute), (&right.c, right.is_column_absolute))?)
            }
            Reference::Rows { top, bottom, left, .. } => {
                let columns = match left {
                    Some(l) => {
                        let p = sheet.columns.snap_forward(line(&l.c)?)?;
                        ((p, l.is_column_absolute), whole(&sheet.columns)?.1)
                    }
                    None => whole(&sheet.columns)?,
                };
                (ends(&sheet.rows, (&top.r, top.is_row_absolute), (&bottom.r, bottom.is_row_absolute))?, columns)
            }
        };
        Some(Located { sheet: s, top, bottom, left, right })
    }

    /// Puts the sheets not deleted in the order of `sheet_order`.
    pub fn order_sheets(&mut self) {
        let index: HashMap<&str, usize> = self.sheet_order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
        let mut sheets = std::mem::take(&mut self.sheets);
        sheets.sort_by_key(|s| index.get(s.id.as_str()).copied().unwrap_or(usize::MAX));
        self.sheets = sheets;
    }

    /// The workbook as `readWorkbook` answers it.
    pub fn contents(&self) -> serde_json::Value {
        serde_json::to_value(self.contents_written()).expect("contents serialize")
    }

    /// The workbook as `readWorkbook` answers it, to be written out: its cells are written as they are, not made into
    /// JSON first.
    pub fn contents_written(&self) -> Contents {
        use serde_json::{json, Map, Value};
        let bases = &self.bases;
        let locale = crate::locale::find(&self.locale).unwrap_or_else(crate::locale::en_us);
        let mut sheets = Vec::with_capacity(self.sheets.len());
        for (index, sheet) in self.sheets.iter().enumerate() {
            let mut cells: Vec<(usize, usize, &LineId, &LineId, &Cell)> = sheet
                .cells
                .iter()
                .filter_map(|((r, c), cell)| Some((sheet.rows.position(*r)?, sheet.columns.position(*c)?, r, c, cell)))
                .collect();
            cells.sort_by_key(|(r, c, ..)| (*r, *c));
            let contents = |(_, _, r, c, cell): (usize, usize, &LineId, &LineId, &Cell)| {
                self.cell_contents(index, (*r, *c), cell, locale, true)
            };
            let cells: Vec<CellContents> = cells.into_iter().map(contents).collect();
            let mut out = Map::new();
            let mut put = |key: &str, v: Value| {
                out.insert(key.to_owned(), v);
            };
            put("sheetId", json!(sheet.id));
            put("name", json!(sheet.name));
            put("rows", json!(sheet.rows.runs(bases)));
            put("columns", json!(sheet.columns.runs(bases)));
            if let Some(view) = &sheet.interactive {
                put("interactive", json!(view));
            }
            let mut list = |key: &str, items: Vec<Value>| {
                if !items.is_empty() {
                    put(key, Value::Array(items));
                }
            };
            list("mergedRanges", layout::merged_contents(bases, sheet));
            list("columnWidths", layout::sizes_contents(bases, &sheet.columns, &sheet.column_widths, "columns", "widthInPixels"));
            list("rowHeights", layout::sizes_contents(bases, &sheet.rows, &sheet.row_heights, "rows", "heightInPixels"));
            let live = sheet.formats.iter().filter(|(_, (r, c), _)| sheet.rows.contains(*r) && sheet.columns.contains(*c));
            let formats = formats::blocks(bases, live)
                .into_iter()
                .map(|(rows, columns, format)| json!({"rows": rows, "columns": columns, "format": format}))
                .collect();
            list("cellFormats", formats);
            list("dropdowns", objects::dropdowns_contents(sheet));
            drop(list);
            if let Some(row) = sheet.last_frozen_row.filter(|r| sheet.rows.contains(*r)) {
                put("lastFrozenRow", json!(bases.text(row)));
            }
            if let Some(column) = sheet.last_frozen_column.filter(|c| sheet.columns.contains(*c)) {
                put("lastFrozenColumn", json!(bases.text(column)));
            }
            if sheet.are_gridlines_hidden {
                put("areGridlinesHidden", json!(true));
            }
            let mut list = |key: &str, items: Vec<Value>| {
                if !items.is_empty() {
                    put(key, Value::Array(items));
                }
            };
            list("rowGroups", layout::groups_contents(bases, &sheet.rows, &sheet.row_groups));
            list("columnGroups", layout::groups_contents(bases, &sheet.columns, &sheet.column_groups));
            list("conditionalFormats", objects::conditional_formats_contents(bases, sheet));
            list("placements", objects::placements_contents(bases, sheet));
            list("cellTables", objects::cell_tables_contents(bases, sheet));
            list(
                "namedViews",
                sheet.named_views.values().map(|(id, view)| json!({"namedViewId": id, "namedView": view})).collect(),
            );
            drop(list);
            let head = std::mem::take(&mut out);
            let spilled: Vec<Value> = self.spilled_cells(index, locale).into_iter().map(|(_, cell)| cell).collect();
            if !spilled.is_empty() {
                out.insert("spilledCells".into(), Value::Array(spilled));
            }
            sheets.push(SheetContents { head, cells, tail: out });
        }
        let mut head = Map::new();
        head.insert("kind".into(), json!("workbookContents"));
        head.insert("revision".into(), json!(self.revision));
        let mut out = Map::new();
        if let Some(tz) = &self.time_zone {
            out.insert("timeZone".into(), json!(time_zone_named(tz).unwrap_or_else(|| tz.clone())));
        }
        if self.locale != DEFAULT_LOCALE {
            out.insert("locale".into(), json!(self.locale));
            for (key, value) in locale_facts(&self.locale).unwrap_or_default() {
                out.insert(key.into(), json!(value));
            }
        }
        // A view placed only on deleted sheets goes with them (it is still there to set, and comes back with them);
        // one placed nowhere stays.
        fn placed(sheets: &[Sheet]) -> hashbrown::HashSet<&str> {
            sheets.iter().flat_map(Sheet::shown_views).collect()
        }
        let (live, deleted) = (placed(&self.sheets), placed(&self.deleted_sheets));
        let views: Vec<Value> = self
            .views
            .values()
            .filter(|(id, _)| live.contains(id.as_str()) || !deleted.contains(id.as_str()))
            .map(|(id, view)| json!({"viewId": id, "view": view}))
            .collect();
        if !views.is_empty() {
            out.insert("views".into(), Value::Array(views));
        }
        Contents { head, sheets, tail: out }
    }

    /// A cell's contents as `readWorkbook` and `readCells` tell them (`index` is the sheet's). Without what its formula
    /// came to (`outcome` false), it is an input the cell held, as a cell's history tells it.
    pub fn cell_contents(
        &self,
        index: usize,
        (r, c): (LineId, LineId),
        cell: &Cell,
        locale: &crate::locale::Locale,
        outcome: bool,
    ) -> CellContents {
        let sheet = &self.sheets[index];
        let mut contents = CellContents {
            r: self.bases.text(r),
            c: self.bases.text(c),
            input: cell.input.clone(),
            formula_text: None,
            number_is_edited_as: None,
            text_is_edited_after_the_mark: false,
            value: None,
            numbers_of_list_lines: None,
            shown: None,
            number_format_brought: None,
            links_to: None,
            spill: None,
            draws_random_numbers: false,
            dropdown_option: None,
        };
        let outcome = self.outcome(&sheet.id, r, c).filter(|_| outcome);
        match &cell.input {
            Input::Formula { formula } => {
                let text = self.formula_text(index, formula);
                contents.formula_text = Some(match crate::locale::find(&self.locale) {
                    Some(locale) => crate::formula_text::in_locale(&text, locale),
                    None => text,
                });
                if let Some(outcome) = outcome {
                    contents.value = Some(ValueContents::of(&outcome.value));
                    contents.links_to = outcome.links_to.as_deref().map(str::to_owned);
                    contents.spill = outcome.spill.as_ref().map(|s| self.spill_contents(sheet, s));
                }
                let expr = cell.parsed.as_deref().and_then(|p| p.as_ref().ok());
                contents.draws_random_numbers = expr.is_some_and(|e| {
                    crate::calculate::calls(e, "RAND") || crate::calculate::calls(e, "RANDBETWEEN")
                });
            }
            Input::Number { value } => {
                let pattern = sheet.formats.value(formats::Leaf::NumberFormat, (r, c));
                let pattern = pattern["pattern"].as_str().unwrap_or("General");
                contents.number_is_edited_as = crate::edited::number_is_edited_as(*value, pattern, locale);
            }
            Input::Text { value } => {
                contents.text_is_edited_after_the_mark = crate::edited::text_is_edited_after_the_mark(value, locale);
            }
            Input::DropdownOption { option_id, label } => {
                let option = sheet.dropdown_option(option_id);
                let label = option.map_or(label, |o| &o.label);
                contents.value = Some(ValueContents::Text(label.clone()));
                contents.dropdown_option = option.cloned();
            }
            // People and text with looks are edited as their text is, after a `'` when it would read otherwise.
            Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                let text = cell.input.reads_as_text();
                contents.text_is_edited_after_the_mark =
                    text.as_deref().is_some_and(|t| crate::edited::text_is_edited_after_the_mark(t, locale));
                contents.value = text.map(ValueContents::Text);
                if let Input::RichText { paragraphs } = &cell.input {
                    contents.numbers_of_list_lines = rich::numbers_of_lines(paragraphs);
                }
            }
            Input::Boolean { .. } => {}
        }
        // A formula's input held once is shown as nothing it came to.
        if outcome.is_some() || !matches!(cell.input, Input::Formula { .. }) {
            contents.shown = self.shown_in(sheet, (r, c), cell, locale);
        }
        // A formula's number without a number format of its own shows as what it reads brings.
        let own = sheet.formats.get(formats::Leaf::NumberFormat, (r, c)).is_some();
        if let (Some(outcome), false) = (outcome, own) {
            if let (Some(brought), Value::Number(_)) = (&outcome.brought, &outcome.value) {
                let room = crate::number_format::Room::AsText;
                contents.shown = crate::shown::shown(&outcome.value, Some(&brought.pattern), room, locale).ok();
                let pattern = brought.pattern.to_string();
                contents.number_format_brought = Some(BroughtContents { kind: brought.kind.name(), pattern });
            }
        }
        contents
    }

    /// How a cell with a number format shows its number or text (worked out, for a formula); `None` without one.
    pub fn shown_in(&self, sheet: &Sheet, at: (LineId, LineId), cell: &Cell, locale: &crate::locale::Locale) -> Option<crate::shown::ShownValue> {
        let pattern = sheet.formats.get(formats::Leaf::NumberFormat, at)?.get("pattern")?.as_str()?;
        let value = match &cell.input {
            Input::Number { value } => Value::Number(*value),
            Input::Text { value } => Value::Text(value.as_str().into()),
            Input::Formula { .. } => self.outcome(&sheet.id, at.0, at.1)?.value.clone(),
            // An option shows its label, as a text.
            Input::DropdownOption { option_id, label } => {
                Value::Text(sheet.dropdown_option(option_id).map_or(label, |o| &o.label).as_str().into())
            }
            // People and text with looks show their text.
            input => Value::Text(input.reads_as_text()?.as_str().into()),
        };
        if !matches!(value, Value::Number(_) | Value::Text(_)) {
            return None;
        }
        // A text is told as shown only through a section for texts (`@`, `0;0;0;"x"`): else it shows as it is.
        let reads = crate::number_format::NumberFormat::parse(pattern);
        if matches!(value, Value::Text(_)) && !reads.is_ok_and(|format| format.shows_texts()) {
            return None;
        }
        crate::shown::shown(&value, Some(pattern), ROOM_OF_A_SHOWN_NUMBER, locale).ok()
    }

    /// The empty cells the arrays of a sheet fill, by their places (row, column) in order: the formula each comes
    /// from and what it comes to, shown in the cell's own number format, else in the one its number brings.
    pub fn spilled_cells(&self, index: usize, locale: &crate::locale::Locale) -> Vec<((usize, usize), serde_json::Value)> {
        self.spilled_cells_where(index, locale, |_, _| true)
    }

    pub(crate) fn spilled_cells_where(
        &self,
        index: usize,
        locale: &crate::locale::Locale,
        selected: impl Fn(usize, usize) -> bool,
    ) -> Vec<((usize, usize), serde_json::Value)> {
        let sheet = &self.sheets[index];
        let mut out = Vec::new();
        for ((id, r, c), outcome) in &self.outcomes {
            let Some(SpillOutcome::Fills { array, formats, .. }) = (*id == sheet.id).then_some(outcome.spill.as_ref()).flatten()
            else {
                continue;
            };
            let (Some(top), Some(left)) = (sheet.rows.position(*r), sheet.columns.position(*c)) else { continue };
            let from = serde_json::json!({"r": self.bases.text(*r), "c": self.bases.text(*c)});
            for ((i, j), value) in array.entries().filter(|(position, _)| *position != (0, 0)) {
                let (row, column) = (top + i, left + j);
                if !selected(row, column) {
                    continue;
                }
                let (Some(rl), Some(cl)) = (sheet.rows.line(row), sheet.columns.line(column)) else { continue };
                if sheet.cells.contains_key(&(rl, cl)) {
                    continue;
                }
                let mut cell = serde_json::json!({
                    "r": self.bases.text(rl), "c": self.bases.text(cl), "from": from, "value": ValueContents::of(value),
                });
                let room = crate::number_format::Room::AsText;
                let own = sheet.formats.get(formats::Leaf::NumberFormat, (rl, cl));
                if let Some(pattern) = own.and_then(|f| f.get("pattern")?.as_str()) {
                    // A text is shown in a number format only through a section for texts.
                    let reads = crate::number_format::NumberFormat::parse(pattern);
                    let shows = match value {
                        Value::Number(_) => true,
                        Value::Text(_) => reads.is_ok_and(|format| format.shows_texts()),
                        _ => false,
                    };
                    if let Some(shown) = shows.then(|| crate::shown::shown(value, Some(pattern), room, locale).ok()).flatten() {
                        cell["shown"] = serde_json::json!(shown);
                    }
                } else if let (Value::Number(_), Some(brought)) =
                    (value, formats.as_ref().and_then(|f| f.get(array.columns(), (i, j))))
                {
                    if let Ok(shown) = crate::shown::shown(value, Some(&brought.pattern), room, locale) {
                        cell["shown"] = serde_json::json!(shown);
                    }
                    let brought = BroughtContents { kind: brought.kind.name(), pattern: brought.pattern.to_string() };
                    cell["numberFormatBrought"] = serde_json::json!(brought);
                }
                out.push(((row, column), cell));
            }
        }
        out.sort_by_key(|(at, _)| *at);
        out
    }

    pub(crate) fn spill_contents(&self, sheet: &Sheet, spill: &SpillOutcome) -> SpillContents {
        let cell = |(r, c): (usize, usize)| PlaceContents {
            r: sheet.rows.line(r).map(|l| self.bases.text(l)).unwrap_or_default(),
            c: sheet.columns.line(c).map(|l| self.bases.text(l)).unwrap_or_default(),
        };
        match spill {
            SpillOutcome::Fills { to, .. } => SpillContents::Fills { to: cell(*to) },
            SpillOutcome::Blocked { by, would_fill_to } => SpillContents::Blocked {
                by: match by {
                    crate::calculate::BlockedBy::FilledCell(p) => BlockedContents::FilledCell { cell: cell(*p) },
                    crate::calculate::BlockedBy::EarlierFormula(p) => BlockedContents::EarlierFormula { cell: cell(*p) },
                    crate::calculate::BlockedBy::EndOfSheet(_) => BlockedContents::EndOfSheet,
                },
                would_fill_to: cell(*would_fill_to),
            },
        }
    }
}

/// A position on an axis, and whether the reference fixes it (`$`).
pub type End = (usize, bool);

/// Where a reference's cells are now (`Workbook::locate`).
#[derive(Clone, Copy, Debug)]
pub struct Located {
    pub sheet: usize,
    pub top: End,
    pub bottom: End,
    pub left: End,
    pub right: End,
}

/// The workbook as `readWorkbook` answers it: what comes before its sheets, the sheets, and what comes after.
pub struct Contents {
    head: serde_json::Map<String, serde_json::Value>,
    pub sheets: Vec<SheetContents>,
    tail: serde_json::Map<String, serde_json::Value>,
}

/// A sheet as `readWorkbook` answers it: what comes before its cells, the cells, and what comes after.
pub struct SheetContents {
    pub head: serde_json::Map<String, serde_json::Value>,
    pub cells: Vec<CellContents>,
    pub tail: serde_json::Map<String, serde_json::Value>,
}

impl Contents {
    pub(crate) fn pack(self, mut blocks_for: impl FnMut(Vec<CellContents>) -> Vec<usize>) -> serde_json::Value {
        use serde_json::{json, Value};
        let Contents { mut head, sheets, mut tail } = self;
        head.insert("kind".into(), json!("workbookContentsWithCellsPacked"));
        let sheets = sheets.into_iter().map(|sheet| {
            let SheetContents { mut head, cells, mut tail } = sheet;
            head.insert("cells".into(), json!(blocks_for(cells)));
            head.append(&mut tail);
            Value::Object(head)
        }).collect();
        head.insert("sheets".into(), Value::Array(sheets));
        head.append(&mut tail);
        Value::Object(head)
    }
}

/// An object written as `head`, then one more key, then `tail`.
fn serialize_around<S: serde::Serializer, T: Serialize>(
    serializer: S,
    head: &serde_json::Map<String, serde_json::Value>,
    (key, value): (&str, &T),
    tail: &serde_json::Map<String, serde_json::Value>,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut map = serializer.serialize_map(Some(head.len() + 1 + tail.len()))?;
    for (k, v) in head {
        map.serialize_entry(k, v)?;
    }
    map.serialize_entry(key, value)?;
    for (k, v) in tail {
        map.serialize_entry(k, v)?;
    }
    map.end()
}

impl Serialize for Contents {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serialize_around(serializer, &self.head, ("sheets", &self.sheets), &self.tail)
    }
}

impl Serialize for SheetContents {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serialize_around(serializer, &self.head, ("cells", &self.cells), &self.tail)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellContents {
    pub r: String,
    pub c: String,
    pub input: Input,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula_text: Option<String>,
    /// How the page writes the number to be edited, where it needs telling (`edited.rs`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_is_edited_as: Option<String>,
    /// The text is written after a `'` to be edited.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub text_is_edited_after_the_mark: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<ValueContents>,
    /// The number of each line of text with looks, when one of its lines is of a numbered list (none for the others).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numbers_of_list_lines: Option<Vec<Option<u32>>>,
    /// The option a cell of a dropdown holds (told before how it shows).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropdown_option: Option<objects::DropdownOption>,
    /// How the cell shows its number or text, when it has a number format (or its formula brings one).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shown: Option<crate::shown::ShownValue>,
    /// The number format a formula's number brings from what it reads, when its cell has none of its own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format_brought: Option<BroughtContents>,
    /// The link a formula's value is (a HYPERLINK's).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spill: Option<SpillContents>,
    /// The formula calls RAND or RANDBETWEEN.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub draws_random_numbers: bool,
}

/// A number format brought, as the page reads it.
#[derive(Serialize)]
pub struct BroughtContents {
    pub kind: &'static str,
    pub pattern: String,
}

/// A worked-out value as the page reads it.
#[derive(Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ValueContents {
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(CellError),
}

impl ValueContents {
    pub fn of(v: &Value) -> ValueContents {
        match v {
            Value::Blank => ValueContents::Number(0.0),
            Value::Number(n) => ValueContents::Number(*n),
            Value::Text(s) => ValueContents::Text(s.to_string()),
            Value::Boolean(b) => ValueContents::Boolean(*b),
            Value::Error(e) => ValueContents::Error(*e),
        }
    }
}

#[derive(Serialize)]
pub struct PlaceContents {
    pub r: String,
    pub c: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpillContents {
    Fills {
        to: PlaceContents,
    },
    #[serde(rename_all = "camelCase")]
    Blocked {
        by: BlockedContents,
        would_fill_to: PlaceContents,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BlockedContents {
    FilledCell { cell: PlaceContents },
    EarlierFormula { cell: PlaceContents },
    EndOfSheet,
}
