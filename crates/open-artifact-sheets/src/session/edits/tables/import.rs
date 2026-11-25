//! A table imported (texts read from a file, row by row) as a new sheet.
//!
//! The sheet (`sht_<code>.0`, rows `row_<code>.<n>`, columns `col_<code>.<n>`) has at least 1000 rows and 26 columns,
//! more when the table has more; it is named as asked, as a copy is (`duplicate.rs`). The header rows' texts are
//! set as they are. Below them, the body runs to the last row with a text that a cell takes (one not empty, typed;
//! one not blank, spaces aside, read or for a dropdown), and the table is as wide and as long as the texts cells
//! take reach.
//! Each column's texts go in as the column says:
//! - read under a column reading (`column_readings.rs`): a number, the text, or the text as it is when it doesn't
//!   fit; the body's cells take the reading's pattern;
//! - a dropdown made for the column (`ddn_<code>.<column>`, its options `opt_<code>.<n>` numbered across the
//!   dropdowns): a text whose label it is (spaces around it aside, then as it is, capitals aside) holds that option,
//!   another stays text; the body's cells are given the dropdown;
//! - as typed (and any column the edit says nothing of): as a paste as typed reads them, in the workbook's locale.
//!
//! The operations: the sheet, its rows and columns; each dropdown and the cells given it; the patterns of the read
//! columns, one operation a pattern, in the order of the patterns; the patterns the typed texts bring; the header's,
//! read and dropdown cells; the typed cells.

use std::collections::BTreeMap;
use hashbrown::HashMap;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::duplicate::copy_name;
use super::{Made, Refused};
use crate::column_readings::{ColumnReading, Read, SPACES};
use crate::ids::{IdRun, LineId};
use crate::locale::{self, Locale};
use crate::session::edits::lines::fit;
use crate::session::edits::objects::dropdowns::{check_labels, OptionToMake};
use crate::session::place::Place;
use crate::typing;
use crate::workbook::grid::CellForm;
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::{DropdownOption, DropdownToSet};
use crate::workbook::{Input, Workbook};

/// The most bytes of text a table imported may have, all its texts together.
const MOST_BYTES_OF_A_TABLE_TO_IMPORT: usize = 48 << 20;
/// The least rows and columns the new sheet has.
const LEAST_ROWS: usize = 1000;
const LEAST_COLUMNS: usize = 26;
/// The most bytes of UTF-8 a text may have.
const LONGEST_TEXT: usize = 32767;

/// How a column's texts are imported.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ColumnToImport {
    AsTyped {},
    Read { reading: ColumnReading },
    Dropdown { options: Vec<OptionToMake> },
}

impl ColumnToImport {
    /// A column is read under a reading of numbers, dates, times or text (a dropdown is made with its options, at
    /// least one).
    pub fn is_readable(&self) -> bool {
        match self {
            ColumnToImport::AsTyped {} => true,
            ColumnToImport::Read { reading } => !matches!(reading, ColumnReading::Dropdown { .. }),
            ColumnToImport::Dropdown { options } => !options.is_empty(),
        }
    }
}

fn is_blank(text: &str) -> bool {
    text.trim_matches(SPACES).is_empty()
}

fn workbook_locale(workbook: &Workbook) -> &'static Locale {
    locale::find(&workbook.locale).unwrap_or_else(locale::en_us)
}

/// The options of a dropdown column, and how its texts find them.
struct Dropdown {
    options: Vec<DropdownOption>,
    by_label: HashMap<String, usize>,
}

impl Dropdown {
    /// The option a text is the label of: the text without the spaces around it, else as it is, capitals aside.
    fn option_of(&self, text: &str) -> Option<&DropdownOption> {
        let trimmed = self.by_label.get(&text.trim_matches(SPACES).to_lowercase());
        let i = trimmed.or_else(|| self.by_label.get(&text.to_lowercase()))?;
        Some(&self.options[*i])
    }
}

