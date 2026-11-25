//! A table imported (texts read from a file, row by row) into a sheet, under one of its rows as the header: what
//! `readWhatATableChanges` tells and `importTableIntoSheet` does.
//!
//! The table's body runs from under the header to the last row of the sheet holding anything, in any column. Each
//! column of the file goes into a column of the sheet (or is left out), its texts read as the column says: read
//! under a column reading (a number, the text, the text as it is when it doesn't fit), or as `TRUE` and `FALSE`
//! (spaces around them aside, capitals aside; any other text as it is). A cell a dropdown is given takes the
//! option the text is the label of (spaces around it aside, capitals aside), or a new option labelled so. A file
//! row whose texts are all blank is left out. The others:
//! - `addRows`: are added under the last row of the body (under the header with no body), or lower: under the
//!   frozen rows, or under the last row of a collapsed group holding it (as the page shows groups), the lowest;
//! - `replaceRows`: take the place of the body's rows in order, the rest of them added; rows of the body left over
//!   go, and in a row replaced the cells of the columns not imported are emptied;
//! - `mergeByKey`: take the place of the row whose cell in the key column shows the same (spaces around it and
//!   capitals aside; a number as written plainly, a formula never), else are added; their blank texts leave a
//!   cell as it is. A key twice in the file or in the body is `keyRepeats`.
//!
//! A cell changes when its input does, or when a number read under a pattern goes into a cell without a number
//! format and General shows it otherwise (the cell is then given the pattern). Rows added are formatted as the last
//! row of the body is (its top border aside, unless they go lower): a dropdown, a number format; a
//! conditional format's range of more than one row ending with it takes them in (groups and formulas don't), when
//! they go right under it. A text that isn't blank and changes a cell a merged range hides (a row added into one
//! too) is `cellCoveredByMergedRange`; the input the cell holds already (given a pattern or not) is not, nor is a
//! blank text emptying it. Keys are matched by what the cells hold, hidden or not.
//!
//! The refusals come in this order: a key twice; then, cell by cell, a new option's label longer than 100 characters
//! (`dropdownOptionTooLong`), holding a control character, or one too many for its dropdown
//! (`tooManyDropdownOptions`); then a hidden cell changed. The edit then checks the ids of its operations
//! (`idNotWellFormed`) before a text too long.
//!
//! The operations: the rows added, their formats and conditional formats, the patterns (an operation for each, in
//! the order of the patterns, a block in it for each column), the cells that grow no larger (written as the page's
//! JSON), what follows the rows that go and the rows that go (in the order of their ids), the dropdowns given new
//! options (each in an operation), the cells that take a new option, and the cells that grow. The cells of columns
//! not imported that a row replaced empties are in the order of the columns' ids as texts (`.10` before `.8`).

use std::collections::BTreeMap;
use hashbrown::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{live_column, live_row, sheet as sheet_of, Made, Refused};
use crate::column_readings::{ColumnReading, Read, SPACES};
use crate::ids::{IdRun, LineId};
use crate::locale::{self, Locale};
use crate::number_format::Room;
use crate::session::edits::lines::{follow, groups, ids_well_formed, Lines};
use crate::session::edits::objects::dropdowns::{dropdown_of, hidden_by_merges};
use crate::session::edits::objects::{is_well_formed, LONGEST_DROPDOWN_OPTION, MOST_OPTIONS_IN_A_DROPDOWN};
use crate::session::place;
use crate::shown::shown;
use crate::value::Value;
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{blocks, id_order, sorted_runs, Leaf};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{DropdownOption, DropdownToSet};
use crate::workbook::{Input, Sheet, Workbook};

/// The most bytes of text a table imported may have, all its texts together.
const MOST_BYTES_OF_A_TABLE_TO_IMPORT: usize = 48 << 20;
/// The most bytes of UTF-8 a text may have.
const LONGEST_TEXT: usize = 32767;

