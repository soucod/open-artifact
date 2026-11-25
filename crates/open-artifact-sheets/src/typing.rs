//! Typed text as it is read: the operations of a `pasteTexts` edit (texts pasted into cells) and of an
//! `enter` edit (one cell given a text, a day or a dropdown's option), or the refusal.
//!
//! A text is read in a locale (the pasted texts' `localeOfTexts`, else the workbook's): nothing empties the cell;
//! `'` first keeps the rest as text; `=` first is a formula (`typing/formula.rs`); `TRUE` and `FALSE` in any
//! capitals are booleans; a number, money, a percentage, a date or a time written the locale's way is a number
//! (`typing/reading.rs`); anything else is text. A number brings a pattern for its cell (`1,000` brings `#,##0`,
//! `5%` brings `0%`), which the cell takes unless its own pattern already shows that kind of number; a cell that
//! shows text (`@`) keeps such a number as the text typed. Pasted in a column with a grouped number, a plain number
//! that shows its digits as written grouped is grouped too (`7` brings `#,##0`, `7.25` `#,##0.00`). A cell with a
//! dropdown takes the option whose label the text is (spaces and capitals aside), else the text as any cell: the edit
//! is refused when its operations leave more cells with dropdowns holding no option than there were
//! (`cellOfDropdownHoldsNoOption`, `options_kept`). That is found once they are applied, and they are taken back:
//! what they touched is told all the same (`session/edits`). A checkbox reads `TRUE` and `FALSE`.
//!
//! A paste whose formulas have many words of their own is first shown to the person (`typing/unseen.rs`): the
//! answer is `toBeShownFirst` with those texts until the edit is queued with exactly them as `shownToThePerson`
//! (`paste_texts_shown`), and refuses a paste with more than 50 of them (`tooMuchThatNoCellShows`). Queued with no
//! `shownToThePerson` (null or left out), a paste shows nothing first and is not refused for them. A formula some
//! cell holds already is not shown, by its text between references as kept: in any sheet, deleted rows, columns and
//! sheets too, whoever put it there (`=sum(` is not `=SUM(`); nor is a formula with the text between references of
//! one shown before it in the paste.
//!
//! The edit is read strictly: a field it doesn't have, a field missing, or a value of the wrong shape refuses it
//! (`unreadableRequest`). An edit that changes nothing answers no operations (`nothingToChange`).

pub(crate) mod formula;
mod in_cells;
mod lists;
mod looks;
mod people;
pub(crate) mod reading;
pub(crate) mod unseen;

use hashbrown::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::dates;
use crate::formula::StoredFormula;
use crate::formula_text;
use crate::ids::LineId;
use crate::locale::{self, Locale};
use crate::number_format::{Kind, NumberFormat};
use crate::workbook::grid::CellForm;
use crate::workbook::formats::{blocks, Leaf};
use crate::workbook::load::{CellToSet, CellsToFormat, Op, Refusal};
use crate::workbook::{Input, Sheet, Workbook};

pub use formula::from_locale;
pub use in_cells::{clear_cells, enter_in_cells, paste_rows_of_texts};
pub use lists::set_list_line_checked;
pub use looks::{enter_text_with_looks_in_cells, is_kept_rich_text};
pub use people::{are_kept_people, change_people, is_kept_person};
use reading::{Reading, Shape, ShapeKind};

