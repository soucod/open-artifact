//! Cells another program put on the clipboard (`pasteCellsOfAnotherProgram`): row by row, what each cell shows,
//! maybe its value, maybe its formula with references by offsets from its cell (`=R[-1]C+R1C1`), and its look (an
//! index into `looks`: a format and a number format's pattern). They are pasted as a copy is, colors and all, but
//! once down whole columns (every row of the sheet selected) and once across whole rows.
//!
//! - A formula is the cell's wherever it lands and reads: its references written from the cell it lands on
//!   (`R[-1]C` is the cell above, `R1C1` is `$A$1`; `R1` the rows `$1:$1`, `C1` the columns `$A:$A`, an end of a
//!   range alone; `A1` stays as it is), with the look's pattern. It starts with `=`; names no cell off the sheet;
//!   calls functions the engine has (`SUM (1)` is a call); uses names only as a LET gives them, in it, and none in
//!   parentheses; holds no errors but `#NULL!`, `#DIV/0!`, `#VALUE!`, `#NUM!` and `#N/A`; and has at most 8,192
//!   bytes besides its references and 256 references. Where it doesn't read (a reference above the first row, say),
//!   the cell is what it shows.
//! - The look's pattern is the cell's when a pasted cell can keep it; one it can't (a fraction, `[$-407]dddd`) gives
//!   its place to one for its kind of number (`pattern_of`), and General or one read as none to none.
//! - A value is kept when it shows as the cell does: a number or a yes or no with the pattern (or General) in as many
//!   characters as the cell shows, in en-US but with any locale's signs for numbers (`1.234,5`, `1 234,5`), compared
//!   without spaces of any kind and with `’` as `'`; a text as it is (an empty one is nothing). A number whose
//!   pattern isn't the look's own (one put in its place, or one that doesn't read, `''` too), or whose pattern
//!   shows it as a fraction (`# ?/?`, `yyyy;# ?/?` below 0), is kept whatever it shows, with the pattern.
//! - Otherwise the text shown is read as a pasted text is, in the workbook's locale. With no value: a text pattern
//!   (`@`) keeps the text as it is, and a number keeps the pattern when it shows such a number, as one typed into a
//!   cell does, else it takes the pattern it brings or General. With a value not kept, the cell takes the number
//!   format the text brings (`5%`), else General when it had a pattern. A cell that shows nothing is emptied, with
//!   the pattern.
//! - The rest of the look's format is set on the cell, but leaves that are their defaults.

use std::collections::BTreeMap;
use hashbrown::{HashMap, HashSet};
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{formats_given, runs_read, taken_away, Landing, Selected, What, LONGEST_FORMULA, MOST_REFERENCES};
use crate::copied_cells::{CopiedCell, CopiedCells, CopiedFormat, CopiedInput, Span, VERSION};
use crate::formula::parse::{self, Expr};
use crate::formula::{column_letters, StoredFormula};
use crate::ids::{Bases, IdRun, LineId};
use crate::locale::{self, Locale};
use crate::number_format::{Kind, NumberFormat, Room};
use crate::shown::{shown, ShownValue};
use crate::typing::{self, formula};
use crate::typing::reading::{self, Locales, Reading};
use crate::value::{CellError, Value};
use crate::workbook::formats::{blocks, read_format, Leaf};
use crate::workbook::layout::written;
use crate::workbook::load::Op;
use crate::workbook::{Sheet, Workbook};

/// The most rows and columns a sheet can have.
const MOST_ROWS: i64 = 1_048_576;
const MOST_COLUMNS: i64 = 16_384;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasteCellsOfAnotherProgram {
    pub(super) selected: Selected,
    rows: Vec<Vec<CellOfAnotherProgram>>,
    looks: Vec<Look>,
    /// The rows the cells may land in when rows out of view are in their way.
    #[serde(default)]
    pub(super) may_land_in: Option<Vec<IdRun>>,
}

/// A cell of another program. What it shows with its looks (as rich text) is never written.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CellOfAnotherProgram {
    shown: String,
    #[serde(rename = "shownWithLooks", deserialize_with = "written::maybe_null")]
    _shown_with_looks: Option<Nothing>,
    #[serde(deserialize_with = "written::maybe_null")]
    value: Option<ValueOfAnotherProgram>,
    #[serde(deserialize_with = "written::maybe_null")]
    formula_by_offsets: Option<String>,
    #[serde(deserialize_with = "written::maybe_null")]
    look: Option<u32>,
}

