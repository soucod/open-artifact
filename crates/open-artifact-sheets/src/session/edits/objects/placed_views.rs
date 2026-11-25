//! Placed views: adding one, moving or resizing where a view is shown on a sheet, deleting it, copying it to a sheet,
//! pointing its widget at another node of the page.
//!
//! A placement shows a view of the workbook, anchored at a cell (and offset from it). Deleting the placement deletes
//! its view too (which no other placement may show). A copy is a new view, its widgets showing the copies the page
//! made of the original's widget nodes (`copiedWidgetNodes`, each a node and its copy), and a new placement of it.

use hashbrown::HashSet;

use serde::Deserialize;

use super::{cell_ids, live_cell, sheet_of, Made, Refused};
use super::{LONGEST_CAPTION_IN_A_VIEW, LONGEST_NAME_OF_A_VIEW, MOST_ELEMENTS_IN_A_VIEW, MOST_INPUTS_OF_AN_ELEMENT};
use crate::workbook::layout::CellIds;
use crate::workbook::load::Op;
use crate::session::place::Place;
use crate::workbook::objects::{
    Embed, InputOfAWidget, OffsetOfAPlacement, Placement, PlacementToSet, RangeOnASheet, ShownByAPlacement, View,
    ViewElement, ViewToSet,
};
use crate::workbook::{Sheet, Workbook};

/// A widget node of the page and the copy the page made of it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CopiedWidgetNode {
    pub source: String,
    pub copy: String,
}

/// A node of the page: `node/` and 1 to 128 of `A-Z a-z 0-9 _ -`.
pub fn is_node(s: &str) -> bool {
    s.strip_prefix("node/").is_some_and(|id| {
        (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

/// A view to add that reads: its widget a node of the page, its inputs named by a letter or `_` and then
/// letters, digits and `_`, 128 at most (the same name twice is read, and refused when made).
pub fn is_readable(embed: &Embed, inputs: &[InputOfAWidget]) -> bool {
    let is_name = |s: &str| {
        (1..=128).contains(&s.len())
            && s.bytes().enumerate().all(|(i, b)| b.is_ascii_alphabetic() || b == b'_' || (i > 0 && b.is_ascii_digit()))
    };
    is_node(&embed.reference) && inputs.iter().all(|i| is_name(&i.name))
}

/// Copies that read: nodes of the page, no node copied twice and no copy made twice.
pub fn copies_are_readable(copies: &[CopiedWidgetNode]) -> bool {
    let (mut sources, mut made) = (HashSet::new(), HashSet::new());
    copies.iter().all(|c| is_node(&c.source) && is_node(&c.copy) && sources.insert(&c.source) && made.insert(&c.copy))
}

/// Where a copy goes: the sheet, the cell it is anchored at and its offset from it.
pub struct Copy {
    pub to_sheet_id: String,
    pub top_left: CellIds,
    pub offset: Option<OffsetOfAPlacement>,
}

/// An offset as a placement keeps it: none is written by leaving it out.
fn kept(offset: Option<OffsetOfAPlacement>) -> Option<OffsetOfAPlacement> {
    offset.filter(|o| o.x_in_pixels != 0 || o.y_in_pixels != 0)
}

/// The placement with this id on the sheet.
fn placement_of<'a>(sheet: &'a Sheet, placement_id: &str) -> Result<&'a Placement, Refused> {
    sheet.placements.get(placement_id).map(|(_, p)| p).ok_or(Refused::Because("unknownPlacement"))
}

/// Anchors a placement at a cell (with an offset, or none), and gives it a size when one is given.
pub fn place(
    workbook: &Workbook,
    sheet_id: String,
    placement_id: String,
    top_left: CellIds,
    offset: Option<OffsetOfAPlacement>,
    size: Option<(u32, u32)>,
) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &sheet_id)?;
    let old = placement_of(sheet, &placement_id)?;
    let at = live_cell(workbook, sheet, &top_left)?;
    let (width_in_pixels, height_in_pixels) = size.unwrap_or((old.width_in_pixels, old.height_in_pixels));
    let placement = Placement {
        shows: old.shows.clone(),
        top_left: cell_ids(workbook, sheet, at),
        offset_from_anchor_cell: kept(offset),
        width_in_pixels,
        height_in_pixels,
    };
    if placement == *old {
        return Ok(Made::nothing());
    }
    let placements = vec![PlacementToSet { placement_id, placement: Some(placement) }];
    Ok(Made::ops(vec![Op::SetPlacements { sheet_id, placements }]))
}