/// A text pasted into a cell.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypedCell {
    pub r: String,
    pub c: String,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PastedTextIs {
    AsTyped,
    WrittenFromACell,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum PasteEdit {
    #[serde(rename_all = "camelCase")]
    PasteTexts {
        sheet_id: String,
        cells: Vec<TypedCell>,
        pasted_text_is: PastedTextIs,
        #[serde(default)]
        locale_of_texts: Option<String>,
    },
}

/// A cell by its row and column ids.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellAt {
    pub r: String,
    pub c: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Entry {
    Text { text: String },
    Day { day: String },
    #[serde(rename_all = "camelCase")]
    DropdownOption { option_id: String },
    /// A person, by their id and name (`typing/people.rs`).
    #[serde(rename_all = "camelCase")]
    User { user_id: String, name: String },
    /// Text with looks (`typing/looks.rs`), typed into the one cell.
    TextWithLooks { paragraphs: Vec<crate::workbook::rich::Paragraph> },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum EnterEdit {
    #[serde(rename_all = "camelCase")]
    Enter { sheet_id: String, cell: CellAt, entry: Entry },
}

/// The most bytes of UTF-8 a text may have (a `'` first aside), a formula may have, and the most references a
/// formula may have.
pub(crate) const LONGEST_TEXT: usize = 32767;
const LONGEST_FORMULA: usize = 8192;
const MOST_REFERENCES: usize = 256;

/// What one cell is given: its new input (`None` empties it) and the pattern it takes, if its own changes.
struct Change {
    input: Option<Input>,
    pattern: Option<String>,
}

/// How the text came: typed into the cell, or pasted.
#[derive(Clone, Copy, PartialEq, Eq)]
enum How {
    Entered,
    Pasted(PastedTextIs),
}

/// A formula pasted with more than a few words of its own, which the person is shown before it is pasted
/// (`typing/unseen.rs`): its cell, and its text as the workbook's locale writes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextThatNoCellShows {
    pub r: String,
    pub c: String,
    pub written: String,
}


/// What a `pasteTexts` edit answers, given what the person has been shown.
#[derive(Clone, Debug)]
pub enum Pasted {
    Ops(Vec<Op>),
    /// `toBeShownFirst`: the texts to show the person (each once, in the order of their cells) before
    /// the edit is queued again with exactly them as `shownToThePerson`.
    ToBeShownFirst(Vec<TextThatNoCellShows>),
}

/// Whether a cell's text, typed into it again in the locale, would read as something else (`123`, `=x`, `'abc`),
/// or is a month and a day with no year, which other spreadsheets read as a date (`1/2`).
pub fn is_read_otherwise(text: &str, locale: &Locale) -> bool {
    reading::is_read_otherwise(text, reading::Locales { text: locale, workbook: locale })
}

/// The number a text is when typed in the locale (money, a percentage, a date or a time written the locale's way),
/// or `None`: not `TRUE` or `FALSE`, a formula or a `'` text, which are no numbers.
pub fn number_of(text: &str, locale: &Locale) -> Option<f64> {
    reading::number(text, reading::Locales { text: locale, workbook: locale }).map(|(n, _)| n)
}

/// Texts typed into cells of a sheet as a `pasteTexts` edit reads them as typed, in the workbook's locale, with
/// nothing shown first (an imported column read as typed): each text's length checked, then the cells' inputs in
/// the order given, then the patterns that change; or the refusal of a text or formula too long. The cells
/// have no dropdowns.
pub(crate) fn type_as_pasted(
    workbook: &Workbook,
    s: usize,
    texts: &[((LineId, LineId), &str)],
) -> Result<Vec<Op>, Refusal> {
    let locale = workbook_locale(workbook);
    let how = How::Pasted(PastedTextIs::AsTyped);
    let readings = pasted_readings(workbook, texts.iter().map(|&(_, text)| text), locale);
    for reading in &readings {
        check_reading_length(workbook, s, reading, locale)?;
    }
    let read = texts.iter().zip(readings).map(|(&(place, text), reading)| (place, text, reading));
    let changes = pasted_changes(workbook, s, read.collect(), locale, how);
    let order: Vec<(LineId, LineId)> = texts.iter().map(|&(place, _)| place).collect();
    Ok(ops_of(workbook, &workbook.sheets[s], &order, &changes))
}

/// The operations of a `pasteTexts` edit (`edit` is the edit's whole JSON object, kind included), or the
/// refusal, as when the person has been shown every text there is to show (see `paste_texts_shown`).
pub fn paste_texts(workbook: &Workbook, edit: &Value) -> Result<Vec<Op>, Refusal> {
    match paste(workbook, edit, None)? {
        Pasted::Ops(ops) => Ok(ops),
        Pasted::ToBeShownFirst(_) => unreachable!("nothing is shown first when everything has been"),
    }
}

/// A `pasteTexts` edit queued with `shownToThePerson`: its operations, the texts to show the person first when
/// there are some they have not seen and they are not exactly the texts shown, or the refusal.
pub fn paste_texts_shown(
    workbook: &Workbook,
    edit: &Value,
    shown_to_the_person: Option<&[TextThatNoCellShows]>,
) -> Result<Pasted, Refusal> {
    paste(workbook, edit, shown_to_the_person)
}

fn paste(workbook: &Workbook, edit: &Value, shown: Option<&[TextThatNoCellShows]>) -> Result<Pasted, Refusal> {
    let PasteEdit::PasteTexts { sheet_id, cells, pasted_text_is, locale_of_texts } =
        PasteEdit::deserialize(edit).map_err(|_| Refusal::UnreadableRequest)?;
    let locale = locale_of(workbook, locale_of_texts.as_deref())?;
    let s = workbook.sheet_index(&sheet_id).ok_or(Refusal::UnknownSheet)?;
    paste_cells(workbook, workbook, s, &cells, pasted_text_is, locale, shown)
}

/// The texts' locale: the one named, else the workbook's.
fn locale_of(workbook: &Workbook, tag: Option<&str>) -> Result<&'static Locale, Refusal> {
    match tag {
        Some(tag) => locale::find(tag).ok_or(Refusal::UnreadableRequest),
        None => Ok(workbook_locale(workbook)),
    }
}

