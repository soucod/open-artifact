//! Dropdowns: making one for a block of cells, adding an option to a cell's, setting a dropdown's options.
//!
//! A dropdown is a sheet's list of options. Cells are given one by their format (`cellControl`), and hold one of its
//! options as their input (`dropdownOption`, with the label it had then). Giving cells a dropdown makes a new one,
//! whose labels the values already there are matched with (as the cells show them, capitals aside); what matches
//! none is cleared. A dropdown no cell is given any more is taken away, and the cells that held its options keep
//! their labels as text.

use hashbrown::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{around, cell_ids, live_cell, live_column, sheet_of, Made, Refused};
use super::{LONGEST_DROPDOWN_OPTION, MOST_OPTIONS_IN_A_DROPDOWN};
use crate::ids::{Bases, IdRun, LineId};
use crate::number_format::Room;
use crate::shown::{shown, ShownValue};
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{sorted_runs, Leaf};
use crate::workbook::layout::{merged_boxes, written, CellIds};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{Color, DropdownOption, DropdownToSet};
use crate::workbook::{Cell, Input, Sheet, Workbook};

/// Cells of a sheet in some rows, from one column to another.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellsInRows {
    pub sheet_id: String,
    pub rows: Vec<IdRun>,
    pub one_column: String,
    pub other_column: String,
}

/// An option of a dropdown to make.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OptionToMake {
    pub label: String,
    pub color: Color,
}

/// An option as the dropdown editor gives it: one the dropdown has (by its id), or a new one (`null`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionInAnEditor {
    #[serde(deserialize_with = "written::maybe_null")]
    pub option_id: Option<String>,
    pub label: String,
    pub color: Color,
}

/// The cells a dropdown's new options are for: all that are given it, or those in some rows (which are given a new
/// dropdown with them).
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AppliesTo {
    EveryCell {},
    #[serde(rename_all = "camelCase")]
    CellsInRows { rows: Vec<IdRun>, one_column: String, other_column: String },
}

impl AppliesTo {
    pub fn is_readable(&self) -> bool {
        match self {
            AppliesTo::EveryCell {} => true,
            AppliesTo::CellsInRows { rows, .. } => super::runs_are_readable(rows),
        }
    }
}

/// Labels as an edit gives them: none empty, no two the same but for capitals, then within the limits.
pub(crate) fn check_labels(labels: &[&str]) -> Result<(), Refused> {
    if labels.iter().any(|l| l.is_empty()) {
        return Err(Refused::Because("dropdownOptionLabelEmpty"));
    }
    check_capitals(labels)?;
    check_limits(labels)
}

/// No two labels the same but for capitals.
fn check_capitals(labels: &[&str]) -> Result<(), Refused> {
    let mut seen = HashSet::new();
    if !labels.iter().all(|l| seen.insert(l.to_lowercase())) {
        return Err(Refused::Because("dropdownOptionsDifferInCapitalsAlone"));
    }
    Ok(())
}

/// A dropdown's labels against the limits: not too many, none too long or holding a control character.
pub(super) fn check_limits(labels: &[&str]) -> Result<(), Refused> {
    if labels.len() > MOST_OPTIONS_IN_A_DROPDOWN {
        return Err(Refused::Because("tooManyDropdownOptions"));
    }
    for label in labels {
        if label.chars().count() > LONGEST_DROPDOWN_OPTION {
            return Err(Refused::Because("dropdownOptionTooLong"));
        }
        if label.chars().any(char::is_control) {
            return Err(Refused::Because("dropdownOptionHoldsControlCharacter"));
        }
    }
    Ok(())
}

/// The dropdown a cell is given, by its id.
pub(crate) fn dropdown_of(sheet: &Sheet, at: (LineId, LineId)) -> Option<&str> {
    let control = sheet.formats.get(Leaf::CellControl, at)?;
    (control.get("kind")?.as_str()? == "dropdown").then(|| control.get("dropdownId")?.as_str()).flatten()
}