/// A table to import into a sheet.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableIntoSheet {
    sheet_id: String,
    header_row: String,
    rows: Vec<Vec<String>>,
    columns: Vec<Option<ColumnInto>>,
    how: How,
}

/// The column of the sheet a column of the file goes into, and how its texts are read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColumnInto {
    column: String,
    texts_are: TextsAre,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum TextsAre {
    TrueOrFalse {},
    Read { reading: ColumnReading },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum How {
    AddRows {},
    ReplaceRows {},
    #[serde(rename_all = "camelCase")]
    MergeByKey { key_column: u32 },
}

impl TableIntoSheet {
    /// A column is read under a reading of numbers, dates, times or text, not of a dropdown.
    pub fn is_readable(&self) -> bool {
        self.columns.iter().flatten().all(|c| match &c.texts_are {
            TextsAre::TrueOrFalse {} => true,
            TextsAre::Read { reading } => !matches!(reading, ColumnReading::Dropdown { .. }),
        })
    }
}

fn workbook_locale(workbook: &Workbook) -> &'static Locale {
    locale::find(&workbook.locale).unwrap_or_else(locale::en_us)
}

/// A text of the file as its column reads it.
#[derive(Clone, PartialEq)]
enum FileValue {
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
}

fn file_value(texts_are: &TextsAre, text: &str, locale: &Locale) -> FileValue {
    match texts_are {
        TextsAre::Read { reading } => match reading.read(text, locale) {
            Read::Blank => FileValue::Blank,
            Read::Number(n) => FileValue::Number(n),
            Read::Text(t) => FileValue::Text(t),
            Read::DoesNotFit => FileValue::Text(text.to_owned()),
        },
        TextsAre::TrueOrFalse {} => {
            let t = text.trim_matches(SPACES);
            if t.is_empty() {
                return FileValue::Blank;
            }
            match t.to_lowercase().as_str() {
                "true" => FileValue::Boolean(true),
                "false" => FileValue::Boolean(false),
                _ => FileValue::Text(text.to_owned()),
            }
        }
    }
}

/// What a key shows, to match keys by: a text without the spaces around it, capitals aside; a number as written
/// plainly; `true` or `false`. Nothing for a blank or a formula.
fn key_of_text(text: &str) -> Option<String> {
    let t = text.trim();
    (!t.is_empty()).then(|| t.to_lowercase())
}

fn key_of_file(value: &FileValue) -> Option<String> {
    match value {
        FileValue::Blank => None,
        FileValue::Number(n) => Some(format!("{n}")),
        FileValue::Text(t) => key_of_text(t),
        FileValue::Boolean(b) => Some(b.to_string()),
    }
}

fn key_of_input(input: &Input) -> Option<String> {
    match input {
        Input::Number { value } => Some(format!("{value}")),
        Input::Text { value } => key_of_text(value),
        Input::Boolean { value } => Some(value.to_string()),
        Input::DropdownOption { label, .. } => key_of_text(label),
        // Text with looks is keyed by its text; a person or people by nothing, as formulas are.
        Input::RichText { .. } => input.reads_as_text().as_deref().and_then(key_of_text),
        Input::Formula { .. } | Input::User { .. } | Input::Users { .. } => None,
    }
}

/// What becomes of a row of the file.
enum RowIs {
    LeftOut,
    Added,
    Changes(LineId, Vec<usize>),
    Same(LineId),
}

/// Options a dropdown is given.
struct NewOptions {
    dropdown_id: String,
    column: usize,
    options: Vec<DropdownOption>,
}

/// What importing a table changes, and the operations that do it.
pub struct Plan {
    rows: Vec<RowIs>,
    rows_that_go: Vec<LineId>,
    rows_not_in_the_table: Vec<LineId>,
    new_options: Vec<NewOptions>,
    ops: Vec<Op>,
    /// Whether a text set is longer than a cell may hold.
    too_long: bool,
}

