//! Views: the workbook's views, and the values the inputs of a view's widgets read.
//!
//! An input reads a range of a sheet as rows of values, each with the text its cell shows. Its range is where its
//! corners are now (a deleted end gives way toward the other), and it reads only as far as its last row and column
//! that hold something; a range with nothing left, on a sheet not there, reads no rows. A date or a time is read as
//! ISO text (`2024-01-02`, `13:45:00`, `2024-01-02T13:45:00`) when the cell's format shows it as one.
//!
//! An input reads at most 2000 rows (`tooManyRowsInAnInput`), and its rows, written as JSON, at most 256 KiB
//! (`inputTooLarge`); the first input of the view that reads more is refused. Charts in the file read their inputs
//! the same way (`xlsx/charts.rs`).

use hashbrown::{HashMap, HashSet};

use serde_json::{json, Value as Json};

use super::Answer;
use crate::calculate::SpillOutcome;
use crate::dates::date_from_serial;
use crate::number_format::{Kind, NumberFormat, Room};
use crate::session::interactive::{reset_changes, with_current_defaults};
use crate::shown::{shown, ShownValue};
use crate::value::Value;
use crate::workbook::formats::Leaf;
use crate::workbook::layout::RangeIds;
use crate::workbook::objects::RangeOnASheet;
use crate::workbook::{Input, Sheet, Workbook};

/// The most rows an input reads.
const ROWS: usize = 2000;
/// The most bytes an input's rows take written as JSON.
const BYTES: usize = 262_144;

/// The workbook's views, as `readWorkbook` gives them: a view placed only on deleted sheets is left out.
pub fn views(workbook: &Workbook) -> Json {
    let is_there = is_there(workbook);
    let views: Vec<Json> = workbook
        .views
        .values()
        .filter(|(id, _)| is_there(id))
        .map(|(id, view)| json!({"viewId": id, "view": view}))
        .collect();
    json!({"kind": "views", "views": views})
}

/// Whether a view is there to read: not placed only on deleted sheets.
fn is_there(workbook: &Workbook) -> impl Fn(&str) -> bool {
    let placed = |sheets: &[Sheet]| -> HashSet<String> {
        sheets.iter().flat_map(Sheet::shown_views).map(str::to_owned).collect()
    };
    let (live, deleted) = (placed(&workbook.sheets), placed(&workbook.deleted_sheets));
    move |id| live.contains(id) || !deleted.contains(id)
}

/// The values each input of a view's widgets reads; a view placed only on deleted sheets is not known.
pub fn inputs_of_view(workbook: &Workbook, view_id: &str) -> Answer {
    let (_, view) = workbook.views.get(view_id).filter(|(id, _)| is_there(workbook)(id)).ok_or("unknownView")?;
    let mut elements: Vec<Json> = Vec::new();
    for element in &view.elements {
        let (element_id, _, inputs) = element.parts();
        let mut read = Vec::new();
        for input in inputs {
            let (_, rows) = read_input(workbook, &input.range).map_err(TooMuch::refusal)?;
            read.push(json!({"name": input.name, "rows": rows}));
        }
        elements.push(json!({"elementId": element_id, "inputs": read}));
    }
    let mut answer = json!({"kind": "inputsOfView", "viewId": view_id, "elements": elements});
    if view.is_interactive() {
        if !reset_changes(workbook, view).is_empty() {
            answer["canBeReset"] = json!(true);
        }
        if !with_current_defaults(workbook, view).is_ok_and(|current| current == *view) {
            answer["hasDefaultsToSave"] = json!(true);
        }
    }
    Ok(answer)
}

/// Why an input is not read: it reads too many rows, or too much.
#[derive(Clone, Copy, Debug)]
pub enum TooMuch {
    Rows,
    Bytes,
}

impl TooMuch {
    fn refusal(self) -> &'static str {
        match self {
            TooMuch::Rows => "tooManyRowsInAnInput",
            TooMuch::Bytes => "inputTooLarge",
        }
    }
}

/// A cell as an input reads it: its value, the text it shows, and its number format's pattern.
pub struct ReadCell {
    pub value: Json,
    pub text: String,
    pub pattern: Option<String>,
}

