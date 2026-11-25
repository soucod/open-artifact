//! Inserting or changing an editable PIVOT formula, and fitting its output.

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{Context, Made, Refused};
use crate::brought::Brought;
use crate::calculate::{calculate, BlockedBy, SpillOutcome};
use crate::formula::pivot::{Listed, Spec, WrittenValue};
use crate::ids::{runs_of, IdRun};
use crate::number_format::Kind;
use crate::session::place::Place;
use crate::session::reads::{
    pivot::{formula_in, record_runs, source_tables, table_has_column},
    tables::{cell_at, sheet, values::SheetValues},
};
use crate::value::{CellError, Value};
use crate::workbook::grid::CellForm;
use crate::workbook::formats::Leaf;
use crate::workbook::layout::{CellIds, ColumnsToSize, SheetSettings, SheetToSet};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::{Input, Workbook};

use super::lines::fit;
use super::tables::duplicate::copy_name;

const NEW_SHEET_ROWS: u32 = 1000;
const NEW_SHEET_COLUMNS: u32 = 26;
const MOST_SHEET_ROWS: usize = 1 << 20;
const MOST_SHEET_COLUMNS: usize = 1 << 14;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::session) enum Edit {
    #[serde(rename_all = "camelCase")]
    InsertPivotTable { place: Destination, pivot_table: Spec },
    #[serde(rename_all = "camelCase")]
    ChangePivotTable {
        sheet_id: String,
        cell: CellIds,
        pivot_table: Spec,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::session) enum Destination {
    #[serde(rename_all = "camelCase")]
    NewSheet { after_sheet: Option<String>, name: String },
    #[serde(rename_all = "camelCase")]
    Cell { sheet_id: String, cell: CellIds },
}

pub(super) fn read(json: &Json) -> Option<Edit> {
    let edit = serde_json::from_value(json.clone()).ok()?;
    let spec = match &edit {
        Edit::InsertPivotTable { pivot_table, .. } | Edit::ChangePivotTable { pivot_table, .. } => pivot_table,
    };
    spec.readable().then_some(edit)
}

pub(super) fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let (dest, spec, changing) = match edit {
        Edit::InsertPivotTable { place, pivot_table } => (place, pivot_table, false),
        Edit::ChangePivotTable {
            sheet_id,
            cell,
            pivot_table,
        } => (Destination::Cell { sheet_id, cell }, pivot_table, true),
    };
    let mut ops = Vec::new();
    let (sheet_id, cell, row, column) = match dest {
        Destination::Cell { sheet_id, cell } => {
            let sheet = sheet(workbook, &sheet_id).map_err(Refused::Because)?;
            let (row, column) = cell_at(workbook, sheet, &cell).map_err(Refused::Because)?;
            let ids = (sheet.rows.line(row).unwrap(), sheet.columns.line(column).unwrap());
            if changing && sheet.cells.get(&ids).and_then(formula_in).is_none() {
                return Err(Refused::Because("noPivotTableAtTheCell"));
            }
            (sheet_id, cell, row, column)
        }
        Destination::NewSheet { after_sheet, name } => {
            if after_sheet
                .as_ref()
                .is_some_and(|sheet| workbook.sheet_index(sheet).is_none())
            {
                return Err(Refused::Because("unknownSheet"));
            }
            let name = copy_name(workbook, &name).ok_or(Refused::Because("sheetNameNotAllowed"))?;
            let sheet_id = format!("sht_{}.0", context.code);
            let (row_base, col_base) = (format!("row_{}", context.code), format!("col_{}", context.code));
            ops.extend([
                Op::InsertSheet {
                    sheet_id: sheet_id.clone(),
                    name,
                    after: after_sheet,
                },
                Op::InsertRows {
                    sheet_id: sheet_id.clone(),
                    after: None,
                    rows: IdRun {
                        base: row_base.clone(),
                        first: 0,
                        count: NEW_SHEET_ROWS,
                    },
                },
                Op::InsertColumns {
                    sheet_id: sheet_id.clone(),
                    after: None,
                    columns: IdRun {
                        base: col_base.clone(),
                        first: 0,
                        count: NEW_SHEET_COLUMNS,
                    },
                },
            ]);
            (
                sheet_id,
                CellIds {
                    r: format!("{row_base}.0"),
                    c: format!("{col_base}.0"),
                },
                0,
                0,
            )
        }
    };

    let sources = source_tables(workbook, &spec.source);
    let table = sources
        .iter()
        .find(|table| table_has_column(table, &spec.values[0].column))
        .ok_or(Refused::Because("pivotTableSourceHasNoHeader"))?;
    if spec.columns_used().any(|column| !table_has_column(table, column)) {
        return Err(Refused::Because("pivotTableColumnNotOfSource"));
    }
    validate_source(workbook, &spec, table)?;
    let input = Input::Formula { formula: spec.stored() };
    if let Ok(sheet) = sheet(workbook, &sheet_id) {
        let r = workbook.bases.parse(&cell.r).unwrap();
        let c = workbook.bases.parse(&cell.c).unwrap();
        if sheet_id == spec.source.sheet_id {
            let id_position = |axis: &crate::ids::Axis, id: &Json| {
                id.as_str()
                    .and_then(|id| workbook.bases.parse(id))
                    .and_then(|id| axis.position(id))
            };
            let top = id_position(&sheet.rows, &table["headerRows"]["firstRow"]).unwrap_or(0);
            let bottom = id_position(&sheet.rows, &table["footerRows"]["lastRow"])
                .or_else(|| {
                    table["body"]
                        .as_array()?
                        .last()
                        .and_then(|run| id_position(&sheet.rows, &run["lastRow"]))
                })
                .unwrap_or(top);
            let left = id_position(&sheet.columns, &table["firstColumn"]).unwrap_or(0);
            let right = id_position(&sheet.columns, &table["lastColumn"]).unwrap_or(left);
            if (top..=bottom).contains(&row) && spec.columns_used().any(|read| read == cell.c) {
                return Err(Refused::Because("pivotTableWouldReadItself"));
            }
            if (top..=bottom.saturating_add(1)).contains(&row)
                && (left..=right.saturating_add(1)).contains(&column)
                && !sheet.cells.contains_key(&(r, c))
            {
                return Err(Refused::Because("pivotTableWouldTouchATable"));
            }
        }
        if let Some(old) = sheet.cells.get(&(r, c)) {
            if old.input == input && changing {
                return Ok(Made::nothing());
            }
            if !changing {
                return Err(Refused::Because("pivotTableCellsInTheWay"));
            }
        }
        for filter in &spec.filters {
            if let Listed::InACell {
                sheet_id: reads_sheet,
                cell,
            } = &filter.listed
            {
                if reads_sheet == &sheet_id {
                    let (reads_row, reads_column) = cell_at(workbook, sheet, cell).map_err(Refused::Because)?;
                    if reads_row >= row && reads_column >= column {
                        return Err(Refused::Because("pivotTableWouldReadItself"));
                    }
                }
            }
        }
    }
    ops.push(Op::SetCells {
        sheet_id: sheet_id.clone(),
        cells: vec![CellToSet {
            r: cell.r.clone(),
            c: cell.c.clone(),
            input: Some(input),
        }],
        form: CellForm::List,
    });

    let mut preview = workbook.clone();
    preview.apply_in_place(&ops).map_err(Refused::from)?;
    calculate(&mut preview, None);
    let r = preview.bases.parse(&cell.r).unwrap();
    let c = preview.bases.parse(&cell.c).unwrap();
    let spanning = preview.outcome(&sheet_id, r, c).and_then(|o| o.spill.as_ref());
    let new_sheet = workbook.sheet_index(&sheet_id).is_none();
    let extent = match spanning {
        Some(SpillOutcome::Fills { to, .. }) if new_sheet => Some(*to),
        Some(SpillOutcome::Blocked {
            by: BlockedBy::EndOfSheet(to),
            ..
        }) => Some(*to),
        _ => None,
    };
    let needed = if let Some((bottom, right)) = extent {
        if bottom >= MOST_SHEET_ROWS {
            return Err(Refused::Because("tooManyRows"));
        }
        if right >= MOST_SHEET_COLUMNS {
            return Err(Refused::Because("tooManyColumns"));
        }
        let source_sheet = sheet(workbook, &spec.source.sheet_id).map_err(Refused::Because)?;
        let header = workbook.bases.parse(&spec.source.header_row).and_then(|r| source_sheet.rows.position(r))
            .ok_or(Refused::Because("pivotTableSourceHasNoHeader"))?;
        let source_rows = source_sheet.rows.len() - header;
        // Reserve room for later groups, within what the source can produce and the sheet can hold.
        let rows = (bottom - row + 101).min(source_rows + 1);
        let columns = if spec.columns.is_some() {
            let fixed = spec.rows.len().max(1) + spec.values.len();
            (right - column + 11).min(source_rows + fixed)
        } else {
            right - column + 1 + usize::from(!spec.rows.is_empty())
        };
        Some(((row + rows).min(MOST_SHEET_ROWS), (column + columns).min(MOST_SHEET_COLUMNS)))
    } else {
        None
    };
    if let Some((need_rows, need_columns)) = needed
        .filter(|&(rows, columns)| !new_sheet || rows > NEW_SHEET_ROWS as usize || columns > NEW_SHEET_COLUMNS as usize)
    {
        if let Ok(sheet) = sheet(workbook, &sheet_id) {
            let r = sheet.rows.len();
            let c = sheet.columns.len();
            let mut growth = Vec::new();
            if need_rows > r {
                growth.push(Op::InsertRows {
                    sheet_id: sheet_id.clone(),
                    after: sheet.rows.line(r - 1).map(|r| workbook.bases.text(r)),
                    rows: IdRun {
                        base: format!("row_{}", context.code),
                        first: 0,
                        count: (need_rows - r) as u32,
                    },
                });
            }
            if need_columns > c {
                growth.push(Op::InsertColumns {
                    sheet_id: sheet_id.clone(),
                    after: sheet.columns.line(c - 1).map(|c| workbook.bases.text(c)),
                    columns: IdRun {
                        base: format!("col_{}", context.code),
                        first: 0,
                        count: (need_columns - c) as u32,
                    },
                });
            }
            ops.splice(0..0, growth);
        } else {
            for op in &mut ops {
                match op {
                    Op::InsertRows { rows, .. } => rows.count = rows.count.max(need_rows as u32),
                    Op::InsertColumns { columns, .. } => columns.count = columns.count.max(need_columns as u32),
                    _ => {}
                }
            }
        }
        preview = workbook.clone();
        preview.apply_in_place(&ops).map_err(Refused::from)?;
        calculate(&mut preview, None);
    }
    if let Some(outcome) = preview.outcome(&sheet_id, r, c) {
        match &outcome.spill {
            Some(SpillOutcome::Blocked {
                by: BlockedBy::FilledCell(_),
                ..
            }) => {
                return Err(Refused::Because("pivotTableCellsInTheWay"));
            }
            Some(SpillOutcome::Blocked {
                by: BlockedBy::EarlierFormula(_),
                ..
            }) => {
                return Err(Refused::Because("pivotTableFormulaInTheWay"));
            }
            Some(SpillOutcome::Fills { to, .. }) if !new_sheet => {
                if another_pivot_reads(workbook, &sheet_id, (row, column), *to) {
                    return Err(Refused::Because("pivotTableWouldBeReadByAnother"));
                }
            }
            _ if outcome.value == Value::Error(CellError::Number) => return Err(Refused::Because("pivotTableTooLarge")),
            _ => {}
        }
    }
    Ok(Made {
        ops,
        place: Some(Place::cells(&sheet_id, row, column, row, column)),
    })
}

