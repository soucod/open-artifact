//! What a filter on a table leaves in view (readFilteredRows), and the values a column of it holds, each with how
//! many records the filter's other lines leave it (readValuesOfFilteredColumn).
//!
//! A filter is lines that must all hold, each tests of which one must: a column meets a condition, is one of some
//! values or none of them. Only records are tested: a row of the body that shows something in the table's columns
//! and is no section's title, subtotal or header again. Blank rows, subtotals and headers again are always out of
//! view; a section's title is in view while a record of its section is.
//!
//! A cell is read as a key: a text with its spaces run together and trimmed, in small letters, or the number it is
//! when it is typed as one in the workbook's locale (`$5`, `50%`, `1/2/2020`); a text of spaces only is blank.
//! Conditions on text read a text as it is (its spaces run together), a number as `&` writes it in the locale, a
//! boolean as `true` or `false`, and never an error. A value that appears more than once is no blank or error.
//!
//! A cell a merged range hides is read as the range's top left cell (wherever that is) when it is in that cell's
//! column, and as blank when it is not. A row is a record when it shows something itself in the table's columns, or
//! a merged range across them whose top left shows something covers it.

use hashbrown::HashMap;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::live::{self, LiveTable, Role, TableInIds};
use super::values::SheetValues;
use crate::ids::runs_of;
use crate::locale::{self, Locale};
use crate::session::edits::objects::condition_within_limits;
use crate::typing;
use crate::value::{number_text_in, CellError, Value};
use crate::workbook::layout::merged_boxes;
use crate::workbook::objects::{CellCondition, Comparison, NumberOperand};
use crate::workbook::Workbook;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Filter {
    all_of: Vec<Line>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Line {
    any_of: Vec<Test>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Test {
    c: String,
    asked: Asked,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Asked {
    Meets { condition: CellCondition },
    IsOneOf { values: Vec<Option<AskedValue>> },
    IsNoneOf { values: Vec<Option<AskedValue>> },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum AskedValue {
    Number { value: f64 },
    Text { value: String },
    Boolean { value: bool },
    Error { value: CellError },
}

impl Filter {
    /// Whether the filter can be read: lines, each with tests, no list of values empty, no condition on an empty
    /// text.
    pub(crate) fn is_readable(&self) -> bool {
        !self.all_of.is_empty()
            && self.all_of.iter().all(|line| {
                !line.any_of.is_empty()
                    && line.any_of.iter().all(|test| match &test.asked {
                        Asked::Meets { condition } => !holds_empty_text(condition),
                        Asked::IsOneOf { values } | Asked::IsNoneOf { values } => !values.is_empty(),
                    })
            })
    }

    fn tests(&self) -> impl Iterator<Item = &Test> {
        self.all_of.iter().flat_map(|line| &line.any_of)
    }

    pub(crate) fn columns(&self) -> impl Iterator<Item = &str> {
        self.tests().flat_map(|test| {
            let (one, other) = match &test.asked {
                Asked::Meets { condition: CellCondition::NumberIs { operand, .. } } => (Some(operand), None),
                Asked::Meets { condition: CellCondition::NumberIsBetween { one_end, other_end }
                    | CellCondition::NumberIsNotBetween { one_end, other_end } } => (Some(one_end), Some(other_end)),
                _ => (None, None),
            };
            std::iter::once(test.c.as_str()).chain(one.into_iter().chain(other).filter_map(|operand| {
                match operand {
                    NumberOperand::SameRowInColumn { c } => Some(c.as_str()),
                    _ => None,
                }
            }))
        })
    }

    /// How many tests the filter makes, in all its lines.
    pub(crate) fn count_of_tests(&self) -> usize {
        self.tests().count()
    }

    /// Whether a text among the values asked for holds a control character other than a tab or a new line (a named
    /// view refuses it, `valueInNamedViewNotAllowed`).
    pub(crate) fn asks_for_a_value_not_allowed(&self) -> bool {
        self.tests().any(|test| match &test.asked {
            Asked::IsOneOf { values } | Asked::IsNoneOf { values } => values.iter().any(|value| {
                matches!(value, Some(AskedValue::Text { value }) if value.chars().any(|c| c < ' ' && c != '\t' && c != '\n' && c != '\r'))
            }),
            Asked::Meets { .. } => false,
        })
    }

    pub(crate) fn check_conditions(&self) -> Result<(), &'static str> {
        self.tests().filter_map(|test| match &test.asked {
            Asked::Meets { condition } => Some(condition),
            _ => None,
        }).try_for_each(condition_within_limits)
    }
}

fn holds_empty_text(condition: &CellCondition) -> bool {
    match condition {
        CellCondition::TextIs { text }
        | CellCondition::TextIsNot { text }
        | CellCondition::TextContains { text }
        | CellCondition::TextDoesNotContain { text }
        | CellCondition::TextStartsWith { text }
        | CellCondition::TextEndsWith { text } => text.is_empty(),
        _ => false,
    }
}

/// A cell (or an asked value) as the filter reads it.
#[derive(Clone, Debug, PartialEq)]
enum Key {
    Blank,
    /// A number, with the text it was read from (in small letters), which conditions on text read.
    Number(f64, Option<String>),
    /// In small letters.
    Text(String),
    Boolean(bool),
    Error(CellError),
}

/// A key to group values by.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Group {
    Blank,
    Number(u64),
    Text(String),
    Boolean(bool),
    Error(CellError),
}

impl Key {
    fn group(&self) -> Group {
        match self {
            Key::Blank => Group::Blank,
            Key::Number(n, _) => Group::Number((n + 0.0).to_bits()),
            Key::Text(t) => Group::Text(t.clone()),
            Key::Boolean(b) => Group::Boolean(*b),
            Key::Error(e) => Group::Error(*e),
        }
    }

    /// The key as conditions on text read it: none for an error.
    fn text(&self, locale: &Locale) -> Option<String> {
        match self {
            Key::Blank => Some(String::new()),
            Key::Number(_, Some(t)) => Some(t.clone()),
            Key::Number(n, None) => Some(number_text_in(*n, locale).to_lowercase()),
            Key::Text(t) => Some(t.clone()),
            Key::Boolean(b) => Some(if *b { "true" } else { "false" }.to_owned()),
            Key::Error(_) => None,
        }
    }
}

/// A text with its spaces run together and trimmed.
fn collapsed(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A text read as a key: blank when it is spaces only, the number it is typed as, or itself in small letters.
fn text_key(text: &str, locale: &Locale) -> Key {
    let text = collapsed(text);
    if text.is_empty() {
        Key::Blank
    } else if let Some(n) = typing::number_of(&text, locale) {
        Key::Number(n, Some(text.to_lowercase()))
    } else {
        Key::Text(text.to_lowercase())
    }
}

fn key_of(value: &Value, locale: &Locale) -> Key {
    match value {
        Value::Blank => Key::Blank,
        Value::Number(n) => Key::Number(*n, None),
        Value::Text(t) => text_key(t, locale),
        Value::Boolean(b) => Key::Boolean(*b),
        Value::Error(e) => Key::Error(*e),
    }
}

/// A value as the values of a column show it.
fn shown(value: &Value, key: &Key) -> Json {
    match (key, value) {
        (Key::Blank, _) => Json::Null,
        (Key::Number(n, _), _) => json!({"kind": "number", "value": n}),
        (Key::Text(_), Value::Text(t)) => json!({"kind": "text", "value": collapsed(t)}),
        (Key::Text(t), _) => json!({"kind": "text", "value": t}),
        (Key::Boolean(b), _) => json!({"kind": "boolean", "value": b}),
        (Key::Error(e), _) => json!({"kind": "error", "value": e.text()}),
    }
}

/// A condition's text as it is compared: spaces run together and trimmed, in small letters (a text of spaces only
/// as it is).
fn condition_text(text: &str) -> String {
    if text.chars().all(char::is_whitespace) {
        text.to_owned()
    } else {
        collapsed(text).to_lowercase()
    }
}

#[derive(Clone, Copy)]
enum Operand {
    Number(f64),
    /// The same row's cell in the column at this position.
    Column(usize),
}

#[derive(Clone, Copy)]
enum OnText {
    Is,
    IsNot,
    Contains,
    DoesNotContain,
    StartsWith,
    EndsWith,
}

enum Check {
    IsBlank,
    IsNotBlank,
    NumberIs(Comparison, Operand),
    /// Between the ends (`true`) or outside them.
    Between(Operand, Operand, bool),
    Text(OnText, String),
    BooleanIs(bool),
    Largest(usize),
    Smallest(usize),
    AppearsMoreThanOnce,
    IsAnError,
    /// One of the keys (`true`), or none of them.
    OneOf(Vec<Key>, bool),
}

/// A test with its column's position.
struct Resolved {
    column: usize,
    check: Check,
}

/// What a column of the body holds: each row's key, and what conditions on the whole column need.
struct Column {
    keys: Vec<Key>,
    /// The records' numbers, largest first.
    numbers: Vec<f64>,
    /// How many records hold each key.
    counts: HashMap<Group, usize>,
}

struct Filtered<'a> {
    table: LiveTable<'a>,
    values: SheetValues,
    locale: &'static Locale,
    lines: Vec<Vec<Resolved>>,
    /// The rows of the body (by their index in it) that are records.
    is_record: Vec<bool>,
    columns: HashMap<usize, Column>,
    /// Where the sheet's merged ranges are: (top, bottom, left, right).
    merged: Vec<(usize, usize, usize, usize)>,
}

/// A column a test names: one the sheet has had (`unknownColumn`), of the table now
/// (`columnIsNotOfTheFilteredTable`).
fn column_of(workbook: &Workbook, table: &LiveTable, id: &str) -> Result<usize, &'static str> {
    let columns = &table.sheet.columns;
    let line = workbook.bases.parse(id).filter(|&l| columns.knows(l)).ok_or("unknownColumn")?;
    columns
        .position(line)
        .filter(|p| (table.columns.0..=table.columns.1).contains(p))
        .ok_or("columnIsNotOfTheFilteredTable")
}

fn operands(condition: &CellCondition) -> Vec<&NumberOperand> {
    match condition {
        CellCondition::NumberIs { operand, .. } => vec![operand],
        CellCondition::NumberIsBetween { one_end, other_end }
        | CellCondition::NumberIsNotBetween { one_end, other_end } => vec![one_end, other_end],
        _ => vec![],
    }
}

impl<'a> Filtered<'a> {
    fn new(
        workbook: &'a Workbook,
        table: &TableInIds,
        filter: &Filter,
        c: Option<&str>,
    ) -> Result<(Filtered<'a>, Option<usize>), &'static str> {
        let sheet = live::sheet_of(workbook, table)?;
        for test in filter.tests() {
            if let Asked::Meets { condition } = &test.asked {
                condition_within_limits(condition)?;
            }
        }
        for test in filter.tests() {
            if let Asked::Meets { condition } = &test.asked {
                if operands(condition).iter().any(|o| matches!(o, NumberOperand::DaysFromToday { .. })) {
                    return Err("dayIsNotKnownToTheFilter");
                }
            }
        }
        let values = SheetValues::of(workbook, sheet);
        let live = live::live(workbook, sheet, &values, table)?;
        let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
        let mut lines = Vec::new();
        for line in &filter.all_of {
            let mut tests = Vec::new();
            for test in &line.any_of {
                let column = column_of(workbook, &live, &test.c)?;
                let operand = |o: &NumberOperand| -> Result<Operand, &'static str> {
                    match o {
                        NumberOperand::Number { number } => Ok(Operand::Number(*number)),
                        NumberOperand::SameRowInColumn { c } => Ok(Operand::Column(column_of(workbook, &live, c)?)),
                        NumberOperand::DaysFromToday { .. } => Err("dayIsNotKnownToTheFilter"),
                    }
                };
                let check = match &test.asked {
                    Asked::Meets { condition } => match condition {
                        CellCondition::IsBlank {} => Check::IsBlank,
                        CellCondition::IsNotBlank {} => Check::IsNotBlank,
                        CellCondition::NumberIs { comparison, operand: o } => Check::NumberIs(*comparison, operand(o)?),
                        CellCondition::NumberIsBetween { one_end, other_end } => {
                            Check::Between(operand(one_end)?, operand(other_end)?, true)
                        }
                        CellCondition::NumberIsNotBetween { one_end, other_end } => {
                            Check::Between(operand(one_end)?, operand(other_end)?, false)
                        }
                        CellCondition::TextIs { text } => Check::Text(OnText::Is, condition_text(text)),
                        CellCondition::TextIsNot { text } => Check::Text(OnText::IsNot, condition_text(text)),
                        CellCondition::TextContains { text } => Check::Text(OnText::Contains, condition_text(text)),
                        CellCondition::TextDoesNotContain { text } => {
                            Check::Text(OnText::DoesNotContain, condition_text(text))
                        }
                        CellCondition::TextStartsWith { text } => Check::Text(OnText::StartsWith, condition_text(text)),
                        CellCondition::TextEndsWith { text } => Check::Text(OnText::EndsWith, condition_text(text)),
                        CellCondition::BooleanIs { value } => Check::BooleanIs(*value),
                        CellCondition::IsAmongTheLargest { count } => Check::Largest(count.get() as usize),
                        CellCondition::IsAmongTheSmallest { count } => Check::Smallest(count.get() as usize),
                        CellCondition::AppearsMoreThanOnce {} => Check::AppearsMoreThanOnce,
                        CellCondition::IsAnError {} => Check::IsAnError,
                    },
                    Asked::IsOneOf { values } | Asked::IsNoneOf { values } => {
                        let keys = values
                            .iter()
                            .map(|v| match v {
                                None => Key::Blank,
                                Some(AskedValue::Number { value }) => Key::Number(*value, None),
                                Some(AskedValue::Text { value }) => text_key(value, locale),
                                Some(AskedValue::Boolean { value }) => Key::Boolean(*value),
                                Some(AskedValue::Error { value }) => Key::Error(*value),
                            })
                            .collect();
                        Check::OneOf(keys, matches!(test.asked, Asked::IsOneOf { .. }))
                    }
                };
                tests.push(Resolved { column, check });
            }
            lines.push(tests);
        }
        let c = c.map(|c| column_of(workbook, &live, c)).transpose()?;
        let (first, last) = live.body;
        let merged = merged_boxes(&workbook.bases, sheet);
        let is_record = (first..=last)
            .map(|r| {
                !matches!(live.roles[r - first], Some(Role::Section | Role::Subtotal | Role::HeaderAgain))
                    && values.row_shows(&merged, r, live.columns)
            })
            .collect();
        let mut filtered = Filtered { table: live, values, locale, lines, is_record, columns: HashMap::new(), merged };
        let mut wanted: Vec<usize> = c.into_iter().collect();
        for test in filtered.lines.iter().flatten() {
            wanted.push(test.column);
            if let Check::NumberIs(_, Operand::Column(o)) = test.check {
                wanted.push(o);
            }
            if let Check::Between(a, b, _) = test.check {
                for o in [a, b] {
                    if let Operand::Column(o) = o {
                        wanted.push(o);
                    }
                }
            }
        }
        for column in wanted {
            if !filtered.columns.contains_key(&column) {
                let read = filtered.column(column);
                filtered.columns.insert(column, read);
            }
        }
        Ok((filtered, c))
    }

    /// The value a cell is read as: under a merged range's top left, that cell's; elsewhere in the range, blank.
    fn shown_at(&self, row: usize, column: usize) -> &Value {
        let hiding = self.merged.iter().find(|&&(t, b, l, r)| (t..=b).contains(&row) && (l..=r).contains(&column));
        match hiding {
            Some(&(t, _, l, _)) if column == l => self.values.get(t, l),
            Some(_) => &Value::Blank,
            None => self.values.get(row, column),
        }
    }

    fn column(&self, column: usize) -> Column {
        let first = self.table.body.0;
        let rows = first..=self.table.body.1;
        let keys: Vec<Key> = rows.map(|r| key_of(self.shown_at(r, column), self.locale)).collect();
        let mut numbers = Vec::new();
        let mut counts = HashMap::new();
        for (_, key) in keys.iter().enumerate().filter(|(i, _)| self.is_record[*i]) {
            if let Key::Number(n, _) = key {
                numbers.push(*n);
            }
            *counts.entry(key.group()).or_insert(0) += 1;
        }
        numbers.sort_by(|a, b| b.total_cmp(a));
        Column { keys, numbers, counts }
    }

    fn number_of(&self, operand: Operand, i: usize) -> Option<f64> {
        match operand {
            Operand::Number(n) => Some(n),
            Operand::Column(c) => match self.columns[&c].keys[i] {
                Key::Number(n, _) => Some(n),
                _ => None,
            },
        }
    }

    /// Whether the body's row `i` passes a test.
    fn passes(&self, test: &Resolved, i: usize) -> bool {
        let column = &self.columns[&test.column];
        let key = &column.keys[i];
        match &test.check {
            Check::IsBlank => *key == Key::Blank,
            Check::IsNotBlank => *key != Key::Blank,
            Check::NumberIs(comparison, operand) => {
                let (Key::Number(n, _), Some(m)) = (key, self.number_of(*operand, i)) else { return false };
                match comparison {
                    Comparison::EqualTo => *n == m,
                    Comparison::NotEqualTo => *n != m,
                    Comparison::GreaterThan => *n > m,
                    Comparison::GreaterThanOrEqualTo => *n >= m,
                    Comparison::LessThan => *n < m,
                    Comparison::LessThanOrEqualTo => *n <= m,
                }
            }
            Check::Between(a, b, inside) => {
                let (Key::Number(n, _), Some(a), Some(b)) = (key, self.number_of(*a, i), self.number_of(*b, i)) else {
                    return false;
                };
                let (low, high) = (a.min(b), a.max(b));
                (low <= *n && *n <= high) == *inside
            }
            Check::Text(on, text) => {
                let Some(k) = key.text(self.locale) else { return false };
                match on {
                    OnText::Is => k == *text,
                    OnText::IsNot => k != *text,
                    OnText::Contains => k.contains(text.as_str()),
                    OnText::DoesNotContain => !k.contains(text.as_str()),
                    OnText::StartsWith => k.starts_with(text.as_str()),
                    OnText::EndsWith => k.ends_with(text.as_str()),
                }
            }
            Check::BooleanIs(b) => *key == Key::Boolean(*b),
            Check::Largest(count) | Check::Smallest(count) => {
                let Key::Number(n, _) = key else { return false };
                let numbers = &column.numbers;
                if numbers.is_empty() {
                    return false;
                }
                let k = (*count).min(numbers.len());
                if matches!(test.check, Check::Largest(_)) {
                    *n >= numbers[k - 1]
                } else {
                    *n <= numbers[numbers.len() - k]
                }
            }
            Check::AppearsMoreThanOnce => {
                !matches!(key, Key::Blank | Key::Error(_))
                    && column.counts.get(&key.group()).is_some_and(|&count| count > 1)
            }
            Check::IsAnError => matches!(key, Key::Error(_)),
            Check::OneOf(keys, one_of) => {
                let group = key.group();
                keys.iter().any(|k| k.group() == group) == *one_of
            }
        }
    }

    fn passes_line(&self, line: &[Resolved], i: usize) -> bool {
        line.iter().any(|test| self.passes(test, i))
    }

    /// Which rows of the body are in view. A section's title is its rows next to each other (a blank row ends it,
    /// not one a merged range covers whose top left shows something); it is in view while a record under it is, up
    /// to the next section's title.
    fn in_view(&self) -> Vec<bool> {
        let (first, last) = self.table.body;
        let passes = |i: usize| self.lines.iter().all(|line| self.passes_line(line, i));
        let mut in_view: Vec<bool> = (0..=last - first).map(|i| self.is_record[i] && passes(i)).collect();
        let mut title: Vec<usize> = Vec::new();
        let mut open = false;
        for i in 0..=last - first {
            let is_section = self.table.roles[i] == Some(Role::Section);
            if is_section && self.values.row_shows(&self.merged, first + i, self.table.columns) {
                if !open {
                    title.clear();
                }
                title.push(i);
                open = true;
            } else {
                open = false;
                if in_view[i] {
                    for &s in &title {
                        in_view[s] = true;
                    }
                    title.clear();
                }
            }
        }
        in_view
    }

    fn row_id(&self, workbook: &Workbook, position: usize) -> String {
        workbook.bases.text(self.table.sheet.rows.line(position).expect("a live row"))
    }
}

/// The rows a filter leaves out of view (never one frozen at the top), the records and those in view, and the cells
/// beside the table in the rows out of view (left of it, then right of it), as a box around them.
pub(crate) fn filtered_rows(workbook: &Workbook, table: &TableInIds, filter: &Filter) -> Result<Json, &'static str> {
    let (filtered, _) = Filtered::new(workbook, table, filter, None)?;
    let (first, last) = filtered.table.body;
    let rows = &filtered.table.sheet.rows;
    let unfrozen = filtered.table.sheet.last_frozen_row.and_then(|r| rows.position(r)).map_or(0, |p| p + 1);
    let mut in_view = filtered.in_view();
    for (i, v) in in_view.iter_mut().enumerate() {
        *v = *v || first + i < unfrozen;
    }
    let out: Vec<usize> = (first..=last).filter(|r| !in_view[r - first]).collect();
    let out_lines: Vec<_> = out.iter().map(|&r| rows.line(r).expect("a live row")).collect();
    let records = filtered.is_record.iter().filter(|&&r| r).count();
    let records_in_view = (0..=last - first).filter(|&i| filtered.is_record[i] && in_view[i]).count();
    let (c0, c1) = filtered.table.columns;
    let mut boxes: [Option<(usize, usize, usize, usize)>; 2] = [None, None];
    for (r, c) in filtered.values.filled() {
        if r < first || r > last || in_view[r - first] || (c0..=c1).contains(&c) {
            continue;
        }
        let side = &mut boxes[usize::from(c > c1)];
        *side = Some(match *side {
            None => (r, c, r, c),
            Some((t, l, b, rt)) => (t.min(r), l.min(c), b.max(r), rt.max(c)),
        });
    }
    let columns = &filtered.table.sheet.columns;
    let cell = |r: usize, c: usize| {
        let (r, c) = (rows.line(r).expect("a live row"), columns.line(c).expect("a live column"));
        json!({"r": workbook.bases.text(r), "c": workbook.bases.text(c)})
    };
    let beside: Vec<Json> = boxes
        .iter()
        .flatten()
        .map(|&(t, l, b, r)| json!({"topLeft": cell(t, l), "bottomRight": cell(b, r)}))
        .collect();
    Ok(json!({
        "kind": "filteredRows",
        "firstRowOfBody": filtered.row_id(workbook, first),
        "lastRowOfBody": filtered.row_id(workbook, last),
        "rowsOutOfView": runs_of(&out_lines, &workbook.bases),
        "records": records,
        "recordsInView": records_in_view,
        "cellsBesideTheTableOutOfView": beside,
    }))
}