/// A cell to set, and how large its input was and is.
struct Setting {
    r: LineId,
    c: LineId,
    input: Option<Input>,
    grows: bool,
    takes_new_option: bool,
}

fn size(input: Option<&Input>) -> usize {
    input.map_or(0, |i| serde_json::to_string(i).map_or(0, |s| s.len()))
}

impl Plan {
    /// Whether each dropdown given new options has an id well formed: the edit and its read both refuse one that
    /// hasn't (`idNotWellFormed`, after the plan's own refusals); the read checks no other id.
    fn dropdowns_well_formed(&self) -> bool {
        self.new_options.iter().all(|o| is_well_formed(&o.dropdown_id, "ddn"))
    }
}

pub fn plan(workbook: &Workbook, table: &TableIntoSheet, code: &str) -> Result<Plan, Refused> {
    let bytes: usize = table.rows.iter().flatten().map(String::len).sum();
    if bytes > MOST_BYTES_OF_A_TABLE_TO_IMPORT {
        return Err(Refused::Because("tableTooLarge"));
    }
    let sheet = sheet_of(workbook, &table.sheet_id)?;
    let (header, h) = live_row(workbook, sheet, &table.header_row)?;
    let mut targets: Vec<Option<(LineId, &TextsAre)>> = Vec::with_capacity(table.columns.len());
    let mut taken = HashSet::new();
    for column in &table.columns {
        let Some(ColumnInto { column, texts_are }) = column else {
            targets.push(None);
            continue;
        };
        let (line, _) = live_column(workbook, sheet, column)?;
        if !taken.insert(line) {
            return Err(Refused::Because("twoColumnsIntoOne"));
        }
        targets.push(Some((line, texts_are)));
    }
    let key_column = match table.how {
        How::MergeByKey { key_column } => {
            let k = key_column as usize;
            if targets.get(k).is_none_or(Option::is_none) {
                return Err(Refused::Because("keyColumnLeftOut"));
            }
            Some(k)
        }
        _ => None,
    };
    let locale = workbook_locale(workbook);

    // The body: from under the header to the last row holding anything.
    let mut by_row: HashMap<LineId, Vec<(usize, LineId)>> = HashMap::new();
    let mut last = None;
    for &(r, c) in sheet.cells.keys() {
        let (Some(p), Some(q)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
        last = last.max(Some(p));
        by_row.entry(r).or_default().push((q, c));
    }
    let body: Vec<LineId> = match last {
        Some(last) if last > h => (h + 1..=last).filter_map(|p| sheet.rows.line(p)).collect(),
        _ => Vec::new(),
    };

    // The file's values, and the rows left out.
    let text = |i: usize, j: usize| table.rows[i].get(j).map_or("", String::as_str);
    let values: Vec<Vec<FileValue>> = (0..table.rows.len())
        .map(|i| {
            targets
                .iter()
                .enumerate()
                .map(|(j, t)| t.map_or(FileValue::Blank, |(_, texts_are)| file_value(texts_are, text(i, j), locale)))
                .collect()
        })
        .collect();
    let left_out: Vec<bool> = values.iter().map(|row| row.iter().all(|v| *v == FileValue::Blank)).collect();

    // Which row of the body each row of the file takes the place of.
    let mut matched: Vec<Option<LineId>> = vec![None; table.rows.len()];
    let mut rows_that_go = Vec::new();
    let mut rows_not_in_the_table = Vec::new();
    match &table.how {
        How::AddRows {} => {}
        How::ReplaceRows {} => {
            let mut next = 0;
            for (i, m) in matched.iter_mut().enumerate() {
                if left_out[i] {
                    continue;
                }
                *m = body.get(next).copied();
                next += 1;
            }
            rows_that_go = body.iter().skip(next).copied().collect();
        }
        How::MergeByKey { .. } => {
            let k = key_column.expect("a key column");
            let key_line = targets[k].expect("a key column imported").0;
            let mut in_body: HashMap<String, LineId> = HashMap::new();
            let mut body_keys = Vec::new();
            for &r in &body {
                let key = sheet.cells.get(&(r, key_line)).and_then(|cell| key_of_input(&cell.input));
                if let Some(key) = key {
                    if in_body.insert(key.clone(), r).is_some() {
                        return Err(Refused::Because("keyRepeats"));
                    }
                    body_keys.push((r, key));
                }
            }
            let mut in_file = HashSet::new();
            for (i, m) in matched.iter_mut().enumerate() {
                if left_out[i] {
                    continue;
                }
                if let Some(key) = key_of_file(&values[i][k]) {
                    if !in_file.insert(key.clone()) {
                        return Err(Refused::Because("keyRepeats"));
                    }
                    *m = in_body.get(&key).copied();
                }
            }
            rows_not_in_the_table =
                body_keys.into_iter().filter(|(_, key)| !in_file.contains(key)).map(|(r, _)| r).collect();
        }
    }

    // The rows added, formatted as the last row of the body. They go under the body, or under the frozen rows or a
    // collapsed group holding its end when those end lower: the formats still come from the last row of the body,
    // its borders all.
    let added = (0..table.rows.len()).filter(|&i| !left_out[i] && matched[i].is_none()).count();
    let mut ops = Vec::new();
    let mut after = workbook.clone();
    let new_base = format!("row_{code}");
    if added > 0 {
        let end = body.last().copied().unwrap_or(header);
        let at = sheet.rows.position(end).expect("a row not deleted");
        let collapsed = groups::shown(&workbook.bases, sheet, Lines::Rows)
            .into_iter()
            .filter(|g| g.is_collapsed && (g.first..=g.last).contains(&at))
            .map(|g| g.last);
        let frozen = sheet.last_frozen_row.and_then(|f| sheet.rows.position(f));
        let from = sheet.rows.line(collapsed.chain(frozen).fold(at, usize::max)).expect("a row not deleted");
        let new = IdRun { base: new_base.clone(), first: 0, count: added as u32 };
        let under = Some(workbook.bases.text(from));
        ops.push(Op::InsertRows { sheet_id: sheet.id.clone(), after: under, rows: new.clone() });
        if let Some(&last) = body.last() {
            ops.extend(follow::formats_of_new(workbook, sheet, Lines::Rows, last, Some(from), &new));
            ops.extend(follow::conditional_formats_of_new(workbook, sheet, Lines::Rows, last, Some(from), &new));
        }
        after.apply(&ops).map_err(Refused::from)?;
    }
    let s = after.sheet_index(&sheet.id).expect("the sheet imported into");
    let target_sheet: &Sheet = &after.sheets[s];
    let new_row = |n: usize| -> LineId { after.bases.parse(&format!("{new_base}.{n}")).expect("a row just added") };
    let hidden = hidden_by_merges(&after, target_sheet);
    let is_hidden = |(r, c): (LineId, LineId)| match (target_sheet.rows.position(r), target_sheet.columns.position(c)) {
        (Some(r), Some(c)) => hidden((r, c)),
        _ => false,
    };

    // Each cell set.
    let mut new_options: Vec<NewOptions> = Vec::new();
    let mut option_count = 0;
    let mut settings: Vec<Setting> = Vec::new();
    let mut patterns: Vec<((LineId, LineId), String)> = Vec::new();
    let mut rows = Vec::with_capacity(table.rows.len());
    let mut too_long = false;
    let mut covered = false;
    let mut n_added = 0;
    for i in 0..table.rows.len() {
        if left_out[i] {
            rows.push(RowIs::LeftOut);
            continue;
        }
        let (r, is_new) = match matched[i] {
            Some(r) => (r, false),
            None => {
                n_added += 1;
                (new_row(n_added - 1), true)
            }
        };
        let mut changed = Vec::new();
        let mut any = false;
        for (j, target) in targets.iter().enumerate() {
            let Some((c, texts_are)) = target else { continue };
            let (c, t) = (*c, text(i, j));
            let at = (r, c);
            let old = sheet.cells.get(&at).map(|cell| &cell.input);
            let dropdown = dropdown_of(target_sheet, at).and_then(|id| target_sheet.dropdowns.get(id));
            // A dropdown can contain ordinary text imported from a file. Reimporting the
            // same text leaves that cell alone, even if it is not a valid option label.
            if dropdown.is_some() && matches!(old, Some(Input::Text { value }) if value == t) {
                continue;
            }
            let new = match dropdown {
                Some((dropdown_id, options)) => {
                    let trimmed = t.trim_matches(SPACES);
                    if trimmed.is_empty() {
                        None
                    } else {
                        let (lower, raw) = (trimmed.to_lowercase(), t.to_lowercase());
                        let added = new_options.iter().find(|o| o.dropdown_id == *dropdown_id);
                        let all = options.iter().chain(added.into_iter().flat_map(|o| o.options.iter()));
                        let found = all
                            .clone()
                            .find(|o| o.label.to_lowercase() == lower)
                            .or_else(|| all.clone().find(|o| o.label.to_lowercase() == raw));
                        // A text no option could be made of is left in a cell holding it already (case aside).
                        let unfit = found.is_none()
                            && (trimmed.chars().count() > LONGEST_DROPDOWN_OPTION || trimmed.chars().any(char::is_control));
                        let holds = matches!(old, Some(Input::Text { value })
                            if value.to_lowercase() == lower || value.to_lowercase() == raw);
                        if unfit && holds {
                            old.cloned()
                        } else {
                            let option = match found {
                                Some(o) => o.clone(),
                                None => {
                                    // A new option's label is checked as it is made, and then how many the dropdown
                                    // holds.
                                    if trimmed.chars().count() > LONGEST_DROPDOWN_OPTION {
                                        return Err(Refused::Because("dropdownOptionTooLong"));
                                    }
                                    if trimmed.chars().any(char::is_control) {
                                        return Err(Refused::Because("dropdownOptionHoldsControlCharacter"));
                                    }
                                    if options.len() + added.map_or(0, |o| o.options.len()) >= MOST_OPTIONS_IN_A_DROPDOWN {
                                        return Err(Refused::Because("tooManyDropdownOptions"));
                                    }
                                    let o = DropdownOption {
                                        option_id: format!("opt_{code}.{option_count}"),
                                        label: trimmed.to_owned(),
                                        color: json!({"kind": "none"}),
                                    };
                                    option_count += 1;
                                    match new_options.iter_mut().find(|x| x.dropdown_id == *dropdown_id) {
                                        Some(x) => x.options.push(o.clone()),
                                        None => new_options.push(NewOptions {
                                            dropdown_id: dropdown_id.clone(),
                                            column: j,
                                            options: vec![o.clone()],
                                        }),
                                    }
                                    o
                                }
                            };
                            Some(Input::DropdownOption { option_id: option.option_id, label: option.label })
                        }
                    }
                }
                None => match &values[i][j] {
                    FileValue::Blank => None,
                    FileValue::Number(n) => Some(Input::Number { value: *n }),
                    FileValue::Text(t) => Some(Input::Text { value: t.clone() }),
                    FileValue::Boolean(b) => Some(Input::Boolean { value: *b }),
                },
            };
            // Merged, a blank text leaves the cell as it is.
            if new.is_none() && key_column.is_some() && !is_new {
                continue;
            }
            let value_changed = old != new.as_ref();
            // A text that changes a cell a merged range hides (rows added into one too) is refused, once the new
            // options are made; one it holds already, given a pattern or not, and a blank one emptying it are not.
            covered |= value_changed && !matches!(values[i][j], FileValue::Blank) && is_hidden(at);
            let mut pattern = None;
            if let (Some(Input::Number { value }), None, TextsAre::Read { reading }) = (&new, dropdown, texts_are) {
                if let Some(p) = reading.pattern(locale) {
                    if target_sheet.formats.get(Leaf::NumberFormat, at).is_none() {
                        let value = Value::Number(*value);
                        let general = shown(&value, None, Room::AsText, locale).ok();
                        let given = shown(&value, Some(&p), Room::AsText, locale).ok();
                        if value_changed || general != given {
                            pattern = Some(p);
                        }
                    }
                }
            }
            if !value_changed && pattern.is_none() {
                continue;
            }
            changed.push(j);
            if let Some(p) = pattern {
                patterns.push((at, p));
            }
            if value_changed {
                if let Some(Input::Text { value }) = &new {
                    too_long |= value.len() > LONGEST_TEXT;
                }
                let takes_new_option = matches!(&new, Some(Input::DropdownOption { option_id, .. })
                    if !sheet.dropdowns.values().any(|(_, os)| os.iter().any(|o| o.option_id == *option_id)));
                let grows = size(new.as_ref()) > size(old);
                settings.push(Setting { r, c, input: new, grows, takes_new_option });
                any = true;
            }
        }
        // Replaced, the cells of the columns not imported are emptied, in the order of the columns' ids as texts.
        if matches!(table.how, How::ReplaceRows {}) && !is_new {
            let mut others: Vec<(String, LineId)> = by_row
                .get(&r)
                .into_iter()
                .flatten()
                .filter(|(_, c)| !taken.contains(c))
                .map(|&(_, c)| (workbook.bases.text(c), c))
                .collect();
            others.sort();
            for (_, c) in others {
                settings.push(Setting { r, c, input: None, grows: false, takes_new_option: false });
                any = true;
            }
        }
        rows.push(if is_new {
            RowIs::Added
        } else if any || !changed.is_empty() {
            RowIs::Changes(r, changed)
        } else {
            RowIs::Same(r)
        });
    }

    if covered {
        return Err(Refused::Because("cellCoveredByMergedRange"));
    }

    // The operations.
    // One operation a pattern, in the order of the patterns' texts; in it a block for each column, in the order of
    // their ids.
    let mut by_pattern: BTreeMap<&str, Vec<(LineId, LineId)>> = BTreeMap::new();
    for (at, p) in &patterns {
        by_pattern.entry(p.as_str()).or_default().push(*at);
    }
    for (p, cells) in by_pattern {
        let value = json!({"pattern": p});
        let mut columns: Vec<LineId> = cells.iter().map(|&(_, c)| c).collect();
        columns.sort_by(|a, b| id_order(&after.bases, *a, *b));
        columns.dedup();
        let formats = columns
            .into_iter()
            .flat_map(|c| {
                let cells = cells.iter().filter(move |at| at.1 == c).map(|&at| (Leaf::NumberFormat, at, &value));
                blocks(&after.bases, cells)
            })
            .map(|(rows, columns, format)| CellsToFormat { rows, columns, format })
            .collect();
        ops.push(Op::SetCellFormats { sheet_id: sheet.id.clone(), formats });
    }
    let cells_of = |settings: &[&Setting]| -> Vec<CellToSet> {
        settings
            .iter()
            .map(|x| CellToSet { r: after.bases.text(x.r), c: after.bases.text(x.c), input: x.input.clone() })
            .collect()
    };
    let shrink: Vec<&Setting> = settings.iter().filter(|x| !x.grows && !x.takes_new_option).collect();
    let taking: Vec<&Setting> = settings.iter().filter(|x| !x.grows && x.takes_new_option).collect();
    let grow: Vec<&Setting> = settings.iter().filter(|x| x.grows).collect();
    if !shrink.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells: cells_of(&shrink), form: CellForm::Auto });
    }
    // The rows that go, and first what they take with them (as deleting them does).
    if !rows_that_go.is_empty() {
        let going: HashSet<LineId> = rows_that_go.iter().copied().collect();
        ops.extend(follow::of_delete(workbook, sheet, Lines::Rows, &going));
        let mut going = rows_that_go.clone();
        ops.push(Op::DeleteRows { sheet_id: sheet.id.clone(), rows: crate::ids::listed_runs::RowRuns::written(sorted_runs(&workbook.bases, &mut going)) });
    }
    for new in &new_options {
        let (_, old) = sheet.dropdowns.get(new.dropdown_id.as_str()).expect("a dropdown of the sheet");
        let options = old.iter().chain(&new.options).cloned().collect();
        let dropdowns = vec![DropdownToSet { dropdown_id: new.dropdown_id.clone(), options: Some(options) }];
        ops.push(Op::SetDropdowns { sheet_id: sheet.id.clone(), dropdowns });
    }
    if !taking.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells: cells_of(&taking), form: CellForm::Auto });
    }
    if !grow.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells: cells_of(&grow), form: CellForm::Auto });
    }
    Ok(Plan { rows, rows_that_go, rows_not_in_the_table, new_options, ops, too_long })
}