/// What reads as nothing but `null`.
#[derive(Deserialize)]
enum Nothing {}

#[derive(Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", deny_unknown_fields)]
enum ValueOfAnotherProgram {
    Number(f64),
    Text(String),
    Boolean(bool),
}

/// How cells of another program look: a format (one setting something) and a number format's pattern.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Look {
    #[serde(deserialize_with = "written::maybe_null")]
    format: Option<Json>,
    #[serde(deserialize_with = "written::maybe_null")]
    number_format_pattern: Option<String>,
}

/// The formats a cell of another program brings: its look's leaves (but the number format), the number format of
/// what it holds, and that of its formula where the formula lands.
pub(super) struct CellLook {
    leaves: BTreeMap<Leaf, Json>,
    number_format: Option<Json>,
    formula_number_format: Option<Json>,
}

/// The cells' looks, by their row and column among the cells, and whether every cell's look is one of the looks:
/// cells with one that is none are refused (`unreadableCopiedCells`), but only once the rows they may land in are
/// looked at.
pub(super) struct Looks {
    of_cells: HashMap<(u32, u32), CellLook>,
    pub(super) all_given: bool,
}

impl PasteCellsOfAnotherProgram {
    /// Whether the edit reads: runs that read, and each look's format one setting something.
    pub(super) fn reads(&self) -> bool {
        let format_reads = |look: &Look| {
            look.format.as_ref().is_none_or(|f| read_format(f).is_some_and(|leaves| !leaves.is_empty()))
        };
        runs_read(&self.selected.rows)
            && self.may_land_in.as_deref().is_none_or(runs_read)
            && self.looks.iter().all(format_reads)
    }

    /// The cells as a copy (from the top left of no sheet: a formula is by offsets), with their looks; or `None`
    /// when there are no cells (`unreadableCopiedCells`). The copy is as many columns wide as its longest row. Its
    /// cells are those that hold something or have a formula. Rows with no cells are a copy no column wide, which
    /// `paste` refuses once it looked at the rows it may land in, as it does cells with a look none of the looks.
    pub(super) fn copy(&self, locale: &Locale) -> Option<(CopiedCells, Looks)> {
        let shown_in = locales_shown_in();
        let row_count = self.rows.len();
        let column_count = self.rows.iter().map(Vec::len).max().unwrap_or(0);
        if row_count == 0 || (row_count == 1 && column_count == 0) {
            return None;
        }
        let mut cells = Vec::new();
        let mut looks = Looks { of_cells: HashMap::new(), all_given: true };
        for (row, cells_of_row) in self.rows.iter().enumerate() {
            for (column, cell) in cells_of_row.iter().enumerate() {
                let look = cell.look.and_then(|k| self.looks.get(k as usize));
                looks.all_given &= look.is_some() || cell.look.is_none();
                let (pattern, own) = look.map_or((None, true), |look| pattern_of(look, locale));
                let pattern = pattern.as_deref();
                let (input, number_format) = held(cell, (pattern, own), locale, &shown_in);
                let input = match &cell.formula_by_offsets {
                    Some(text) => {
                        Some(CopiedInput::FormulaByOffsets { text: text.clone(), otherwise: input.map(Box::new) })
                    }
                    None => input,
                };
                let place = (row as u32, column as u32);
                if let Some(input) = input {
                    cells.push(CopiedCell { row: place.0, column: place.1, input });
                }
                let format = |p: Option<&str>| p.map(|p| json!({ "pattern": p }));
                let cell_look = CellLook {
                    leaves: look.map(leaves_of).unwrap_or_default(),
                    number_format: format(number_format.as_deref()),
                    formula_number_format: format(pattern),
                };
                let sets = !cell_look.leaves.is_empty()
                    || cell_look.number_format.is_some()
                    || cell_look.formula_number_format.is_some();
                if sets {
                    looks.of_cells.insert(place, cell_look);
                }
            }
        }
        let copy = CopiedCells {
            version: VERSION,
            top_row_position: 0,
            left_column_position: 0,
            row_count: row_count as u64,
            column_count: column_count as u64,
            cells,
            formats: Vec::new(),
            blank_rows_left_out: None,
            blank_columns_left_out: None,
        };
        Some((copy, looks))
    }
}