/// The operations of `importTableAsNewSheet`, or the refusal.
pub fn as_new_sheet(
    workbook: &Workbook,
    after_sheet: Option<String>,
    name: &str,
    rows: &[Vec<String>],
    header_rows: u32,
    columns: &[ColumnToImport],
    code: &str,
) -> Result<Made, Refused> {
    let bytes: usize = rows.iter().flatten().map(String::len).sum();
    if bytes > MOST_BYTES_OF_A_TABLE_TO_IMPORT {
        return Err(Refused::Because("tableTooLarge"));
    }
    for column in columns {
        if let ColumnToImport::Dropdown { options } = column {
            check_labels(&options.iter().map(|o| o.label.as_str()).collect::<Vec<_>>())?;
        }
    }
    if let Some(after) = &after_sheet {
        workbook.sheet_index(after).ok_or(Refused::Because("unknownSheet"))?;
    }
    let name = copy_name(workbook, name).ok_or(Refused::Because("sheetNameNotAllowed"))?;
    let locale = workbook_locale(workbook);
    let sheet_id = format!("sht_{code}.0");
    let (row_base, column_base) = (format!("row_{code}"), format!("col_{code}"));
    let header = (header_rows as usize).min(rows.len());
    let as_typed = ColumnToImport::AsTyped {};
    let column = |c: usize| columns.get(c).unwrap_or(&as_typed);
    // Whether a cell takes a text: the header's and typed ones not empty, the others not blank.
    let takes = |r: usize, c: usize, t: &str| match column(c) {
        _ if r < header => !t.is_empty(),
        ColumnToImport::AsTyped {} => !t.is_empty(),
        ColumnToImport::Read { .. } | ColumnToImport::Dropdown { .. } => !is_blank(t),
    };
    let taken = |r: usize| rows[r].iter().enumerate().rev().find(|&(c, t)| takes(r, c, t)).map(|(c, _)| c + 1);
    let width = (0..rows.len()).filter_map(taken).max().unwrap_or(0);
    let height = (0..rows.len()).rev().find(|&r| taken(r).is_some()).map_or(0, |r| r + 1);
    let mut ops = vec![
        Op::InsertSheet { sheet_id: sheet_id.clone(), name, after: after_sheet },
        Op::InsertRows {
            sheet_id: sheet_id.clone(),
            after: None,
            rows: IdRun { base: row_base.clone(), first: 0, count: height.max(LEAST_ROWS) as u32 },
        },
        Op::InsertColumns {
            sheet_id: sheet_id.clone(),
            after: None,
            columns: IdRun { base: column_base.clone(), first: 0, count: width.max(LEAST_COLUMNS) as u32 },
        },
    ];
    // The body: from under the header to the last row with a text a cell takes.
    let body = (header..rows.len()).rev().find(|&r| taken(r).is_some());
    let body_rows = body.map(|last| {
        vec![IdRun { base: row_base.clone(), first: header as u32, count: (last + 1 - header) as u32 }]
    });
    let columns_run =
        |first: usize, count: usize| IdRun { base: column_base.clone(), first: first as u32, count: count as u32 };

    // The dropdowns, and the cells given them.
    let mut dropdowns: HashMap<usize, Dropdown> = HashMap::new();
    if let Some(body_rows) = &body_rows {
        let mut n = 0;
        for c in 0..width {
            let ColumnToImport::Dropdown { options } = column(c) else { continue };
            let id = format!("ddn_{code}.{c}");
            let mut made = Vec::with_capacity(options.len());
            let mut by_label = HashMap::new();
            for option in options {
                let (option_id, label) = (format!("opt_{code}.{n}"), option.label.clone());
                made.push(DropdownOption { option_id, label, color: option.color.0.clone() });
                by_label.insert(option.label.to_lowercase(), made.len() - 1);
                n += 1;
            }
            ops.push(Op::SetDropdowns {
                sheet_id: sheet_id.clone(),
                dropdowns: vec![DropdownToSet { dropdown_id: id.clone(), options: Some(made.clone()) }],
            });
            ops.push(Op::SetCellFormats {
                sheet_id: sheet_id.clone(),
                formats: vec![CellsToFormat {
                    rows: body_rows.clone(),
                    columns: vec![columns_run(c, 1)],
                    format: json!({"cellControl": {"kind": "dropdown", "dropdownId": id}}),
                }],
            });
            dropdowns.insert(c, Dropdown { options: made, by_label });
        }
        // The read columns' patterns, each over runs of neighboring columns.
        let mut patterns: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for c in 0..width {
            if let ColumnToImport::Read { reading } = column(c) {
                if let Some(pattern) = reading.pattern(locale) {
                    patterns.entry(pattern).or_default().push(c);
                }
            }
        }
        for (pattern, at) in patterns {
            let mut runs: Vec<(usize, usize)> = Vec::new();
            for c in at {
                match runs.last_mut() {
                    Some((first, count)) if *first + *count == c => *count += 1,
                    _ => runs.push((c, 1)),
                }
            }
            let formats = runs
                .into_iter()
                .map(|(first, count)| CellsToFormat {
                    rows: body_rows.clone(),
                    columns: vec![columns_run(first, count)],
                    format: json!({"numberFormat": {"pattern": pattern}}),
                })
                .collect();
            ops.push(Op::SetCellFormats { sheet_id: sheet_id.clone(), formats });
        }
    }

    // The header's cells, and the read and dropdown ones.
    let text = |t: &str| -> Result<Option<Input>, Refused> {
        if t.len() > LONGEST_TEXT {
            return Err(Refused::Because("textTooLong"));
        }
        Ok(Some(Input::Text { value: t.to_owned() }))
    };
    let mut cells: Vec<CellToSet> = Vec::new();
    let mut typed: Vec<(usize, usize)> = Vec::new();
    for (r, row) in rows.iter().enumerate() {
        for (c, t) in row.iter().enumerate() {
            let input = if r < header {
                if t.is_empty() {
                    continue;
                }
                text(t)?
            } else {
                match column(c) {
                    ColumnToImport::AsTyped {} => {
                        if !t.is_empty() {
                            typed.push((r, c));
                        }
                        continue;
                    }
                    ColumnToImport::Read { reading } => match reading.read(t, locale) {
                        Read::Blank => continue,
                        Read::Number(n) => Some(Input::Number { value: n }),
                        Read::Text(t) => text(&t)?,
                        Read::DoesNotFit => text(t)?,
                    },
                    ColumnToImport::Dropdown { .. } => {
                        if is_blank(t) {
                            continue;
                        }
                        match dropdowns.get(&c).and_then(|d| d.option_of(t)) {
                            Some(o) => {
                                Some(Input::DropdownOption { option_id: o.option_id.clone(), label: o.label.clone() })
                            }
                            None => text(t)?,
                        }
                    }
                }
            };
            cells.push(CellToSet { r: format!("{row_base}.{r}"), c: format!("{column_base}.{c}"), input });
        }
    }

    // The typed cells, typed into the new sheet.
    let mut typed_ops = Vec::new();
    if !typed.is_empty() {
        let mut with_sheet = workbook.clone();
        with_sheet.apply(&ops[..3]).map_err(Refused::from)?;
        let s = with_sheet.sheet_index(&sheet_id).expect("the sheet just made");
        let line = |id: String| -> LineId { with_sheet.bases.parse(&id).expect("a line just made") };
        let texts: Vec<((LineId, LineId), &str)> = typed
            .iter()
            .map(|&(r, c)| ((line(format!("{row_base}.{r}")), line(format!("{column_base}.{c}"))), rows[r][c].as_str()))
            .collect();
        typed_ops = typing::type_as_pasted(&with_sheet, s, &texts).map_err(Refused::from)?;
    }
    let (typed_formats, typed_cells): (Vec<Op>, Vec<Op>) =
        typed_ops.into_iter().partition(|op| matches!(op, Op::SetCellFormats { .. }));
    ops.extend(typed_formats);
    if !cells.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet_id.clone(), cells, form: CellForm::Auto });
    }
    ops.extend(typed_cells);
    Ok(Made { ops, place: Some(Place::sheet(&sheet_id)) })
}