/// Texts pasted into cells of sheet `s` (`pasteTexts`, and `pasteRowsOfTexts` once it knows where each lands, in
/// `workbook` grown by the lines it adds to `before`).
fn paste_cells(
    workbook: &Workbook,
    before: &Workbook,
    s: usize,
    cells: &[TypedCell],
    pasted_text_is: PastedTextIs,
    locale: &Locale,
    shown: Option<&[TextThatNoCellShows]>,
) -> Result<Pasted, Refusal> {
    let sheet = &workbook.sheets[s];
    if cells.is_empty() {
        return Ok(Pasted::Ops(Vec::new()));
    }
    let how = How::Pasted(pasted_text_is);
    // A cell named twice takes its last text, in the place of its last; then the cells' rows and columns, then
    // whether a merged range covers one given something, then the texts' lengths, then the texts to show first,
    // then what each cell takes.
    let last_named: HashMap<(&str, &str), usize> = cells.iter().enumerate().map(|(i, cell)| ((cell.r.as_str(), cell.c.as_str()), i)).collect();
    let mut named: Vec<((LineId, LineId), bool, &str)> = Vec::with_capacity(cells.len());
    for (i, cell) in cells.iter().enumerate() {
        if last_named[&(cell.r.as_str(), cell.c.as_str())] != i {
            continue;
        }
        let (place, covered) = cell_of(workbook, sheet, &cell.r, &cell.c)?;
        named.push((place, covered, &cell.text));
    }
    let last: HashMap<(LineId, LineId), usize> = named.iter().enumerate().map(|(i, &(place, ..))| (place, i)).collect();
    let texts: Vec<_> = named.iter().enumerate().filter(|&(i, (place, ..))| last[place] == i).map(|(_, &t)| t).collect();
    if texts.iter().any(|&(_, covered, text)| covered && !text.is_empty()) {
        return Err(Refusal::CellCoveredByMergedRange);
    }
    let readings = pasted_readings(workbook, texts.iter().map(|&(_, _, text)| text), locale);
    for reading in &readings {
        check_reading_length(workbook, s, reading, locale)?;
    }
    // Only a paste the page shows the person first (`shownToThePerson` given) counts the texts no cell shows: with
    // none (an agent's write), however many there are, nothing is asked or refused.
    if let Some(shown) = shown {
        let to_show = texts_to_show(workbook, s, texts.iter().map(|&(place, ..)| place).zip(&readings), locale);
        if to_show.len() > unseen::MOST_TEXTS {
            return Err(Refusal::TooMuchThatNoCellShows);
        }
        if !to_show.is_empty() && !were_shown(before, &to_show, shown) {
            return Ok(Pasted::ToBeShownFirst(to_show));
        }
    }
    let read = texts.iter().zip(readings).map(|(&(place, _, text), reading)| (place, text, reading));
    let changes = pasted_changes(workbook, s, read.collect(), locale, how);
    let order: Vec<(LineId, LineId)> = texts.iter().map(|&(place, ..)| place).collect();
    Ok(Pasted::Ops(ops_of(workbook, sheet, &order, &changes)))
}

/// Whether the texts to show are the ones the person was shown, compared in order, each by its
/// text and by its row and column as the workbook knew them before the paste (in any sheet, deleted ones too). An id
/// the workbook never knew, malformed or not, and a line the paste adds are alike unknown, so they match each other.
/// The clipboard's pastes compare so too.
pub(crate) fn were_shown(before: &Workbook, to_show: &[TextThatNoCellShows], shown: &[TextThatNoCellShows]) -> bool {
    let row = |id: &str| before.bases.parse(id).filter(|&line| before.sheets.iter().any(|sheet| sheet.rows.knows(line)));
    let column =
        |id: &str| before.bases.parse(id).filter(|&line| before.sheets.iter().any(|sheet| sheet.columns.knows(line)));
    to_show.len() == shown.len()
        && to_show.iter().zip(shown).all(|(a, b)| a.written == b.written && row(&a.r) == row(&b.r) && column(&a.c) == column(&b.c))
}

/// Texts pasted as a paste reads them (never as typed into a cell, so every read of one is the same), each once.
fn pasted_readings<'a>(workbook: &Workbook, texts: impl Iterator<Item = &'a str>, locale: &Locale) -> Vec<Reading> {
    texts.map(|text| reading::read(text, locales_of(workbook, locale), false)).collect()
}