/// Deletes a placement and the view it shows.
pub fn delete(workbook: &Workbook, sheet_id: String, placement_id: String) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &sheet_id)?;
    let view_id = placement_of(sheet, &placement_id)?.shows.view_id().to_owned();
    let ops = vec![
        Op::SetPlacements {
            sheet_id: sheet_id.clone(),
            placements: vec![PlacementToSet { placement_id, placement: None }],
        },
        Op::SetViews { views: vec![ViewToSet { view_id, view: None }] },
    ];
    Ok(Made { ops, place: Some(crate::session::place::Place::sheet(&sheet_id)) })
}

/// Copies a placement and its view: the copy's widgets show the copies of the original's nodes, which no view may
/// show already.
pub fn copy(
    workbook: &Workbook,
    sheet_id: String,
    placement_id: String,
    to: Copy,
    copies: Vec<CopiedWidgetNode>,
    code: &str,
) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &sheet_id)?;
    let original = placement_of(sheet, &placement_id)?;
    let to_sheet = sheet_of(workbook, &to.to_sheet_id)?;
    let at = live_cell(workbook, to_sheet, &to.top_left)?;
    let view_id = original.shows.view_id();
    let Some((_, view)) = workbook.views.get(view_id) else { return Err(Refused::Because("unknownView")) };
    let shown: HashSet<&str> = workbook
        .views
        .values()
        .flat_map(|(_, v)| &v.elements)
        .map(|element| element.parts().1.reference.as_str())
        .collect();
    let mut elements = Vec::with_capacity(view.elements.len());
    for (k, element) in view.elements.iter().enumerate() {
        let (_, embed, _) = element.parts();
        let Some(copy) = copies.iter().find(|c| c.source == embed.reference) else {
            return Err(Refused::Because("widgetNodeNotCopied"));
        };
        if shown.contains(copy.copy.as_str()) {
            return Err(Refused::Because("widgetNodeOfAnotherView"));
        }
        let mut element = element.clone();
        let (element_id, embed, _) = element.parts_mut();
        *element_id = format!("vel_{code}.{k}");
        embed.reference.clone_from(&copy.copy);
        elements.push(element);
    }
    let new_view = format!("viw_{code}.0");
    let placement = Placement {
        shows: ShownByAPlacement::View { view_id: new_view.clone() },
        top_left: cell_ids(workbook, to_sheet, at),
        offset_from_anchor_cell: kept(to.offset),
        width_in_pixels: original.width_in_pixels,
        height_in_pixels: original.height_in_pixels,
    };
    let view = View { name: view.name.clone(), elements };
    let ops = vec![
        Op::SetViews { views: vec![ViewToSet { view_id: new_view, view: Some(view) }] },
        Op::SetPlacements {
            sheet_id: to.to_sheet_id,
            placements: vec![PlacementToSet { placement_id: format!("plc_{code}.0"), placement: Some(placement) }],
        },
    ];
    Ok(Made::ops(ops))
}

/// Where a view added goes: the cell it is anchored at, its offset from it and its size.
pub struct At {
    pub top_left: CellIds,
    pub offset: Option<OffsetOfAPlacement>,
    pub size: (u32, u32),
}

/// The nodes the views of the workbook show (but those of one view, when it is named).
fn nodes_shown<'a>(workbook: &'a Workbook, but: Option<&str>) -> HashSet<&'a str> {
    workbook
        .views
        .values()
        .filter(|(id, _)| Some(id.as_str()) != but)
        .flat_map(|(_, v)| &v.elements)
        .map(|element| element.parts().1.reference.as_str())
        .collect()
}

/// Adds a view of one widget and a placement of it: the anchor cell and each input's corners cells of their sheets
/// (`unknownSheet`, `unknownRow`, `unknownColumn`, an input's corners put in order), no two inputs of one name
/// (`inputOfViewNamedTwice`), its node shown by no other view (`widgetNodeOfAnotherView`); then the view and
/// placement against the limits.
pub fn add(
    workbook: &Workbook,
    sheet_id: String,
    name: String,
    embed: Embed,
    inputs: Vec<InputOfAWidget>,
    at: At,
    code: &str,
) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &sheet_id)?;
    let anchor = live_cell(workbook, sheet, &at.top_left)?;
    let mut ordered = Vec::with_capacity(inputs.len());
    for input in inputs {
        let RangeOnASheet { sheet_id: of, top_left, bottom_right } = input.range;
        let on = sheet_of(workbook, &of)?;
        let (r1, c1) = live_cell(workbook, on, &top_left)?;
        let (r2, c2) = live_cell(workbook, on, &bottom_right)?;
        let range = RangeOnASheet {
            sheet_id: of,
            top_left: cell_ids(workbook, on, (r1.min(r2), c1.min(c2))),
            bottom_right: cell_ids(workbook, on, (r1.max(r2), c1.max(c2))),
        };
        ordered.push(InputOfAWidget { name: input.name, range });
    }
    let mut names = HashSet::new();
    if !ordered.iter().all(|i| names.insert(i.name.clone())) {
        return Err(Refused::Because("inputOfViewNamedTwice"));
    }
    if nodes_shown(workbook, None).contains(embed.reference.as_str()) {
        return Err(Refused::Because("widgetNodeOfAnotherView"));
    }
    let view_id = format!("viw_{code}.0");
    let element = ViewElement::Widget { element_id: format!("vel_{code}.0"), embed, inputs: ordered };
    let placement = Placement {
        shows: ShownByAPlacement::View { view_id: view_id.clone() },
        top_left: cell_ids(workbook, sheet, anchor),
        offset_from_anchor_cell: kept(at.offset),
        width_in_pixels: at.size.0,
        height_in_pixels: at.size.1,
    };
    let ops = vec![
        Op::SetViews { views: vec![ViewToSet { view_id, view: Some(View { name, elements: vec![element] }) }] },
        Op::SetPlacements {
            sheet_id,
            placements: vec![PlacementToSet { placement_id: format!("plc_{code}.0"), placement: Some(placement) }],
        },
    ];
    Ok(Made::ops(ops))
}

