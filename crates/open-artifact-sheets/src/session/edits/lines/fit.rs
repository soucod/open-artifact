//! How wide a column must be to show its cells (`fitColumns`): each cell measured as the page draws it, in the
//! font the cell has, and the widest of them.
//!
//! Texts are measured character by character, with tables of how wide each character of the page's font
//! is (in thousandths of an em, regular and bold; italic is as wide as regular); a character past them is as wide as
//! a letter of its script. Numbers are measured in digits (`describeSharedCode`'s `widthsOfNumbers`): General ones
//! every character a digit, ones with a pattern by what each character of what they show is like. A cell with a
//! checkbox is as wide as a checkbox, whatever it holds; a merged range across columns is left out. A column a
//! conditional format may make bold is measured all in bold, whether the condition holds or not, and so is text with
//! looks with a bold run anywhere in it. A dropdown option shows its label in a chip: in bold, on one line, with more
//! room beside it. Text with lines of lists is measured line by line, each line of a list with room for its mark and
//! its level before it (`LIST_INDENT` an em for each, the mark taking one).

use hashbrown::{HashMap, HashSet};

use crate::calculate::SpillOutcome;
use crate::ids::LineId;
use crate::locale::Locale;
use crate::number_format::{NumberFormat, Room};
use crate::shown::{shown, ShownValue};
use crate::value::Value;
use crate::workbook::formats::Leaf;
use crate::workbook::layout::RangeIds;
use crate::workbook::objects::Effect;
use crate::workbook::rich::{List, Mark, Paragraph};
use crate::workbook::{Input, Sheet, Workbook};

/// How wide the characters ` ` to `~` are, in thousandths of an em: regular (and italic), and bold.
const REGULAR: [u16; 95] = [
    212, 236, 408, 640, 521, 993, 684, 237, 404, 404, 489, 640, 236, 360, 236, 335, 640, 640, 640, 640,
    640, 640, 640, 640, 640, 640, 236, 236, 640, 640, 640, 543, 873, 737, 656, 762, 742, 640, 596, 795,
    742, 273, 540, 686, 578, 939, 787, 816, 611, 816, 683, 589, 578, 726, 737, 1013, 671, 680, 662, 404,
    335, 404, 640, 500, 500, 547, 620, 552, 620, 579, 419, 571, 597, 252, 252, 567, 252, 871, 597, 583,
    620, 620, 403, 514, 419, 591, 563, 823, 571, 571, 505, 404, 304, 404, 640,
];
const BOLD: [u16; 95] = [
    203, 280, 505, 640, 551, 1025, 748, 280, 415, 415, 490, 640, 280, 360, 280, 367, 640, 640, 640, 640,
    640, 640, 640, 640, 640, 640, 280, 280, 640, 640, 640, 575, 879, 765, 670, 777, 759, 650, 608, 806,
    757, 294, 576, 737, 586, 921, 792, 818, 639, 818, 700, 630, 586, 728, 765, 1058, 738, 717, 677, 415,
    367, 415, 640, 500, 500, 575, 643, 583, 643, 602, 453, 600, 628, 277, 277, 617, 277, 910, 628, 600,
    643, 643, 435, 535, 453, 605, 608, 868, 648, 610, 528, 415, 315, 415, 640,
];

/// Pixels in a thousandth of an em of a 10-point font (13 pixels), with a little room.
const PIXELS_IN_A_THOUSANDTH: f64 = 0.01352;
/// `widthsOfNumbers`: a digit's width in ems, regular and bold, and the pixels of 10 points.
const PIXELS_IN_TEN_POINTS: f64 = 13.0;
const WIDTH_OF_A_DIGIT: f64 = 0.64;
const WIDTH_OF_A_BOLD_DIGIT: f64 = 0.67;
const HALF_AS_WIDE_AS_A_DIGIT: &str = " \u{a0}\u{202f}!',.:;Iijl";
const NO_WIDER_THAN_A_DIGIT: &str = "0123456789#+$€£()[]{}|/\\*\"?=<>^~_`-abcdefghijklnopqrstuvxyzEFJLPST";
const WIDTH_OF_ANY_OTHER_CHARACTER: f64 = 1.75;
/// `aroundTheTextInPixels`: the room beside a cell's text.
const AROUND_THE_TEXT: u32 = 8;
/// The room beside a dropdown option's label: the chip's, and the cell's around it.
const AROUND_A_CHIP: u32 = 19;
/// The most characters a General number shows in a cell.
const MOST_CHARACTERS_OF_A_NUMBER: u32 = 11;
/// How wide a cell with a checkbox is.
const WIDTH_OF_A_CHECKBOX: u32 = 28;
/// The room a line of a list takes before its text for its mark, and for each level it lies under, in ems (24
/// pixels in a font of 10 points, found by probing `fitColumns`).
const LIST_INDENT: f64 = 2.4;
/// A column's width when none is set.
pub const DEFAULT_WIDTH: u32 = 104;