/// The pattern a cell of a look takes: the look's, unless it is one read as none, or General (in any case:
/// `general`). One a pasted cell can't keep (a fraction, `[$-407]dddd`) gives its place to one for its kind of
/// number: a date's `m/d/yyyy`, a time of day's the workbook's (`h:mm AM/PM`), a date and time's `m/d h:mm`, else
/// none. And whether the pattern is the look's own: a number shown with another, or with a pattern that doesn't
/// read (`''` too), is kept whatever it shows.
fn pattern_of(look: &Look, locale: &Locale) -> (Option<String>, bool) {
    let Some(pattern) = look.number_format_pattern.as_deref().filter(|p| !p.eq_ignore_ascii_case("General")) else {
        return (None, true);
    };
    let Some(format) = Some(pattern).filter(|p| !p.is_empty()).and_then(|p| NumberFormat::parse(p).ok()) else {
        return (None, false);
    };
    if format.is_kept_when_pasted() {
        return (Some(pattern.to_owned()), true);
    }
    let in_its_place = match format.kind() {
        Kind::Date => Some("m/d/yyyy"),
        Kind::Time => Some(locale.pattern_of_a_time_of_day),
        Kind::DateAndTime => Some("m/d h:mm"),
        _ => None,
    };
    (in_its_place.map(str::to_owned), false)
}

/// The leaves of a look's format a cell takes: all but its number format, and those that are their defaults.
fn leaves_of(look: &Look) -> BTreeMap<Leaf, Json> {
    let leaves = look.format.as_ref().and_then(read_format).unwrap_or_default();
    leaves.into_iter().filter(|(leaf, value)| *leaf != Leaf::NumberFormat && *value != leaf.default_value()).collect()
}

/// The locales another program may have shown its cells in: en-US, writing numbers each way a locale does (its
/// decimal sign, group sign and sizes of groups: `1,234.5`, `1.234,5`, `1 234,5`, `1'234.5`, `12,34,567.5`…).
fn locales_shown_in() -> Vec<Locale> {
    let en_us = locale::en_us();
    let mut locales: Vec<Locale> = Vec::new();
    for l in locale::all() {
        let (decimal_sign, group_sign, sizes_of_groups) = (l.decimal_sign, l.group_sign, l.sizes_of_groups);
        let shown_in = Locale { decimal_sign, group_sign, sizes_of_groups, ..*en_us };
        if !locales.contains(&shown_in) {
            locales.push(shown_in);
        }
    }
    locales
}

/// A text shown, to compare with another: without its spaces (any of Unicode's), a `’` as `'`.
fn comparable(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).map(|c| if c == '\u{2019}' { '\'' } else { c }).collect()
}