/// `readWhatATableChanges`'s answer.
pub fn what_it_changes(workbook: &Workbook, table: &TableIntoSheet, code: &str) -> Result<Json, Refused> {
    let plan = plan(workbook, table, code)?;
    if !plan.dropdowns_well_formed() {
        return Err(Refused::Because("idNotWellFormed"));
    }
    let id = |l: &LineId| workbook.bases.text(*l);
    let rows: Vec<Json> = plan
        .rows
        .iter()
        .map(|row| match row {
            RowIs::LeftOut => json!({"kind": "leftOut"}),
            RowIs::Added => json!({"kind": "added"}),
            RowIs::Changes(r, columns) => json!({"kind": "changes", "row": id(r), "columns": columns}),
            RowIs::Same(r) => json!({"kind": "same", "row": id(r)}),
        })
        .collect();
    let options: Vec<Json> = plan
        .new_options
        .iter()
        .map(|o| {
            let labels: Vec<&str> = o.options.iter().map(|x| x.label.as_str()).collect();
            json!({"dropdownId": o.dropdown_id, "column": o.column, "labels": labels})
        })
        .collect();
    Ok(json!({
        "kind": "whatATableChanges",
        "rows": rows,
        "rowsThatGo": plan.rows_that_go.iter().map(id).collect::<Vec<_>>(),
        "rowsNotInTheTable": plan.rows_not_in_the_table.iter().map(id).collect::<Vec<_>>(),
        "optionsAdded": options,
    }))
}

/// `importTableIntoSheet`'s operations.
pub fn into_sheet(workbook: &Workbook, table: &TableIntoSheet, code: &str) -> Result<Made, Refused> {
    let plan = plan(workbook, table, code)?;
    if !ids_well_formed(&plan.ops) || !plan.dropdowns_well_formed() {
        return Err(Refused::Because("idNotWellFormed"));
    }
    if plan.too_long {
        return Err(Refused::Because("textTooLong"));
    }
    // The place is where the rows and cells change: not where a dropdown is given new options, nor where what
    // follows the rows added or gone (conditional formats, groups, the frozen row, cell tables) is.
    let is_aside = |op: &Op| {
        !matches!(op, Op::InsertRows { .. } | Op::SetCellFormats { .. } | Op::SetCells { .. } | Op::DeleteRows { .. })
    };
    if !plan.ops.iter().any(is_aside) {
        return Ok(Made::ops(plan.ops));
    }
    let mut after = workbook.clone();
    after.apply(&plan.ops).map_err(Refused::from)?;
    let rest: Vec<Op> = plan.ops.iter().filter(|op| !is_aside(op)).cloned().collect();
    let place = place::of_ops(workbook, &after, &rest);
    Ok(Made { ops: plan.ops, place: Some(place) })
}