/// What texts pasted give their cells, given how each reads ([`pasted_readings`]). In a column given a grouped
/// number (`1,000`), plain numbers are grouped too (`grouped_change`).
fn pasted_changes(
    workbook: &Workbook,
    s: usize,
    texts: Vec<((LineId, LineId), &str, Reading)>,
    locale: &Locale,
    how: How,
) -> HashMap<(LineId, LineId), Change> {
    let grouped: HashSet<LineId> = texts
        .iter()
        .filter(|(_, _, reading)| matches!(reading, Reading::Number(_, shape) if shape.kind == ShapeKind::Grouped))
        .map(|&((_, c), ..)| c)
        .collect();
    let mut changes: HashMap<(LineId, LineId), Change> = HashMap::with_capacity(texts.len());
    for (place, text, reading) in texts {
        let change = if grouped.contains(&place.1) {
            grouped_change(workbook, s, place, text, reading, locale, how)
        } else {
            let read = || read_change(workbook, s, place, text, reading, locale, how);
            dropdown_change(workbook, s, place, text, locale, how).unwrap_or_else(read)
        };
        changes.insert(place, change);
    }
    changes
}

/// The formulas pasted that weigh too much to paste unseen, in the order of their cells: each text between
/// references once, and none the workbook's formulas have (`typing/unseen.rs`).
fn texts_to_show<'a>(
    workbook: &Workbook,
    s: usize,
    texts: impl Iterator<Item = ((LineId, LineId), &'a Reading)>,
    locale: &Locale,
) -> Vec<TextThatNoCellShows> {
    let heavy: Vec<((LineId, LineId), crate::formula::StoredFormula)> = texts
        .filter_map(|(place, reading)| {
            let Reading::Formula(t) = reading else { return None };
            let stored = formula::stored(t, workbook, s, locale);
            (unseen::weight(&stored.text_between_references) > unseen::MOST_WEIGHT).then_some((place, stored))
        })
        .collect();
    let mut seen = if heavy.is_empty() { Default::default() } else { unseen::seen(workbook) };
    let mut to_show: Vec<TextThatNoCellShows> = Vec::new();
    for (place, stored) in &heavy {
        if seen.insert(&stored.text_between_references) {
            let written = formula_text::in_locale(&workbook.formula_text(s, stored), workbook_locale(workbook));
            let (r, c) = (workbook.bases.text(place.0), workbook.bases.text(place.1));
            to_show.push(TextThatNoCellShows { r, c, written });
        }
    }
    to_show
}

/// Whether an edit of the cells reads (`edit` is the whole JSON object): its fields as they are read, a day that
/// is one, a locale known. An edit is read so before anything else about it (`unreadableRequest`
/// comes before `opIdInUse`).
pub fn reads(edit: &Value) -> bool {
    match edit.get("kind").and_then(Value::as_str) {
        Some("enter") => match EnterEdit::deserialize(edit) {
            Ok(EnterEdit::Enter { entry: Entry::Day { day }, .. }) => day_of(&day).is_some(),
            Ok(_) => true,
            Err(_) => false,
        },
        Some("pasteTexts") => match PasteEdit::deserialize(edit) {
            Ok(PasteEdit::PasteTexts { locale_of_texts, .. }) => {
                locale_of_texts.is_none_or(|tag| locale::find(&tag).is_some())
            }
            Err(_) => false,
        },
        Some("enterInCells" | "pasteRowsOfTexts" | "clearCells") => in_cells::reads(edit),
        Some("enterTextWithLooksInCells") => looks::reads(edit),
        Some("addUserToCell" | "removeUserFromCell") => people::reads(edit),
        Some("setListLineChecked") => lists::reads(edit),
        _ => false,
    }
}

