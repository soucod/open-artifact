//! Formats, borders and merges given to cells.
//!
//! Kinds: formatCells, setBorders, mergeCells, unmergeCells.
//!
//! Each names its cells the same way (`cells`): a sheet, its rows as runs of ids, and its columns by the two at the
//! ends (`oneColumn`, `otherColumn`). The rows are those of the runs still in the sheet, the others passed over (a run
//! may reach past the sheet's end, or name deleted rows); the columns are every one from one end to the other.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{Context, Made, Refused};
use crate::ids::{Bases, IdRun, LineId};
use crate::number_format::{NumberFormat, Room};
use crate::session::place::Place;
use crate::shown::{shown, ShownValue};
use crate::value::Value;
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{read_format, sorted_runs, write_format, CellFormats, Leaf};
use crate::workbook::layout::{CellIds, RangeIds};
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::objects::DropdownToSet;
use crate::workbook::rich::{self, Mark, Paragraph, Run};
use crate::workbook::{Input, Sheet, Workbook};

/// The most cells a control may give something to hold, those under merged ranges counted though they are given
/// nothing.
const MOST_CELLS_SET: usize = 2960;

/// The most an edit formatting cells may take, its operations written out (240 KiB).
const MOST_BYTES: usize = 245_760;

/// The sizes of font a cell may be given, in points.
const FONT_SIZES: std::ops::RangeInclusive<u64> = 6..=96;

/// Cells as an edit of formats names them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cells {
    sheet_id: String,
    rows: Vec<IdRun>,
    one_column: String,
    other_column: String,
}

/// The edges of cells a border is set on: every edge of every cell, those between the cells (both ways, or one), those
/// around them, or one side of them.
#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Edges {
    All,
    Inner,
    InnerHorizontal,
    InnerVertical,
    Outer,
    Left,
    Top,
    Right,
    Bottom,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    /// Gives the cells what the format sets, leaving the rest of their formats as they are.
    FormatCells { cells: Cells, format: Json },
    SetBorders { cells: Cells, edges: Edges, border: Json },
    MergeCells { cells: Cells },
    UnmergeCells { cells: Cells },
}

/// The edit as the session reads it, before anything else about it: an edit that is not one, names no rows (or a run
/// of none, or past the largest id), or gives a format (or a border) that does not read, is unreadable. A format
/// must set something, and so must each part of it.
pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    let (cells, readable) = match &edit {
        Edit::FormatCells { cells, format } => (cells, read_format(format).is_some_and(|leaves| !leaves.is_empty())),
        Edit::SetBorders { cells, border, .. } => (cells, border_of(border).is_some()),
        Edit::MergeCells { cells } | Edit::UnmergeCells { cells } => (cells, true),
    };
    let run = |r: &IdRun| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32;
    (readable && !cells.rows.is_empty() && cells.rows.iter().all(run)).then_some(edit)
}

impl Edit {
    /// The sheet a border is set on, in the order the person sees its rows (`seen`).
    pub fn in_seen_order(&self) -> Option<&str> {
        match self {
            Edit::SetBorders { cells, .. } => Some(&cells.sheet_id),
            _ => None,
        }
    }
}

pub fn make(workbook: &Workbook, edit: Edit, _context: &Context) -> Result<Made, Refused> {
    match edit {
        Edit::FormatCells { cells, format } => format_cells(workbook, &cells, &format),
        Edit::SetBorders { cells, edges, border } => set_borders(workbook, &cells, edges, &border),
        Edit::MergeCells { cells } => merge_cells(workbook, &cells),
        Edit::UnmergeCells { cells } => unmerge_cells(workbook, &cells),
    }
}

/// A border as a cell's edge keeps it: none, or a line of a style and a color.
fn border_of(border: &Json) -> Option<Json> {
    let mut leaves = read_format(&json!({"border": {"top": border}}))?;
    leaves.pop().map(|(_, value)| value)
}