/// What a cell holds (where its formula doesn't land), and the pattern of the number format it takes, given the
/// look's pattern (and whether it is the look's own) and the locales the cell may be shown in.
fn held(
    cell: &CellOfAnotherProgram,
    (pattern, own): (Option<&str>, bool),
    locale: &Locale,
    shown_in: &[Locale],
) -> (Option<CopiedInput>, Option<String>) {
    let owned = |p: Option<&str>| p.map(str::to_owned);
    let shown_text = comparable(&cell.shown);
    if let Some(value) = &cell.value {
        let shows = |value: &Value| {
            let room = Room::InACell { most_characters: shown_text.chars().count() as u32 };
            shown_in.iter().any(|l| match shown(value, Some(pattern.unwrap_or("General")), room, l) {
                Ok(ShownValue::Text { text, .. }) => comparable(&text) == shown_text,
                _ => false,
            })
        };
        let kept = match value {
            ValueOfAnotherProgram::Number(n) => {
                let as_a_fraction = || {
                    pattern.and_then(|p| NumberFormat::parse(p).ok()).is_some_and(|f| f.shows_as_a_fraction(*n))
                };
                (!own || as_a_fraction() || shows(&Value::number(*n))).then(|| CopiedInput::Number { value: *n })
            }
            ValueOfAnotherProgram::Boolean(b) => {
                shows(&Value::Boolean(*b)).then_some(CopiedInput::Boolean { value: *b })
            }
            // An empty text is kept as nothing.
            ValueOfAnotherProgram::Text(t) if comparable(t) == shown_text => {
                return ((!t.is_empty()).then(|| CopiedInput::Text { value: t.clone() }), owned(pattern));
            }
            ValueOfAnotherProgram::Text(_) => None,
        };
        if let Some(input) = kept {
            return (Some(input), owned(pattern));
        }
    }
    if cell.shown.is_empty() {
        return (None, owned(pattern));
    }
    let is_text = pattern.is_some_and(|p| NumberFormat::parse(p).is_ok_and(|f| f.kind() == Kind::Text));
    if cell.value.is_none() && is_text {
        return (Some(CopiedInput::Text { value: cell.shown.clone() }), owned(pattern));
    }
    let given = cell.value.is_some();
    let (input, brought) = match reading::read(&cell.shown, Locales { text: locale, workbook: locale }, false) {
        Reading::Empty => (None, None),
        Reading::Text(value) | Reading::Formula(value) => (Some(CopiedInput::Text { value }), None),
        Reading::Boolean(value) => (Some(CopiedInput::Boolean { value }), None),
        // With no value, a number keeps the pattern when it shows such a number, as one typed into a cell does;
        // else it takes the pattern it brings, or General.
        Reading::Number(value, shape) if !given => {
            let number_format = match typing::pattern_kept(pattern.unwrap_or("General"), value, &shape) {
                true => owned(pattern),
                false => Some(shape.pattern.unwrap_or_else(|| "General".to_owned())),
            };
            return (Some(CopiedInput::Number { value }), number_format);
        }
        Reading::Number(value, shape) => (Some(CopiedInput::Number { value }), shape.pattern),
    };
    let number_format = match (brought, given) {
        (Some(brought), _) => Some(brought),
        (None, true) => pattern.map(|_| "General".to_owned()),
        (None, false) => owned(pattern),
    };
    (input, number_format)
}

/// The formula by offsets a cell (at a row and column of the sheet, from 0) is given, when it reads there.
pub(super) fn formula_by_offsets(
    workbook: &Workbook,
    s: usize,
    text: &str,
    (row, column): (usize, usize),
) -> Option<StoredFormula> {
    let text = written_from(text, row as i64, column as i64)?;
    let stored = formula::stored(&text, workbook, s, locale::en_us());
    let length: usize = stored.text_between_references.iter().map(String::len).sum();
    if length > LONGEST_FORMULA || stored.references.len() > MOST_REFERENCES {
        return None;
    }
    let pieces = calls_joined(&stored.text_between_references);
    let expr = parse::parse(&pieces).ok()?;
    let reads = checks(&expr, &mut Vec::new()) && !names_in_parentheses(&pieces);
    reads.then_some(stored)
}

/// A formula's pieces with no spaces between a name and its `(`: `SUM (1)` is read as a call when it is
/// pasted from another program (the formula is kept as written).
fn calls_joined(pieces: &[String]) -> Vec<String> {
    let mut joined = Vec::new();
    for piece in pieces {
        let chars: Vec<char> = piece.chars().collect();
        let mut out: Vec<char> = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if c == '"' || c == '\'' {
                let end = quoted_end(&chars, i);
                out.extend(&chars[i..end]);
                i = end;
                continue;
            }
            let spaces =
                (i..chars.len()).find(|&j| !matches!(chars[j], ' ' | '\t' | '\n' | '\r')).unwrap_or(chars.len());
            if spaces > i && chars.get(spaces) == Some(&'(') {
                let word: Vec<char> = out.iter().rev().take_while(|&&c| !ends_word(c)).copied().collect();
                if word.last().is_some_and(|&c| c.is_alphabetic() || c == '_') {
                    i = spaces;
                    continue;
                }
            }
            out.push(c);
            i += 1;
        }
        joined.push(out.into_iter().collect());
    }
    joined
}

