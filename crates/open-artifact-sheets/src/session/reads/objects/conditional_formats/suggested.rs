//! What the page offers for the conditional formats of some cells (`readConditionalFormatSuggestions`): the cells of
//! the records around them it is about, the rules it suggests for those, a rule to start from, and the records with
//! what their columns hold.
//!
//! Suggestions are made for one column, by its kind: a color scale and the three largest for numbers; the days
//! gone and the week to come for dates; a color for each of the commonest texts in a column of few words; the rows
//! of the checked boxes struck through; texts that come more than once; then the cells showing nothing. A suggestion
//! is offered when it would set some cells apart: one matching every cell, or none, is not (a color scale is always
//! offered, and so are those for dates when the latest is today or after). Texts in a column given dropdowns in
//! most of its cells (checkboxes do not count) are suggested nothing, and cells showing nothing are not suggested
//! for a column a merged range meets.

use std::collections::BTreeSet;
use std::num::NonZeroU32;

use serde_json::{json, Value as Json};

use super::records::{Around, Block, Column, Kind, Records};
use crate::session::reads::formats::Matching;
use crate::workbook::layout::{merged_boxes, CellIds, RangeIds};
use crate::workbook::objects::{
    CellCondition, Color, Comparison, Effect, FontOfACondition, FormatOfACondition, HighestAnchor, LowestAnchor,
    NumberOperand, Stop, Test, TestedCell,
};
use crate::workbook::{Sheet, Workbook};

/// The hues the commonest texts of a column are given, in turn.
const HUES: [&str; 8] = ["blue", "purple", "teal", "orange", "green", "magenta", "yellow", "gray"];
/// How many of the largest numbers a suggestion sets apart, and how many numbers it takes.
const LARGEST: NonZeroU32 = NonZeroU32::new(3).expect("not 0");
const NUMBERS_FOR_THE_LARGEST: usize = 4;
/// The days to come a suggestion for dates sets apart.
const DAYS_TO_COME: i32 = 7;

/// When a suggestion is offered: when it matches some cells but fewer than so many; when it matches some; always.
enum Offered {
    FewerThan(usize),
    Matching,
    Always,
}

/// A suggestion: its rules (each its ranges and its effect), and when it is offered.
struct Suggestion {
    rules: Vec<(Vec<RangeIds>, Effect)>,
    offered: Offered,
}

/// The suggestions for some cells.
pub(super) fn suggestions(
    workbook: &Workbook,
    sheet: &Sheet,
    rows: &[usize],
    columns: &[usize],
    now: Option<f64>,
) -> Json {
    let around = Around::of(workbook, sheet, rows, columns);
    let Around { values, records, about, widened, .. } = &around;
    let ids = |block: Block| range_ids(workbook, sheet, block);
    let table = values.columns(records, about.left);
    // A column's own suggestions, from what it holds down the rows they are about.
    let down_the_rows;
    let columns = if (about.top, about.bottom) == (records.block.top, records.block.bottom) {
        &table
    } else {
        let rows = Block { top: about.top, bottom: about.bottom, ..records.block };
        down_the_rows = values.columns(&Records::of(rows), about.left);
        &down_the_rows
    };
    let column = columns.iter().find(|c| c.column == about.left).filter(|_| about.left == about.right);
    let (suggestions, start) = match column {
        Some(column) => {
            let made = Making { workbook, sheet, around: &around, column, today: now.map(f64::floor) };
            (made.offered(), made.start())
        }
        None => (Vec::new(), format_where(TestedCell::TheCellItself {}, CellCondition::IsNotBlank {}, start_look())),
    };
    let matching = Matching::new(workbook, sheet, now);
    let suggestions: Vec<Json> = suggestions.into_iter().filter_map(|s| s.told(&matching)).collect();
    let columns: Vec<Json> = table.iter().map(|c| c.told(column_id(workbook, sheet, c.column))).collect();
    json!({
        "kind": "conditionalFormatSuggestions",
        "about": ids(*about),
        "isWidenedToColumn": widened,
        "suggestions": suggestions,
        "ruleToStartFrom": {"ranges": [ids(*about)], "effect": start},
        "table": {"cells": ids(records.table), "records": ids(records.block), "columns": columns},
    })
}

/// The suggestions being made for a column.
struct Making<'a> {
    workbook: &'a Workbook,
    sheet: &'a Sheet,
    around: &'a Around<'a>,
    column: &'a Column,
    /// The day dates count from (none: no clock reading).
    today: Option<f64>,
}

