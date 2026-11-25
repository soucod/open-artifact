//! What a sheet holds besides its cells: dropdowns, conditional formats, cell tables and the placements of views;
//! and the workbook's views. Each is kept by its id, and an operation sets some of them whole (`null` takes one
//! away); conditional formats change only in what is written.

use hashbrown::HashSet;

use serde::{Deserialize, Serialize};
mod named_views;
pub use named_views::{NamedView, NamedViewToSet};
pub(crate) use named_views::MOST_VIEWS as MOST_NAMED_VIEWS;
use serde_json::{json, Value};

use super::formats::read_color;
use super::layout::{id_key, live_ends, written, CellIds, RangeIds};
use super::load::{Lines, Op, Refusal};
use super::{Input, Sheet, Workbook};
use crate::ids::{Axis, Bases, LineId};

/// An option of a dropdown.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DropdownOption {
    pub option_id: String,
    pub label: String,
    pub color: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DropdownToSet {
    pub dropdown_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub options: Option<Vec<DropdownOption>>,
}

/// A color as a conditional format or a dropdown option gives it: `none`, a standard hue and shade, or `rgb`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Color(pub Value);

impl<'de> Deserialize<'de> for Color {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        read_color(&v).map(Color).ok_or_else(|| serde::de::Error::custom("not a color"))
    }
}