/// The cells named, as they are in the sheet.
struct Block<'a> {
    sheet: &'a Sheet,
    /// The rows named that the sheet has, by position, in order.
    rows: Vec<usize>,
    /// The columns from one end to the other, by position.
    left: usize,
    right: usize,
}

impl Block<'_> {
    fn row(&self, position: usize) -> LineId {
        self.sheet.rows.line(position).expect("a position in the sheet")
    }

    fn column(&self, position: usize) -> LineId {
        self.sheet.columns.line(position).expect("a position in the sheet")
    }

    /// Every cell, row by row: its positions and ids.
    fn cells(&self) -> impl Iterator<Item = ((usize, usize), (LineId, LineId))> + '_ {
        self.rows.iter().flat_map(move |&r| (self.left..=self.right).map(move |c| ((r, c), (self.row(r), self.column(c)))))
    }

    /// The place it is: from its first row to its last, between its columns.
    fn place(&self) -> Place {
        Place::cells(&self.sheet.id, self.rows[0], self.left, self.rows[self.rows.len() - 1], self.right)
    }
}

/// The cells an edit names: refused when the sheet or either end of the columns is not there, or none of the rows is.
fn block<'a>(workbook: &'a Workbook, cells: &Cells) -> Result<Block<'a>, Refused> {
    let i = workbook.sheet_index(&cells.sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    let sheet = &workbook.sheets[i];
    let column = |id: &str| -> Result<usize, Refused> {
        workbook.bases.parse(id).and_then(|l| sheet.columns.position(l)).ok_or(Refused::Because("unknownColumn"))
    };
    let (one, other) = (column(&cells.one_column)?, column(&cells.other_column)?);
    let mut rows = Vec::new();
    for run in &cells.rows {
        let Some(base) = workbook.bases.find(&run.base) else { continue };
        let named = |n: u32| n >= run.first && (n as u64) < run.first as u64 + run.count as u64;
        if run.count as usize > sheet.rows.total() {
            // A run longer than the sheet: its rows are found among the sheet's.
            rows.extend((0..sheet.rows.len()).filter(|&p| {
                let l = sheet.rows.line(p).expect("a position in the sheet");
                l.base == base && named(l.n)
            }));
        } else {
            let ids = (run.first as u64..run.first as u64 + run.count as u64).map(|n| LineId { base, n: n as u32 });
            rows.extend(ids.filter_map(|l| sheet.rows.position(l)));
        }
    }
    rows.sort_unstable();
    rows.dedup();
    if rows.is_empty() {
        return Err(Refused::Because("unknownRow"));
    }
    Ok(Block { sheet, rows, left: one.min(other), right: one.max(other) })
}

/// The live boxes of the sheet's merged ranges (top, bottom, left, right), with each range as kept, in the order
/// they are kept: by their ids as text, top left row first (so `row_….13` comes before `row_….2`).
fn merged_boxes<'a>(bases: &Bases, sheet: &'a Sheet) -> Vec<((usize, usize, usize, usize), &'a RangeIds)> {
    let mut boxes: Vec<_> = sheet.merged_ranges.iter().filter_map(|range| Some((sheet.live_box(bases, range)?, range))).collect();
    boxes.sort_by(|(_, x), (_, y)| {
        let text = |r: &'a RangeIds| (r.top_left.r.as_str(), r.top_left.c.as_str(), r.bottom_right.r.as_str(), r.bottom_right.c.as_str());
        text(x).cmp(&text(y))
    });
    boxes
}

/// Whether a cell is under a merged range but not its top left cell, where the range shows its value. The boxes are
/// those read back (`layout::merged_boxes`): a range hidden by one it overlaps covers nothing here, though merging
/// and unmerging reach it.
fn is_covered(boxes: &[(usize, usize, usize, usize)], (r, c): (usize, usize)) -> bool {
    boxes.iter().any(|(t, b, l, rr)| (*t..=*b).contains(&r) && (*l..=*rr).contains(&c) && (r, c) != (*t, *l))
}