/// Characters that end a word of a formula (as `typing::formula` reads one).
fn ends_word(c: char) -> bool {
    matches!(
        c,
        '=' | '(' | ')' | ',' | ';' | ':' | '-' | '+' | '*' | '/' | '^' | '&' | '<' | '>' | '@' | '#' | '?' | '\\'
            | '{' | '}' | '[' | ']' | '|' | '~' | '`' | '%' | '!' | '"' | '\'' | ' ' | '\t' | '\n' | '\r'
    ) || c.is_ascii_control()
}

/// A formula by offsets written as references are from a cell (its row and column, from 0): each reference by
/// offsets a whole word, not a call, nor a sheet's name; texts and quoted sheets' names passed over. A range is two
/// ends with `:` between them (the second with no sheet's name), and its ends may be a row or a column alone (`R`
/// is the cell's own row, `C` its column), which a reference alone may not. `None` when a reference is off the
/// sheet.
fn written_from(text: &str, row: i64, column: i64) -> Option<String> {
    if !text.starts_with('=') || text.len() == 1 {
        return None;
    }
    let chars: Vec<char> = text.chars().collect();
    // Whether a reference may end at `k`: a whole word, not a call nor a sheet's name.
    let ends_at = |k: usize| chars.get(k).is_none_or(|&c| ends_word(c) && c != '!') && !calls(&chars, k);
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            let end = quoted_end(&chars, i);
            out.extend(&chars[i..end]);
            i = end;
            continue;
        }
        if ends_word(c) {
            out.push(c);
            i += 1;
            continue;
        }
        if let Some((first, j)) = point_at(&chars, i) {
            let second = match chars.get(j) {
                Some(':') => point_at(&chars, j + 1).filter(|&(_, k)| ends_at(k)),
                _ => None,
            };
            if let Some((second, k)) = second {
                out.push_str(&format!("{}:{}", first.end(row, column)?, second.end(row, column)?));
                i = k;
                continue;
            }
            if ends_at(j) && !first.is_own_line() {
                out.push_str(&first.alone(row, column)?);
                i = j;
                continue;
            }
        }
        let end = (i..chars.len()).find(|&j| ends_word(chars[j])).unwrap_or(chars.len());
        out.extend(&chars[i..end]);
        i = end;
    }
    Some(out)
}

/// Where a text in quotes from `i` ends: after its closing quote (two of them are one inside), or at the end.
fn quoted_end(chars: &[char], i: usize) -> usize {
    let quote = chars[i];
    let mut j = i + 1;
    while j < chars.len() {
        if chars[j] == quote {
            if chars.get(j + 1) == Some(&quote) {
                j += 2;
                continue;
            }
            return j + 1;
        }
        j += 1;
    }
    j
}

/// Whether `(` follows, spaces aside.
fn calls(chars: &[char], mut i: usize) -> bool {
    while chars.get(i).is_some_and(|&c| matches!(c, ' ' | '\t' | '\n' | '\r')) {
        i += 1;
    }
    chars.get(i) == Some(&'(')
}

/// A row or a column of a reference by offsets: the cell's own (`R`), so many from it (`R[-1]`), or one by its
/// number (`R2`).
#[derive(Clone, Copy)]
enum Part {
    Own,
    By(i64),
    At(i64),
}

/// A reference by offsets: a row and a column (`R1C1`), or rows (`R1`) or columns (`C1`) alone.
struct Point {
    row: Option<Part>,
    column: Option<Part>,
}

/// The reference by offsets at `i`, in any case, and where it ends.
fn point_at(chars: &[char], i: usize) -> Option<(Point, usize)> {
    let (row, j) = match part_at(chars, i, 'R') {
        Some((part, j)) => (Some(part), j),
        None => (None, i),
    };
    let (column, k) = match part_at(chars, j, 'C') {
        Some((part, k)) => (Some(part), k),
        None => (None, j),
    };
    (row.is_some() || column.is_some()).then_some((Point { row, column }, k))
}