/// A character's width in thousandths of an em: a line break or a tab is a space.
fn thousandths(c: char, bold: bool) -> u32 {
    let table = if bold { &BOLD } else { &REGULAR };
    match c {
        '\t' | '\n' | '\r' => table[0] as u32,
        ' '..='~' => table[c as usize - ' ' as usize] as u32,
        c if (c as u32) < 0x1100 => 700,
        c if (c as u32) < 0x10000 => 1000,
        _ => 1400,
    }
}

/// The font a cell's text is drawn in.
struct Font {
    bold: bool,
    size: f64,
}

impl Font {
    /// The cell's font: bold when `made_bold` (by a conditional format, or a bold run of its text with looks), whatever
    /// the cell's is.
    fn of(sheet: &Sheet, cell: (LineId, LineId), made_bold: bool) -> Font {
        let bold = made_bold || sheet.formats.value(Leaf::Bold, cell).as_bool() == Some(true);
        let size = sheet.formats.value(Leaf::FontSize, cell).as_f64().unwrap_or(10.0);
        Font { bold, size }
    }

    /// The pixels of characters of a text, together.
    fn pixels(&self, thousandths: u32) -> f64 {
        thousandths as f64 * PIXELS_IN_A_THOUSANDTH * self.size / 10.0
    }

    fn text(&self, text: &str) -> f64 {
        self.pixels(text.chars().map(|c| thousandths(c, self.bold)).sum())
    }

    /// The pixels of so many digits.
    fn digits(&self, digits: f64) -> f64 {
        let digit = if self.bold { WIDTH_OF_A_BOLD_DIGIT } else { WIDTH_OF_A_DIGIT };
        digits * digit * PIXELS_IN_TEN_POINTS * self.size / 10.0
    }
}

/// How many digits wide a number's text is, by what each character is like.
fn digits_of(text: &str) -> f64 {
    text.chars()
        .map(|c| {
            if HALF_AS_WIDE_AS_A_DIGIT.contains(c) {
                0.5
            } else if NO_WIDER_THAN_A_DIGIT.contains(c) {
                1.0
            } else {
                WIDTH_OF_ANY_OTHER_CHARACTER
            }
        })
        .sum()
}

/// How tall a cell's text is wrapped in its column, `width` pixels wide, as the file guesses it (`readXlsxFile`),
/// when it takes more than one line: each line is 1.7 times the font's size, and no more than 546 pixels (409.5
/// points) in all. The text has the column's width but the room beside it; when that is less than an em of the font
/// (1.3 pixels a point), it is not measured.
///
/// Each paragraph starts a line. Its words (between spaces: a tab or a carriage return is a character of one) go on
/// a line while they fit, a space between two, each word and the space as wide as a whole number of pixels (rounded
/// up); a word wider than a line takes as many as it needs, and what comes next goes after its last part. A space at
/// the start of a line takes no room, and one more than fits starts the next line. Text is measured in the cell's
/// own font (bold or not, its size), not its runs'.
pub fn wrapped_height(sheet: &Sheet, cell: (LineId, LineId), text: &str, width: u32) -> Option<f64> {
    let font = Font::of(sheet, cell, false);
    let room = width as f64 - AROUND_THE_TEXT as f64;
    if room < font.size * 1.3 {
        return None;
    }
    let space = font.text(" ").ceil();
    let mut lines = 0usize;
    for paragraph in text.split('\n') {
        lines += 1;
        let mut line = 0.0;
        for word in paragraph.split(' ') {
            let width = font.text(word).ceil();
            if line > 0.0 {
                if line + space + width <= room {
                    line += space + width;
                    continue;
                }
                lines += 1;
            }
            line = width;
            if width > room {
                let more = (width / room).ceil() - 1.0;
                lines += more as usize;
                line = width - more * room;
            }
        }
    }
    (lines > 1).then(|| (lines as f64 * font.size * 1.7).min(546.0))
}

