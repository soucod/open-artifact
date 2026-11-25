//! Conditional formats, dropdowns and placed views: the edits that change what a sheet holds besides its cells. Each
//! kind of object has a module of its own (`conditional_formats`, `dropdowns`, `placed_views`).
//!
//! What they add is named from the edit's `newIdCode`: conditional formats `cfm_<code>.<k>`, a dropdown
//! `ddn_<code>.0` and its options `opt_<code>.<k>`, a copied placement `plc_<code>.0`, its view `viw_<code>.0` and
//! the view's elements `vel_<code>.<k>`.
//!
//! The operations an edit comes to are checked before they are applied (`check`): first that every id of these
//! objects they name is well formed (`idNotWellFormed`: objects loaded from elsewhere may have others), then
//! the limits on what they set. A workbook with no time zone also takes the browser's with the first edit that
//! changes it (`adopt_time_zone`), whatever the edit.

use serde::Deserialize;
use serde_json::Value as Json;

use super::{Context, Made, Refused};
use crate::session::place::Place;
use crate::ids::{split_id, IdRun, LineId};
use crate::workbook::layout::{written, CellIds, RangeIds};
use crate::workbook::load::Op;
use crate::workbook::objects::{CellCondition, Color, Effect, Embed, InputOfAWidget, OffsetOfAPlacement};
use crate::workbook::{Input, Sheet, Workbook};

pub(crate) mod conditional_formats;
pub(crate) mod dropdowns;
mod placed_views;

/// The most ranges a conditional format formats.
pub(crate) const MOST_RANGES_IN_A_CONDITIONAL_FORMAT: usize = 20;
/// The most tests a conditional format's cells pass.
pub(crate) const MOST_TESTS_IN_A_CONDITIONAL_FORMAT: usize = 5;
/// The longest text a condition holds, in characters.
pub(crate) const LONGEST_TEXT_OF_A_CONDITION: usize = 100;
/// The largest count of cells a condition takes (the largest or smallest so many).
pub(crate) const LARGEST_COUNT_IN_A_CONDITION: u32 = 1000;
/// The most options a dropdown has, and the longest an option's label is, in characters.
pub(crate) const MOST_OPTIONS_IN_A_DROPDOWN: usize = 100;
pub(crate) const LONGEST_DROPDOWN_OPTION: usize = 100;
/// The sides a placement may have, and the largest offset from its anchor cell, in pixels.
const SIDES_OF_A_PLACEMENT: std::ops::RangeInclusive<u32> = 40..=4000;
const LARGEST_OFFSET_OF_A_PLACEMENT: u32 = 2000;
/// The longest name of a view and caption of its element, in characters; the most elements and inputs.
const LONGEST_NAME_OF_A_VIEW: usize = 100;
const LONGEST_CAPTION_IN_A_VIEW: usize = 500;
const MOST_ELEMENTS_IN_A_VIEW: usize = 1;
const MOST_INPUTS_OF_AN_ELEMENT: usize = 32;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    AddConditionalFormats { sheet_id: String, rules: Vec<conditional_formats::Rule> },
    #[serde(rename_all = "camelCase")]
    ChangeConditionalFormat {
        sheet_id: String,
        conditional_format_id: String,
        #[serde(default, deserialize_with = "written::not_null")]
        ranges: Option<Vec<RangeIds>>,
        #[serde(default, deserialize_with = "written::not_null")]
        effect: Option<Effect>,
    },
    #[serde(rename_all = "camelCase")]
    MoveConditionalFormat {
        sheet_id: String,
        conditional_format_id: String,
        #[serde(deserialize_with = "written::maybe_null")]
        before: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    RemoveConditionalFormat { sheet_id: String, conditional_format_id: String },
    MakeDropdown { cells: dropdowns::CellsInRows, options: Vec<dropdowns::OptionToMake> },
    #[serde(rename_all = "camelCase")]
    AddDropdownOption { sheet_id: String, cell: CellIds, label: String, color: Color },
    #[serde(rename_all = "camelCase")]
    SetDropdownOptions {
        sheet_id: String,
        dropdown_id: String,
        options: Vec<dropdowns::OptionInAnEditor>,
        applies_to: dropdowns::AppliesTo,
    },
    #[serde(rename_all = "camelCase")]
    MovePlacedView {
        sheet_id: String,
        placement_id: String,
        top_left: CellIds,
        #[serde(default, deserialize_with = "written::not_null")]
        offset_from_anchor_cell: Option<OffsetOfAPlacement>,
    },
    #[serde(rename_all = "camelCase")]
    ResizePlacedView {
        sheet_id: String,
        placement_id: String,
        top_left: CellIds,
        #[serde(default, deserialize_with = "written::not_null")]
        offset_from_anchor_cell: Option<OffsetOfAPlacement>,
        width_in_pixels: u32,
        height_in_pixels: u32,
    },
    #[serde(rename_all = "camelCase")]
    DeletePlacedView { sheet_id: String, placement_id: String },
    #[serde(rename_all = "camelCase")]
    CopyPlacedView {
        sheet_id: String,
        placement_id: String,
        to_sheet_id: String,
        top_left: CellIds,
        #[serde(default, deserialize_with = "written::not_null")]
        offset_from_anchor_cell: Option<OffsetOfAPlacement>,
        copied_widget_nodes: Vec<placed_views::CopiedWidgetNode>,
    },
    #[serde(rename_all = "camelCase")]
    AddPlacedView {
        sheet_id: String,
        name: String,
        embed: Embed,
        inputs: Vec<InputOfAWidget>,
        top_left: CellIds,
        #[serde(default, deserialize_with = "written::not_null")]
        offset_from_anchor_cell: Option<OffsetOfAPlacement>,
        width_in_pixels: u32,
        height_in_pixels: u32,
    },
    #[serde(rename_all = "camelCase")]
    ReplaceWidgetNodeOfPlacedView {
        sheet_id: String,
        placement_id: String,
        old_node: String,
        new_node: String,
        #[serde(default)]
        new_name: Option<String>,
    },
}