/// The operations of an `enter` edit (`edit` is the whole JSON object), or the refusal.
pub fn enter(workbook: &Workbook, edit: &Value) -> Result<Vec<Op>, Refusal> {
    let EnterEdit::Enter { sheet_id, cell, entry } = EnterEdit::deserialize(edit).map_err(|_| Refusal::UnreadableRequest)?;
    let day = match &entry {
        Entry::Day { day } => Some(day_of(day).ok_or(Refusal::UnreadableRequest)?),
        _ => None,
    };
    let s = workbook.sheet_index(&sheet_id).ok_or(Refusal::UnknownSheet)?;
    let sheet = &workbook.sheets[s];
    let (place, covered) = cell_of(workbook, sheet, &cell.r, &cell.c)?;
    let locale = workbook_locale(workbook);
    let change = match entry {
        // As `enterTextWithLooksInCells` types it into the one cell. A cell a merged range covers takes it only when
        // its text (none, or typed as `enter` types a text) leaves what the cell holds as it is, and then takes its
        // looks too.
        Entry::TextWithLooks { paragraphs } => {
            let text = looks::plain_of(&paragraphs);
            if covered && !text.is_empty() {
                let now = sheet.cells.get(&place).map(|c| &c.input);
                let change = change_of(workbook, s, place, &text, locale, How::Entered);
                if now.is_none() || change.pattern.is_some() || change.input.as_ref() != now {
                    return Err(Refusal::CellCoveredByMergedRange);
                }
            }
            return looks::enter_in_cell(workbook, s, place, paragraphs);
        }
        Entry::Text { text } => {
            // A cell a merged range covers takes nothing, though typing again what it holds changes nothing.
            if covered && !text.is_empty() {
                let now = sheet.cells.get(&place).map(|c| &c.input);
                let change = change_of(workbook, s, place, &text, locale, How::Entered);
                if now.is_some() && change.pattern.is_none() && change.input.as_ref() == now {
                    return Ok(Vec::new());
                }
                return Err(Refusal::CellCoveredByMergedRange);
            }
            check_length(workbook, s, &text, locale, How::Entered)?;
            change_of(workbook, s, place, &text, locale, How::Entered)
        }
        Entry::Day { .. } => {
            let (y, m, d) = day.expect("a day read");
            // Kept as text, it is the day as the locale writes a short date.
            let shape = Shape { kind: ShapeKind::Date, pattern: Some("m/d/yyyy".to_owned()), hundredth: None, in_parentheses: false, cents_given: false };
            // A cell that shows a date and a time, holding a number, keeps its time of day (the part past the day).
            let kind = NumberFormat::parse(&pattern_of(sheet, place)).map(|f| f.kind()).ok();
            let time = match sheet.cells.get(&place).map(|cell| &cell.input) {
                Some(Input::Number { value }) if kind == Some(Kind::DateAndTime) => value - value.floor(),
                _ => 0.0,
            };
            let serial = dates::serial_from_date(y, m, d) as f64 + time;
            number_change(sheet, place, serial, &shape, &locale.short_date.show(y, m, d), How::Entered)
        }
        Entry::DropdownOption { option_id } => {
            let options = dropdown_of(sheet, place).ok_or(Refusal::UnknownDropdown)?;
            let option = options.iter().find(|o| o.option_id == option_id).ok_or(Refusal::UnknownDropdownOption)?;
            Change { input: Some(Input::DropdownOption { option_id: option.option_id.clone(), label: option.label.clone() }), pattern: None }
        }
        Entry::User { user_id, name } => Change { input: Some(people::person(&user_id, &name)?), pattern: None },
    };
    let now = sheet.cells.get(&place).map(|c| &c.input);
    if change.pattern.is_none() && change.input.as_ref() == now {
        return Ok(Vec::new());
    }
    if covered && change.input.is_some() {
        return Err(Refusal::CellCoveredByMergedRange);
    }
    let changes = HashMap::from([(place, change)]);
    Ok(ops_of(workbook, sheet, &[place], &changes))
}

/// The operations that would give a cell a text typed into it, for the value it would come to
/// (`readProposedFormulaValue`): as `enter` gives it, except that a text naming no option of the cell's dropdown is
/// what it reads as. `None`: the text is empty, and the cell would hold nothing.
pub fn proposed(workbook: &Workbook, sheet_id: &str, cell: &CellAt, text: &str) -> Result<Option<Vec<Op>>, Refusal> {
    let s = workbook.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
    let sheet = &workbook.sheets[s];
    let (place, covered) = cell_of(workbook, sheet, &cell.r, &cell.c)?;
    if text.is_empty() {
        return Ok(None);
    }
    if covered {
        return Err(Refusal::CellCoveredByMergedRange);
    }
    let locale = workbook_locale(workbook);
    check_length(workbook, s, text, locale, How::Entered)?;
    let change = match option_change(workbook, s, place, text, locale, How::Entered) {
        Some(change) => change,
        None => {
            let reading = reading::read(text, locales_of(workbook, locale), true);
            read_change(workbook, s, place, text, reading, locale, How::Entered)
        }
    };
    let changes = HashMap::from([(place, change)]);
    Ok(Some(ops_of(workbook, sheet, &[place], &changes)))
}