fn format_cells(workbook: &Workbook, cells: &Cells, format: &Json) -> Result<Made, Refused> {
    let block = block(workbook, cells)?;
    let sheet = block.sheet;
    let mut leaves: BTreeMap<Leaf, Json> = read_format(format).unwrap_or_default().into_iter().collect();
    if let Some(id) = leaves.get(&Leaf::CellControl).and_then(|control| control.get("dropdownId")) {
        if !sheet.dropdowns.contains_key(id.as_str().unwrap_or_default()) {
            return Err(Refused::Because("unknownDropdown"));
        }
    }
    // A pattern not printed yet and a size not allowed are refused as the formats are set, after the edit is made:
    // so not when the cells have them already, and after `editTooLarge`.
    let mut not_printed = false;
    if let Some(number_format) = leaves.get_mut(&Leaf::NumberFormat) {
        let pattern = number_format["pattern"].as_str().unwrap_or_default();
        not_printed = !NumberFormat::parse(pattern).is_ok_and(|f| f.is_printed());
        if pattern.eq_ignore_ascii_case("general") {
            *number_format = Leaf::NumberFormat.default_value();
        }
    }
    let not_allowed = leaves.get(&Leaf::FontSize).is_some_and(|size| !size.as_u64().is_some_and(|s| FONT_SIZES.contains(&s)));
    // A number format takes away the cells' checkboxes and dropdowns.
    if leaves.contains_key(&Leaf::NumberFormat)
        && !leaves.contains_key(&Leaf::CellControl)
        && block.cells().any(|(_, at)| sheet.formats.get(Leaf::CellControl, at).is_some())
    {
        leaves.insert(Leaf::CellControl, Leaf::CellControl.default_value());
    }
    let mut ops = Vec::new();
    let changes = block.cells().any(|(_, at)| leaves.iter().any(|(leaf, value)| sheet.formats.value(*leaf, at) != *value));
    if changes {
        let mut rows: Vec<LineId> = block.rows.iter().map(|&p| block.row(p)).collect();
        let mut columns: Vec<LineId> = (block.left..=block.right).map(|p| block.column(p)).collect();
        let mut written = write_format(&leaves);
        // The wrapping is sent as the page wrote it (by name or as a boolean), though it is kept as one of three.
        if let (Some(wrap), Some(alignment)) = (format.pointer("/alignment/wrap"), written.get_mut("alignment")) {
            alignment["wrap"] = wrap.clone();
        }
        let format = CellsToFormat {
            rows: sorted_runs(&workbook.bases, &mut rows),
            columns: sorted_runs(&workbook.bases, &mut columns),
            format: written,
        };
        ops.push(Op::SetCellFormats { sheet_id: sheet.id.clone(), formats: vec![format] });
    }
    // Text with looks loses the marks the font sets (`without_marks`), then a control gives the cells what it gives.
    let mut inputs: BTreeMap<(usize, usize), CellToSet> = rich_inputs(workbook, &block, &leaves);
    let mut unused: Vec<&String> = Vec::new();
    if let Some(control) = leaves.get(&Leaf::CellControl) {
        let mut formats = sheet.formats.clone();
        for (_, at) in block.cells() {
            for (leaf, value) in &leaves {
                formats.set(*leaf, at, value.clone());
            }
        }
        // Dropdowns no cell shows any more are taken away, when the formats change.
        if changes {
            unused = sheet.dropdowns.values().map(|(id, _)| id).filter(|id| !formats.uses_dropdown(id)).collect();
        }
        if !unused.is_empty() {
            let dropdowns = unused.iter().map(|&id| DropdownToSet { dropdown_id: id.clone(), options: None }).collect();
            ops.push(Op::SetDropdowns { sheet_id: sheet.id.clone(), dropdowns });
        }
        // A checkbox is given to what the cells hold whether or not they had it; the others only when the formats change.
        let (controlled, given) = match changes || control["kind"] == "checkbox" {
            true => inputs_under_control(workbook, &block, control, &formats),
            false => (Vec::new(), 0),
        };
        if given > MOST_CELLS_SET {
            return Err(Refused::Because("editTooLarge"));
        }
        inputs.extend(controlled);
    }
    if !inputs.is_empty() {
        ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells: inputs.into_values().collect(), form: CellForm::List });
    }
    // No formatting of cells is sent in parts: too large to send whole, it is refused.
    if serde_json::to_string(&ops).map_or(0, |text| text.len()) > MOST_BYTES {
        return Err(Refused::Because("editTooLarge"));
    }
    if changes && not_printed {
        return Err(Refused::Because("numberFormatNotPrintedYet"));
    }
    if changes && not_allowed {
        return Err(Refused::Because("fontSizeNotAllowed"));
    }
    if !unused.iter().all(|id| is_well_formed_id(id, "ddn")) {
        return Err(Refused::Because("idNotWellFormed"));
    }
    // Formats unchanged, the place is where the cells were set.
    Ok(Made { ops, place: changes.then(|| block.place()) })
}