/// What an input reads: its sheet and the row and column its rows start at, when it reads any, and its rows.
pub struct Read {
    pub at: Option<(usize, usize, usize)>,
    pub rows: Vec<Vec<ReadCell>>,
}

/// What an input reads, and its rows as JSON; refused past the most rows or bytes.
pub fn read_input(workbook: &Workbook, range: &RangeOnASheet) -> Result<(Read, Json), TooMuch> {
    let read = rows_read(workbook, range);
    if read.rows.len() > ROWS {
        return Err(TooMuch::Rows);
    }
    let rows: Json = read
        .rows
        .iter()
        .map(|row| row.iter().map(|cell| json!({"value": cell.value, "text": cell.text})).collect::<Json>())
        .collect();
    if rows.to_string().len() > BYTES {
        return Err(TooMuch::Bytes);
    }
    Ok((read, rows))
}

/// What a cell holds as an input reads it: a value, from its input, its formula or a formula spilling into it.
enum Held {
    Nothing,
    Value(Value),
    /// A formula not worked out yet: it fills its cell, read as nothing.
    Waiting,
}

/// The rows of values a range reads.
fn rows_read(workbook: &Workbook, range: &RangeOnASheet) -> Read {
    let nothing = || Read { at: None, rows: Vec::new() };
    let Some(index) = workbook.sheet_index(&range.sheet_id) else { return nothing() };
    let sheet = &workbook.sheets[index];
    let corners = RangeIds { top_left: range.top_left.clone(), bottom_right: range.bottom_right.clone() };
    let Some((top, bottom, left, right)) = sheet.live_box(&workbook.bases, &corners) else { return nothing() };
    let inside = |(r, c): (usize, usize)| (top..=bottom).contains(&r) && (left..=right).contains(&c);
    let spilled = spilled_values(workbook, sheet, &inside);
    let mut held: HashMap<(usize, usize), Held> = HashMap::new();
    // The number format a formula's number brings, by its cell.
    let mut brought: HashMap<(usize, usize), String> = HashMap::new();
    for ((r, c), cell) in &sheet.cells {
        let Some(at) = sheet.rows.position(*r).zip(sheet.columns.position(*c)).filter(|at| inside(*at)) else {
            continue;
        };
        let value = match &cell.input {
            Input::Text { value } if value.is_empty() => Held::Nothing,
            Input::Text { value } => Held::Value(Value::Text(value.as_str().into())),
            Input::Number { value } => Held::Value(Value::Number(*value)),
            Input::Boolean { value } => Held::Value(Value::Boolean(*value)),
            Input::DropdownOption { option_id, label } => {
                Held::Value(Value::Text(sheet.dropdown_option(option_id).map_or(label, |o| &o.label).as_str().into()))
            }
            Input::Formula { .. } => {
                let outcome = workbook.outcome(&sheet.id, *r, *c);
                let number = outcome.filter(|o| matches!(o.value, Value::Number(_)));
                if let Some(pattern) = number.and_then(|o| o.brought.as_ref()) {
                    brought.insert(at, pattern.pattern.to_string());
                }
                outcome.map_or(Held::Waiting, |o| Held::Value(o.value.clone()))
            }
            Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                Held::Value(Value::Text(cell.input.reads_as_text().unwrap_or_default().into()))
            }
        };
        held.insert(at, value);
    }
    for (at, value, pattern) in spilled {
        if held.contains_key(&at) {
            continue;
        }
        if let Some(pattern) = pattern.filter(|_| matches!(value, Value::Number(_))) {
            brought.insert(at, pattern);
        }
        // A blank an array spills is nothing (a formula's own blank reads as 0).
        held.insert(at, if matches!(value, Value::Blank) { Held::Nothing } else { Held::Value(value) });
    }
    let filled = held.iter().filter(|(_, h)| matches!(h, Held::Value(_) | Held::Waiting)).map(|(at, _)| *at);
    let Some((last_row, last_column)) = filled.fold(None, |far: Option<(usize, usize)>, (r, c)| {
        Some(far.map_or((r, c), |(fr, fc)| (fr.max(r), fc.max(c))))
    }) else {
        return nothing();
    };
    let locale = crate::locale::find(&workbook.locale).unwrap_or_else(crate::locale::en_us);
    let rows = (top..=last_row)
        .map(|r| {
            (left..=last_column)
                .map(|c| match held.get(&(r, c)) {
                    Some(Held::Value(value)) => {
                        let at =
                            (sheet.rows.line(r).expect("a live row"), sheet.columns.line(c).expect("a live column"));
                        let format = sheet.formats.get(Leaf::NumberFormat, at);
                        let own = format.map(|f| f.get("pattern").and_then(Json::as_str));
                        // A number format of its own, else the one its formula brings.
                        let pattern = own.unwrap_or_else(|| brought.get(&(r, c)).map(String::as_str));
                        read_value(value, pattern, locale)
                    }
                    _ => ReadCell { value: Json::Null, text: String::new(), pattern: None },
                })
                .collect()
        })
        .collect();
    Read { at: Some((index, top, left)), rows }
}