/// The positions of a block of cells: the rows of the runs not deleted, in order, and the columns from one to the
/// other (each of them not deleted).
pub(crate) fn block(
    workbook: &Workbook,
    sheet: &Sheet,
    rows: &[IdRun],
    one_column: &str,
    other_column: &str,
) -> Result<(Vec<usize>, Vec<usize>), Refused> {
    let one = live_column(workbook, sheet, one_column)?;
    let other = live_column(workbook, sheet, other_column)?;
    let runs: Vec<(u32, &IdRun)> = rows.iter().filter_map(|r| Some((workbook.bases.find(&r.base)?, r))).collect();
    let in_runs = |l: LineId| runs.iter().any(|&(base, r)| base == l.base && l.n >= r.first && l.n - r.first < r.count);
    let rows: Vec<usize> = (0..sheet.rows.len()).filter(|&p| sheet.rows.line(p).is_some_and(in_runs)).collect();
    if rows.is_empty() {
        return Err(Refused::Because("unknownRow"));
    }
    Ok((rows, (one.min(other)..=one.max(other)).collect()))
}

/// Whether a position is hidden by a merged range: in one, and not its top left. Giving cells a dropdown leaves
/// what these hold as it is.
pub(crate) fn hidden_by_merges(workbook: &Workbook, sheet: &Sheet) -> impl Fn((usize, usize)) -> bool {
    let boxes = merged_boxes(&workbook.bases, sheet);
    move |(row, column)| {
        boxes.iter().any(|&(t, b, l, r)| (t..=b).contains(&row) && (l..=r).contains(&column) && (row, column) != (t, l))
    }
}

/// The line ids of a position.
pub(crate) fn lines(sheet: &Sheet, (row, column): (usize, usize)) -> (LineId, LineId) {
    (sheet.rows.line(row).expect("a live position"), sheet.columns.line(column).expect("a live position"))
}

/// The sheet's cells not deleted that hold one of these options, by row and then column.
fn holding<'a>(sheet: &'a Sheet, options: &HashSet<&str>) -> Vec<((usize, usize), &'a Cell)> {
    let mut found: Vec<((usize, usize), &Cell)> = sheet
        .cells
        .iter()
        .filter(|(_, cell)| {
            matches!(&cell.input, Input::DropdownOption { option_id, .. } if options.contains(option_id.as_str()))
        })
        .filter_map(|((r, c), cell)| Some(((sheet.rows.position(*r)?, sheet.columns.position(*c)?), cell)))
        .collect();
    found.sort_by_key(|(at, _)| *at);
    found
}

/// The text a cell shows, as a dropdown's labels are matched with it: its number or text as its format shows it, its
/// boolean, its option's label now; `None` for a formula.
pub(crate) fn shown_text(workbook: &Workbook, sheet: &Sheet, at: (LineId, LineId), cell: &Cell) -> Option<String> {
    let value = match &cell.input {
        Input::Formula { .. } => return None,
        Input::Boolean { value } => return Some(if *value { "TRUE" } else { "FALSE" }.to_owned()),
        Input::DropdownOption { option_id, label } => {
            return Some(sheet.dropdown_option(option_id).map_or(label, |o| &o.label).clone())
        }
        Input::Number { value } => crate::value::Value::Number(*value),
        Input::Text { value } => crate::value::Value::Text(value.as_str().into()),
        Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => return cell.input.reads_as_text(),
    };
    let pattern = sheet.formats.get(Leaf::NumberFormat, at).and_then(|f| f.get("pattern")).and_then(Json::as_str);
    let locale = crate::locale::find(&workbook.locale).unwrap_or_else(crate::locale::en_us);
    match shown(&value, pattern, Room::AsText, locale) {
        Ok(ShownValue::Text { text, .. }) => Some(text),
        _ => None,
    }
}

/// What a cell given a dropdown with these options comes to hold: the option its value matches, or nothing.
fn matched(
    workbook: &Workbook,
    sheet: &Sheet,
    at: (LineId, LineId),
    cell: &Cell,
    options: &[DropdownOption],
) -> Option<Input> {
    let text = shown_text(workbook, sheet, at, cell)?.to_lowercase();
    let option = options.iter().find(|o| o.label.to_lowercase() == text)?;
    Some(Input::DropdownOption { option_id: option.option_id.clone(), label: option.label.clone() })
}