/// The widest word (between spaces and line breaks) and the widest line of a text, in thousandths.
fn widest_word_and_line(text: &str, bold: bool) -> (u32, u32) {
    let (mut word, mut line, mut widest_word, mut widest_line) = (0, 0, 0, 0);
    for c in text.chars() {
        let is_line_break = c == '\n';
        let width = if is_line_break { 0 } else { thousandths(c, bold) };
        word = if is_line_break || c == ' ' { 0 } else { word + width };
        line = if is_line_break { 0 } else { line + width };
        widest_word = widest_word.max(word);
        widest_line = widest_line.max(line);
    }
    (widest_word, widest_line)
}

/// How wide a cell's column must be to show a dropdown option's label (the option's now, or the one it had when it
/// is gone); `None` when the label shows nothing.
fn needed_by_chip(sheet: &Sheet, cell: (LineId, LineId), label: &str) -> Option<u32> {
    if label.trim().is_empty() {
        return None;
    }
    let font = Font { bold: true, ..Font::of(sheet, cell, false) };
    Some(font.text(label).ceil() as u32 + AROUND_A_CHIP)
}

/// How wide a cell's column must be to show its value, in its format; `None` when it shows nothing to measure.
fn needed(sheet: &Sheet, cell: (LineId, LineId), value: &Value, width: u32, made_bold: bool, locale: &Locale)
    -> Option<u32> {
    let font = Font::of(sheet, cell, made_bold);
    let pattern = sheet.formats.get(Leaf::NumberFormat, cell).and_then(|f| f.get("pattern")?.as_str());
    let pattern = pattern.filter(|p| *p != "General");
    let text = match value {
        Value::Blank => return None,
        Value::Number(n) => {
            let pixels = match pattern {
                None => {
                    let general = NumberFormat::parse("General").expect("General reads");
                    let room = Room::InACell { most_characters: MOST_CHARACTERS_OF_A_NUMBER };
                    let text = general.show_number_in(*n, locale, room).ok()?.text;
                    font.digits(text.chars().count() as f64)
                }
                Some(pattern) => match shown(value, Some(pattern), Room::AsText, locale).ok()? {
                    ShownValue::Text { text, .. } => font.digits(digits_of(&text)),
                    ShownValue::CannotBeShown(_) => return None,
                },
            };
            return Some(pixels.ceil() as u32 + AROUND_THE_TEXT);
        }
        Value::Text(t) => match pattern.and_then(|p| shown(value, Some(p), Room::AsText, locale).ok()) {
            Some(ShownValue::Text { text, .. }) => text,
            _ => t.to_string(),
        },
        Value::Boolean(b) => (if *b { "TRUE" } else { "FALSE" }).to_owned(),
        Value::Error(e) => e.text().to_owned(),
    };
    if text.trim().is_empty() {
        return None;
    }
    if sheet.formats.value(Leaf::Wrap, cell).as_bool() == Some(true) {
        let (word, line) = widest_word_and_line(&text, font.bold);
        let (word, line) = (font.pixels(word).ceil() as u32, font.pixels(line).ceil() as u32);
        return Some(if word <= width.saturating_sub(AROUND_THE_TEXT) {
            (line + AROUND_THE_TEXT).min(width)
        } else {
            word + AROUND_THE_TEXT
        });
    }
    Some(font.text(&text).ceil() as u32 + AROUND_THE_TEXT)
}

