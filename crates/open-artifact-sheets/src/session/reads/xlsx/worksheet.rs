//! A sheet as a part of the file (`xl/worksheets/sheetN.xml`): how it is shown (gridlines, frozen panes), its
//! columns' and rows' sizes, looks and outline (groups), its cells, merged ranges and dropdowns.
//!
//! A cell is written when it holds something or looks other than its column. A column has a look of its own (`style`)
//! made of what more than half its rows have, leaf by leaf of their formats (bold in 600 of 1,000 rows and italic in
//! 300 of them make a bold column), when that is not the plain look; its other cells are then written even when they
//! hold nothing. A row's look is not written: its cells carry it. A row is written when it holds a cell to write,
//! has a height of its own or is in the outline.
//!
//! The file writes at most 500,000 blank cells and rows that hold nothing, over all its sheets
//! (`looksOfSomeBlankCells`): past that, a blank cell that only looks some way is left out, and so is a row with
//! nothing in it.
//!
//! A text with looks is written with its runs when one of them is marked, each run's font its cell's with the run's
//! marks on it; its link is the cell's (`<hyperlink>`), the first of them when its runs do not all have the same one
//! (`linksOfPartsOfTexts`). A link Excel would not take is left out (`linksOfSomeCells`, see `is_link_taken`), and so
//! is every one past 65,530 on a sheet. A person is written as their label (`users`).

use std::collections::{BTreeMap, BTreeSet};
use hashbrown::{HashMap, HashSet};
use std::fmt::Write;

use super::formula;
use super::styles::{height, width, Look, StandardColors, Styles};
use super::xml::{attribute, number, text, text_element, SharedStrings, DECLARATION};
use super::{Flags, RELATIONSHIP};
use crate::brought::Brought;
use crate::calculate::SpillOutcome;
use crate::formula::column_letters;
use crate::ids::{Axis, LineId};
use crate::value::{CellError, Value};
use crate::workbook::formats::Leaf;
use crate::session::edits::lines::fit;
use crate::workbook::layout::{groups_contents, merged_boxes, merged_contents};
use crate::workbook::rich::{self, Mark, Paragraph};
use crate::workbook::{Input, Sheet, Workbook};

/// What the file is written with.
pub struct Writing<'a> {
    pub workbook: &'a Workbook,
    /// The sheets' names in the file, in the workbook's order.
    pub names: &'a [String],
    pub colors: &'a StandardColors,
    pub styles: Styles,
    pub strings: SharedStrings,
    pub flags: Flags,
    /// The blank cells and rows that hold nothing the file may still write.
    pub budget: u64,
    /// The links of each sheet that has some (`xl/worksheets/_rels/sheetN.xml.rels`), by the sheet's number.
    pub sheet_links: Vec<(usize, String)>,
    /// The number of each sheet's drawing, when it has charts, by the sheet's index.
    pub drawings: Vec<Option<usize>>,
}

/// The blank cells and rows that hold nothing a file writes at most.
pub const BUDGET: u64 = 500_000;

/// The links a sheet writes at most.
const LINKS: usize = 65_530;

/// A dropdown's list in the sheet of options: the cells it is offered in, and where its options are.
pub struct Validation {
    pub sqref: String,
    pub formula: String,
}

/// What a cell holds, as the file writes it.
enum Content {
    Number(f64),
    /// A text the cells share.
    Text(String),
    /// A text with looks the cells share, as its runs are written.
    Runs(String),
    /// A text an array spills, written in the cell.
    SpilledText(String),
    Boolean(bool),
    Error(CellError),
    Formula { text: String, array: Option<String>, value: Value },
}

/// A line's place in the outline: how deep it is in groups, whether a collapsed group hides it, whether one ends
/// just before it, and which groups it is in (as one number: columns in different groups are written apart).
#[derive(Clone, Copy, Default, PartialEq)]
struct Outline {
    level: usize,
    hidden: bool,
    after_collapsed: bool,
    groups: u64,
}

type Groups = BTreeMap<crate::workbook::layout::IdKey, (String, crate::workbook::layout::Group)>;