fn another_pivot_reads(
    workbook: &Workbook,
    sheet_id: &str,
    (top, left): (usize, usize),
    (bottom, right): (usize, usize),
) -> bool {
    let Some(index) = workbook.sheet_index(sheet_id) else {
        return false;
    };
    workbook.sheets.iter().enumerate().any(|(sheet_index, sheet)| {
        sheet.cells.iter().any(|(&(r, c), cell)| {
            let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else {
                return false;
            };
            if sheet_index == index && (row, column) == (top, left) {
                return false;
            }
            let Some((formula, Ok(_))) = formula_in(cell) else {
                return false;
            };
            formula
                .references
                .iter()
                .filter(|reference| reference.sheet_id() == sheet_id)
                .filter_map(|reference| workbook.locate(reference))
                .any(|at| at.top.0 <= bottom && top <= at.bottom.0 && at.left.0 <= right && left <= at.right.0)
        })
    })
}

fn validate_source(workbook: &Workbook, spec: &Spec, table: &Json) -> Result<(), Refused> {
    if spec.columns.is_some() && spec.values.len() != 1 {
        return Err(Refused::Because("pivotTableWithColumnsTakesOneValue"));
    }
    let table_sheet = sheet(workbook, &spec.source.sheet_id).map_err(Refused::Because)?;
    let body = table["body"]
        .as_array()
        .ok_or(Refused::Because("pivotTableSourceHasNoRecords"))?;
    if body
        .iter()
        .any(|run| run["role"] == "sectionLabel" || run["role"] == "subtotal")
    {
        return Err(Refused::Because("pivotTableSourceHasSectionsOrSubtotals"));
    }
    let why = table["basis"]["whyNotRecognized"].as_str();
    if matches!(why, Some("mergedCellsAmongRecords" | "headingComesAgain")) {
        return Err(Refused::Because("pivotTableSourceRecordsNotClear"));
    }
    let records = record_runs(workbook, table_sheet, table).ok_or(Refused::Because("pivotTableSourceHasNoRecords"))?;
    if records.is_empty() {
        return Err(Refused::Because("pivotTableSourceHasNoRecords"));
    }

    let column = |id: &str| {
        workbook
            .bases
            .parse(id)
            .and_then(|c| table_sheet.columns.position(c))
            .ok_or(Refused::Because("pivotTableColumnNotOfSource"))
    };
    let values = SheetValues::of(workbook, table_sheet);
    for measure in spec.values.iter().filter(|m| m.total.needs_numbers()) {
        let c = column(&measure.column)?;
        if !records
            .iter()
            .cloned()
            .flatten()
            .any(|r| matches!(values.get(r, c), Value::Number(_)))
        {
            return Err(Refused::Because("pivotTableTotalNeedsNumbers"));
        }
    }
    for axis in spec.rows.iter().chain(&spec.columns).filter(|f| f.by.is_some()) {
        let c = column(&axis.column)?;
        let col = table_sheet.columns.line(c).unwrap();
        let has_dates = records.iter().cloned().flatten().any(|r| {
            let rows = table_sheet.rows.line(r).unwrap();
            matches!(values.get(r, c), Value::Number(_))
                && table_sheet
                    .formats
                    .get(Leaf::NumberFormat, (rows, col))
                    .and_then(|format| format["pattern"].as_str())
                    .and_then(Brought::of_pattern)
                    .or_else(|| {
                        workbook
                            .outcome(&spec.source.sheet_id, rows, col)
                            .and_then(|o| o.brought.clone())
                    })
                    .is_some_and(|b| matches!(b.kind, Kind::Date | Kind::DateAndTime))
        });
        if !has_dates {
            return Err(Refused::Because("pivotTablePeriodNeedsDates"));
        }
    }

    for filter in &spec.filters {
        match &filter.listed {
            Listed::Written { values } => {
                if values.iter().flatten().any(|v| {
                    matches!(
                        v,
                        WrittenValue::Error {
                            value: CellError::Error | CellError::Timeout | CellError::Spill
                        }
                    )
                }) {
                    return Err(Refused::Because("pivotTableFilterValueCannotBeWritten"));
                }
            }
            Listed::InACell { sheet_id, cell } => {
                let sheet = sheet(workbook, sheet_id).map_err(Refused::Because)?;
                cell_at(workbook, sheet, cell).map_err(Refused::Because)?;
            }
        }
    }
    Ok(())
}