/// The values a column of the table holds in its records, each once: the first record that holds it, how many
/// records hold it that the filter's lines on other columns leave in view, and whether it meets the lines on its own
/// column. Numbers first, smallest first, then texts by their small letters, booleans, errors as they come, and
/// blank last.
pub(crate) fn values_of_filtered_column(
    workbook: &Workbook,
    table: &TableInIds,
    filter: &Filter,
    c: &str,
) -> Result<Json, &'static str> {
    let (filtered, c) = Filtered::new(workbook, table, filter, Some(c))?;
    let c = c.expect("a column");
    let (first, last) = filtered.table.body;
    let column = &filtered.columns[&c];
    let (on_others, on_its_own): (Vec<&Vec<Resolved>>, Vec<&Vec<Resolved>>) =
        filtered.lines.iter().partition(|line| line.iter().all(|t| t.column != c));
    // Each value: its key, the first row that holds it, how many records hold it in view of the other lines.
    let mut groups: Vec<(Key, usize, usize)> = Vec::new();
    let mut index: HashMap<Group, usize> = HashMap::new();
    for i in (0..=last - first).filter(|&i| filtered.is_record[i]) {
        let key = &column.keys[i];
        let g = *index.entry(key.group()).or_insert_with(|| {
            groups.push((key.clone(), i, 0));
            groups.len() - 1
        });
        if on_others.iter().all(|line| filtered.passes_line(line, i)) {
            groups[g].2 += 1;
        }
    }
    let rank = |key: &Key| match key {
        Key::Number(..) => 0,
        Key::Text(_) => 1,
        Key::Boolean(_) => 2,
        Key::Error(_) => 3,
        Key::Blank => 4,
    };
    let mut order: Vec<usize> = (0..groups.len()).collect();
    order.sort_by(|&a, &b| {
        let (ka, kb) = (&groups[a].0, &groups[b].0);
        rank(ka).cmp(&rank(kb)).then_with(|| match (ka, kb) {
            (Key::Number(x, _), Key::Number(y, _)) => x.total_cmp(y),
            (Key::Text(x), Key::Text(y)) => x.as_bytes().cmp(y.as_bytes()),
            (Key::Boolean(x), Key::Boolean(y)) => x.cmp(y),
            _ => a.cmp(&b),
        })
    });
    let values: Vec<Json> = order
        .iter()
        .map(|&g| {
            let (key, i, records) = &groups[g];
            let meets = on_its_own.iter().all(|line| filtered.passes_line(line, *i));
            json!({
                "value": shown(filtered.shown_at(first + i, c), key),
                "firstInRow": filtered.row_id(workbook, first + i),
                "records": records,
                "meetsTheLinesOfItsColumn": meets,
            })
        })
        .collect();
    Ok(json!({"kind": "valuesOfFilteredColumn", "values": values, "areMoreLeftOut": false}))
}