/// The edit as the session reads it, before anything else about it: rules with ranges and an effect that reads,
/// dropdown options and rows to give them, copies of widget nodes each made once. `adoptTimeZone` is not an edit
/// the page sends (the session adopts the browser's time zone itself).
pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    let readable = match &edit {
        Edit::AddConditionalFormats { rules, .. } => !rules.is_empty() && rules.iter().all(|r| r.is_readable()),
        Edit::ChangeConditionalFormat { ranges, effect, .. } => {
            ranges.as_ref().is_none_or(|r| !r.is_empty()) && effect.as_ref().is_none_or(Effect::is_readable)
        }
        Edit::MakeDropdown { cells, options } => !options.is_empty() && runs_are_readable(&cells.rows),
        Edit::SetDropdownOptions { options, applies_to, .. } => !options.is_empty() && applies_to.is_readable(),
        Edit::CopyPlacedView { copied_widget_nodes, .. } => placed_views::copies_are_readable(copied_widget_nodes),
        Edit::AddPlacedView { embed, inputs, .. } => placed_views::is_readable(embed, inputs),
        Edit::ReplaceWidgetNodeOfPlacedView { old_node, new_node, .. } => {
            placed_views::is_node(old_node) && placed_views::is_node(new_node)
        }
        _ => true,
    };
    readable.then_some(edit)
}

