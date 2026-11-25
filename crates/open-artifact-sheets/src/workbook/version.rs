//! Format versions: which version of the operations' format an edit is written in. Every recorded edit carries the
//! version it needs (`v`), the newest of its operations' (a feature's operations are first readable in the version
//! that brought it); an edit streamed from the server must carry exactly that one, and a load page one the module
//! still reads.

use super::formats::Leaf;
use super::load::Op;
use super::Input;
use crate::formula::Reference;

/// The first version, and the oldest still read.
pub const OLDEST: u32 = 17;
/// The newest version.
pub const NEWEST: u32 = 47;

/// Whether the module reads a released version.
pub fn is_known(v: u32) -> bool {
    matches!(v, 17 | 20..=30 | 32..=34 | 36..=39 | 42..=47)
}

/// The version an edit of these operations is written in.
pub fn of_ops(ops: &[Op]) -> u32 {
    ops.iter().map(of_op).max().unwrap_or(OLDEST)
}

/// A streamed grid declares its needed reader by the form it actually uses, even if this writer would choose
/// another form for the same cells.
pub fn of_wire_ops(ops: &[Op], written: &[serde_json::Value]) -> u32 {
    ops.iter().zip(written).map(|(op, written)| {
        if let Some(grid) = written.get("grid").filter(|_| matches!(op, Op::SetCells { .. })) {
            if grid.get("formulas").is_some() { 46 } else { 39 }
        } else if let Op::SetCellFormats { formats, .. } = op {
            // Rows as lists of runs need 43, however many; rows not so, what the formats need.
            let listed = |rows: &serde_json::Value| rows.as_array().is_some_and(|r| r.iter().any(|run| run.get("runs").is_some()));
            let lists = written["formats"].as_array().is_some_and(|f| f.iter().any(|f| listed(&f["rows"])));
            let plain: Vec<_> = formats.iter().map(|f| super::load::CellsToFormat { rows: Vec::new(), ..f.clone() }).collect();
            of_op(&Op::SetCellFormats { sheet_id: String::new(), formats: plain }).max(if lists { 43 } else { OLDEST })
        } else {
            of_op(op)
        }
    }).max().unwrap_or(OLDEST)
}

fn of_op(op: &Op) -> u32 {
    match op {
        // Cells written as a grid came in 39.
        Op::SetCells { sheet_id, cells, form } if super::grid::is_grid(sheet_id, cells, *form) => {
            if super::grid::uses_formula_dictionary(cells) { 46 } else { 39 }
        }
        Op::SetCells { cells, .. } => cells.iter().filter_map(|c| c.input.as_ref()).map(of_input).max().unwrap_or(OLDEST),
        // Rows to format written as lists of runs came in 43.
        Op::SetCellFormats { formats, .. } if formats.iter().any(|f| f.rows.len() >= crate::ids::listed_runs::FEWEST) => 43,
        // Rows deleted or undeleted as lists of runs (read so, or written so from 100 runs on).
        Op::DeleteRows { rows, .. } | Op::UndeleteRows { rows, .. } if rows.listed => 43,
        // Text's wrapping written by name came in 44.
        Op::SetCellFormats { formats, .. } if formats.iter().any(|f| f.format.pointer("/alignment/wrap").is_some_and(|w| w.is_string())) => 44,
        Op::SetCellFormats { formats, .. } => formats
            .iter()
            .flat_map(|f| super::formats::read_format(&f.format).unwrap_or_default())
            .map(|(leaf, value)| match leaf {
                Leaf::CellControl if value.get("kind").and_then(|k| k.as_str()) == Some("checkbox") => 21,
                Leaf::Vertical | Leaf::Wrap => 23,
                _ => OLDEST,
            })
            .max()
            .unwrap_or(OLDEST),
        Op::SetSheetSettings { sheets } => sheets
            .iter()
            .map(|s| {
                if s.settings.interactive.is_some() { 47 }
                else if s.settings.are_gridlines_hidden.is_some() { 29 }
                else { 20 }
            })
            .max()
            .unwrap_or(20),
        Op::Reseed { .. } => 24,
        Op::SetTimeZone { .. } | Op::AdoptTimeZone { .. } => 25,
        Op::MoveSheets { .. } => 26,
        Op::SetRowGroups { .. } | Op::SetColumnGroups { .. } => 27,
        Op::SetConditionalFormats { .. } => 28,
        // A placement set off from its anchor cell came in 33.
        Op::SetPlacements { placements, .. }
            if placements.iter().flat_map(|p| &p.placement).any(|p| p.offset_from_anchor_cell.is_some()) =>
        {
            33
        }
        Op::SetViews { views }
            if views.iter().filter_map(|entry| entry.view.as_ref()).any(super::objects::View::is_interactive) => 47,
        Op::SetViews { .. } | Op::SetPlacements { .. } => 30,
        Op::SetLocale { .. } => 32,
        Op::SetCellTables { .. } => 36,
        Op::ReorderRows { .. } => 42,
        Op::SetNamedViews { .. } => 45,
        _ => OLDEST,
    }
}

fn of_input(input: &Input) -> u32 {
    match input {
        Input::Formula { formula } => formula
            .references
            .iter()
            .map(|r| match r {
                Reference::Columns { .. } | Reference::Rows { .. } => 34,
                _ => OLDEST,
            })
            .max()
            .unwrap_or(OLDEST),
        Input::Users { .. } => 22,
        // Lines of lists came in 38.
        Input::RichText { paragraphs } if paragraphs.iter().any(|p| p.list != super::rich::List::None) => 38,
        Input::RichText { .. } => 37,
        _ => OLDEST,
    }
}