/// What giving a block of cells a dropdown with these labels would clear: the formulas, and the other values that
/// match none of them. Cells given the dropdown already (`held`) are left as they are.
pub(crate) fn would_clear(
    workbook: &Workbook,
    sheet: &Sheet,
    (rows, columns): (&[usize], &[usize]),
    labels: &[&str],
    held: Option<&str>,
) -> (usize, usize) {
    let options: Vec<DropdownOption> = labels
        .iter()
        .map(|l| DropdownOption { option_id: String::new(), label: (*l).to_owned(), color: Json::Null })
        .collect();
    let hidden = hidden_by_merges(workbook, sheet);
    let (mut formulas, mut others) = (0, 0);
    for &r in rows {
        for &c in columns {
            if hidden((r, c)) {
                continue;
            }
            let at = lines(sheet, (r, c));
            let Some(cell) = sheet.cells.get(&at) else { continue };
            if held.is_some() && dropdown_of(sheet, at) == held {
                continue;
            }
            if matches!(cell.input, Input::Formula { .. }) {
                formulas += 1;
            } else if matched(workbook, sheet, at, cell, &options).is_none() {
                others += 1;
            }
        }
    }
    (formulas, others)
}

/// The dropdowns of the sheet that no cell is given once these cells are given another, in id order.
fn unused_after<'a>(sheet: &'a Sheet, given: &HashSet<(LineId, LineId)>) -> Vec<&'a String> {
    let used: HashSet<&str> = sheet
        .formats
        .iter()
        .filter(|(leaf, at, _)| *leaf == Leaf::CellControl && !given.contains(at))
        .filter_map(|(_, _, v)| v.get("dropdownId")?.as_str())
        .collect();
    sheet.dropdowns.values().map(|(id, _)| id).filter(|id| !used.contains(id.as_str())).collect()
}

/// Cells as they are given a format: the columns with the same rows make one block, its rows and columns as
/// runs in id order; the blocks by their rows, then their columns.
fn blocks_by_rows(bases: &Bases, cells: &[(LineId, LineId)]) -> Vec<(Vec<IdRun>, Vec<IdRun>)> {
    let mut by_column: HashMap<LineId, Vec<LineId>> = HashMap::new();
    for &(r, c) in cells {
        by_column.entry(c).or_default().push(r);
    }
    let key = |runs: &[IdRun]| -> Vec<(String, u32, u32)> {
        runs.iter().map(|r| (r.base.clone(), r.first, r.count)).collect()
    };
    let mut by_rows: HashMap<Vec<(String, u32, u32)>, (Vec<IdRun>, Vec<LineId>)> = HashMap::new();
    for (c, mut rows) in by_column {
        let rows = sorted_runs(bases, &mut rows);
        by_rows.entry(key(&rows)).or_insert_with(|| (rows, Vec::new())).1.push(c);
    }
    let mut blocks: Vec<(Vec<IdRun>, Vec<IdRun>)> =
        by_rows.into_values().map(|(rows, mut columns)| (rows, sorted_runs(bases, &mut columns))).collect();
    blocks.sort_by(|a, b| key(&a.0).cmp(&key(&b.0)).then_with(|| key(&a.1).cmp(&key(&b.1))));
    blocks
}

/// The operations that give cells a new dropdown and take away those no cell is given then: the dropdown, the
/// cells' formats, the dropdowns taken away. With the new dropdown's cells set (by position), the cells that held the
/// options of those taken away keep their labels as text.
struct Giving<'a> {
    workbook: &'a Workbook,
    sheet: &'a Sheet,
    sheet_id: &'a str,
    dropdown_id: String,
    options: Vec<DropdownOption>,
    /// The cells given the dropdown, by position, row by row.
    cells: Vec<(usize, usize)>,
}

