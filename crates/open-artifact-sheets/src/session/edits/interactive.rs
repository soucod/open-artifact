use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value as Json;

use super::{Made, Refused};
use crate::session::interactive::{reset_changes, with_current_defaults, Binding};
use crate::workbook::grid::CellForm;
use crate::workbook::layout::written;
use crate::workbook::load::{CellToSet, Op};
use crate::workbook::objects::{InteractiveCell, InteractiveValue, View, ViewElement, ViewToSet};
use crate::workbook::Workbook;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    WriteFromInteractive { view_id: String, cells: Vec<CellWrite> },
    #[serde(rename_all = "camelCase")]
    ResetInteractive { view_id: String },
    #[serde(rename_all = "camelCase")]
    SaveDefaultsOfInteractive { view_id: String },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellWrite {
    input: String,
    row: usize,
    column: usize,
    #[serde(deserialize_with = "written::maybe_null")]
    value: Option<InteractiveValue>,
}

pub fn read(edit: &Json) -> Option<Edit> {
    serde_json::from_value(edit.clone()).ok()
}

/// Edits that change a sheet's grid are refused while it displays an interactive.
pub(super) fn check_grid_edits(workbook: &Workbook, ops: &[Op]) -> Result<(), Refused> {
    for op in ops {
        let sheet_id = match op {
            Op::SetCells { sheet_id, .. }
            | Op::SetCellFormats { sheet_id, .. }
            | Op::MergeCells { sheet_id, .. }
            | Op::UnmergeCells { sheet_id, .. }
            | Op::SetColumnWidths { sheet_id, .. }
            | Op::SetRowHeights { sheet_id, .. }
            | Op::InsertRows { sheet_id, .. }
            | Op::InsertColumns { sheet_id, .. }
            | Op::DeleteRows { sheet_id, .. }
            | Op::DeleteColumns { sheet_id, .. }
            | Op::MoveRows { sheet_id, .. }
            | Op::ReorderRows { sheet_id, .. }
            | Op::MoveColumns { sheet_id, .. }
            | Op::SetRowGroups { sheet_id, .. }
            | Op::SetColumnGroups { sheet_id, .. }
            | Op::SetCellTables { sheet_id, .. } => sheet_id,
            _ => continue,
        };
        if workbook
            .sheet_index(sheet_id)
            .is_some_and(|i| workbook.sheets[i].interactive.is_some())
        {
            return Err(Refused::Because("sheetIsAnInteractive"));
        }
    }
    Ok(())
}

fn get_view<'a>(workbook: &'a Workbook, id: &str) -> Result<&'a View, Refused> {
    workbook
        .views
        .get(id)
        .map(|(_, view)| view)
        .filter(|view| {
            view.is_interactive()
                && workbook
                    .sheets
                    .iter()
                    .any(|sheet| sheet.interactive.as_deref() == Some(id))
        })
        .ok_or(Refused::Because("unknownInteractive"))
}

fn write_cells(workbook: &Workbook, view: &View, writes: Vec<CellWrite>) -> Result<Vec<CellChange>, Refused> {
    writes
        .into_iter()
        .map(|asked| {
            let (binding, at, value) = view
                .elements
                .iter()
                .find_map(|element| {
                    let ViewElement::Interactive { inputs, writes, .. } = element else {
                        return None;
                    };
                    let input = writes.iter().find(|write| write.input == asked.input)?;
                    let range = &inputs.iter().find(|input| input.name == asked.input)?.range;
                    let binding = Binding::new(workbook, range)?;
                    let at = binding.at_offset(asked.row, asked.column)?;
                    (!binding.is_covered(at) && input
                        .saved
                        .iter()
                        .any(|cell| binding.position(&cell.r, &cell.c) == Some(at)))
                        .then_some((binding, at, asked.value.clone()))
                })
                .ok_or(Refused::Because("cellIsNotTheInteractives"))?;
            let mut cell = binding
                .read(at)
                .map_err(|_| Refused::Because("cellHoldsMoreThanAValue"))?;
            cell.value = value
                .filter(|v| !matches!(v, InteractiveValue::Text { value } if value.is_empty()));
            if !binding.fits(at, cell.value.as_ref()) {
                return Err(Refused::Because("valueDoesNotFitCell"));
            }
            if matches!(&cell.value, Some(InteractiveValue::Text { value }) if value.len() > crate::typing::LONGEST_TEXT) {
                return Err(Refused::Because("textTooLong"));
            }
            Ok((binding.sheet, at, cell))
        })
        .collect()
}

type CellChange = (usize, (usize, usize), InteractiveCell);

fn make_changes(workbook: &Workbook, changes: Vec<CellChange>) -> Made {
    let mut by_sheet = BTreeMap::<_, BTreeMap<_, _>>::new();
    for (sheet, at, cell) in changes {
        by_sheet.entry(sheet).or_default().insert(at, cell);
    }
    let ops = by_sheet
        .into_iter()
        .filter_map(|(s, changes)| {
            let sheet = &workbook.sheets[s];
            let cells = changes
                .into_iter()
                .filter_map(|((r, c), cell)| {
                    let held = sheet
                        .rows
                        .line(r)
                        .zip(sheet.columns.line(c))
                        .and_then(|key| sheet.cells.get(&key));
                    let input = cell.value.and_then(InteractiveValue::into_input);
                    (held.map(|cell| &cell.input) != input.as_ref()).then_some(CellToSet {
                        r: cell.r,
                        c: cell.c,
                        input,
                    })
                })
                .collect::<Vec<_>>();
            (!cells.is_empty()).then_some(Op::SetCells {
                sheet_id: sheet.id.clone(),
                cells,
                form: CellForm::List,
            })
        })
        .collect();
    Made::ops(ops)
}

pub fn make(workbook: &Workbook, edit: Edit) -> Result<Made, Refused> {
    let out = match edit {
        Edit::WriteFromInteractive { view_id, cells } => {
            make_changes(workbook, write_cells(workbook, get_view(workbook, &view_id)?, cells)?)
        }
        Edit::ResetInteractive { view_id } => {
            make_changes(workbook, reset_changes(workbook, get_view(workbook, &view_id)?))
        }
        Edit::SaveDefaultsOfInteractive { view_id } => {
            let before = get_view(workbook, &view_id)?;
            let view =
                with_current_defaults(workbook, before).map_err(|_| Refused::Because("interactiveSavesTooMuch"))?;
            if view == *before {
                Made::nothing()
            } else {
                Made::ops(vec![Op::SetViews {
                    views: vec![ViewToSet {
                        view_id,
                        view: Some(view),
                    }],
                }])
            }
        }
    };
    Ok(out)
}