/// A part of a reference by offsets at `i`, its letter first, and where it ends: `R`, `R[-1]` or `R2` (a number
/// from 1, no `0` first).
fn part_at(chars: &[char], i: usize, letter: char) -> Option<(Part, usize)> {
    if !chars.get(i)?.eq_ignore_ascii_case(&letter) {
        return None;
    }
    let digits_from = |j: usize| (j..chars.len()).find(|&k| !chars[k].is_ascii_digit()).unwrap_or(chars.len());
    let number = |from: usize, to: usize| chars[from..to].iter().collect::<String>().parse::<i64>().ok();
    match chars.get(i + 1) {
        Some('[') => {
            let negative = chars.get(i + 2) == Some(&'-');
            let from = i + 2 + negative as usize;
            let to = digits_from(from);
            if to == from || chars.get(to) != Some(&']') {
                return Some((Part::Own, i + 1));
            }
            let n = number(from, to)?;
            Some((Part::By(if negative { -n } else { n }), to + 1))
        }
        Some(c) if c.is_ascii_digit() && *c != '0' => {
            let to = digits_from(i + 1);
            Some((Part::At(number(i + 1, to)?), to))
        }
        _ => Some((Part::Own, i + 1)),
    }
}

impl Part {
    /// The row or column it is from the cell's own (from 0); `None` off the sheet (of `most` lines).
    fn from(self, own: i64, most: i64) -> Option<i64> {
        let p = match self {
            Part::Own => own,
            Part::By(k) => own.checked_add(k)?,
            Part::At(n) => n - 1,
        };
        (0..most).contains(&p).then_some(p)
    }

    /// Whether it is fixed (`$`): one by its number.
    fn fixed(self) -> bool {
        matches!(self, Part::At(_))
    }
}

impl Point {
    /// Whether it is the cell's own row or column alone (`R`, `C`): an end of a range only.
    fn is_own_line(&self) -> bool {
        matches!((self.row, self.column), (Some(Part::Own), None) | (None, Some(Part::Own)))
    }

    /// The reference as an end of a range, written from a cell: `$A$1`, `B2`; a row `$1`, a column `$A`.
    fn end(&self, row: i64, column: i64) -> Option<String> {
        let dollar = |fixed: bool| if fixed { "$" } else { "" };
        let row = match self.row {
            Some(part) => format!("{}{}", dollar(part.fixed()), part.from(row, MOST_ROWS)? + 1),
            None => String::new(),
        };
        let column = match self.column {
            Some(part) => {
                format!("{}{}", dollar(part.fixed()), column_letters(part.from(column, MOST_COLUMNS)? as usize))
            }
            None => String::new(),
        };
        Some(column + &row)
    }

    /// The reference alone, written from a cell: a cell, or rows `$1:$1`, or columns `$A:$A`.
    fn alone(&self, row: i64, column: i64) -> Option<String> {
        let end = self.end(row, column)?;
        Some(if self.row.is_some() && self.column.is_some() { end } else { format!("{end}:{end}") })
    }
}

/// The errors a formula pasted from another program may hold.
fn is_kept(error: CellError) -> bool {
    matches!(
        error,
        CellError::Null | CellError::DivideByZero | CellError::Value | CellError::Number | CellError::NotAvailable
    )
}

/// Whether a formula is one pasted from another program: its calls of known functions, its names given
/// by a LET around them, its errors kept ones. `names` are those LETs around give.
fn checks(expr: &Expr, names: &mut Vec<Rc<str>>) -> bool {
    match expr {
        Expr::Number(_) | Expr::Text(_) | Expr::Boolean(_) | Expr::Reference(_) | Expr::Missing => true,
        Expr::Error(error) => is_kept(*error),
        Expr::Name(name) => names.contains(name),
        Expr::Array(array) => array.values().all(|v| !matches!(v, Value::Error(e) if !is_kept(*e))),
        Expr::Unary(_, a) => checks(a, names),
        Expr::Binary(_, a, b) => checks(a, names) && checks(b, names),
        Expr::Call { function: None, .. } => false,
        Expr::Call { name, arguments, .. } if name.eq_ignore_ascii_case("LET") => let_checks(arguments, names),
        Expr::Call { arguments, .. } => arguments.iter().all(|a| checks(a, names)),
    }
}