/// What a conditional format does.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Effect {
    /// Gives `format` to each cell for which every test holds.
    #[serde(rename_all = "camelCase")]
    FormatWhere { all_of: Vec<Test>, format: FormatOfACondition },
    /// Fills each cell that holds a number with a color between those of its stops.
    ColorScale {
        lowest: Stop<LowestAnchor>,
        #[serde(deserialize_with = "written::maybe_null")]
        middle: Option<Stop<MiddleAnchor>>,
        highest: Stop<HighestAnchor>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Test {
    pub tested: TestedCell,
    pub condition: CellCondition,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TestedCell {
    TheCellItself {},
    SameRowInColumn { c: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Comparison {
    EqualTo,
    NotEqualTo,
    GreaterThan,
    GreaterThanOrEqualTo,
    LessThan,
    LessThanOrEqualTo,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum NumberOperand {
    Number { number: f64 },
    DaysFromToday { days: i32 },
    SameRowInColumn { c: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CellCondition {
    IsBlank {},
    IsNotBlank {},
    NumberIs { comparison: Comparison, operand: NumberOperand },
    #[serde(rename_all = "camelCase")]
    NumberIsBetween { one_end: NumberOperand, other_end: NumberOperand },
    #[serde(rename_all = "camelCase")]
    NumberIsNotBetween { one_end: NumberOperand, other_end: NumberOperand },
    TextIs { text: String },
    TextIsNot { text: String },
    TextContains { text: String },
    TextDoesNotContain { text: String },
    TextStartsWith { text: String },
    TextEndsWith { text: String },
    BooleanIs { value: bool },
    IsAmongTheLargest { count: std::num::NonZeroU32 },
    IsAmongTheSmallest { count: std::num::NonZeroU32 },
    AppearsMoreThanOnce {},
    IsAnError {},
}

/// The look a `formatWhere` gives: a fill, a font, or both.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormatOfACondition {
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<Color>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub font: Option<FontOfACondition>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontOfACondition {
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub underline: Option<Underline>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Underline {
    None,
    Single,
    Double,
}

/// A stop of a color scale: where it lies among the numbers in the cells, and its color.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stop<A> {
    pub anchor: A,
    pub color: Color,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum LowestAnchor {
    SmallestNumber {},
    Number { number: f64 },
    Percentile { percentile: f64 },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MiddleAnchor {
    Number { number: f64 },
    Percentile { percentile: f64 },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum HighestAnchor {
    LargestNumber {},
    Number { number: f64 },
    Percentile { percentile: f64 },
}

/// A stop's anchor as a number or a percentile, to compare stops by.
#[derive(Clone, Copy, PartialEq)]
enum At {
    Number(f64),
    Percentile(f64),
    End,
}

impl LowestAnchor {
    fn at(&self) -> At {
        match self {
            LowestAnchor::SmallestNumber {} => At::End,
            LowestAnchor::Number { number } => At::Number(*number),
            LowestAnchor::Percentile { percentile } => At::Percentile(*percentile),
        }
    }
}

impl MiddleAnchor {
    fn at(&self) -> At {
        match self {
            MiddleAnchor::Number { number } => At::Number(*number),
            MiddleAnchor::Percentile { percentile } => At::Percentile(*percentile),
        }
    }
}

impl HighestAnchor {
    fn at(&self) -> At {
        match self {
            HighestAnchor::LargestNumber {} => At::End,
            HighestAnchor::Number { number } => At::Number(*number),
            HighestAnchor::Percentile { percentile } => At::Percentile(*percentile),
        }
    }
}

impl Effect {
    /// Whether the effect reads: a test or more, a format that gives something, texts that are not
    /// empty, percentiles from 0 to 100, and stops in order where two are both at a number or both at a percentile.
    pub fn is_readable(&self) -> bool {
        match self {
            Effect::FormatWhere { all_of, format } => {
                !all_of.is_empty()
                    && all_of.iter().all(|t| match &t.condition {
                        CellCondition::TextIs { text }
                        | CellCondition::TextIsNot { text }
                        | CellCondition::TextContains { text }
                        | CellCondition::TextDoesNotContain { text }
                        | CellCondition::TextStartsWith { text }
                        | CellCondition::TextEndsWith { text } => !text.is_empty(),
                        _ => true,
                    })
                    && (format.fill_color.is_some() || format.font.is_some())
                    && format.font.as_ref().is_none_or(|f| {
                        f.bold.is_some() || f.italic.is_some() || f.underline.is_some() || f.strikethrough.is_some() || f.color.is_some()
                    })
            }
            Effect::ColorScale { lowest, middle, highest } => {
                let stops: Vec<At> = [Some(lowest.anchor.at()), middle.as_ref().map(|m| m.anchor.at()), Some(highest.anchor.at())]
                    .into_iter()
                    .flatten()
                    .collect();
                let percentiles_fit = stops.iter().all(|a| !matches!(a, At::Percentile(p) if !(0.0..=100.0).contains(p)));
                let in_order = stops.iter().enumerate().all(|(i, a)| {
                    stops[i + 1..].iter().all(|b| match (a, b) {
                        (At::Number(x), At::Number(y)) | (At::Percentile(x), At::Percentile(y)) => x < y,
                        _ => true,
                    })
                });
                percentiles_fit && in_order
            }
        }
    }

    /// The columns the effect's tests and operands name.
    pub fn columns(&self) -> Vec<&str> {
        let mut out = Vec::new();
        if let Effect::FormatWhere { all_of, .. } = self {
            for t in all_of {
                if let TestedCell::SameRowInColumn { c } = &t.tested {
                    out.push(c.as_str());
                }
                let operands: Vec<&NumberOperand> = match &t.condition {
                    CellCondition::NumberIs { operand, .. } => vec![operand],
                    CellCondition::NumberIsBetween { one_end, other_end } | CellCondition::NumberIsNotBetween { one_end, other_end } => {
                        vec![one_end, other_end]
                    }
                    _ => vec![],
                };
                for o in operands {
                    if let NumberOperand::SameRowInColumn { c } = o {
                        out.push(c.as_str());
                    }
                }
            }
        }
        out
    }
}

/// A conditional format: the ranges it formats, its priority (the smallest first), and what it does. As set, one
/// already there changes only in what is written.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionalFormatPatch {
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub ranges: Option<Vec<RangeIds>>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub effect: Option<Effect>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConditionalFormatToSet {
    pub conditional_format_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub conditional_format: Option<ConditionalFormatPatch>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConditionalFormat {
    pub ranges: Vec<RangeIds>,
    pub priority: i32,
    pub effect: Effect,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowsOfACellTable {
    pub first_row: String,
    pub last_row: String,
}

/// A table drawn on cells: its header rows, its columns, and its footer rows if it has them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellTable {
    pub header_rows: RowsOfACellTable,
    pub first_column: String,
    pub last_column: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub footer_rows: Option<RowsOfACellTable>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellTableToSet {
    pub cell_table_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub cell_table: Option<CellTable>,
}

/// A view: its name and what it shows, widgets (`ref` names a node of the page, `node/<id>`) each reading named
/// ranges. The workbook keeps it as written: its ranges are not followed when rows move.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct View {
    pub name: String,
    pub elements: Vec<ViewElement>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ViewElement {
    #[serde(rename_all = "camelCase")]
    Widget { element_id: String, embed: Embed, inputs: Vec<InputOfAWidget> },
    #[serde(rename_all = "camelCase")]
    Interactive { element_id: String, embed: Embed, inputs: Vec<InputOfAWidget>, writes: Vec<InteractiveWrite> },
}

impl ViewElement {
    pub fn parts(&self) -> (&str, &Embed, &[InputOfAWidget]) {
        match self {
            Self::Widget { element_id, embed, inputs } | Self::Interactive { element_id, embed, inputs, .. } => {
                (element_id, embed, inputs)
            }
        }
    }

    pub fn parts_mut(&mut self) -> (&mut String, &mut Embed, &mut Vec<InputOfAWidget>) {
        match self {
            Self::Widget { element_id, embed, inputs } | Self::Interactive { element_id, embed, inputs, .. } => {
                (element_id, embed, inputs)
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InteractiveWrite {
    pub input: String,
    pub saved: Vec<InteractiveCell>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InteractiveCell {
    pub r: String,
    pub c: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub value: Option<InteractiveValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum InteractiveValue {
    Number { value: f64 },
    Text { value: String },
    Boolean { value: bool },
}

impl InteractiveValue {
    pub fn from_input(input: Option<&Input>) -> Result<Option<Self>, ()> {
        Ok(match input {
            None => None,
            Some(Input::Text { value }) if value.is_empty() => None,
            Some(Input::Number { value }) => Some(Self::Number { value: *value }),
            Some(Input::Text { value }) => Some(Self::Text { value: value.clone() }),
            Some(Input::Boolean { value }) => Some(Self::Boolean { value: *value }),
            Some(_) => return Err(()),
        })
    }

    pub fn into_input(self) -> Option<Input> {
        match self {
            Self::Number { value } => Some(Input::Number { value }),
            Self::Text { value } if value.is_empty() => None,
            Self::Text { value } => Some(Input::Text { value }),
            Self::Boolean { value } => Some(Input::Boolean { value }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Embed {
    #[serde(rename = "ref")]
    pub reference: String,
    pub caption: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputOfAWidget {
    pub name: String,
    pub range: RangeOnASheet,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RangeOnASheet {
    pub sheet_id: String,
    pub top_left: CellIds,
    pub bottom_right: CellIds,
}

impl View {
    pub fn is_interactive(&self) -> bool {
        self.elements.iter().any(|element| matches!(element, ViewElement::Interactive { .. }))
    }

    /// Whether the view reads: refs `node/` and 1 to 128 of `A-Z a-z 0-9 _ -`; input names a letter or `_`
    /// and then letters, digits and `_`, 128 at most, none twice in a widget; no element id twice in the view.
    fn is_readable(&self) -> bool {
        let is_node_id = |s: &str| (1..=128).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        let is_name = |s: &str| {
            (1..=128).contains(&s.len())
                && s.bytes().enumerate().all(|(i, b)| b.is_ascii_alphabetic() || b == b'_' || (i > 0 && b.is_ascii_digit()))
        };
        let mut element_ids = HashSet::new();
        self.elements.iter().all(|element| {
            let (element_id, embed, inputs) = element.parts();
            let mut names = HashSet::new();
            let base_is_readable = element_ids.insert(element_id)
                && embed.reference.strip_prefix("node/").is_some_and(is_node_id)
                && inputs.iter().all(|i| is_name(&i.name) && names.insert(i.name.as_str()));
            if let ViewElement::Interactive { writes, .. } = element {
                base_is_readable && writes.iter().all(|write| names.remove(write.input.as_str()))
            } else {
                base_is_readable
            }
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewToSet {
    pub view_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub view: Option<View>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ShownByAPlacement {
    #[serde(rename_all = "camelCase")]
    View { view_id: String },
}

impl ShownByAPlacement {
    pub fn view_id(&self) -> &str {
        match self {
            ShownByAPlacement::View { view_id } => view_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OffsetOfAPlacement {
    pub x_in_pixels: u32,
    pub y_in_pixels: u32,
}

/// Where a view is shown on a sheet: anchored at a cell, its size.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    pub shows: ShownByAPlacement,
    pub top_left: CellIds,
    #[serde(default, deserialize_with = "written::not_null", skip_serializing_if = "Option::is_none")]
    pub offset_from_anchor_cell: Option<OffsetOfAPlacement>,
    pub width_in_pixels: u32,
    pub height_in_pixels: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacementToSet {
    pub placement_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub placement: Option<Placement>,
}

/// Whether a dropdown's options read: some, each with its own id and a label, no two labels
/// the same but for capitals, colors known.
fn options_are_readable(options: &[DropdownOption]) -> bool {
    let mut ids = HashSet::new();
    let mut labels = HashSet::new();
    !options.is_empty()
        && options.iter().all(|o| {
            ids.insert(o.option_id.as_str())
                && !o.label.is_empty()
                && labels.insert(o.label.to_lowercase())
                && read_color(&o.color).is_some_and(|c| c == o.color)
        })
}

impl Op {
    pub(super) fn objects_well_formed(&self) -> Option<bool> {
        Some(match self {
            Op::SetDropdowns { dropdowns, .. } => {
                !dropdowns.is_empty() && dropdowns.iter().all(|d| d.options.as_deref().is_none_or(options_are_readable))
            }
            Op::SetConditionalFormats { conditional_formats, .. } => {
                !conditional_formats.is_empty()
                    && conditional_formats.iter().all(|c| {
                        c.conditional_format.as_ref().is_none_or(|p| {
                            (p.ranges.is_some() || p.priority.is_some() || p.effect.is_some())
                                && p.ranges.as_ref().is_none_or(|r| !r.is_empty())
                                && p.effect.as_ref().is_none_or(Effect::is_readable)
                        })
                    })
            }
            Op::SetCellTables { cell_tables, .. } => !cell_tables.is_empty(),
            Op::SetNamedViews { named_views, .. } => {
                !named_views.is_empty() && named_views.iter().all(|entry| entry.named_view.as_ref().is_none_or(NamedView::is_readable))
            }
            Op::SetViews { views } => !views.is_empty() && views.iter().all(|v| v.view.as_ref().is_none_or(View::is_readable)),
            // An offset of nothing is written by leaving it out.
            Op::SetPlacements { placements, .. } => {
                !placements.is_empty()
                    && placements.iter().all(|p| {
                        p.placement.as_ref().and_then(|p| p.offset_from_anchor_cell.as_ref()).is_none_or(|o| o.x_in_pixels != 0 || o.y_in_pixels != 0)
                    })
            }
            _ => return None,
        })
    }
}

impl Workbook {
    pub(super) fn apply_objects(&mut self, op: &Op) -> Result<Op, Refusal> {
        match op {
            Op::SetDropdowns { sheet_id, dropdowns } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut seen = HashSet::new();
                if !dropdowns.iter().all(|d| seen.insert(&d.dropdown_id)) {
                    return Err(Refusal::DropdownSetTwice);
                }
                // An option id names one option of the operation's dropdowns, and none of another dropdown's now.
                let mut owner = hashbrown::HashMap::new();
                for d in dropdowns {
                    for o in d.options.iter().flatten() {
                        if owner.insert(o.option_id.as_str(), d.dropdown_id.as_str()).is_some_and(|other| other != d.dropdown_id) {
                            return Err(Refusal::DropdownOptionIdInTwoDropdowns);
                        }
                    }
                }
                // Dropdown ids and option ids are the workbook's: another sheet's dropdown (deleted or not) holds its
                // own.
                let others = self.sheets.iter().enumerate().filter(|(i, _)| *i != index).map(|(_, s)| s).chain(&self.deleted_sheets);
                for other in others {
                    if dropdowns.iter().any(|d| other.dropdowns.contains_key(&id_key(&d.dropdown_id))) {
                        return Err(Refusal::DropdownIdTaken);
                    }
                }
                let all = self.sheets.iter().chain(&self.deleted_sheets);
                for (id, options) in all.flat_map(|s| s.dropdowns.values()) {
                    if options.iter().any(|o| owner.get(o.option_id.as_str()).is_some_and(|d| *d != id)) {
                        return Err(Refusal::DropdownOptionIdTaken);
                    }
                }
                let sheet = &self.sheets[index];
                for d in dropdowns {
                    if d.options.is_none() && sheet.formats.uses_dropdown(&d.dropdown_id) {
                        return Err(Refusal::DropdownInUse);
                    }
                }
                let sheet = &mut self.sheets[index];
                let mut reverse = Vec::with_capacity(dropdowns.len());
                for d in dropdowns {
                    let key = id_key(&d.dropdown_id);
                    let old = match &d.options {
                        Some(options) => sheet.dropdowns.insert(key, (d.dropdown_id.clone(), options.clone())),
                        None => sheet.dropdowns.remove(&key),
                    };
                    reverse.push(DropdownToSet { dropdown_id: d.dropdown_id.clone(), options: old.map(|(_, o)| o) });
                }
                reverse.sort_by(|a, b| a.dropdown_id.cmp(&b.dropdown_id));
                Ok(Op::SetDropdowns { sheet_id: sheet_id.clone(), dropdowns: reverse })
            }
            Op::SetConditionalFormats { sheet_id, conditional_formats } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut seen = HashSet::new();
                if !conditional_formats.iter().all(|c| seen.insert(&c.conditional_format_id)) {
                    return Err(Refusal::ConditionalFormatNamedTwice);
                }
                let sheet = &self.sheets[index];
                for c in conditional_formats {
                    let Some(patch) = &c.conditional_format else { continue };
                    for range in patch.ranges.iter().flatten() {
                        for cell in [&range.top_left, &range.bottom_right] {
                            self.known_cell(sheet, cell)?;
                        }
                    }
                    for column in patch.effect.iter().flat_map(Effect::columns) {
                        self.known_line(sheet, Lines::Columns, column)?;
                    }
                    let known = sheet.conditional_formats.contains_key(&id_key(&c.conditional_format_id));
                    if !known && (patch.ranges.is_none() || patch.priority.is_none() || patch.effect.is_none()) {
                        return Err(Refusal::UnknownConditionalFormat);
                    }
                }
                let sheet = &mut self.sheets[index];
                let mut reverse = Vec::with_capacity(conditional_formats.len());
                for c in conditional_formats {
                    let key = id_key(&c.conditional_format_id);
                    let old = sheet.conditional_formats.get(&key).map(|(_, f)| f.clone());
                    let back = match (&c.conditional_format, &old) {
                        (_, None) => None,
                        (None, Some(old)) => Some(ConditionalFormatPatch {
                            ranges: Some(old.ranges.clone()),
                            priority: Some(old.priority),
                            effect: Some(old.effect.clone()),
                        }),
                        (Some(p), Some(old)) => Some(ConditionalFormatPatch {
                            ranges: p.ranges.as_ref().map(|_| old.ranges.clone()),
                            priority: p.priority.map(|_| old.priority),
                            effect: p.effect.as_ref().map(|_| old.effect.clone()),
                        }),
                    };
                    match &c.conditional_format {
                        None => {
                            sheet.conditional_formats.remove(&key);
                        }
                        Some(p) => match sheet.conditional_formats.get_mut(&key) {
                            Some((_, cf)) => {
                                if let Some(r) = &p.ranges {
                                    cf.ranges = r.clone();
                                }
                                if let Some(pr) = p.priority {
                                    cf.priority = pr;
                                }
                                if let Some(e) = &p.effect {
                                    cf.effect = e.clone();
                                }
                            }
                            None => {
                                let (Some(ranges), Some(priority), Some(effect)) = (&p.ranges, p.priority, &p.effect) else {
                                    unreachable!("a new conditional format is written whole");
                                };
                                let cf = ConditionalFormat { ranges: ranges.clone(), priority, effect: effect.clone() };
                                sheet.conditional_formats.insert(key, (c.conditional_format_id.clone(), cf));
                            }
                        },
                    }
                    reverse.push(ConditionalFormatToSet { conditional_format_id: c.conditional_format_id.clone(), conditional_format: back });
                }
                Ok(Op::SetConditionalFormats { sheet_id: sheet_id.clone(), conditional_formats: reverse })
            }
            Op::SetCellTables { sheet_id, cell_tables } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut seen = HashSet::new();
                if !cell_tables.iter().all(|c| seen.insert(&c.cell_table_id)) {
                    return Err(Refusal::CellTableNamedTwice);
                }
                let sheet = &self.sheets[index];
                for t in cell_tables.iter().filter_map(|c| c.cell_table.as_ref()) {
                    self.known_line(sheet, Lines::Rows, &t.header_rows.first_row)?;
                    self.known_line(sheet, Lines::Rows, &t.header_rows.last_row)?;
                    self.known_line(sheet, Lines::Columns, &t.first_column)?;
                    self.known_line(sheet, Lines::Columns, &t.last_column)?;
                    if let Some(f) = &t.footer_rows {
                        self.known_line(sheet, Lines::Rows, &f.first_row)?;
                        self.known_line(sheet, Lines::Rows, &f.last_row)?;
                    }
                }
                let sheet = &mut self.sheets[index];
                let mut reverse = Vec::with_capacity(cell_tables.len());
                for c in cell_tables {
                    let key = id_key(&c.cell_table_id);
                    let old = match &c.cell_table {
                        Some(t) => sheet.cell_tables.insert(key, (c.cell_table_id.clone(), t.clone())),
                        None => sheet.cell_tables.remove(&key),
                    };
                    reverse.push(CellTableToSet { cell_table_id: c.cell_table_id.clone(), cell_table: old.map(|(_, t)| t) });
                }
                Ok(Op::SetCellTables { sheet_id: sheet_id.clone(), cell_tables: reverse })
            }
            Op::SetNamedViews { sheet_id, named_views } => self.apply_named_views(sheet_id, named_views),
            Op::SetViews { views } => {
                let mut seen = HashSet::new();
                if !views.iter().all(|v| seen.insert(&v.view_id)) {
                    return Err(Refusal::ViewNamedTwice);
                }
                let shown: HashSet<&str> = self
                    .sheets
                    .iter()
                    .chain(&self.deleted_sheets)
                    .flat_map(Sheet::shown_views)
                    .collect();
                if views.iter().any(|v| v.view.is_none() && shown.contains(v.view_id.as_str())) {
                    return Err(Refusal::ViewInUse);
                }
                let mut reverse = Vec::with_capacity(views.len());
                for v in views {
                    let key = id_key(&v.view_id);
                    let old = match &v.view {
                        Some(view) => {
                            let mut view = view.clone();
                            for element in &mut view.elements {
                                let ViewElement::Interactive { inputs, writes, .. } = element else { continue };
                                for write in writes {
                                    let sheet = inputs.iter().find(|input| input.name == write.input)
                                        .and_then(|input| self.sheets.iter().chain(&self.deleted_sheets)
                                            .find(|sheet| sheet.id == input.range.sheet_id));
                                    write.saved.retain(|cell| sheet.is_some_and(|sheet| {
                                        self.known_line(sheet, Lines::Rows, &cell.r).is_ok()
                                            && self.known_line(sheet, Lines::Columns, &cell.c).is_ok()
                                    }));
                                }
                            }
                            self.views.insert(key, (v.view_id.clone(), view))
                        }
                        None => self.views.remove(&key),
                    };
                    reverse.push(ViewToSet { view_id: v.view_id.clone(), view: old.map(|(_, v)| v) });
                }
                Ok(Op::SetViews { views: reverse })
            }
            Op::SetPlacements { sheet_id, placements } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut seen = HashSet::new();
                if !placements.iter().all(|p| seen.insert(&p.placement_id)) {
                    return Err(Refusal::PlacementNamedTwice);
                }
                let sheet = &self.sheets[index];
                for p in placements.iter().filter_map(|p| p.placement.as_ref()) {
                    self.known_cell(sheet, &p.top_left)?;
                    let ShownByAPlacement::View { view_id } = &p.shows;
                    if !self.views.contains_key(&id_key(view_id)) {
                        return Err(Refusal::UnknownView);
                    }
                }
                let sheet = &mut self.sheets[index];
                let mut reverse = Vec::with_capacity(placements.len());
                for p in placements {
                    let key = id_key(&p.placement_id);
                    let old = match &p.placement {
                        Some(pl) => sheet.placements.insert(key, (p.placement_id.clone(), pl.clone())),
                        None => sheet.placements.remove(&key),
                    };
                    reverse.push(PlacementToSet { placement_id: p.placement_id.clone(), placement: old.map(|(_, p)| p) });
                }
                Ok(Op::SetPlacements { sheet_id: sheet_id.clone(), placements: reverse })
            }
            _ => unreachable!("not an operation on a sheet's objects"),
        }
    }
}

impl Sheet {
    /// The dropdown option with this id, in any of the sheet's dropdowns.
    pub fn dropdown_option(&self, option_id: &str) -> Option<&DropdownOption> {
        self.dropdowns.values().flat_map(|(_, options)| options).find(|o| o.option_id == option_id)
    }
}

pub fn dropdowns_contents(sheet: &Sheet) -> Vec<Value> {
    sheet.dropdowns.values().map(|(id, options)| json!({"dropdownId": id, "options": options})).collect()
}

/// Conditional formats, the first to apply first (smallest priority, then id), each with its ranges now.
pub fn conditional_formats_contents(bases: &Bases, sheet: &Sheet) -> Vec<Value> {
    let mut all: Vec<_> = sheet.conditional_formats.iter().collect();
    all.sort_by(|a, b| (a.1 .1.priority, a.0).cmp(&(b.1 .1.priority, b.0)));
    all.into_iter()
        .map(|(_, (id, cf))| {
            let live: Vec<RangeIds> = cf.ranges.iter().filter_map(|r| sheet.live_range(bases, r)).collect();
            json!({"conditionalFormatId": id, "ranges": cf.ranges, "liveRanges": live, "priority": cf.priority, "effect": cf.effect})
        })
        .collect()
}

/// A cell table where it is now: `None` when its header rows or its columns are all deleted.
pub fn live_cell_table(bases: &Bases, sheet: &Sheet, t: &CellTable) -> Option<CellTable> {
    let rows = |a: &str, b: &str| -> Option<RowsOfACellTable> {
        let (first, last) = live_ends(&sheet.rows, bases.parse(a)?, bases.parse(b)?)?;
        let text = |p| bases.text(sheet.rows.line(p).expect("a live position"));
        Some(RowsOfACellTable { first_row: text(first), last_row: text(last) })
    };
    let header_rows = rows(&t.header_rows.first_row, &t.header_rows.last_row)?;
    let (first, last) = live_ends(&sheet.columns, bases.parse(&t.first_column)?, bases.parse(&t.last_column)?)?;
    let column = |p| bases.text(sheet.columns.line(p).expect("a live position"));
    let footer_rows = t.footer_rows.as_ref().and_then(|f| rows(&f.first_row, &f.last_row));
    Some(CellTable { header_rows, first_column: column(first), last_column: column(last), footer_rows })
}

/// A cell table as it is shown now: the cell at its top left and where it is; `None` when it is not shown (its header
/// rows or its columns are all deleted, or its footer is not under its header).
pub fn shown_cell_table(bases: &Bases, sheet: &Sheet, t: &CellTable) -> Option<((usize, usize), CellTable)> {
    let live = live_cell_table(bases, sheet, t)?;
    let row = |id: &str| sheet.rows.position(bases.parse(id)?);
    if let Some(f) = &live.footer_rows {
        if row(&f.first_row)? <= row(&live.header_rows.last_row)? {
            return None;
        }
    }
    let place = (row(&live.header_rows.first_row)?, sheet.columns.position(bases.parse(&live.first_column)?)?);
    Some((place, live))
}

/// Cell tables where they are now, top to bottom and then left to right; one whose footer is not under its header
/// is left out.
pub fn cell_tables_contents(bases: &Bases, sheet: &Sheet) -> Vec<Value> {
    let mut live: Vec<((usize, usize), &String, &CellTable, CellTable)> = sheet
        .cell_tables
        .values()
        .filter_map(|(id, t)| {
            let (place, live) = shown_cell_table(bases, sheet, t)?;
            Some((place, id, t, live))
        })
        .collect();
    live.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));
    live.into_iter().map(|(_, id, t, live)| json!({"cellTableId": id, "cellTable": t, "liveCellTable": live})).collect()
}

/// Placements with the cell they are anchored at now: the next row or column left when theirs is deleted.
pub fn placements_contents(bases: &Bases, sheet: &Sheet) -> Vec<Value> {
    sheet
        .placements
        .values()
        .filter_map(|(id, p)| {
            let r = anchored_at(&sheet.rows, bases.parse(&p.top_left.r)?)?;
            let c = anchored_at(&sheet.columns, bases.parse(&p.top_left.c)?)?;
            let live = CellIds {
                r: bases.text(sheet.rows.line(r).expect("a live position")),
                c: bases.text(sheet.columns.line(c).expect("a live position")),
            };
            Some(json!({"placementId": id, "placement": p, "liveTopLeft": live}))
        })
        .collect()
}

/// Where a placement anchored at a line is now: at the line, or when it is deleted the next line left, or when no
/// line after it is left the last line.
pub fn anchored_at(axis: &Axis, line: LineId) -> Option<usize> {
    axis.snap_forward(line).or_else(|| axis.index(line).and(axis.len().checked_sub(1)))
}