impl Making<'_> {
    /// The suggestions for the column, by its kind, then for its cells showing nothing.
    fn offered(&self) -> Vec<Suggestion> {
        let column = self.column;
        let about = self.around.about;
        let mut offered = Vec::new();
        let given_controls = about.rows() < self.around.values.dropdowns(about).saturating_mul(2);
        let one = |effect: Effect, offered: Offered| Suggestion { rules: vec![(vec![self.about()], effect)], offered };
        match column.kind {
            Kind::Number | Kind::Currency | Kind::Percent => {
                if let (Some(smallest), Some(largest)) = (column.smallest, column.largest) {
                    if smallest < largest {
                        offered.push(one(color_scale(), Offered::Always));
                    }
                }
                if column.numbers >= NUMBERS_FOR_THE_LARGEST {
                    let largest = CellCondition::IsAmongTheLargest { count: LARGEST };
                    let font = FontOfACondition { bold: Some(true), ..no_font() };
                    let look = FormatOfACondition { fill_color: Some(color("blue", 100)), font: Some(font) };
                    let effect = format_where(TestedCell::TheCellItself {}, largest, look);
                    offered.push(one(effect, Offered::FewerThan(column.numbers)));
                }
            }
            Kind::Date => {
                let to_come = self.today.zip(column.largest).is_some_and(|(today, largest)| today <= largest);
                let when = || if to_come { Offered::Always } else { Offered::FewerThan(column.numbers) };
                let gone = CellCondition::NumberIs { comparison: Comparison::LessThan, operand: days(0) };
                offered.push(one(format_where(TestedCell::TheCellItself {}, gone, look("red")), when()));
                let week = CellCondition::NumberIsBetween { one_end: days(0), other_end: days(DAYS_TO_COME) };
                offered.push(one(format_where(TestedCell::TheCellItself {}, week, look("yellow")), when()));
            }
            Kind::FewWords if !given_controls => {
                let texts = column.commonest.iter().filter(|t| !t.is_empty());
                let rules = texts.zip(HUES.iter().cycle()).map(|(text, hue)| {
                    let condition = CellCondition::TextIs { text: text.clone() };
                    (vec![self.about()], format_where(TestedCell::TheCellItself {}, condition, look(hue)))
                });
                let when =
                    if column.commonest.len() > 1 { Offered::Matching } else { Offered::FewerThan(column.filled) };
                offered.push(Suggestion { rules: rules.collect(), offered: when });
            }
            Kind::Checkbox => {
                let records = self.around.records.block;
                let rows = Block { top: about.top, left: records.left, bottom: about.bottom, right: records.right };
                let tested = TestedCell::SameRowInColumn { c: self.column_id(about.left) };
                let font = FontOfACondition { strikethrough: Some(true), color: Some(color("gray", 600)), ..no_font() };
                let look = FormatOfACondition { fill_color: None, font: Some(font) };
                let effect = format_where(tested, CellCondition::BooleanIs { value: true }, look);
                let cells = column.filled.saturating_mul((records.right - records.left).saturating_add(1));
                let ranges = vec![range_ids(self.workbook, self.sheet, rows)];
                offered.push(Suggestion { rules: vec![(ranges, effect)], offered: Offered::FewerThan(cells) });
            }
            Kind::Text if !given_controls => {
                let twice = CellCondition::AppearsMoreThanOnce {};
                let effect = format_where(TestedCell::TheCellItself {}, twice, look("orange"));
                offered.push(one(effect, Offered::FewerThan(column.filled)));
            }
            Kind::FewWords | Kind::Text => return offered,
        }
        if column.blank > 0 && !self.merged() {
            let look = FormatOfACondition { fill_color: Some(color("yellow", 100)), font: None };
            let effect = format_where(TestedCell::TheCellItself {}, CellCondition::IsBlank {}, look);
            offered.push(one(effect, Offered::FewerThan(column.filled.saturating_add(column.blank))));
        }
        offered
    }

    /// The rule to start from: more than the middle number, a day gone, the commonest text, a box checked, or a cell
    /// showing something.
    fn start(&self) -> Effect {
        let column = self.column;
        let condition = match column.kind {
            Kind::Number | Kind::Currency | Kind::Percent => match (column.middle, column.largest) {
                (Some(middle), Some(largest)) if middle.is_finite() && middle < largest => {
                    CellCondition::NumberIs {
                        comparison: Comparison::GreaterThan,
                        operand: NumberOperand::Number { number: middle },
                    }
                }
                _ => CellCondition::IsNotBlank {},
            },
            Kind::Date => CellCondition::NumberIs { comparison: Comparison::LessThan, operand: days(0) },
            Kind::FewWords => match column.commonest.first() {
                Some(text) if !text.is_empty() => CellCondition::TextIs { text: text.clone() },
                _ => CellCondition::IsNotBlank {},
            },
            Kind::Checkbox => CellCondition::BooleanIs { value: true },
            Kind::Text => CellCondition::IsNotBlank {},
        };
        format_where(TestedCell::TheCellItself {}, condition, start_look())
    }

    /// Whether a merged range meets the cells the suggestions are about.
    fn merged(&self) -> bool {
        let about = self.around.about;
        merged_boxes(&self.workbook.bases, self.sheet).into_iter().any(|(top, bottom, left, right)| {
            top <= about.bottom && about.top <= bottom && left <= about.right && about.left <= right
        })
    }

    fn about(&self) -> RangeIds {
        range_ids(self.workbook, self.sheet, self.around.about)
    }

    fn column_id(&self, column: usize) -> String {
        self.sheet.columns.line(column).map(|l| self.workbook.bases.text(l)).unwrap_or_default()
    }
}