/// How an imported table looks (`look`): as imported, its header rows frozen, or frozen and filled, the first
/// columns at least as wide as given and as wide as their cells need (a text no wider than `widestForATextInPixels`).
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Look {
    Plain {},
    HeaderFrozen {},
    #[serde(rename_all = "camelCase")]
    HeaderFrozenAndFilled {
        header_fill: crate::workbook::objects::Color,
        least_widths_in_pixels: Vec<u32>,
        widest_for_a_text_in_pixels: u32,
    },
}

/// The look of a table imported as a new sheet, given once the sheet is made: its header rows, and the look.
pub struct LookToGive {
    code: String,
    header_rows: usize,
    look: Look,
}

/// The look to give the sheet a table is imported as, when there is one to give: none when it is plain or the table
/// has no header rows. The header rows are as many as asked for, past the rows the table gives too (they are frozen
/// so, an empty table's first row as well).
pub fn look_to_give(look: Option<&Look>, header_rows: u32, code: &str) -> Option<LookToGive> {
    let header_rows = header_rows as usize;
    match look? {
        Look::Plain {} => None,
        _ if header_rows == 0 => None,
        look => Some(LookToGive { code: code.to_owned(), header_rows, look: look.clone() }),
    }
}

/// The operations of a look, made after the import as a part of its own (the second part): the header rows
/// frozen; filled, the fill (unless none) over the header rows and as many columns as least widths are given, and the widths of
/// those of them the table reaches.
pub fn look_ops(workbook: &Workbook, look: LookToGive) -> Vec<Op> {
    let LookToGive { code, header_rows, look } = look;
    let sheet_id = format!("sht_{code}.0");
    let (row_base, column_base) = (format!("row_{code}"), format!("col_{code}"));
    let frozen = json!({"sheetId": sheet_id, "settings": {"lastFrozenRow": format!("{row_base}.{}", header_rows - 1)}});
    let mut ops: Vec<Op> =
        vec![serde_json::from_value(json!({"kind": "setSheetSettings", "sheets": [frozen]})).expect("settings read")];
    let Look::HeaderFrozenAndFilled { header_fill, least_widths_in_pixels: least, widest_for_a_text_in_pixels: widest } =
        look
    else {
        return ops;
    };
    if least.is_empty() {
        return ops;
    }
    // A fill of none is not set (the cells hold none yet).
    if header_fill.0.get("kind").and_then(Json::as_str) != Some("none") {
        ops.push(Op::SetCellFormats {
            sheet_id: sheet_id.clone(),
            formats: vec![CellsToFormat {
                rows: vec![IdRun { base: row_base, first: 0, count: header_rows as u32 }],
                columns: vec![IdRun { base: column_base.clone(), first: 0, count: least.len() as u32 }],
                format: json!({"fillColor": header_fill.0}),
            }],
        });
    }
    let Some(s) = workbook.sheet_index(&sheet_id) else { return ops };
    let sheet = &workbook.sheets[s];
    // The columns the table reaches: to the last with a cell.
    let reached = sheet.cells.keys().filter_map(|&(_, c)| sheet.columns.position(c)).max().map_or(0, |c| c + 1);
    let columns: Vec<LineId> = (0..least.len().min(reached)).filter_map(|i| sheet.columns.line(i)).collect();
    let needed = fit::widths_needed_with_texts_held_to(workbook, sheet, &columns, widest);
    let sizes = columns.into_iter().enumerate().map(|(i, column)| {
        let width = least[i].max(needed.get(&column).copied().unwrap_or(0));
        (column, width.clamp(super::super::lines::NARROWEST_COLUMN, super::super::lines::WIDEST_COLUMN))
    });
    let widths = super::super::lines::column_width_runs(workbook, sizes);
    if !widths.is_empty() {
        ops.push(Op::SetColumnWidths { sheet_id, widths });
    }
    ops
}