/// What the cells hold once they have a control: a checkbox holds a boolean (a formula stays), a dropdown one of its
/// options (the one labelled as the cell shows, whatever its case, else nothing; a formula is taken away), and no
/// control no option (an option becomes the label of the sheet's option of its id, whichever dropdown has it; one no
/// dropdown of the sheet has stays as it is). Cells under a merged range are left as they are; so are those
/// that hold what they would, and those that had the dropdown already. With them, how many cells are given something,
/// counting those under a merged range (what `editTooLarge` counts).
fn inputs_under_control(
    workbook: &Workbook,
    block: &Block,
    control: &Json,
    formats: &CellFormats,
) -> (Vec<((usize, usize), CellToSet)>, usize) {
    let sheet = block.sheet;
    let boxes = crate::workbook::layout::merged_boxes(&workbook.bases, sheet);
    let locale = crate::locale::find(&workbook.locale).unwrap_or_else(crate::locale::en_us);
    let options = control["dropdownId"].as_str().and_then(|id| sheet.dropdowns.get(id)).map(|(_, options)| options);
    let mut out = Vec::new();
    let mut given = 0;
    for (position, at) in block.cells() {
        if control["kind"] == "dropdown" && sheet.formats.value(Leaf::CellControl, at) == *control {
            continue;
        }
        let input = sheet.cells.get(&at).map(|cell| &cell.input);
        let new = match (control["kind"].as_str(), input) {
            (Some("checkbox"), Some(Input::Boolean { .. } | Input::Formula { .. })) => continue,
            (Some("checkbox"), _) => Some(Input::Boolean { value: false }),
            (Some("dropdown"), None) => continue,
            (Some("dropdown"), Some(Input::Formula { .. })) => None,
            (Some("dropdown"), Some(input)) => {
                let value = match input {
                    Input::Number { value } => Value::Number(*value),
                    Input::Text { value } => Value::Text(value.as_str().into()),
                    Input::Boolean { value } => Value::Boolean(*value),
                    Input::DropdownOption { option_id, label } => {
                        Value::Text(sheet.dropdown_option(option_id).map_or(label, |o| &o.label).as_str().into())
                    }
                    Input::Formula { .. } => unreachable!("a formula is taken away"),
                    Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                        Value::Text(input.reads_as_text().unwrap_or_default().into())
                    }
                };
                let pattern = formats.get(Leaf::NumberFormat, at).and_then(|f| f["pattern"].as_str());
                let text = match shown(&value, pattern, Room::AsText, locale) {
                    Ok(ShownValue::Text { text, .. }) => Some(text.to_lowercase()),
                    _ => None,
                };
                let option = options.into_iter().flatten().find(|o| Some(o.label.to_lowercase()) == text);
                option.map(|o| Input::DropdownOption { option_id: o.option_id.clone(), label: o.label.clone() })
            }
            (_, Some(Input::DropdownOption { option_id, .. })) => match sheet.dropdown_option(option_id) {
                Some(option) => Some(Input::Text { value: option.label.clone() }),
                None => continue,
            },
            _ => continue,
        };
        if new.as_ref() == input {
            continue;
        }
        given += usize::from(new.is_some());
        if !is_covered(&boxes, position) {
            let (r, c) = at;
            out.push((position, CellToSet { r: workbook.bases.text(r), c: workbook.bases.text(c), input: new }));
        }
    }
    (out, given)
}

