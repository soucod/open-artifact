//! The ids an edit of the page's brings into the workbook, and whether they are well formed: an edit
//! queued (`queueEdit`), taking others back (`queueEditsThatTakeBack`) or taking a step back (`queueNextUndo`,
//! `queueNextRedo`) that names one not well formed is refused (`idNotWellFormed`), whatever else is wrong with it.
//!
//! An id is `<kind>_<code>.<n>`: a kind of three letters as below, a code of 8 to 16 small letters and digits, and
//! a number of at most 4294967295 written with no 0 before it. The base of rows or columns inserted is
//! `row_<code>` or `col_<code>`. Checked: the ids of sheets inserted, of the rows and columns inserted, of the
//! objects set (dropdowns and their options, row and column groups, conditional formats, views and their elements,
//! placements, cell tables), deleting them included, and what a cell's input names (its option, the sheets, rows
//! and columns its formula reads) and a widget's input range. Not checked: the ids of what an operation acts on
//! (its sheet, its cells, what it goes after), nor the rows and columns that groups, placements, merged ranges,
//! conditional formats and tables are on, nor the view a placement shows. The workbook loaded and others' edits are
//! not checked either.

use crate::formula::Reference;
use crate::workbook::load::Op;
use crate::workbook::objects::RangeOnASheet;
use crate::workbook::Input;

/// Whether every id the operations bring in is well formed.
pub fn are_well_formed(ops: &[Op]) -> bool {
    ops.iter().all(op_is_well_formed)
}

fn op_is_well_formed(op: &Op) -> bool {
    match op {
        Op::InsertSheet { sheet_id, .. } => is_id(sheet_id, "sht"),
        Op::InsertRows { rows, .. } => is_base(&rows.base, "row"),
        Op::InsertColumns { columns, .. } => is_base(&columns.base, "col"),
        Op::SetCells { cells, .. } => cells.iter().filter_map(|c| c.input.as_ref()).all(|input| match input {
            Input::DropdownOption { option_id, .. } => is_id(option_id, "opt"),
            Input::Formula { formula } => formula.references.iter().all(reference_is_well_formed),
            Input::Number { .. } | Input::Text { .. } | Input::Boolean { .. } => true,
            // A person's id is checked as typing checks it (`userIdNotWellFormed`), not here.
            Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => true,
        }),
        Op::SetDropdowns { dropdowns, .. } => dropdowns.iter().all(|d| {
            is_id(&d.dropdown_id, "ddn")
                && d.options.iter().flatten().all(|o| is_id(&o.option_id, "opt"))
        }),
        Op::SetRowGroups { groups, .. } => groups.iter().all(|g| is_id(&g.group_id, "rgr")),
        Op::SetColumnGroups { groups, .. } => groups.iter().all(|g| is_id(&g.group_id, "cgr")),
        Op::SetConditionalFormats { conditional_formats, .. } => {
            conditional_formats.iter().all(|f| is_id(&f.conditional_format_id, "cfm"))
        }
        Op::SetViews { views } => views.iter().all(|v| {
            is_id(&v.view_id, "viw")
                && v.view.iter().flat_map(|v| &v.elements).all(|element| {
                    let (element_id, _, inputs) = element.parts();
                    is_id(element_id, "vel") && inputs.iter().all(|i| range_is_well_formed(&i.range))
                })
        }),
        Op::SetPlacements { placements, .. } => placements.iter().all(|p| is_id(&p.placement_id, "plc")),
        Op::SetCellTables { cell_tables, .. } => cell_tables.iter().all(|t| is_id(&t.cell_table_id, "ctb")),
        Op::SetNamedViews { named_views, .. } => named_views.iter().all(|entry| {
            is_id(&entry.named_view_id, "nvw")
                && entry.named_view.as_ref().is_none_or(|view| is_id(&view.cell_table_id, "ctb"))
        }),
        _ => true,
    }
}

fn reference_is_well_formed(reference: &Reference) -> bool {
    let (row, column) = (|r: &str| is_id(r, "row"), |c: &str| is_id(c, "col"));
    is_id(reference.sheet_id(), "sht")
        && match reference {
            Reference::Cell { cell, .. } => row(&cell.r) && column(&cell.c),
            Reference::Range { top_left, bottom_right, .. } => {
                row(&top_left.r) && column(&top_left.c) && row(&bottom_right.r) && column(&bottom_right.c)
            }
            Reference::Columns { left, right, top, .. } => {
                column(&left.c) && column(&right.c) && top.as_ref().is_none_or(|t| row(&t.r))
            }
            Reference::Rows { top, bottom, left, .. } => {
                row(&top.r) && row(&bottom.r) && left.as_ref().is_none_or(|l| column(&l.c))
            }
        }
}

fn range_is_well_formed(range: &RangeOnASheet) -> bool {
    let (row, column) = (|r: &str| is_id(r, "row"), |c: &str| is_id(c, "col"));
    is_id(&range.sheet_id, "sht")
        && row(&range.top_left.r)
        && column(&range.top_left.c)
        && row(&range.bottom_right.r)
        && column(&range.bottom_right.c)
}

/// `<kind>_<code>.<n>`.
fn is_id(id: &str, kind: &str) -> bool {
    let Some((base, n)) = id.rsplit_once('.') else { return false };
    is_base(base, kind)
        && !n.is_empty()
        && n.bytes().all(|b| b.is_ascii_digit())
        && (n == "0" || !n.starts_with('0'))
        && n.parse::<u32>().is_ok()
}

/// `<kind>_<code>`.
fn is_base(base: &str, kind: &str) -> bool {
    base.strip_prefix(kind).and_then(|rest| rest.strip_prefix('_')).is_some_and(|code| {
        (8..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    })
}