impl Giving<'_> {
    fn ops(self, mut set: Vec<((usize, usize), Option<Input>)>) -> Made {
        let Giving { workbook, sheet, sheet_id, dropdown_id, options, cells } = self;
        let given: Vec<(LineId, LineId)> = cells.iter().map(|&at| lines(sheet, at)).collect();
        let format = json!({"cellControl": {"kind": "dropdown", "dropdownId": dropdown_id}});
        let formats = blocks_by_rows(&workbook.bases, &given)
            .into_iter()
            .map(|(rows, columns)| CellsToFormat { rows, columns, format: format.clone() })
            .collect();
        let mut ops = vec![
            Op::SetDropdowns {
                sheet_id: sheet_id.to_owned(),
                dropdowns: vec![DropdownToSet { dropdown_id, options: Some(options) }],
            },
            Op::SetCellFormats { sheet_id: sheet_id.to_owned(), formats },
        ];
        let given: HashSet<(LineId, LineId)> = given.into_iter().collect();
        let unused = unused_after(sheet, &given);
        if !unused.is_empty() {
            let dropdowns =
                unused.iter().map(|id| DropdownToSet { dropdown_id: (*id).clone(), options: None }).collect();
            ops.push(Op::SetDropdowns { sheet_id: sheet_id.to_owned(), dropdowns });
            // The cells that held their options (but those set already, and those a merged range hides) keep the
            // labels as text.
            let options: HashSet<&str> = unused
                .iter()
                .flat_map(|id| &sheet.dropdowns[id.as_str()].1)
                .map(|o| o.option_id.as_str())
                .collect();
            let already: HashSet<(usize, usize)> = set.iter().map(|(at, _)| *at).collect();
            let hidden = hidden_by_merges(workbook, sheet);
            for (at, cell) in holding(sheet, &options) {
                if already.contains(&at) || given.contains(&lines(sheet, at)) || hidden(at) {
                    continue;
                }
                let Input::DropdownOption { option_id, .. } = &cell.input else { continue };
                let label = sheet.dropdown_option(option_id).expect("an option of the sheet's").label.clone();
                set.push((at, Some(Input::Text { value: label })));
            }
        }
        let boxes: Vec<_> = cells.iter().chain(set.iter().map(|(at, _)| at)).map(|&(r, c)| (r, r, c, c)).collect();
        let place = around(sheet_id, boxes.iter());
        if !set.is_empty() {
            let cells = set
                .into_iter()
                .map(|(at, input)| {
                    let CellIds { r, c } = cell_ids(workbook, sheet, at);
                    CellToSet { r, c, input }
                })
                .collect();
            ops.push(Op::SetCells { sheet_id: sheet_id.to_owned(), cells, form: CellForm::ListUnlessLarge });
        }
        Made { ops, place: Some(place) }
    }
}

pub fn make_dropdown(
    workbook: &Workbook,
    cells: CellsInRows,
    options: Vec<OptionToMake>,
    code: &str,
) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &cells.sheet_id)?;
    let (rows, columns) = block(workbook, sheet, &cells.rows, &cells.one_column, &cells.other_column)?;
    check_labels(&options.iter().map(|o| o.label.as_str()).collect::<Vec<_>>())?;
    let options: Vec<DropdownOption> = options
        .into_iter()
        .enumerate()
        .map(|(k, o)| DropdownOption { option_id: format!("opt_{code}.{k}"), label: o.label, color: o.color.0 })
        .collect();
    let block: Vec<(usize, usize)> = rows.iter().flat_map(|&r| columns.iter().map(move |&c| (r, c))).collect();
    // The values there become the options they match, or nothing (but those a merged range hides).
    let hidden = hidden_by_merges(workbook, sheet);
    let set = block
        .iter()
        .filter(|&&at| !hidden(at))
        .filter_map(|&at| {
            let lines = lines(sheet, at);
            let cell = sheet.cells.get(&lines)?;
            Some((at, matched(workbook, sheet, lines, cell, &options)))
        })
        .collect();
    let giving = Giving {
        workbook,
        sheet,
        sheet_id: &cells.sheet_id,
        dropdown_id: format!("ddn_{code}.0"),
        options,
        cells: block,
    };
    Ok(giving.ops(set))
}