/// How wide a cell's column must be to show text with lines of lists: its widest line, a line of a list with room
/// for its mark and level before it (an empty one too); wrapped, as any text, by its widest word and line so.
fn needed_by_lists(sheet: &Sheet, cell: (LineId, LineId), paragraphs: &[Paragraph], width: u32, made_bold: bool) -> u32 {
    let font = Font::of(sheet, cell, made_bold);
    let wraps = sheet.formats.value(Leaf::Wrap, cell).as_bool() == Some(true);
    let (mut widest_word, mut widest_line) = (0.0f64, 0.0f64);
    for paragraph in paragraphs {
        let indent = paragraph.list.level().map_or(0.0, |level| LIST_INDENT * font.size * f64::from(level + 1));
        let text: String = paragraph.runs.iter().map(|r| r.text.as_str()).collect();
        let (word, line) = if wraps {
            let (word, line) = widest_word_and_line(&text, font.bold);
            (font.pixels(word), font.pixels(line))
        } else {
            (0.0, font.text(&text))
        };
        // The text and the room before it are each a whole number of pixels (found by probing a font of 6 points).
        widest_word = widest_word.max(word.ceil() + indent.ceil());
        widest_line = widest_line.max(line.ceil() + indent.ceil());
    }
    let (word, line) = (widest_word as u32, widest_line as u32);
    if wraps && word > width.saturating_sub(AROUND_THE_TEXT) {
        return word + AROUND_THE_TEXT;
    }
    if wraps { (line + AROUND_THE_TEXT).min(width) } else { line + AROUND_THE_TEXT }
}

/// The merged ranges a sheet shows, as boxes of positions (top, bottom, left, right): as read back, a range left
/// with one cell or overlapping one before it merges nothing (of two with the same top left, the one whose corners'
/// ids come first is before).
pub fn merged_boxes(workbook: &Workbook, sheet: &Sheet) -> Vec<(usize, usize, usize, usize)> {
    let mut live: Vec<((usize, usize, usize, usize), &RangeIds)> =
        sheet.merged_ranges.iter().filter_map(|range| Some((sheet.live_box(&workbook.bases, range)?, range))).collect();
    fn ids(range: &RangeIds) -> [&String; 4] {
        [&range.top_left.r, &range.top_left.c, &range.bottom_right.r, &range.bottom_right.c]
    }
    live.sort_by(|((t, b, l, r), x), ((t2, b2, l2, r2), y)| (t, l, ids(x), b, r).cmp(&(t2, l2, ids(y), b2, r2)));
    let mut kept: Vec<(usize, usize, usize, usize)> = Vec::new();
    for ((t, b, l, r), _) in live {
        if (t == b && l == r) || kept.iter().any(|&(t2, b2, l2, r2)| t <= b2 && t2 <= b && l <= r2 && l2 <= r) {
            continue;
        }
        kept.push((t, b, l, r));
    }
    kept
}

/// The columns a conditional format may make bold: those of its ranges, when its font is bold.
fn made_bold(workbook: &Workbook, sheet: &Sheet) -> HashSet<LineId> {
    let mut columns = HashSet::new();
    for (_, f) in sheet.conditional_formats.values() {
        let Effect::FormatWhere { format, .. } = &f.effect else { continue };
        if format.font.as_ref().and_then(|font| font.bold) != Some(true) {
            continue;
        }
        for (_, _, l, r) in f.ranges.iter().filter_map(|range| sheet.live_box(&workbook.bases, range)) {
            columns.extend((l..=r).filter_map(|p| sheet.columns.line(p)));
        }
    }
    columns
}

/// Whether what a cell does when clicked is a checkbox.
fn is_a_checkbox(control: &serde_json::Value) -> bool {
    control.get("kind").and_then(|k| k.as_str()) == Some("checkbox")
}

/// How wide each of the columns must be to show its cells, of the ones with a cell to show.
pub fn widths_needed(workbook: &Workbook, sheet: &Sheet, columns: &[LineId]) -> HashMap<LineId, u32> {
    widths_needed_with_texts_held_to(workbook, sheet, columns, u32::MAX)
}