/// A formula typed on a sheet (`readTypedFormula`), as a cell keeps it: its text the en-US way, its references by
/// the ids of the cells they name. Any text is kept so, a formula or not.
pub fn typed_formula(workbook: &Workbook, s: usize, text: &str) -> StoredFormula {
    formula::stored(text, workbook, s, workbook_locale(workbook))
}

fn workbook_locale(workbook: &Workbook) -> &'static Locale {
    locale::find(&workbook.locale).unwrap_or_else(locale::en_us)
}

/// A text's locale, with the workbook's.
fn locales_of<'a>(workbook: &Workbook, text: &'a Locale) -> reading::Locales<'a> {
    reading::Locales { text, workbook: workbook_locale(workbook) }
}

/// A cell of the sheet by its row and column ids, and whether a merged range covers it (it is in one, not first; of
/// the ranges the sheet reads back).
fn cell_of(workbook: &Workbook, sheet: &Sheet, r: &str, c: &str) -> Result<((LineId, LineId), bool), Refusal> {
    let row = workbook.bases.parse(r).filter(|&l| sheet.rows.contains(l)).ok_or(Refusal::UnknownRow)?;
    let column = workbook.bases.parse(c).filter(|&l| sheet.columns.contains(l)).ok_or(Refusal::UnknownColumn)?;
    let (r, c) = (sheet.rows.position(row), sheet.columns.position(column));
    // The merged ranges as read back: one overlapping another kept, or left with one cell, hides nothing.
    for (top, bottom, left, right) in crate::workbook::layout::merged_boxes(&workbook.bases, sheet) {
        let inside = r.is_some_and(|r| (top..=bottom).contains(&r)) && c.is_some_and(|c| (left..=right).contains(&c));
        if inside && (r, c) != (Some(top), Some(left)) {
            return Ok(((row, column), true));
        }
    }
    Ok(((row, column), false))
}

/// The options of the dropdown a cell has, if it has one.
pub(crate) fn dropdown_of(
    sheet: &Sheet,
    place: (LineId, LineId),
) -> Option<&[crate::workbook::objects::DropdownOption]> {
    let control = sheet.formats.get(Leaf::CellControl, place)?;
    if control["kind"] != "dropdown" {
        return None;
    }
    let id = control["dropdownId"].as_str()?;
    sheet.dropdowns.values().find(|(dropdown_id, _)| dropdown_id == id).map(|(_, options)| options.as_slice())
}

/// Whether operations keep the cells with a dropdown holding its options, as an edit's operations are checked
/// once applied (else they are taken back, `cellOfDropdownHoldsNoOption`): they may not leave more cells holding
/// something else than there were. So a cell that holds something else already may be given something else again,
/// or pass it to another.
pub fn options_kept(workbook: &Workbook, ops: &[Op]) -> bool {
    let Some(before) = cells_holding_no_option(workbook) else { return true };
    let mut after = workbook.clone();
    if ops.is_empty() || after.apply(ops).is_err() {
        return true;
    }
    cells_holding_no_option(&after).is_none_or(|n| n <= before)
}

/// How many cells hold something the dropdown they have does not offer: an input but one of its options (a dropdown
/// the sheet no longer has offers none; an empty cell holds nothing). None when no sheet has a dropdown, nor a cell
/// one: then an edit can give no cell one.
fn cells_holding_no_option(workbook: &Workbook) -> Option<usize> {
    let mut controls = false;
    let mut count = 0;
    for sheet in &workbook.sheets {
        for (_, place, control) in sheet.formats.iter().filter(|&(leaf, ..)| leaf == Leaf::CellControl) {
            if control["kind"] != "dropdown" {
                continue;
            }
            controls = true;
            let Some(cell) = sheet.cells.get(&place) else { continue };
            let offered = match (&cell.input, dropdown_of(sheet, place)) {
                (Input::DropdownOption { option_id, .. }, Some(options)) => {
                    options.iter().any(|o| &o.option_id == option_id)
                }
                _ => false,
            };
            count += usize::from(!offered);
        }
    }
    (controls || workbook.sheets.iter().any(|sheet| !sheet.dropdowns.is_empty())).then_some(count)
}

/// What a text gives a cell.
fn change_of(workbook: &Workbook, s: usize, place: (LineId, LineId), text: &str, locale: &Locale, how: How) -> Change {
    let read = || {
        let reading = reading::read(text, locales_of(workbook, locale), how == How::Entered);
        read_change(workbook, s, place, text, reading, locale, how)
    };
    dropdown_change(workbook, s, place, text, locale, how).unwrap_or_else(read)
}