pub fn add_option(
    workbook: &Workbook,
    sheet_id: String,
    cell: CellIds,
    label: String,
    color: Color,
    code: &str,
) -> Result<Made, Refused> {
    // An empty label before all else, even the sheet.
    if label.is_empty() {
        return Err(Refused::Because("dropdownOptionLabelEmpty"));
    }
    let sheet = sheet_of(workbook, &sheet_id)?;
    let at = live_cell(workbook, sheet, &cell)?;
    let lines = lines(sheet, at);
    let dropdown = dropdown_of(sheet, lines).and_then(|id| sheet.dropdowns.get(id));
    let Some((dropdown_id, options)) = dropdown else { return Err(Refused::Because("unknownDropdown")) };
    let CellIds { r, c } = cell_ids(workbook, sheet, at);
    let set_cell = |option: &DropdownOption| {
        let input = Input::DropdownOption { option_id: option.option_id.clone(), label: option.label.clone() };
        let cells = vec![CellToSet { r: r.clone(), c: c.clone(), input: Some(input) }];
        Op::SetCells { sheet_id: sheet_id.clone(), cells, form: CellForm::Auto }
    };
    // A label the dropdown has (capitals aside) is that option.
    let lower = label.to_lowercase();
    if let Some(option) = options.iter().find(|o| o.label.to_lowercase() == lower) {
        let holds = |cell: &Cell| {
            matches!(&cell.input, Input::DropdownOption { option_id, label }
                if *option_id == option.option_id && *label == option.label)
        };
        if sheet.cells.get(&lines).is_some_and(holds) {
            return Ok(Made::nothing());
        }
    }
    // A cell a merged range hides is not set.
    if hidden_by_merges(workbook, sheet)(at) {
        return Err(Refused::Because("cellCoveredByMergedRange"));
    }
    if let Some(option) = options.iter().find(|o| o.label.to_lowercase() == lower) {
        return Ok(Made::ops(vec![set_cell(option)]));
    }
    let option = DropdownOption { option_id: format!("opt_{code}.0"), label, color: color.0 };
    let mut all = options.clone();
    all.push(option.clone());
    let dropdowns = vec![DropdownToSet { dropdown_id: dropdown_id.clone(), options: Some(all) }];
    let ops = vec![Op::SetDropdowns { sheet_id: sheet_id.clone(), dropdowns }, set_cell(&option)];
    Ok(Made { ops, place: Some(around(&sheet_id, [(at.0, at.0, at.1, at.1)].iter())) })
}

