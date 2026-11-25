//! The values a sheet shows, by position: what its cells hold, what their formulas worked out, and what arrays
//! spill into cells that hold nothing.

use hashbrown::HashMap;

use crate::calculate::SpillOutcome;
use crate::value::Value;
use crate::workbook::{Input, Sheet, Workbook};

/// Where a merged range is: its top, bottom, left and right.
type Box4 = (usize, usize, usize, usize);

pub(crate) struct SheetValues {
    values: HashMap<(usize, usize), Value>,
    blank: Value,
}

impl SheetValues {
    pub(crate) fn of(workbook: &Workbook, sheet: &Sheet) -> SheetValues {
        let mut values = HashMap::new();
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
                Input::Formula { .. } => match workbook.outcome(&sheet.id, r, c) {
                    Some(outcome) => {
                        if let Some(SpillOutcome::Fills { array, .. }) = &outcome.spill {
                            for ((i, j), value) in array.stored_entries().filter(|(position, _)| *position != (0, 0)) {
                                values.entry((row + i, column + j)).or_insert_with(|| value.clone());
                            }
                        }
                        outcome.value.clone()
                    }
                    None => Value::Blank,
                },
            };
            values.insert((row, column), value);
        }
        SheetValues { values, blank: Value::Blank }
    }

    /// The value at a position (blank when nothing is there).
    pub(crate) fn get(&self, row: usize, column: usize) -> &Value {
        self.values.get(&(row, column)).unwrap_or(&self.blank)
    }

    /// Whether a position shows something: not blank, nor a text of spaces only.
    pub(crate) fn is_filled(&self, row: usize, column: usize) -> bool {
        self.values.get(&(row, column)).is_some_and(shows_something)
    }

    /// Whether a row shows something in the columns from one to the other.
    pub(crate) fn is_filled_between(&self, row: usize, (first, last): (usize, usize)) -> bool {
        if last - first < 64 {
            (first..=last).any(|c| self.is_filled(row, c))
        } else {
            self.values.iter().any(|(&(r, c), v)| r == row && (first..=last).contains(&c) && shows_something(v))
        }
    }

    /// Whether a row shows something in the columns from one to the other: a cell of its own does, or a merged range
    /// across them (`merged`: top, bottom, left, right) whose top left shows something covers the row.
    pub(crate) fn row_shows(&self, merged: &[Box4], row: usize, columns: (usize, usize)) -> bool {
        let (first, last) = columns;
        let across = |&(t, b, l, r): &Box4| (t..=b).contains(&row) && l <= last && first <= r && self.is_filled(t, l);
        self.is_filled_between(row, columns) || merged.iter().any(across)
    }

    /// The positions that show something, in no order.
    pub(crate) fn filled(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.values.iter().filter(|(_, v)| shows_something(v)).map(|(&at, _)| at)
    }
}

/// Whether a value shows something: not blank, nor a text of spaces only.
pub(crate) fn shows_something(value: &Value) -> bool {
    match value {
        Value::Blank => false,
        Value::Text(t) => !t.chars().all(char::is_whitespace),
        _ => true,
    }
}