pub(in crate::session) struct FollowUp {
    sheet_id: String,
    cell: CellIds,
    freeze: bool,
}

pub(super) fn follow_up(edit: &Edit, code: &str) -> FollowUp {
    match edit {
        Edit::InsertPivotTable {
            place: Destination::NewSheet { .. },
            ..
        } => FollowUp {
            sheet_id: format!("sht_{code}.0"),
            cell: CellIds {
                r: format!("row_{code}.0"),
                c: format!("col_{code}.0"),
            },
            freeze: true,
        },
        Edit::InsertPivotTable {
            place: Destination::Cell { sheet_id, cell },
            ..
        } => FollowUp {
            sheet_id: sheet_id.clone(),
            cell: cell.clone(),
            freeze: false,
        },
        Edit::ChangePivotTable { sheet_id, cell, .. } => FollowUp {
            sheet_id: sheet_id.clone(),
            cell: cell.clone(),
            freeze: false,
        },
    }
}

pub(super) fn follow_up_ops(workbook: &Workbook, follow: FollowUp) -> Vec<Op> {
    let mut book = workbook.clone();
    calculate(&mut book, None);
    look(&book, follow).unwrap_or_default()
}

fn look(book: &Workbook, follow: FollowUp) -> Option<Vec<Op>> {
    let sheet_id = follow.sheet_id;
    let index = book.sheet_index(&sheet_id)?;
    let sheet = &book.sheets[index];
    let (row, column) = cell_at(book, sheet, &follow.cell).ok()?;
    let r = book.bases.parse(&follow.cell.r)?;
    let c = book.bases.parse(&follow.cell.c)?;
    let spill = &book.outcome(&sheet_id, r, c)?.spill;
    let (bottom, right) = match spill {
        Some(SpillOutcome::Fills { to, .. }) => *to,
        Some(SpillOutcome::Blocked {
            would_fill_to,
            by: BlockedBy::EndOfSheet(_),
        }) => *would_fill_to,
        _ => return None,
    };
    let columns: Vec<_> = (column..=right).filter_map(|c| sheet.columns.line(c)).collect();
    let rows: Vec<_> = (row..=bottom.min(row + 1)).filter_map(|r| sheet.rows.line(r)).collect();
    let mut ops = Vec::new();
    if rows.iter().any(|&r| {
        columns
            .iter()
            .any(|&c| sheet.formats.value(Leaf::Bold, (r, c)).as_bool() != Some(true))
    }) {
        let format = Op::SetCellFormats {
            sheet_id: sheet_id.clone(),
            formats: vec![CellsToFormat {
                rows: runs_of(&rows, &book.bases),
                columns: runs_of(&columns, &book.bases),
                format: json!({"font": {"bold": true}}),
            }],
        };
        ops.push(format);
    }
    if follow.freeze {
        let last = rows.last().map(|row| book.bases.text(*row));
        ops.push(Op::SetSheetSettings {
            sheets: vec![SheetToSet {
                sheet_id: sheet_id.clone(),
                settings: SheetSettings {
                    last_frozen_row: Some(last),
                    ..SheetSettings::default()
                },
            }],
        });
    }
    let sheet = &book.sheets[index];
    let needed = fit::widths_needed_with_texts_held_to(book, sheet, &columns, 308);
    let widths = columns
        .into_iter()
        .filter_map(|col| {
            let width = *needed.get(&col)?;
            let current = sheet.column_widths.get(&col).copied().unwrap_or(fit::DEFAULT_WIDTH);
            let needed = (width > current).then_some(width)?;
            let columns = runs_of(&[col], &book.bases).pop()?;
            Some(ColumnsToSize {
                columns,
                width_in_pixels: Some(needed),
            })
        })
        .collect::<Vec<_>>();
    if !widths.is_empty() {
        ops.push(Op::SetColumnWidths { sheet_id, widths });
    }
    Some(ops)
}