/// What a text pasted in a column given a grouped number too gives its cell: as anywhere, but a plain number that
/// shows its digits as written grouped (`reading::grouped_alike`: `7`, `7.25`) is read as grouped, bringing
/// `#,##0` or `#,##0.00`, unless its cell shows text.
fn grouped_change(
    workbook: &Workbook,
    s: usize,
    place: (LineId, LineId),
    text: &str,
    reading: Reading,
    locale: &Locale,
    how: How,
) -> Change {
    let sheet = &workbook.sheets[s];
    let read = || {
        let shows_text = kind_of(&pattern_of(sheet, place)) == Kind::Text;
        match (reading, reading::grouped_alike(text, locale)) {
            (Reading::Number(n, shape), Some(pattern)) if shape.kind == ShapeKind::Plain && !shows_text => {
                let shape = Shape { kind: ShapeKind::Grouped, pattern: Some(pattern.to_owned()), ..shape };
                number_change(sheet, place, n, &shape, text, how)
            }
            (reading, _) => read_change(workbook, s, place, text, reading, locale, how),
        }
    };
    dropdown_change(workbook, s, place, text, locale, how).unwrap_or_else(read)
}

/// What a text gives a cell with a dropdown: none (emptied) when the text is empty, else the option it names. `None`
/// when the cell has no dropdown or the text names no option: it is read as in any cell, and `options_kept` tells
/// whether that may be once the edit's operations are made.
fn dropdown_change(
    workbook: &Workbook,
    s: usize,
    place: (LineId, LineId),
    text: &str,
    locale: &Locale,
    how: How,
) -> Option<Change> {
    dropdown_of(&workbook.sheets[s], place)?;
    if text.is_empty() {
        return Some(Change { input: None, pattern: None });
    }
    option_change(workbook, s, place, text, locale, how)
}

/// The option of the cell's dropdown a text names (spaces and capitals aside), if it has a dropdown with one.
fn option_change(
    workbook: &Workbook,
    s: usize,
    place: (LineId, LineId),
    text: &str,
    locale: &Locale,
    how: How,
) -> Option<Change> {
    let options = dropdown_of(&workbook.sheets[s], place)?;
    let wanted = reading::unquoted(text, locales_of(workbook, locale), how == How::Entered).trim().to_lowercase();
    let option = options.iter().find(|o| o.label.to_lowercase() == wanted)?;
    let input = Input::DropdownOption { option_id: option.option_id.clone(), label: option.label.clone() };
    Some(Change { input: Some(input), pattern: None })
}

/// What a text gives a cell as it reads, whatever control the cell has.
fn read_change(
    workbook: &Workbook,
    s: usize,
    place: (LineId, LineId),
    text: &str,
    reading: Reading,
    locale: &Locale,
    how: How,
) -> Change {
    let sheet = &workbook.sheets[s];
    match reading {
        Reading::Empty => Change { input: None, pattern: None },
        Reading::Text(t) => Change { input: Some(Input::Text { value: t }), pattern: None },
        Reading::Boolean(b) => Change { input: Some(Input::Boolean { value: b }), pattern: None },
        Reading::Formula(t) => Change { input: Some(Input::Formula { formula: formula::stored(&t, workbook, s, locale) }), pattern: None },
        Reading::Number(n, shape) => number_change(sheet, place, n, &shape, text, how),
    }
}

/// Refuses a text that reads as too long a text, or too long a formula (in bytes, or in references), whatever cell
/// it is for.
fn check_length(workbook: &Workbook, s: usize, text: &str, locale: &Locale, how: How) -> Result<(), Refusal> {
    check_reading_length(workbook, s, &reading::read(text, locales_of(workbook, locale), how == How::Entered), locale)
}

/// The same, given how the text reads.
fn check_reading_length(workbook: &Workbook, s: usize, reading: &Reading, locale: &Locale) -> Result<(), Refusal> {
    match reading {
        Reading::Text(t) if t.len() > LONGEST_TEXT => Err(Refusal::TextTooLong),
        Reading::Formula(t) if t.len() > LONGEST_FORMULA => Err(Refusal::FormulaTooLong),
        Reading::Formula(t) if formula::stored(t, workbook, s, locale).references.len() > MOST_REFERENCES => {
            Err(Refusal::FormulaTooLong)
        }
        _ => Ok(()),
    }
}

/// The pattern a cell shows.
fn pattern_of(sheet: &Sheet, place: (LineId, LineId)) -> String {
    sheet.formats.value(Leaf::NumberFormat, place)["pattern"].as_str().unwrap_or("General").to_owned()
}