/// What the cells holding text with looks hold once the font sets some of its marks (bold, italic, underline or
/// strikethrough, whatever it sets them to): each run loses them. Cells under a merged range are left as they are,
/// and so are those whose runs have none of them. By position, so that a control's inputs take their place.
fn rich_inputs(
    workbook: &Workbook,
    block: &Block,
    leaves: &BTreeMap<Leaf, Json>,
) -> BTreeMap<(usize, usize), CellToSet> {
    let marks: Vec<Mark> = Mark::ALL.into_iter().filter(|mark| leaves.contains_key(&Leaf::of_mark(*mark))).collect();
    let mut out = BTreeMap::new();
    if marks.is_empty() {
        return out;
    }
    let boxes = crate::workbook::layout::merged_boxes(&workbook.bases, block.sheet);
    for (position, at) in block.cells() {
        let Some(Input::RichText { paragraphs }) = block.sheet.cells.get(&at).map(|cell| &cell.input) else { continue };
        if is_covered(&boxes, position) {
            continue;
        }
        if let Some(input) = without_marks(paragraphs, &marks) {
            let (r, c) = at;
            let (r, c) = (workbook.bases.text(r), workbook.bases.text(c));
            out.insert(position, CellToSet { r, c, input: Some(input) });
        }
    }
    out
}

/// Text with looks with the marks taken off every run, put as a cell keeps it: runs next to each other that come to
/// look alike are one, and text left with nothing rich (no mark, no link, no line of a list) is plain text, its paragraphs on lines of
/// their own, as it reads (`'`, digits or `=` at its start kept as they are). `None` when no run has any of them.
fn without_marks(paragraphs: &[Paragraph], marks: &[Mark]) -> Option<Input> {
    let runs = || paragraphs.iter().flat_map(|p| &p.runs);
    if !runs().any(|run| run.marks.iter().any(|mark| marks.contains(mark))) {
        return None;
    }
    let mut out = Vec::new();
    for paragraph in paragraphs {
        let mut kept: Vec<Run> = Vec::new();
        for run in &paragraph.runs {
            let left: Vec<Mark> = run.marks.iter().copied().filter(|mark| !marks.contains(mark)).collect();
            match kept.last_mut() {
                Some(last) if last.marks == left && last.link == run.link => last.text.push_str(&run.text),
                _ => kept.push(Run { text: run.text.clone(), marks: left, link: run.link.clone() }),
            }
        }
        out.push(Paragraph { list: paragraph.list, runs: kept });
    }
    let is_rich = out.iter().flat_map(|p| &p.runs).any(|run| !run.marks.is_empty() || run.link.is_some())
        || out.iter().any(|p| p.list != rich::List::None);
    Some(match is_rich {
        true => Input::RichText { paragraphs: out },
        false => Input::Text { value: rich::plain_text(&out) },
    })
}