/// How wide each of the columns must be to show its cells, a cell showing anything but a number taken as no wider
/// than `widest_text` (an imported table's look fits its columns so).
pub fn widths_needed_with_texts_held_to(workbook: &Workbook, sheet: &Sheet, columns: &[LineId], widest_text: u32)
    -> HashMap<LineId, u32> {
    let locale = crate::locale::find(&workbook.locale).unwrap_or_else(crate::locale::en_us);
    let wanted: HashSet<LineId> = columns.iter().copied().collect();
    let merged = merged_boxes(workbook, sheet);
    let bold = made_bold(workbook, sheet);
    // A cell under a merged range is not shown; the range's own cell is, when the range is of one column.
    let is_hidden_by_merge = |row: usize, column: usize| {
        merged.iter().any(|&(t, b, l, r)| (t..=b).contains(&row) && (l..=r).contains(&column) && (l != r || row != t))
    };
    let shows = |cell: (LineId, LineId)| -> Option<(usize, usize)> {
        if !wanted.contains(&cell.1) {
            return None;
        }
        let (row, column) = (sheet.rows.position(cell.0)?, sheet.columns.position(cell.1)?);
        (!is_hidden_by_merge(row, column)).then_some((row, column))
    };
    let is_checkbox = |cell: (LineId, LineId)| sheet.formats.get(Leaf::CellControl, cell).is_some_and(is_a_checkbox);
    let width_of = |column: LineId| sheet.column_widths.get(&column).copied().unwrap_or(DEFAULT_WIDTH);
    let mut widths: HashMap<LineId, u32> = HashMap::new();
    let mut note = |column: LineId, width: u32| {
        let w = widths.entry(column).or_insert(0);
        *w = (*w).max(width);
    };
    let mut measure = |cell: (LineId, LineId), value: &Value, is_chip: bool, has_bold_run: bool, lists: Option<&[Paragraph]>| {
        if shows(cell).is_none() || is_checkbox(cell) {
            return;
        }
        let width = match value {
            _ if lists.is_some() => {
                lists.map(|p| needed_by_lists(sheet, cell, p, width_of(cell.1), has_bold_run || bold.contains(&cell.1)))
            }
            Value::Text(label) if is_chip => needed_by_chip(sheet, cell, label),
            _ => needed(sheet, cell, value, width_of(cell.1), has_bold_run || bold.contains(&cell.1), locale),
        };
        if let Some(width) = width {
            // The room around the text is kept, however narrow the text is held to.
            note(cell.1, if matches!(value, Value::Number(_)) { width } else { width.min(widest_text.max(AROUND_THE_TEXT)) });
        }
    };
    for (&cell, contents) in &sheet.cells {
        let is_chip = matches!(contents.input, Input::DropdownOption { .. });
        let value = match &contents.input {
            Input::Number { value } => Value::Number(*value),
            Input::Text { value } => Value::Text(value.as_str().into()),
            Input::Boolean { value } => Value::Boolean(*value),
            Input::Formula { .. } => match workbook.outcome(&sheet.id, cell.0, cell.1) {
                Some(outcome) => outcome.value.clone(),
                None => continue,
            },
            Input::DropdownOption { option_id, label } => {
                Value::Text(sheet.dropdown_option(option_id).map_or(label, |o| &o.label).as_str().into())
            }
            Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                Value::Text(contents.input.reads_as_text().unwrap_or_default().into())
            }
        };
        let has_bold_run = match &contents.input {
            Input::RichText { paragraphs } => {
                paragraphs.iter().flat_map(|p| &p.runs).any(|run| run.marks.contains(&Mark::Bold))
            }
            _ => false,
        };
        let lists = match &contents.input {
            Input::RichText { paragraphs } if paragraphs.iter().any(|p| p.list != List::None) => Some(&paragraphs[..]),
            _ => None,
        };
        measure(cell, &value, is_chip, has_bold_run, lists);
    }
    // What spilled arrays fill.
    for ((sheet_id, r, c), outcome) in &workbook.outcomes {
        let Some(SpillOutcome::Fills { array, .. }) = &outcome.spill else { continue };
        if *sheet_id != sheet.id {
            continue;
        }
        let (Some(top), Some(left)) = (sheet.rows.position(*r), sheet.columns.position(*c)) else { continue };
        for ((i, j), value) in array.entries().filter(|(position, _)| *position != (0, 0)) {
            let Some(column) = sheet.columns.line(left + j) else { continue };
            if !wanted.contains(&column) {
                continue;
            }
            let Some(row) = sheet.rows.line(top + i) else { continue };
            measure((row, column), value, false, false, None);
        }
    }
    drop(measure);
    for (leaf, cell, v) in sheet.formats.iter() {
        if leaf == Leaf::CellControl && is_a_checkbox(v) && shows(cell).is_some() {
            note(cell.1, WIDTH_OF_A_CHECKBOX);
        }
    }
    widths
}