pub fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let code = context.code;
    let made = match edit {
        Edit::AddConditionalFormats { sheet_id, rules } => conditional_formats::add(workbook, sheet_id, rules, code),
        Edit::ChangeConditionalFormat { sheet_id, conditional_format_id, ranges, effect } => {
            conditional_formats::change(workbook, sheet_id, conditional_format_id, ranges, effect)
        }
        Edit::MoveConditionalFormat { sheet_id, conditional_format_id, before } => {
            conditional_formats::move_before(workbook, sheet_id, conditional_format_id, before)
        }
        Edit::RemoveConditionalFormat { sheet_id, conditional_format_id } => {
            conditional_formats::remove(workbook, sheet_id, conditional_format_id)
        }
        Edit::MakeDropdown { cells, options } => dropdowns::make_dropdown(workbook, cells, options, code),
        Edit::AddDropdownOption { sheet_id, cell, label, color } => {
            dropdowns::add_option(workbook, sheet_id, cell, label, color, code)
        }
        Edit::SetDropdownOptions { sheet_id, dropdown_id, options, applies_to } => {
            dropdowns::set_options(workbook, sheet_id, dropdown_id, options, applies_to, code)
        }
        Edit::MovePlacedView { sheet_id, placement_id, top_left, offset_from_anchor_cell } => {
            placed_views::place(workbook, sheet_id, placement_id, top_left, offset_from_anchor_cell, None)
        }
        Edit::ResizePlacedView {
            sheet_id,
            placement_id,
            top_left,
            offset_from_anchor_cell,
            width_in_pixels,
            height_in_pixels,
        } => {
            let size = Some((width_in_pixels, height_in_pixels));
            placed_views::place(workbook, sheet_id, placement_id, top_left, offset_from_anchor_cell, size)
        }
        Edit::DeletePlacedView { sheet_id, placement_id } => placed_views::delete(workbook, sheet_id, placement_id),
        Edit::CopyPlacedView {
            sheet_id,
            placement_id,
            to_sheet_id,
            top_left,
            offset_from_anchor_cell,
            copied_widget_nodes,
        } => {
            let to = placed_views::Copy { to_sheet_id, top_left, offset: offset_from_anchor_cell };
            placed_views::copy(workbook, sheet_id, placement_id, to, copied_widget_nodes, code)
        }
        Edit::AddPlacedView {
            sheet_id,
            name,
            embed,
            inputs,
            top_left,
            offset_from_anchor_cell,
            width_in_pixels,
            height_in_pixels,
        } => {
            let at = placed_views::At { top_left, offset: offset_from_anchor_cell, size: (width_in_pixels, height_in_pixels) };
            placed_views::add(workbook, sheet_id, name, embed, inputs, at, code)
        }
        Edit::ReplaceWidgetNodeOfPlacedView { sheet_id, placement_id, old_node, new_node, new_name } => {
            placed_views::replace_widget_node(workbook, sheet_id, placement_id, old_node, new_node, new_name)
        }
    }?;
    if !made.ops.is_empty() {
        check(workbook, &made.ops)?;
    }
    Ok(made)
}

/// The browser's time zone, taken by a workbook that has none with the first edit that changes it (unless the edit
/// sets the time zone itself): the operation goes before the edit's.
pub fn adopt_time_zone(workbook: &Workbook, made: &mut Made, context: &Context) {
    if made.ops.is_empty() || workbook.time_zone.is_some() {
        return;
    }
    if made.ops.iter().any(|op| matches!(op, Op::SetTimeZone { .. } | Op::AdoptTimeZone { .. })) {
        return;
    }
    let Some(zone) = context.browser_zone.and_then(crate::time_zone::named) else { return };
    made.ops.insert(0, Op::AdoptTimeZone { time_zone: zone.to_owned() });
}

/// The sheet with this id.
fn sheet_of<'a>(workbook: &'a Workbook, sheet_id: &str) -> Result<&'a Sheet, Refused> {
    workbook.sheet_index(sheet_id).map(|i| &workbook.sheets[i]).ok_or(Refused::Because("unknownSheet"))
}

/// A row of the sheet that is not deleted, by its position.
fn live_row(workbook: &Workbook, sheet: &Sheet, id: &str) -> Result<usize, Refused> {
    workbook.bases.parse(id).and_then(|l| sheet.rows.position(l)).ok_or(Refused::Because("unknownRow"))
}