/// Whether an id is well formed: `<kind>_`, a code of 8 to 16 small letters and digits, `.` and a number.
fn is_well_formed_id(id: &str, kind: &str) -> bool {
    let Some(rest) = id.strip_prefix(kind).and_then(|rest| rest.strip_prefix('_')) else { return false };
    let Some((code, n)) = rest.split_once('.') else { return false };
    (8..=16).contains(&code.len())
        && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && crate::ids::split_id(&format!("x.{n}")).is_some()
}

/// The border edges an edit sets, each a leaf over rows by columns (positions).
type Part = (Vec<usize>, Vec<usize>, Leaf);

fn set_borders(workbook: &Workbook, cells: &Cells, edges: Edges, border: &Json) -> Result<Made, Refused> {
    let block = block(workbook, cells)?;
    let sheet = block.sheet;
    let border = border_of(border).expect("read as a border");
    let rows = block.rows.clone();
    let columns: Vec<usize> = (block.left..=block.right).collect();
    let (first_row, last_row) = (rows[0], rows[rows.len() - 1]);
    let all_but = |lines: &[usize], skip_first: bool| -> Vec<usize> {
        if skip_first { lines[1..].to_vec() } else { lines[..lines.len() - 1].to_vec() }
    };
    let horizontal = vec![
        (all_but(&rows, false), columns.clone(), Leaf::BorderBottom),
        (all_but(&rows, true), columns.clone(), Leaf::BorderTop),
    ];
    let vertical = vec![
        (rows.clone(), all_but(&columns, false), Leaf::BorderRight),
        (rows.clone(), all_but(&columns, true), Leaf::BorderLeft),
    ];
    let side = |leaf: Leaf| -> Part {
        match leaf {
            Leaf::BorderTop => (vec![first_row], columns.clone(), leaf),
            Leaf::BorderBottom => (vec![last_row], columns.clone(), leaf),
            Leaf::BorderLeft => (rows.clone(), vec![block.left], leaf),
            _ => (rows.clone(), vec![block.right], leaf),
        }
    };
    let outer = [Leaf::BorderTop, Leaf::BorderLeft, Leaf::BorderRight, Leaf::BorderBottom];
    let mut parts: Vec<Part> = match edges {
        Edges::All => outer.iter().map(|&leaf| (rows.clone(), columns.clone(), leaf)).collect(),
        Edges::Inner => horizontal.into_iter().chain(vertical).collect(),
        Edges::InnerHorizontal => horizontal,
        Edges::InnerVertical => vertical,
        Edges::Outer => outer.iter().map(|&leaf| side(leaf)).collect(),
        Edges::Top => vec![side(Leaf::BorderTop)],
        Edges::Bottom => vec![side(Leaf::BorderBottom)],
        Edges::Left => vec![side(Leaf::BorderLeft)],
        Edges::Right => vec![side(Leaf::BorderRight)],
    };
    parts.retain(|(rows, columns, _)| !rows.is_empty() && !columns.is_empty());
    let id = |r: usize, c: usize| (block.row(r), block.column(c));
    let changes = |(rows, columns, leaf): &Part, value: &Json| {
        rows.iter().any(|&r| columns.iter().any(|&c| sheet.formats.value(*leaf, id(r, c)) != *value))
    };
    let is_changed = parts.iter().any(|part| changes(part, &border));
    // An edge set takes away the facing edge of the cell across it, when that cell is not among those named and any of
    // the cells across an edge of the kind has a line.
    let none = Leaf::BorderTop.default_value();
    let named = |r: usize| rows.binary_search(&r).is_ok();
    let mut beside: Vec<Part> = Vec::new();
    for (part_rows, part_columns, leaf) in &parts {
        let strip = match leaf {
            Leaf::BorderTop => {
                let across: Vec<usize> = part_rows.iter().filter_map(|r| r.checked_sub(1)).filter(|&r| !named(r)).collect();
                (across, part_columns.clone(), Leaf::BorderBottom)
            }
            Leaf::BorderBottom => {
                let across = part_rows.iter().map(|r| r + 1).filter(|&r| r < sheet.rows.len() && !named(r)).collect();
                (across, part_columns.clone(), Leaf::BorderTop)
            }
            Leaf::BorderLeft => {
                let across = part_columns.iter().filter_map(|c| c.checked_sub(1)).filter(|&c| c < block.left).collect();
                (part_rows.clone(), across, Leaf::BorderRight)
            }
            _ => {
                let across = part_columns.iter().map(|c| c + 1).filter(|&c| c > block.right && c < sheet.columns.len()).collect();
                (part_rows.clone(), across, Leaf::BorderLeft)
            }
        };
        if !strip.0.is_empty() && !strip.1.is_empty() && changes(&strip, &none) {
            beside.push(strip);
        }
    }
    if !is_changed && beside.is_empty() {
        return Ok(Made::nothing());
    }
    let bases = &workbook.bases;
    // Edges over the same cells go together; the blocks are in the order of where they are in the sheet: by their
    // first row, last row, first column and last column.
    let mut blocks: Vec<((usize, usize, usize, usize), Vec<IdRun>, Vec<IdRun>, BTreeMap<Leaf, Json>)> = Vec::new();
    let with_values = parts.into_iter().map(|p| (p, &border)).chain(beside.into_iter().map(|p| (p, &none)));
    for ((rows, columns, leaf), value) in with_values {
        let at = (rows[0], rows[rows.len() - 1], columns[0], columns[columns.len() - 1]);
        let mut rows: Vec<LineId> = rows.iter().map(|&r| block.row(r)).collect();
        let mut columns: Vec<LineId> = columns.iter().map(|&c| block.column(c)).collect();
        let (rows, columns) = (sorted_runs(bases, &mut rows), sorted_runs(bases, &mut columns));
        match blocks.iter_mut().find(|b| b.1 == rows && b.2 == columns) {
            Some(b) => {
                b.3.insert(leaf, value.clone());
            }
            None => blocks.push((at, rows, columns, BTreeMap::from([(leaf, value.clone())]))),
        }
    }
    blocks.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| run_order(&a.1, &b.1)).then_with(|| run_order(&a.2, &b.2)));
    let formats = blocks
        .into_iter()
        .map(|(_, rows, columns, leaves)| CellsToFormat { rows, columns, format: write_format(&leaves) })
        .collect();
    Ok(Made { ops: vec![Op::SetCellFormats { sheet_id: sheet.id.clone(), formats }], place: Some(block.place()) })
}