/// How wide a column may be made to show numbers given a new pattern (`queueEdit`'s `makesRoomForNumbersIn`).
const WIDEST_MADE_ROOM: u32 = 400;

/// How many digits a General number is taken to show before its pattern changes, at most.
const DIGITS_OF_A_GENERAL_NUMBER_BEFORE: usize = 5;

/// The columns made wider to show numbers in a pattern they were given (`queueEdit` with `makesRoomForNumbersIn`
/// naming the sheet the pattern is given in): a number of the cells given it (a formula's too)
/// that fitted its column before (nine tenths of what it needed then no wider than the column; a General number
/// taken to need no more than five digits) and does not now makes its column as wide as the widest such needs now, no
/// more than 400 pixels, when that is wider than it is. In the columns' order, each with its new width.
pub fn widths_making_room_for_numbers(before: &Workbook, after: &Workbook, sheet_id: &str,
    is_given: impl Fn((LineId, LineId)) -> bool) -> Vec<(LineId, u32)> {
    let (Some(was), Some(sheet)) = (before.sheet_index(sheet_id).map(|k| &before.sheets[k]), after.sheet_index(sheet_id).map(|k| &after.sheets[k])) else {
        return Vec::new();
    };
    let locale = crate::locale::find(&after.locale).unwrap_or_else(crate::locale::en_us);
    let (bold_before, bold) = (made_bold(before, was), made_bold(after, sheet));
    let width_of = |column: LineId| sheet.column_widths.get(&column).copied().unwrap_or(DEFAULT_WIDTH);
    let mut wanted: HashMap<LineId, u32> = HashMap::new();
    for (&cell, contents) in &sheet.cells {
        if !is_given(cell) || sheet.rows.position(cell.0).is_none() || sheet.columns.position(cell.1).is_none() {
            continue;
        }
        let number = match &contents.input {
            Input::Number { value } => *value,
            Input::Formula { .. } => match before.outcome(sheet_id, cell.0, cell.1).or_else(|| after.outcome(sheet_id, cell.0, cell.1)) {
                Some(outcome) => match outcome.value {
                    Value::Number(n) => n,
                    _ => continue,
                },
                None => continue,
            },
            _ => continue,
        };
        let value = Value::Number(number);
        let width = width_of(cell.1);
        let pattern = was.formats.get(Leaf::NumberFormat, cell).and_then(|f| f.get("pattern")?.as_str());
        let needed_before = match pattern.filter(|p| *p != "General") {
            None => {
                let font = Font::of(was, cell, bold_before.contains(&cell.1));
                let general = NumberFormat::parse("General").expect("General reads");
                let room = Room::InACell { most_characters: MOST_CHARACTERS_OF_A_NUMBER };
                let Ok(shown) = general.show_number_in(number, locale, room) else { continue };
                let digits = shown.text.chars().count().min(DIGITS_OF_A_GENERAL_NUMBER_BEFORE);
                font.digits(digits as f64).ceil() as u32 + AROUND_THE_TEXT
            }
            Some(_) => match needed(was, cell, &value, width, bold_before.contains(&cell.1), locale) {
                Some(w) => w,
                None => continue,
            },
        };
        let Some(needed_now) = needed(sheet, cell, &value, width, bold.contains(&cell.1), locale) else { continue };
        if 0.9 * needed_before as f64 <= width as f64 && needed_now > width {
            let w = wanted.entry(cell.1).or_insert(0);
            *w = (*w).max(needed_now.min(WIDEST_MADE_ROOM));
        }
    }
    let mut out: Vec<(LineId, u32)> = wanted.into_iter().filter(|&(c, w)| w > width_of(c)).collect();
    out.sort_by_key(|&(c, _)| sheet.columns.position(c));
    out
}