fn live_column(workbook: &Workbook, sheet: &Sheet, id: &str) -> Result<usize, Refused> {
    workbook.bases.parse(id).and_then(|l| sheet.columns.position(l)).ok_or(Refused::Because("unknownColumn"))
}

/// A cell of the sheet whose row and column are not deleted, by its position: its row first.
fn live_cell(workbook: &Workbook, sheet: &Sheet, cell: &CellIds) -> Result<(usize, usize), Refused> {
    Ok((live_row(workbook, sheet, &cell.r)?, live_column(workbook, sheet, &cell.c)?))
}

/// The ids of a cell at a position.
fn cell_ids(workbook: &Workbook, sheet: &Sheet, (row, column): (usize, usize)) -> CellIds {
    let line = |l: Option<LineId>| workbook.bases.text(l.expect("a live position"));
    CellIds { r: line(sheet.rows.line(row)), c: line(sheet.columns.line(column)) }
}

/// The box around boxes of a sheet (top, bottom, left, right).
fn around<'a>(sheet_id: &str, boxes: impl Iterator<Item = &'a (usize, usize, usize, usize)>) -> Place {
    let around = boxes.copied().reduce(|x, y| (x.0.min(y.0), x.1.max(y.1), x.2.min(y.2), x.3.max(y.3)));
    match around {
        Some((t, b, l, r)) => Place::cells(sheet_id, t, l, b, r),
        None => Place::sheet(sheet_id),
    }
}

/// Runs that read for rows to give a dropdown: some, none of them empty.
fn runs_are_readable(runs: &[IdRun]) -> bool {
    !runs.is_empty() && runs.iter().all(|r| r.count > 0)
}