pub fn set_options(
    workbook: &Workbook,
    sheet_id: String,
    dropdown_id: String,
    options: Vec<OptionInAnEditor>,
    applies_to: AppliesTo,
    code: &str,
) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &sheet_id)?;
    // The block first, then the dropdown, then the options: an empty label, the ids (all known, then none twice),
    // labels the same but for capitals; then whether anything changes, and only then the limits.
    let block = match &applies_to {
        AppliesTo::EveryCell {} => None,
        AppliesTo::CellsInRows { rows, one_column, other_column } => {
            Some(block(workbook, sheet, rows, one_column, other_column)?)
        }
    };
    let Some((_, old)) = sheet.dropdowns.get(&dropdown_id) else { return Err(Refused::Because("unknownDropdown")) };
    if options.iter().any(|o| o.label.is_empty()) {
        return Err(Refused::Because("dropdownOptionLabelEmpty"));
    }
    let ids: Vec<&str> = options.iter().filter_map(|o| o.option_id.as_deref()).collect();
    if !ids.iter().all(|&id| old.iter().any(|o| o.option_id == id)) {
        return Err(Refused::Because("unknownDropdownOption"));
    }
    let mut seen = HashSet::new();
    if !ids.iter().all(|&id| seen.insert(id)) {
        return Err(Refused::Because("dropdownOptionIdTaken"));
    }
    drop((seen, ids));
    let given: Vec<String> = options.iter().map(|o| o.label.clone()).collect();
    let labels: Vec<&str> = given.iter().map(String::as_str).collect();
    check_capitals(&labels)?;
    match applies_to {
        AppliesTo::EveryCell {} => {
            // New options are numbered among themselves.
            let mut k = 0;
            let new: Vec<DropdownOption> = options
                .into_iter()
                .map(|o| {
                    let option_id = o.option_id.unwrap_or_else(|| {
                        k += 1;
                        format!("opt_{code}.{}", k - 1)
                    });
                    DropdownOption { option_id, label: o.label, color: o.color.0 }
                })
                .collect();
            if new == *old {
                return Ok(Made::nothing());
            }
            check_limits(&labels)?;
            // The cells that held the options left out are cleared (those renamed keep what they hold, and so do
            // those a merged range hides).
            let kept: HashSet<&str> = new.iter().map(|o| o.option_id.as_str()).collect();
            let gone: HashSet<&str> =
                old.iter().map(|o| o.option_id.as_str()).filter(|id| !kept.contains(id)).collect();
            let hidden = hidden_by_merges(workbook, sheet);
            let cleared: Vec<(usize, usize)> =
                holding(sheet, &gone).into_iter().map(|(at, _)| at).filter(|&at| !hidden(at)).collect();
            drop((kept, gone));
            let dropdowns = vec![DropdownToSet { dropdown_id, options: Some(new) }];
            let mut ops = vec![Op::SetDropdowns { sheet_id: sheet_id.clone(), dropdowns }];
            let boxes: Vec<_> = cleared.iter().map(|&(r, c)| (r, r, c, c)).collect();
            let place = around(&sheet_id, boxes.iter());
            if !cleared.is_empty() {
                let cells = cleared
                    .into_iter()
                    .map(|at| {
                        let CellIds { r, c } = cell_ids(workbook, sheet, at);
                        CellToSet { r, c, input: None }
                    })
                    .collect();
                ops.push(Op::SetCells { sheet_id: sheet_id.clone(), cells, form: CellForm::Auto });
            }
            Ok(Made { ops, place: Some(place) })
        }
        AppliesTo::CellsInRows { .. } => {
            let (rows, columns) = block.expect("the block of cells in rows");
            // The cells of the block given the dropdown are given a new one with these options.
            let cells: Vec<(usize, usize)> = rows
                .iter()
                .flat_map(|&r| columns.iter().map(move |&c| (r, c)))
                .filter(|&at| dropdown_of(sheet, lines(sheet, at)) == Some(dropdown_id.as_str()))
                .collect();
            if cells.is_empty() {
                return Ok(Made::nothing());
            }
            check_limits(&labels)?;
            let new: Vec<DropdownOption> = options
                .iter()
                .enumerate()
                .map(|(k, o)| DropdownOption {
                    option_id: format!("opt_{code}.{k}"),
                    label: o.label.clone(),
                    color: o.color.0.clone(),
                })
                .collect();
            // Their options become the new ones they were given as; those left out are cleared (but in cells a
            // merged range hides).
            let renamed: HashMap<&str, &DropdownOption> = options
                .iter()
                .zip(&new)
                .filter_map(|(o, n)| Some((o.option_id.as_deref()?, n)))
                .collect();
            let hidden = hidden_by_merges(workbook, sheet);
            let set = cells
                .iter()
                .filter(|&&at| !hidden(at))
                .filter_map(|&at| {
                    let cell = sheet.cells.get(&lines(sheet, at))?;
                    let Input::DropdownOption { option_id, .. } = &cell.input else { return None };
                    if !old.iter().any(|o| o.option_id == *option_id) {
                        return None;
                    }
                    let input = renamed.get(option_id.as_str()).map(|n| Input::DropdownOption {
                        option_id: n.option_id.clone(),
                        label: n.label.clone(),
                    });
                    Some((at, input))
                })
                .collect();
            drop(renamed);
            let giving = Giving {
                workbook,
                sheet,
                sheet_id: &sheet_id,
                dropdown_id: format!("ddn_{code}.0"),
                options: new,
                cells,
            };
            Ok(giving.ops(set))
        }
    }
}