/// Runs in order: by their first run's base, first id and count, then the next run's.
fn run_order(a: &[IdRun], b: &[IdRun]) -> Ordering {
    let key = |r: &IdRun| (r.base.clone(), r.first, r.count);
    a.iter().map(key).cmp(b.iter().map(key))
}

/// Merges the cells, and every merged range they reach into, into one range. Only the first cell with something in
/// it keeps it, moved to the top left cell.
fn merge_cells(workbook: &Workbook, cells: &Cells) -> Result<Made, Refused> {
    let block = block(workbook, cells)?;
    let sheet = block.sheet;
    let bases = &workbook.bases;
    let boxes = merged_boxes(bases, sheet);
    let (mut top, mut bottom) = (block.rows[0], block.rows[block.rows.len() - 1]);
    let (mut left, mut right) = (block.left, block.right);
    loop {
        let before = (top, bottom, left, right);
        for ((t, b, l, r), _) in &boxes {
            if *t <= bottom && top <= *b && *l <= right && left <= *r {
                (top, bottom, left, right) = (top.min(*t), bottom.max(*b), left.min(*l), right.max(*r));
            }
        }
        if (top, bottom, left, right) == before {
            break;
        }
    }
    if (top..=bottom).any(|r| block.rows.binary_search(&r).is_err()) {
        return Err(Refused::Because("rowNotNamedInTheWay"));
    }
    if (top, left) == (bottom, right) || boxes.iter().any(|(b, _)| *b == (top, bottom, left, right)) {
        return Ok(Made::nothing());
    }
    let mut ops = Vec::new();
    let reached: Vec<_> = boxes.iter().filter(|((t, b, l, r), _)| *t <= bottom && top <= *b && *l <= right && left <= *r).collect();
    if !reached.is_empty() {
        let ranges = reached.into_iter().map(|(_, range)| (*range).clone()).collect();
        ops.push(Op::UnmergeCells { sheet_id: sheet.id.clone(), ranges });
    }
    let id = |r: usize, c: usize| (block.row(r), block.column(c));
    let set = |(r, c): (LineId, LineId), input: Option<Input>| CellToSet { r: bases.text(r), c: bases.text(c), input };
    let filled: Vec<(LineId, LineId)> =
        (top..=bottom).flat_map(|r| (left..=right).map(move |c| (r, c))).map(|(r, c)| id(r, c)).filter(|at| sheet.cells.contains_key(at)).collect();
    let mut broken = false;
    if let Some(&kept) = filled.first() {
        let top_left = id(top, left);
        let mut inputs = Vec::new();
        if kept != top_left {
            // An option moved is written by its id, which must be well formed.
            if let Input::DropdownOption { option_id, .. } = &sheet.cells[&kept].input {
                if !is_well_formed_id(option_id, "opt") {
                    return Err(Refused::Because("idNotWellFormed"));
                }
            }
            // A cell with a dropdown should hold one of its options (by id). The merge may not make more cells that
            // don't: the value moved may break the top left's dropdown only when a cell cleared broke its own.
            let breaks = |at: (LineId, LineId), input: &Input| {
                let control = sheet.formats.value(Leaf::CellControl, at);
                let options = control["dropdownId"].as_str().and_then(|id| sheet.dropdowns.get(id)).map(|(_, options)| options);
                control["kind"] == "dropdown"
                    && !matches!(input, Input::DropdownOption { option_id, .. }
                        if options.is_some_and(|o| o.iter().any(|o| o.option_id == *option_id)))
            };
            broken = breaks(top_left, &sheet.cells[&kept].input) && !filled.iter().any(|&at| breaks(at, &sheet.cells[&at].input));
            inputs.push(set(kept, None));
            inputs.push(set(top_left, Some(sheet.cells[&kept].input.clone())));
        }
        inputs.extend(filled[1..].iter().map(|&at| set(at, None)));
        if !inputs.is_empty() {
            ops.push(Op::SetCells { sheet_id: sheet.id.clone(), cells: inputs, form: CellForm::List });
        }
    }
    let corner = |(r, c): (LineId, LineId)| CellIds { r: bases.text(r), c: bases.text(c) };
    let range = RangeIds { top_left: corner(id(top, left)), bottom_right: corner(id(bottom, right)) };
    ops.push(Op::MergeCells { sheet_id: sheet.id.clone(), ranges: vec![range] });
    // This is found once the operations are applied, and they are taken back.
    if broken {
        return Err(Refused::Tried("cellOfDropdownHoldsNoOption", ops));
    }
    Ok(Made::ops(ops))
}

/// Unmerges every merged range with a cell among those named.
fn unmerge_cells(workbook: &Workbook, cells: &Cells) -> Result<Made, Refused> {
    let block = block(workbook, cells)?;
    let reached: Vec<_> = merged_boxes(&workbook.bases, block.sheet)
        .into_iter()
        .filter(|((t, b, l, r), _)| *l <= block.right && block.left <= *r && block.rows.iter().any(|p| (*t..=*b).contains(p)))
        .collect();
    if reached.is_empty() {
        return Ok(Made::nothing());
    }
    let ranges = reached.into_iter().map(|(_, range)| range.clone()).collect();
    Ok(Made::ops(vec![Op::UnmergeCells { sheet_id: block.sheet.id.clone(), ranges }]))
}