impl Suggestion {
    /// The suggestion as the page is told it, with how many cells and rows its rules match (none for color scales),
    /// when it is offered.
    fn told(self, matching: &Matching) -> Option<Json> {
        let scales = self.rules.iter().all(|(_, effect)| matches!(effect, Effect::ColorScale { .. }));
        // The cells some rule matches, each once (the rules for two texts may match the same cells).
        let mut matched = BTreeSet::new();
        for (ranges, effect) in &self.rules {
            if let Effect::FormatWhere { all_of, .. } = effect {
                matched.extend(matching.matched(ranges, all_of));
            }
        }
        let cells = matched.len();
        let rows: BTreeSet<usize> = matched.iter().map(|&(r, _)| r).collect();
        let offered = match self.offered {
            Offered::FewerThan(n) => 0 < cells && cells < n,
            Offered::Matching => cells > 0,
            Offered::Always => true,
        };
        if !offered {
            return None;
        }
        let matches = if scales { Json::Null } else { json!({"cells": cells, "rows": rows.len()}) };
        let rules: Vec<Json> =
            self.rules.into_iter().map(|(ranges, effect)| json!({"ranges": ranges, "effect": effect})).collect();
        Some(json!({"rules": rules, "matches": matches}))
    }
}

/// A block of a sheet by the ids of its corners' rows and columns.
fn range_ids(workbook: &Workbook, sheet: &Sheet, block: Block) -> RangeIds {
    let cell = |row: usize, column: usize| CellIds {
        r: sheet.rows.line(row).map(|l| workbook.bases.text(l)).unwrap_or_default(),
        c: sheet.columns.line(column).map(|l| workbook.bases.text(l)).unwrap_or_default(),
    };
    RangeIds { top_left: cell(block.top, block.left), bottom_right: cell(block.bottom, block.right) }
}

fn column_id(workbook: &Workbook, sheet: &Sheet, column: usize) -> Json {
    json!(sheet.columns.line(column).map(|l| workbook.bases.text(l)))
}

/// An effect of one test: a format given to the cells for which a condition holds.
fn format_where(tested: TestedCell, condition: CellCondition, format: FormatOfACondition) -> Effect {
    Effect::FormatWhere { all_of: vec![Test { tested, condition }], format }
}

/// A color scale from no color at the smallest number to green at the largest.
fn color_scale() -> Effect {
    Effect::ColorScale {
        lowest: Stop { anchor: LowestAnchor::SmallestNumber {}, color: Color(json!({"kind": "none"})) },
        middle: None,
        highest: Stop { anchor: HighestAnchor::LargestNumber {}, color: color("green", 300) },
    }
}

fn color(hue: &str, shade: u32) -> Color {
    Color(json!({"kind": "standard", "hue": hue, "shade": shade}))
}

fn no_font() -> FontOfACondition {
    FontOfACondition { bold: None, italic: None, underline: None, strikethrough: None, color: None }
}

/// A hue's light fill with its dark text.
fn look(hue: &str) -> FormatOfACondition {
    let font = FontOfACondition { color: Some(color(hue, 800)), ..no_font() };
    FormatOfACondition { fill_color: Some(color(hue, 100)), font: Some(font) }
}

/// The look of the rule to start from.
fn start_look() -> FormatOfACondition {
    look("yellow")
}

fn days(days: i32) -> NumberOperand {
    NumberOperand::DaysFromToday { days }
}