/// Points the widget of a placement's view at another node of the page, and renames the view when a new name is
/// given: nothing to change when the view shows the new node already; refused when it does not show the old one
/// (`widgetNodeNotShownByTheView`), or another view shows the new one (`widgetNodeOfAnotherView`). The place is the
/// placement's.
pub fn replace_widget_node(
    workbook: &Workbook,
    sheet_id: String,
    placement_id: String,
    old_node: String,
    new_node: String,
    new_name: Option<String>,
) -> Result<Made, Refused> {
    let sheet = sheet_of(workbook, &sheet_id)?;
    let placement = placement_of(sheet, &placement_id)?;
    let view_id = placement.shows.view_id();
    let Some((_, view)) = workbook.views.get(view_id) else { return Err(Refused::Because("unknownView")) };
    let shows = |node: &str| view.elements.iter().any(|element| element.parts().1.reference == node);
    // A node the view shows already is nothing to change (a new name too), unless another view shows it as well (as
    // a workbook may) or the view would not take the new name.
    let of_another_view = || nodes_shown(workbook, Some(view_id)).contains(new_node.as_str());
    if shows(&new_node) {
        if of_another_view() {
            return Err(Refused::Because("widgetNodeOfAnotherView"));
        }
        if let Some(name) = &new_name {
            check_view(&View { name: name.clone(), ..view.clone() })?;
        }
        return Ok(Made::nothing());
    }
    if !shows(&old_node) {
        return Err(Refused::Because("widgetNodeNotShownByTheView"));
    }
    if of_another_view() {
        return Err(Refused::Because("widgetNodeOfAnotherView"));
    }
    let mut view = view.clone();
    for element in &mut view.elements {
        let (_, embed, _) = element.parts_mut();
        if embed.reference == old_node {
            embed.reference = new_node.clone();
        }
    }
    if let Some(name) = new_name {
        view.name = name;
    }
    let ops = vec![Op::SetViews { views: vec![ViewToSet { view_id: view_id.to_owned(), view: Some(view) }] }];
    let anchor = live_cell(workbook, sheet, &placement.top_left).ok().map(|(r, c)| (r, c, r, c));
    let place = Place::Sheet { sheet_id, cells: anchor, placement: Some(placement_id) };
    Ok(Made { ops, place: Some(place) })
}

/// A view against the limits: a name, not too long; an element, not too many; captions not too long; not too many
/// inputs; no control character in its texts.
pub(super) fn check_view(view: &View) -> Result<(), Refused> {
    if view.name.is_empty() {
        return Err(Refused::Because("viewHasNoName"));
    }
    if view.name.chars().count() > LONGEST_NAME_OF_A_VIEW {
        return Err(Refused::Because("nameOfViewTooLong"));
    }
    if view.elements.is_empty() {
        return Err(Refused::Because("viewHasNoElement"));
    }
    if view.elements.len() > MOST_ELEMENTS_IN_A_VIEW {
        return Err(Refused::Because("tooManyElementsInView"));
    }
    for element in &view.elements {
        let (_, embed, inputs) = element.parts();
        if embed.caption.chars().count() > LONGEST_CAPTION_IN_A_VIEW {
            return Err(Refused::Because("captionInViewTooLong"));
        }
        if inputs.len() > MOST_INPUTS_OF_AN_ELEMENT {
            return Err(Refused::Because("tooManyInputsOfElement"));
        }
    }
    let captions = view.elements.iter().map(|element| element.parts().1.caption.as_str());
    if std::iter::once(view.name.as_str()).chain(captions).any(|t| t.chars().any(char::is_control)) {
        return Err(Refused::Because("textOfViewHoldsControlCharacter"));
    }
    Ok(())
}