/// A number typed into a cell: the cell keeps its pattern when that shows such a number, else takes the one the
/// number brings. A cell that shows text keeps a number as the text typed; a text written from a cell stays the
/// number it shows, the cell's
/// pattern unchanged. A plain number
/// typed into a cell that shows percentages is that many hundredths.
fn number_change(sheet: &Sheet, place: (LineId, LineId), n: f64, shape: &Shape, text: &str, how: How) -> Change {
    let pattern = pattern_of(sheet, place);
    let kind = kind_of(&pattern);
    let n = match shape.hundredth {
        Some(hundredth) if how == How::Entered && kind == Kind::Percent => hundredth,
        _ => n,
    };
    let number = Some(Input::Number { value: n });
    if kind == Kind::Text {
        let as_typed = how != How::Pasted(PastedTextIs::WrittenFromACell);
        let input = if as_typed { Input::Text { value: text.to_owned() } } else { Input::Number { value: n } };
        return Change { input: Some(input), pattern: None };
    }
    let wanted = if kept_as(kind, &pattern, n, shape) {
        None
    } else {
        match &shape.pattern {
            Some(p) if shape.cents_given && how == How::Pasted(PastedTextIs::WrittenFromACell) => Some(p.replacen(".00", "", 1)),
            Some(p) => Some(p.clone()),
            None => Some("General".to_owned()),
        }
    };
    Change { input: number, pattern: wanted.filter(|p| *p != pattern) }
}

/// Whether a cell keeps its pattern for a number read with a shape: when the pattern shows such a number.
pub(crate) fn pattern_kept(pattern: &str, n: f64, shape: &Shape) -> bool {
    kept_as(kind_of(pattern), pattern, n, shape)
}

/// What a pattern shows (a pattern unread shows numbers as General does).
fn kind_of(pattern: &str) -> Kind {
    NumberFormat::kind_of(pattern).0
}

/// `pattern_kept`, the pattern's kind known.
fn kept_as(kind: Kind, pattern: &str, n: f64, shape: &Shape) -> bool {
    // A cell that shows times of day keeps a number that is a time of the day, to the nearest second.
    let in_a_day = (n * 24.0 * 60.0 * 60.0).round();
    let in_a_day = (0.0..86_400.0).contains(&in_a_day);
    match shape.kind {
        ShapeKind::Plain => kind != Kind::Time || in_a_day,
        ShapeKind::Grouped => kind != Kind::General && (kind != Kind::Time || in_a_day),
        ShapeKind::Percent => kind == Kind::Percent,
        ShapeKind::Currency => {
            kind == Kind::Currency
                && reading::currency_of(pattern) == shape.pattern.as_deref().and_then(reading::currency_of)
        }
        ShapeKind::Date => matches!(kind, Kind::Date | Kind::DateAndTime),
        ShapeKind::Time => matches!(kind, Kind::Time | Kind::Duration),
        ShapeKind::TimeOfHalfDay => kind == Kind::Time,
        ShapeKind::DateAndTime => kind == Kind::DateAndTime,
    }
}

/// A day as `YYYY-M-D`: its year, month and day.
fn day_of(day: &str) -> Option<(i64, u32, u32)> {
    let parts: Vec<&str> = day.split('-').collect();
    let [y, m, d] = parts[..] else { return None };
    let digits = |s: &str, min: usize, max: usize| {
        (s.len() >= min && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse::<u32>().ok()).flatten()
    };
    let (y, m, d) = (digits(y, 4, 4)? as i64, digits(m, 1, 2)?, digits(d, 1, 2)?);
    if !(1..=9999).contains(&y) || !dates::is_date(y, m, d) {
        return None;
    }
    Some((y, m, d))
}

/// The operations giving cells their changes: their inputs, in the order given, then the patterns that change.
fn ops_of(workbook: &Workbook, sheet: &Sheet, order: &[(LineId, LineId)], changes: &HashMap<(LineId, LineId), Change>) -> Vec<Op> {
    let bases = &workbook.bases;
    let cells = order
        .iter()
        .map(|place| CellToSet { r: bases.text(place.0), c: bases.text(place.1), input: changes[place].input.clone() })
        .collect();
    let mut ops = vec![Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto }];
    let patterns: Vec<(Leaf, (LineId, LineId), Value)> = order
        .iter()
        .filter_map(|place| changes[place].pattern.as_ref().map(|p| (Leaf::NumberFormat, *place, json!({"pattern": p}))))
        .collect();
    if !patterns.is_empty() {
        let formats = blocks(bases, patterns.iter().map(|(leaf, place, v)| (*leaf, *place, v)))
            .into_iter()
            .map(|(rows, columns, format)| CellsToFormat { rows, columns, format })
            .collect();
        ops.push(Op::SetCellFormats { sheet_id: sheet.id.clone(), formats });
    }
    ops
}