/// The values of a sheet's spilled arrays in the cells they spill into (their formulas' own cells left out) that
/// are inside the range, each with the number format it brings.
fn spilled_values(
    workbook: &Workbook,
    sheet: &Sheet,
    inside: &dyn Fn((usize, usize)) -> bool,
) -> Vec<((usize, usize), Value, Option<String>)> {
    let mut out = Vec::new();
    for ((sheet_id, r, c), outcome) in &workbook.outcomes {
        let Some(SpillOutcome::Fills { array, formats, .. }) = &outcome.spill else { continue };
        if *sheet_id != sheet.id {
            continue;
        }
        let Some((top, left)) = sheet.rows.position(*r).zip(sheet.columns.position(*c)) else { continue };
        for ((i, j), value) in array.stored_entries() {
            if (i, j) != (0, 0) && inside((top + i, left + j)) {
                let brought = formats.as_ref().and_then(|f| f.get(array.columns(), (i, j)));
                out.push(((top + i, left + j), value.clone(), brought.map(|b| b.pattern.to_string())));
            }
        }
    }
    out
}

/// A value as an input reads it, with the text its cell shows: an error has no value; a number its cell's format
/// shows as a date or a time is ISO text.
fn read_value(value: &Value, pattern: Option<&str>, locale: &crate::locale::Locale) -> ReadCell {
    let value = match value {
        Value::Blank => &Value::Number(0.0),
        v => v,
    };
    let text = match shown(value, pattern, Room::AsText, locale) {
        Ok(ShownValue::Text { text, .. }) => text,
        _ => match shown(value, None, Room::AsText, locale) {
            Ok(ShownValue::Text { text, .. }) => text,
            _ => String::new(),
        },
    };
    let read = match value {
        Value::Number(n) => number_read(*n, pattern),
        Value::Text(t) => json!(t.as_ref()),
        Value::Boolean(b) => json!(b),
        Value::Error(_) | Value::Blank => Json::Null,
    };
    ReadCell { value: read, text, pattern: pattern.map(str::to_owned) }
}

/// A number as an input reads it: as a date (`2024-01-02`) when its format shows a whole day as one, a time of day
/// (`13:45:00`) when it shows a time on the first day, else as a date and time (`2024-01-02T13:45:00`); seconds as
/// the format rounds them, without their fraction. Any other number is itself.
fn number_read(n: f64, pattern: Option<&str>) -> Json {
    let Some(format) = pattern.and_then(|p| NumberFormat::parse(p).ok()) else { return json!(n) };
    let Some((day, second)) = format.day_and_second(n) else { return json!(n) };
    let (year, month, date) = date_from_serial(day);
    let day_text = format!("{year:04}-{month:02}-{date:02}");
    let time_text = format!("{:02}:{:02}:{:02}", second / 3600, second / 60 % 60, second % 60);
    match format.kind() {
        Kind::Date if second == 0 => json!(day_text),
        Kind::Time if day == 0 => json!(time_text),
        Kind::Date | Kind::Time | Kind::DateAndTime => json!(format!("{day_text}T{time_text}")),
        _ => json!(n),
    }
}