fn outline(workbook: &Workbook, axis: &Axis, groups: &Groups) -> Vec<Outline> {
    let mut out = vec![Outline::default(); axis.len()];
    for (i, g) in groups_contents(&workbook.bases, axis, groups).into_iter().enumerate() {
        // splitmix64 of the group's place: a sum of them tells sets of groups apart.
        let mut mark = (i as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        mark = (mark ^ (mark >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        mark = (mark ^ (mark >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        mark ^= mark >> 31;
        let position = |key: &str| {
            let id = g["ends"][key].as_str().and_then(|t| workbook.bases.parse(t))?;
            axis.position(id)
        };
        let (Some(first), Some(last)) = (position("first"), position("last")) else { continue };
        let depth = g["depth"].as_u64().unwrap_or(1) as usize;
        let collapsed = g["isCollapsed"].as_bool().unwrap_or(false);
        for o in &mut out[first..=last] {
            o.level = o.level.max(depth);
            o.hidden |= collapsed;
            o.groups = o.groups.wrapping_add(mark);
        }
        if collapsed && last + 1 < out.len() {
            out[last + 1].after_collapsed = true;
        }
    }
    out
}

/// The rows with a height of their own too short for a wrapped text in them: the file leaves their height out, and
/// Excel fits them to their text. The text measured is what the cell holds, as it reads: a formula's text when it
/// spills nothing, a dropdown option's label, people's labels, a text with looks without them; a cell merged with
/// others or in a hidden column is not measured. See `fit::wrapped_height`.
fn too_short(workbook: &Workbook, sheet: &Sheet, heights: &HashMap<usize, u32>, columns: &[Outline])
    -> HashSet<usize> {
    let merged = merged_boxes(&workbook.bases, sheet);
    let mut out = HashSet::new();
    for (&(r, c), cell) in &sheet.cells {
        let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
        let Some(&px) = heights.get(&row) else { continue };
        let is_wrapped = sheet.formats.value(Leaf::Wrap, (r, c)).as_bool() == Some(true);
        if out.contains(&row) || columns[column].hidden || !is_wrapped {
            continue;
        }
        if merged.iter().any(|&(t, b, l, right)| (t..=b).contains(&row) && (l..=right).contains(&column)) {
            continue;
        }
        let width = sheet.column_widths.get(&c).copied().unwrap_or(fit::DEFAULT_WIDTH);
        let text = match &cell.input {
            Input::Text { value } => value.clone(),
            Input::DropdownOption { option_id, label } => {
                sheet.dropdown_option(option_id).map_or(label, |o| &o.label).clone()
            }
            Input::Formula { .. } => match workbook.outcome(&sheet.id, r, c) {
                Some(o) if !matches!(o.spill, Some(SpillOutcome::Fills { .. })) => match &o.value {
                    Value::Text(t) => t.to_string(),
                    _ => continue,
                },
                _ => continue,
            },
            input => match input.reads_as_text() {
                Some(t) => t,
                None => continue,
            },
        };
        if fit::wrapped_height(sheet, (r, c), &text, width).is_some_and(|h| h > px as f64) {
            out.insert(row);
        }
    }
    out
}

/// A cell's address: `B3`.
pub fn address(row: usize, column: usize) -> String {
    format!("{}{}", column_letters(column), row + 1)
}

impl Writing<'_> {
    /// The part of the sheet at `index` in the workbook.
    pub fn sheet(&mut self, index: usize, is_first: bool, validations: &[Validation]) -> String {
        let workbook = self.workbook;
        let sheet = &workbook.sheets[index];
        let mut out = String::from(DECLARATION);
        out.push_str("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
        // Where the links' namespace goes, when the sheet has some.
        let root_end = out.len() - 1;
        out.push_str(&sheet_views(sheet, is_first));
        let rows = outline(workbook, &sheet.rows, &sheet.row_groups);
        let columns = outline(workbook, &sheet.columns, &sheet.column_groups);
        let deepest = |o: &[Outline]| o.iter().map(|o| o.level).max().unwrap_or(0);
        out.push_str("<sheetFormatPr defaultColWidth=\"14.857142857142858\" defaultRowHeight=\"12.75\"");
        if deepest(&rows) > 0 {
            let _ = write!(out, " outlineLevelRow=\"{}\"", deepest(&rows));
        }
        if deepest(&columns) > 0 {
            let _ = write!(out, " outlineLevelCol=\"{}\"", deepest(&columns));
        }
        out.push_str("/>");

        // The looks of the cells that have a format, by position.
        let mut looks: BTreeMap<(usize, usize), Look> = BTreeMap::new();
        let mut formatted: BTreeSet<(LineId, LineId)> = BTreeSet::new();
        for (leaf, at, value) in sheet.formats.iter() {
            // A checkbox left on a deleted row or column is not one.
            let is_live = sheet.rows.position(at.0).is_some() && sheet.columns.position(at.1).is_some();
            if leaf == Leaf::CellControl && value.get("kind").and_then(|k| k.as_str()) == Some("checkbox") && is_live {
                self.flags.checkboxes = true;
            }
            formatted.insert(at);
        }
        for &(r, c) in &formatted {
            let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
            let look = Look::of(sheet, (r, c), self.colors);
            if !look.is_default() {
                looks.insert((row, column), look);
            }
        }
        // A formula's number without a number format of its own is written in the one its formula brings: a look
        // numbered when its cell is written, and no column's.
        // So is each number an array spills that brings one.
        let mut brought_looks: Vec<((usize, usize), Look)> = Vec::new();
        let mut bring = |(row, column): (usize, usize), value: &Value, brought: Option<&Brought>| {
            let (Some(r), Some(c), Some(brought)) = (sheet.rows.line(row), sheet.columns.line(column), brought) else {
                return;
            };
            if matches!(value, Value::Number(_)) && sheet.formats.get(Leaf::NumberFormat, (r, c)).is_none() {
                brought_looks.push(((row, column), Look::of(sheet, (r, c), self.colors).bringing(&brought.pattern)));
            }
        };
        for (&(r, c), cell) in &sheet.cells {
            if !matches!(cell.input, Input::Formula { .. }) {
                continue;
            }
            let Some(outcome) = workbook.outcome(&sheet.id, r, c) else { continue };
            let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
            bring((row, column), &outcome.value, outcome.brought.as_ref());
            if let Some(SpillOutcome::Fills { array, formats: Some(formats), .. }) = &outcome.spill {
                for ((i, j), value) in array.entries().filter(|(at, _)| *at != (0, 0)) {
                    let brought = formats.get(array.columns(), (i, j));
                    bring((row + i, column + j), value, brought);
                }
            }
        }
        // Each column's own look: of each leaf of its cells' formats, the value more than half its rows have (as
        // the format sets it: a standard color and the same color in hex are two).
        let mut column_looks: BTreeMap<usize, Look> = BTreeMap::new();
        {
            let mut counts: HashMap<(usize, Leaf), HashMap<String, (usize, &serde_json::Value)>> = HashMap::new();
            for (leaf, at, value) in sheet.formats.iter() {
                let (Some(_), Some(c)) = (sheet.rows.position(at.0), sheet.columns.position(at.1)) else { continue };
                counts.entry((c, leaf)).or_default().entry(value.to_string()).or_insert((0, value)).0 += 1;
            }
            let mut leaves: BTreeMap<usize, HashMap<Leaf, &serde_json::Value>> = BTreeMap::new();
            for ((c, leaf), values) in counts {
                if let Some((_, value)) = values.into_values().find(|(n, _)| n * 2 > sheet.rows.len()) {
                    leaves.entry(c).or_default().insert(leaf, value);
                }
            }
            for (c, leaves) in leaves {
                let look = Look::from_leaves(|leaf| leaves.get(&leaf).copied(), self.colors);
                if !look.is_default() {
                    column_looks.insert(c, look);
                }
            }
        }
        // The sheet's looks are numbered in the order of the cells before anything is written (a column's own look
        // among them): a text kept as text gets its look's number then, after them.
        for look in looks.values() {
            self.styles.xf(look, false);
        }
        out.push_str(&self.cols(sheet, &columns, &column_looks));
        looks.extend(brought_looks);

        // What the cells hold, by position: their inputs, then the cells arrays spill into.
        let mut contents: BTreeMap<(usize, usize), (Content, bool)> = BTreeMap::new();
        let mut links: BTreeMap<(usize, usize), String> = BTreeMap::new();
        let mut cells: Vec<(usize, usize, LineId, LineId)> = sheet
            .cells
            .keys()
            .filter_map(|&(r, c)| Some((sheet.rows.position(r)?, sheet.columns.position(c)?, r, c)))
            .collect();
        cells.sort();
        // The arrays spilled, with whether their formula is written (a text one spills is then written in its cell).
        let mut spills: Vec<((usize, usize), std::rc::Rc<crate::value::Array>, bool)> = Vec::new();
        for (row, column, r, c) in cells {
            let cell = &sheet.cells[&(r, c)];
            let (content, quote) = match &cell.input {
                Input::Number { value } => (Content::Number(*value), false),
                Input::Boolean { value } => (Content::Boolean(*value), false),
                Input::Text { value } => (Content::Text(value.clone()), value.starts_with(['=', '+', '-'])),
                Input::DropdownOption { option_id, label } => {
                    let shown = sheet.dropdown_option(option_id).map_or(label, |o| &o.label);
                    (Content::Text(shown.clone()), shown.starts_with(['=', '+', '-']))
                }
                Input::User { .. } | Input::Users { .. } => {
                    self.flags.users = true;
                    let text = cell.input.reads_as_text().unwrap_or_default();
                    let quote = text.starts_with(['=', '+', '-']);
                    (Content::Text(text), quote)
                }
                Input::RichText { paragraphs } => {
                    if let Some(link) = self.link_of(paragraphs) {
                        links.insert((row, column), link);
                    }
                    // Lines of lists are written as text after their marks, in a cell that wraps.
                    let prefixes = rich::list_prefixes(paragraphs);
                    let text = match &prefixes {
                        Some(prefixes) => {
                            self.flags.lists_in_texts = true;
                            looks.entry((row, column)).or_default().wrap = true;
                            let lines: Vec<String> = paragraphs
                                .iter()
                                .zip(prefixes)
                                .map(|(p, prefix)| p.runs.iter().fold(prefix.clone(), |line, r| line + &r.text))
                                .collect();
                            lines.join("\n")
                        }
                        None => rich::plain_text(paragraphs),
                    };
                    let quote = text.starts_with(['=', '+', '-']);
                    let look = looks.get(&(row, column)).cloned().unwrap_or_default();
                    match runs_written(paragraphs, prefixes.as_deref(), &look) {
                        Some(runs) => (Content::Runs(runs), quote),
                        None => (Content::Text(text), quote),
                    }
                }
                Input::Formula { formula } => {
                    let outcome = workbook.outcome(&sheet.id, r, c);
                    let value = outcome.map(|o| o.value.clone()).unwrap_or(Value::Blank);
                    let parsed = cell.parsed.as_deref().and_then(|p| p.as_ref().ok());
                    let written = parsed.and_then(|expr| {
                        if formula::draws_random_numbers(expr) {
                            self.flags.random_numbers = true;
                        }
                        formula::write(workbook, index, formula, expr, self.names)
                    });
                    if let Some(SpillOutcome::Fills { array, .. }) = outcome.and_then(|o| o.spill.as_ref()) {
                        spills.push(((row, column), array.clone(), written.is_some()));
                    }
                    match written {
                        Some(w) => {
                            let array = w.is_array.then(|| match outcome.and_then(|o| o.spill.as_ref()) {
                                Some(SpillOutcome::Fills { to, .. }) => {
                                    format!("{}:{}", address(row, column), address(to.0, to.1))
                                }
                                _ => address(row, column),
                            });
                            (Content::Formula { text: w.text, array, value }, false)
                        }
                        None => {
                            self.flags.formulas_written_as_values = true;
                            (value_content(&value), is_kept_as_text(&value))
                        }
                    }
                }
            };
            contents.insert((row, column), (content, quote));
        }
        for ((top, left), array, is_written) in spills {
            for ((i, j), value) in array.entries().filter(|(at, _)| *at != (0, 0)) {
                let content = match value {
                    Value::Text(s) if is_written => Content::SpilledText(s.to_string()),
                    value => value_content(value),
                };
                let quote = !is_written && is_kept_as_text(value);
                contents.entry((top + i, left + j)).or_insert((content, quote));
            }
        }

        // The rows: their sizes and outline, then their cells.
        let mut row_set: BTreeSet<usize> = contents.keys().map(|k| k.0).chain(looks.keys().map(|k| k.0)).collect();
        if !column_looks.is_empty() {
            row_set.extend(0..sheet.rows.len());
        }
        let mut heights: HashMap<usize, u32> = HashMap::new();
        for (&line, &px) in &sheet.row_heights {
            if let Some(p) = sheet.rows.position(line) {
                heights.insert(p, px);
                row_set.insert(p);
            }
        }
        let too_short = too_short(workbook, sheet, &heights, &columns);
        for (p, o) in rows.iter().enumerate() {
            if *o != Outline::default() {
                row_set.insert(p);
            }
        }
        out.push_str("<sheetData>");
        for row in row_set {
            let mut columns_here: BTreeSet<usize> = contents.range((row, 0)..(row + 1, 0)).map(|(k, _)| k.1).collect();
            let holds = !columns_here.is_empty();
            columns_here.extend(looks.range((row, 0)..(row + 1, 0)).map(|(k, _)| k.1));
            columns_here.extend(column_looks.keys().copied());
            let is_blank_to_write = |column: &usize| {
                !contents.contains_key(&(row, *column)) && looks.get(&(row, *column)) != column_looks.get(column)
            };
            let has_blanks = columns_here.iter().any(is_blank_to_write);
            if !holds && !has_blanks && !heights.contains_key(&row) && rows[row] == Outline::default() {
                continue;
            }
            if !holds && !self.spend() {
                continue;
            }
            let _ = write!(out, "<row r=\"{}\"", row + 1);
            if let Some(&px) = heights.get(&row).filter(|_| !too_short.contains(&row)) {
                let (ht, cut) = height(px);
                self.flags.sizes_cut |= cut;
                let _ = write!(out, " ht=\"{ht}\" customHeight=\"1\"");
            }
            let o = rows[row];
            if o.hidden {
                out.push_str(" hidden=\"1\"");
            }
            if o.level > 0 {
                let _ = write!(out, " outlineLevel=\"{}\"", o.level);
            }
            if o.after_collapsed {
                out.push_str(" collapsed=\"1\"");
            }
            out.push('>');
            for column in columns_here {
                let look = looks.get(&(row, column));
                let content = contents.remove(&(row, column));
                let own = column_looks.get(&column);
                if content.is_none() && (look == own || !self.spend()) {
                    continue;
                }
                let quote = content.as_ref().is_some_and(|c| c.1);
                let s = match (look, quote) {
                    (None, false) => 0,
                    (look, quote) => self.styles.xf(look.unwrap_or(&Look::default()), quote),
                };
                self.cell(&mut out, row, column, s, content.map(|c| c.0));
            }
            out.push_str("</row>");
        }
        out.push_str("</sheetData>");

        let merged = merged_contents(&workbook.bases, sheet);
        if !merged.is_empty() {
            let _ = write!(out, "<mergeCells count=\"{}\">", merged.len());
            for m in &merged {
                let at = |key: &str| -> Option<(usize, usize)> {
                    let r = workbook.bases.parse(m[key]["r"].as_str()?)?;
                    let c = workbook.bases.parse(m[key]["c"].as_str()?)?;
                    Some((sheet.rows.position(r)?, sheet.columns.position(c)?))
                };
                if let (Some(a), Some(b)) = (at("liveTopLeft"), at("liveBottomRight")) {
                    let _ = write!(out, "<mergeCell ref=\"{}:{}\"/>", address(a.0, a.1), address(b.0, b.1));
                }
            }
            out.push_str("</mergeCells>");
        }
        if !validations.is_empty() {
            let _ = write!(out, "<dataValidations count=\"{}\">", validations.len());
            for v in validations {
                let _ = write!(
                    out,
                    "<dataValidation type=\"list\" allowBlank=\"1\" sqref=\"{}\"><formula1>{}</formula1>\
                     </dataValidation>",
                    attribute(&v.sqref),
                    text(&v.formula)
                );
            }
            out.push_str("</dataValidations>");
        }
        // The drawing is the sheet's first link, when it has one.
        let drawing = self.drawings.get(index).copied().flatten();
        let shift = usize::from(drawing.is_some());
        let mut targets: Vec<&str> = Vec::new();
        if !links.is_empty() {
            // Each link once, numbered as the cells first have it.
            out.push_str("<hyperlinks>");
            for (i, (&(row, column), link)) in links.iter().enumerate() {
                if i == LINKS {
                    self.flags.links_of_some_cells = true;
                    break;
                }
                let id = match targets.iter().position(|t| t == link) {
                    Some(id) => id,
                    None => {
                        targets.push(link);
                        targets.len() - 1
                    }
                };
                let _ = write!(out, "<hyperlink ref=\"{}\" r:id=\"rId{}\"/>", address(row, column), id + 1 + shift);
            }
            out.push_str("</hyperlinks>");
        }
        if drawing.is_some() {
            out.push_str("<drawing r:id=\"rId1\"/>");
        }
        if !links.is_empty() || drawing.is_some() {
            let mut rels = String::from(DECLARATION);
            rels.push_str("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            if let Some(d) = drawing {
                let _ = write!(
                    rels,
                    "<Relationship Id=\"rId1\" Type=\"{RELATIONSHIP}/drawing\" Target=\"../drawings/drawing{d}.xml\"/>"
                );
            }
            for (i, target) in targets.iter().enumerate() {
                let _ = write!(
                    rels,
                    "<Relationship Id=\"rId{}\" Type=\"{RELATIONSHIP}/hyperlink\" Target=\"{}\" TargetMode=\"External\"/>",
                    i + 1 + shift,
                    attribute(target)
                );
            }
            rels.push_str("</Relationships>");
            self.sheet_links.push((index + 1, rels));
            out.insert_str(root_end, &format!(" xmlns:r=\"{RELATIONSHIP}\""));
        }
        out.push_str("</worksheet>");
        out
    }

    /// One more blank cell or row that holds nothing, if the file may still write one.
    fn spend(&mut self) -> bool {
        if self.budget == 0 {
            self.flags.looks_of_some_blank_cells = true;
            return false;
        }
        self.budget -= 1;
        true
    }

    /// The link of a text with looks, when it is one Excel takes: its runs' first.
    fn link_of(&mut self, paragraphs: &[Paragraph]) -> Option<String> {
        let links: Vec<Option<&str>> = paragraphs.iter().flat_map(|p| &p.runs).map(|r| r.link.as_deref()).collect();
        let first = links.iter().flatten().next().copied()?;
        if links.iter().any(|l| *l != Some(first)) {
            self.flags.links_of_parts_of_texts = true;
        }
        if !is_link_taken(first) {
            self.flags.links_of_some_cells = true;
            return None;
        }
        Some(first.to_owned())
    }

    /// The columns that differ from the plain one, those next to each other that are the same as one: the same
    /// width in pixels (two cut to Excel's widest are not), look and groups. Two with a width set are one only when
    /// their ids follow on, as in the runs of widths the workbook reads back (a column deleted between them, or one
    /// moved there, keeps them apart).
    fn cols(&mut self, sheet: &Sheet, outline: &[Outline], looks: &BTreeMap<usize, Look>) -> String {
        let mut widths: HashMap<usize, u32> = HashMap::new();
        for (&line, &px) in &sheet.column_widths {
            if let Some(p) = sheet.columns.position(line) {
                widths.insert(p, px);
            }
        }
        // Each run: its first and last position, attributes, width, groups and the id of its last column.
        let mut written: Vec<(usize, usize, String, Option<u32>, u64, Option<LineId>)> = Vec::new();
        for c in 0..sheet.columns.len() {
            let o = outline[c];
            let look = looks.get(&c);
            if widths.get(&c).is_none() && look.is_none() && o == Outline::default() {
                continue;
            }
            let mut attributes = String::new();
            let (w, custom) = match widths.get(&c) {
                Some(&px) => {
                    let (w, cut) = width(px);
                    self.flags.sizes_cut |= cut;
                    (w, true)
                }
                None => ("14.857142857142858".to_owned(), false),
            };
            let _ = write!(attributes, " width=\"{w}\"");
            if let Some(look) = look {
                let _ = write!(attributes, " style=\"{}\"", self.styles.xf(look, false));
            }
            if o.hidden {
                attributes.push_str(" hidden=\"1\"");
            }
            if custom {
                attributes.push_str(" customWidth=\"1\"");
            }
            if o.level > 0 {
                let _ = write!(attributes, " outlineLevel=\"{}\"", o.level);
            }
            if o.after_collapsed {
                attributes.push_str(" collapsed=\"1\"");
            }
            let px = widths.get(&c).copied();
            let line = sheet.columns.line(c);
            let follows = |last: &Option<LineId>| match (px, last, line) {
                (None, ..) => true,
                (Some(_), Some(last), Some(line)) => last.base == line.base && last.n + 1 == line.n,
                _ => false,
            };
            match written.last_mut() {
                Some((_, max, a, p, g, last))
                    if *max + 1 == c && *a == attributes && *p == px && *g == o.groups && follows(last) =>
                {
                    *max = c;
                    *last = line;
                }
                _ => written.push((c, c, attributes, px, o.groups, line)),
            }
        }
        if written.is_empty() {
            return String::new();
        }
        let mut out = String::from("<cols>");
        for (min, max, a, ..) in written {
            let _ = write!(out, "<col min=\"{}\" max=\"{}\"{a}/>", min + 1, max + 1);
        }
        out.push_str("</cols>");
        out
    }

    fn cell(&mut self, out: &mut String, row: usize, column: usize, s: usize, content: Option<Content>) {
        let _ = write!(out, "<c r=\"{}\"", address(row, column));
        if s != 0 {
            let _ = write!(out, " s=\"{s}\"");
        }
        let Some(content) = content else {
            out.push_str("/>");
            return;
        };
        match content {
            Content::Number(n) => {
                let _ = write!(out, "><v>{}</v></c>", number(n));
            }
            Content::Text(shown) => {
                let i = self.strings.place(&shown);
                let _ = write!(out, " t=\"s\"><v>{i}</v></c>");
            }
            Content::Runs(runs) => {
                let i = self.strings.place_runs(&runs);
                let _ = write!(out, " t=\"s\"><v>{i}</v></c>");
            }
            Content::SpilledText(shown) => {
                let _ = write!(out, " t=\"str\">{}</c>", text_element("v", &shown));
            }
            Content::Boolean(b) => {
                let _ = write!(out, " t=\"b\"><v>{}</v></c>", u8::from(b));
            }
            Content::Error(e) => {
                let _ = write!(out, " t=\"e\"><v>{}</v></c>", error_value(e));
            }
            Content::Formula { text: f, array, value } => {
                if array.is_some() {
                    out.push_str(" cm=\"1\"");
                }
                let (t, v) = match &value {
                    Value::Blank => ("", "<v>0</v>".to_owned()),
                    Value::Number(n) => ("", format!("<v>{}</v>", number(*n))),
                    Value::Text(s) => (" t=\"str\"", text_element("v", s)),
                    Value::Boolean(b) => (" t=\"b\"", format!("<v>{}</v>", u8::from(*b))),
                    Value::Error(e) => (" t=\"e\"", format!("<v>{}</v>", error_value(*e))),
                };
                out.push_str(t);
                out.push('>');
                match array {
                    Some(r) => {
                        let _ = write!(out, "<f t=\"array\" ref=\"{r}\">{}</f>", text(&f));
                    }
                    None => {
                        let _ = write!(out, "<f>{}</f>", text(&f));
                    }
                }
                let _ = write!(out, "{v}</c>");
            }
        }
    }
}

/// A text with looks as its runs are written (`<r>`), when one of them is marked: an unmarked run as its text, a
/// marked one with its font. Each paragraph after the first starts a line at the end of the run before it (a run of
/// its own when there is none).
fn runs_written(paragraphs: &[Paragraph], prefixes: Option<&[String]>, look: &Look) -> Option<String> {
    if paragraphs.iter().flat_map(|p| &p.runs).all(|r| r.marks.is_empty()) {
        return None;
    }
    let mut runs: Vec<(String, &[Mark])> = Vec::new();
    for (i, p) in paragraphs.iter().enumerate() {
        if i > 0 {
            match runs.last_mut() {
                Some(last) => last.0.push('\n'),
                None => runs.push(("\n".to_owned(), &[])),
            }
        }
        // A line's mark joins the run before it when that run has no marks, else is a run of its own.
        let prefix = prefixes.map_or("", |prefixes| prefixes[i].as_str());
        if !prefix.is_empty() {
            match runs.last_mut() {
                Some(last) if i > 0 && last.1.is_empty() => last.0.push_str(prefix),
                _ => runs.push((prefix.to_owned(), &[])),
            }
        }
        runs.extend(p.runs.iter().map(|r| (r.text.clone(), r.marks.as_slice())));
    }
    let mut out = String::new();
    for (text, marks) in runs {
        out.push_str("<r>");
        if !marks.is_empty() {
            out.push_str(&look.run_properties(marks));
        }
        out.push_str(&text_element("t", &text));
        out.push_str("</r>");
    }
    Some(out)
}

/// Whether Excel takes a link: `http://` or `https://` (in any case) and more, at most 2,048 characters, each a
/// letter, a digit or one of `-._~:/?#[]@!$&'()*+,;=%`.
fn is_link_taken(link: &str) -> bool {
    let lower = link.get(..8).map(str::to_ascii_lowercase).unwrap_or_default();
    let scheme = if lower.starts_with("http://") {
        7
    } else if lower.starts_with("https://") {
        8
    } else {
        return false;
    };
    link.len() > scheme
        && link.len() <= 2048
        && link.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=%".contains(&b))
}

/// A value written as the cell's: a text shared, an error as Excel has it.
fn value_content(value: &Value) -> Content {
    match value {
        Value::Blank => Content::Number(0.0),
        Value::Number(n) => Content::Number(*n),
        Value::Text(s) => Content::Text(s.to_string()),
        Value::Boolean(b) => Content::Boolean(*b),
        Value::Error(e) => Content::Error(*e),
    }
}

/// Whether a value written as a cell's is a text Excel would read as a formula or number unless kept as text.
fn is_kept_as_text(value: &Value) -> bool {
    matches!(value, Value::Text(s) if s.starts_with(['=', '+', '-']))
}

/// An error as a value in the file: Excel's own, #VALUE! for those it does not have.
fn error_value(e: CellError) -> &'static str {
    match e {
        CellError::Spill | CellError::Error | CellError::Timeout => CellError::Value.text(),
        e => e.text(),
    }
}

/// How the sheet is shown: its gridlines, whether it is the one selected, and its frozen rows and columns.
fn sheet_views(sheet: &Sheet, is_first: bool) -> String {
    let mut out = String::from("<sheetViews><sheetView");
    if sheet.are_gridlines_hidden {
        out.push_str(" showGridLines=\"0\"");
    }
    if is_first {
        out.push_str(" tabSelected=\"1\"");
    }
    out.push_str(" workbookViewId=\"0\"");
    let frozen = |axis: &Axis, line: Option<LineId>| line.and_then(|l| axis.position(l)).map(|p| p + 1);
    let rows = frozen(&sheet.rows, sheet.last_frozen_row);
    let columns = frozen(&sheet.columns, sheet.last_frozen_column);
    if rows.is_none() && columns.is_none() {
        out.push_str("/></sheetViews>");
        return out;
    }
    out.push_str("><pane");
    if let Some(x) = columns {
        let _ = write!(out, " xSplit=\"{x}\"");
    }
    if let Some(y) = rows {
        let _ = write!(out, " ySplit=\"{y}\"");
    }
    let pane = match (rows.is_some(), columns.is_some()) {
        (true, true) => "bottomRight",
        (true, false) => "bottomLeft",
        _ => "topRight",
    };
    let _ = write!(
        out,
        " topLeftCell=\"{}\" activePane=\"{pane}\" state=\"frozen\"/></sheetView></sheetViews>",
        address(rows.unwrap_or(0), columns.unwrap_or(0))
    );
    out
}

#[cfg(test)]
mod tests {
    use super::is_link_taken;

    #[test]
    fn links_excel_takes() {
        for link in ["https://a.com", "HTTP://X.Y/b?c=1&d=2", "https://b.com/%zz[]@!$'()*+,;=~", "https:///"] {
            assert!(is_link_taken(link), "{link}");
        }
        let long = format!("https://x/{}", "y".repeat(2038));
        assert!(is_link_taken(&long[..2048]));
        assert!(!is_link_taken(&format!("{long}y")));
        for link in ["ftp://x", "https://", "https:/a.com", "https://a b", "mailto:a@b", "https://ü.com", "https://x/\"", "h"] {
            assert!(!is_link_taken(link), "{link}");
        }
    }
}