/// Whether a LET checks: each name it gives a name (once), each value checked with the names before it, and what
/// it answers with them all. One with fewer than three arguments, or an even number, isn't looked into.
fn let_checks(arguments: &[Expr], names: &mut Vec<Rc<str>>) -> bool {
    if arguments.len() < 3 || arguments.len() % 2 == 0 {
        return true;
    }
    let around = names.len();
    let (pairs, answer) = arguments.split_at(arguments.len() - 1);
    let mut fine = true;
    for pair in pairs.chunks(2) {
        let Expr::Name(name) = &pair[0] else {
            fine = false;
            break;
        };
        if names[around..].contains(name) || !checks(&pair[1], names) {
            fine = false;
            break;
        }
        names.push(name.clone());
    }
    let fine = fine && checks(&answer[0], names);
    names.truncate(around);
    fine
}

/// Whether a LET (of three arguments or more, an odd number) gives a name written in parentheses (`LET((x),1,x)`):
/// no name is read there, though the formula as parsed (which keeps no parentheses) has one.
fn names_in_parentheses(pieces: &[String]) -> bool {
    let chars: Vec<char> = pieces.join("A1").chars().collect();
    // Each parenthesis and brace open: whether it is a LET's, and the first character of each of its arguments.
    let mut open: Vec<(bool, Vec<Option<char>>)> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some((_, arguments)) = open.last_mut() {
            let first = arguments.last_mut().expect("an argument");
            if first.is_none() && !c.is_whitespace() && !matches!(c, ',' | ')' | '}') {
                *first = Some(c);
            }
        }
        match c {
            '"' | '\'' => {
                i = quoted_end(&chars, i);
                continue;
            }
            '(' | '{' => {
                let word: String = chars[..i].iter().rev().take_while(|&&c| !ends_word(c)).collect();
                open.push((c == '(' && word.eq_ignore_ascii_case("TEL"), vec![None]));
            }
            ',' => {
                if let Some((_, arguments)) = open.last_mut() {
                    arguments.push(None);
                }
            }
            ')' | '}' => {
                if let Some((true, arguments)) = open.pop() {
                    let n = arguments.len();
                    let mut names = arguments[..n - 1].iter().step_by(2);
                    if n >= 3 && n % 2 == 1 && names.any(|first| *first == Some('(')) {
                        return true;
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    false
}

/// The formats cells of another program set where they land: those of the cells pasted over taken away, then each
/// cell's look, with its formula's number format where that landed (at `formulas`). The looks are grouped into
/// blocks over all the cells pasted on, as a workbook's formats are.
pub(super) fn looks_given(
    bases: &Bases,
    sheet: &Sheet,
    ids: &Sheet,
    landing: &Landing,
    looks: &Looks,
    formulas: &HashSet<(usize, usize)>,
) -> Vec<Op> {
    let what = What::Cells { colors: true };
    let (rows, columns) = (landing.area_rows(), landing.area_columns());
    let taken = taken_away(bases, sheet, ids, &rows, &columns, |leaf| what.pastes(leaf));
    let (top, left) = (rows[0], columns[0]);
    // The leaves by place, counted from the top left of the cells pasted on.
    let mut counted = Bases::default();
    let base = counted.intern("");
    let mut leaves: Vec<(Leaf, (LineId, LineId), &Json)> = Vec::new();
    for &t in &landing.rows {
        for &l in &landing.columns {
            for (&(row, column), look) in &looks.of_cells {
                let place = (t + row as usize, l + column as usize);
                let number_format =
                    if formulas.contains(&place) { &look.formula_number_format } else { &look.number_format };
                let at = (LineId { base, n: (place.0 - top) as u32 }, LineId { base, n: (place.1 - left) as u32 });
                let number_format = number_format.iter().map(|f| (Leaf::NumberFormat, f));
                for (leaf, value) in look.leaves.iter().map(|(&leaf, value)| (leaf, value)).chain(number_format) {
                    leaves.push((leaf, at, value));
                }
            }
        }
    }
    let spans = |runs: Vec<IdRun>| runs.into_iter().map(|run| Span { first: run.first, count: run.count }).collect();
    let formats: Vec<CopiedFormat> = blocks(&counted, leaves.into_iter())
        .into_iter()
        .map(|(rows, columns, format)| CopiedFormat { rows: spans(rows), columns: spans(columns), format })
        .collect();
    let once = Landing { rows: vec![top], columns: vec![left], row_count: 1, column_count: 1 };
    taken.into_iter().chain(formats_given(bases, sheet, ids, &once, &formats, what)).collect()
}