/// Whether an id is well formed: `<prefix>_<code>.<n>`, the code 8 to 16 of `a-z 0-9`, `n` a number
/// written without leading zeros.
pub(crate) fn is_well_formed(id: &str, prefix: &str) -> bool {
    let Some((base, _)) = split_id(id) else { return false };
    base.strip_prefix(prefix).and_then(|b| b.strip_prefix('_')).is_some_and(|code| {
        (8..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    })
}

/// The ids of objects an operation names, each with the prefix it is to have. A placement's view is not among them.
fn ids_named(op: &Op) -> Vec<(&str, &'static str)> {
    match op {
        Op::SetConditionalFormats { conditional_formats, .. } => {
            conditional_formats.iter().map(|c| (c.conditional_format_id.as_str(), "cfm")).collect()
        }
        Op::SetDropdowns { dropdowns, .. } => dropdowns
            .iter()
            .flat_map(|d| {
                let options = d.options.iter().flatten().map(|o| (o.option_id.as_str(), "opt"));
                std::iter::once((d.dropdown_id.as_str(), "ddn")).chain(options)
            })
            .collect(),
        Op::SetCells { cells, .. } => cells
            .iter()
            .filter_map(|c| match &c.input {
                Some(Input::DropdownOption { option_id, .. }) => Some((option_id.as_str(), "opt")),
                _ => None,
            })
            .collect(),
        Op::SetPlacements { placements, .. } => placements.iter().map(|p| (p.placement_id.as_str(), "plc")).collect(),
        Op::SetViews { views } => views
            .iter()
            .flat_map(|v| {
                let elements = v.view.iter().flat_map(|v| &v.elements);
                let elements = elements.map(|element| (element.parts().0, "vel"));
                std::iter::once((v.view_id.as_str(), "viw")).chain(elements)
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The operations of an edit checked before they are applied: the ids they name, then what they set
/// against the limits.
fn check(workbook: &Workbook, ops: &[Op]) -> Result<(), Refused> {
    if !ops.iter().flat_map(ids_named).all(|(id, prefix)| is_well_formed(id, prefix)) {
        return Err(Refused::Because("idNotWellFormed"));
    }
    for op in ops {
        match op {
            Op::SetConditionalFormats { conditional_formats, .. } => {
                for patch in conditional_formats.iter().filter_map(|c| c.conditional_format.as_ref()) {
                    if patch.ranges.as_ref().is_some_and(|r| r.len() > MOST_RANGES_IN_A_CONDITIONAL_FORMAT) {
                        return Err(Refused::Because("tooManyRangesInConditionalFormat"));
                    }
                    if let Some(effect) = &patch.effect {
                        check_effect(effect)?;
                    }
                }
            }
            Op::SetDropdowns { dropdowns, .. } => {
                for options in dropdowns.iter().filter_map(|d| d.options.as_ref()) {
                    dropdowns::check_limits(&options.iter().map(|o| o.label.as_str()).collect::<Vec<_>>())?;
                }
            }
            Op::SetPlacements { placements, .. } => {
                for p in placements.iter().filter_map(|p| p.placement.as_ref()) {
                    let allowed = |side| SIDES_OF_A_PLACEMENT.contains(side);
                    if !allowed(&p.width_in_pixels) || !allowed(&p.height_in_pixels) {
                        return Err(Refused::Because("sizeOfPlacementNotAllowed"));
                    }
                    let offset = p.offset_from_anchor_cell.as_ref();
                    if offset.is_some_and(|o| o.x_in_pixels.max(o.y_in_pixels) > LARGEST_OFFSET_OF_A_PLACEMENT) {
                        return Err(Refused::Because("offsetOfPlacementNotAllowed"));
                    }
                    // A placement an edit moves, sizes or makes may not show an interactive: those
                    // fill a sheet of their own.
                    if shows_an_interactive(workbook, ops, p.shows.view_id()) {
                        return Err(Refused::Because("viewIsAnInteractive"));
                    }
                }
            }
            Op::SetViews { views } => {
                for view in views.iter().filter_map(|v| v.view.as_ref()) {
                    placed_views::check_view(view)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Whether the view is an interactive: as the operations set it, or else as the workbook holds it.
fn shows_an_interactive(workbook: &Workbook, ops: &[Op], view_id: &str) -> bool {
    let set = ops.iter().rev().find_map(|op| match op {
        Op::SetViews { views } => views.iter().find(|v| v.view_id == view_id).map(|v| v.view.as_ref()),
        _ => None,
    });
    match set {
        Some(view) => view.is_some_and(|view| view.is_interactive()),
        None => workbook.views.get(view_id).is_some_and(|(_, view)| view.is_interactive()),
    }
}

/// A conditional format's tests against the limits: not too many, each condition within them.
fn check_effect(effect: &Effect) -> Result<(), Refused> {
    let Effect::FormatWhere { all_of, .. } = effect else { return Ok(()) };
    if all_of.len() > MOST_TESTS_IN_A_CONDITIONAL_FORMAT {
        return Err(Refused::Because("tooManyTestsInConditionalFormat"));
    }
    for test in all_of {
        condition_within_limits(&test.condition).map_err(Refused::Because)?;
    }
    Ok(())
}

/// A condition against the limits: a count not too large, a text not too long and without control characters.
pub(crate) fn condition_within_limits(condition: &CellCondition) -> Result<(), &'static str> {
    match condition {
        CellCondition::IsAmongTheLargest { count } | CellCondition::IsAmongTheSmallest { count } => {
            if count.get() > LARGEST_COUNT_IN_A_CONDITION {
                return Err("countInConditionTooLarge");
            }
        }
        CellCondition::TextIs { text }
        | CellCondition::TextIsNot { text }
        | CellCondition::TextContains { text }
        | CellCondition::TextDoesNotContain { text }
        | CellCondition::TextStartsWith { text }
        | CellCondition::TextEndsWith { text } => {
            if text.chars().count() > LONGEST_TEXT_OF_A_CONDITION {
                return Err("textOfConditionTooLong");
            }
            if text.chars().any(char::is_control) {
                return Err("textOfConditionHoldsControlCharacter");
            }
        }
        _ => {}
    }
    Ok(())
}
