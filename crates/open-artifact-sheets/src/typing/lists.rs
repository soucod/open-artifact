//! A checkbox line of a cell's list ticked or unticked (`setListLineChecked`): the cell's text with looks, its
//! paragraph at the index given (from 0) a checkbox line set to `isChecked`.
//!
//! A paragraph that is no checkbox line, past the last one, of a cell holding no text with looks or of an empty cell,
//! or a checkbox already as asked changes nothing. A negative index, `isChecked` not a boolean or a field more or
//! less refuses the edit (`unreadableRequest`); an unknown sheet, row or column as for any cell.

use serde::Deserialize;
use serde_json::Value;

use super::{cell_of, CellAt};
use crate::workbook::grid::CellForm;
use crate::workbook::load::{CellToSet, Op, Refusal};
use crate::workbook::rich::List;
use crate::workbook::{Input, Workbook};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum ListEdit {
    #[serde(rename_all = "camelCase")]
    SetListLineChecked { sheet_id: String, cell: CellAt, paragraph: u32, is_checked: bool },
}

/// Whether a `setListLineChecked` edit reads.
pub fn reads(edit: &Value) -> bool {
    ListEdit::deserialize(edit).is_ok()
}

/// The operations of a `setListLineChecked` edit, or the refusal.
pub fn set_list_line_checked(workbook: &Workbook, edit: &Value) -> Result<Vec<Op>, Refusal> {
    let ListEdit::SetListLineChecked { sheet_id, cell, paragraph, is_checked } =
        ListEdit::deserialize(edit).map_err(|_| Refusal::UnreadableRequest)?;
    let s = workbook.sheet_index(&sheet_id).ok_or(Refusal::UnknownSheet)?;
    let sheet = &workbook.sheets[s];
    let (place, _) = cell_of(workbook, sheet, &cell.r, &cell.c)?;
    let Some(Input::RichText { paragraphs }) = sheet.cells.get(&place).map(|cell| &cell.input) else {
        return Ok(Vec::new());
    };
    let mut paragraphs = paragraphs.clone();
    let Some(line) = paragraphs.get_mut(paragraph as usize) else { return Ok(Vec::new()) };
    match &mut line.list {
        List::Checkbox { is_checked: now, .. } if *now != is_checked => *now = is_checked,
        _ => return Ok(Vec::new()),
    }
    let cells = vec![CellToSet {
        r: workbook.bases.text(place.0),
        c: workbook.bases.text(place.1),
        input: Some(Input::RichText { paragraphs }),
    }];
    Ok(vec![Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto }])
}
