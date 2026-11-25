//! Edits: what the page asks to change (`queueEdit`'s `edit`), worked out into operations on the workbook as it is
//! shown. An edit that would change nothing is no operations (`nothingToChange`).
//!
//! There are 64 kinds of edit. Each family of them has a module of its own, with the same three parts: its
//! `Edit` (the kinds it reads), `read` (the edit as the session reads it before anything else,
//! `None` when it is unreadable) and `make` (the edit worked out on the workbook shown). `read` here sends each kind
//! to its family.

use serde_json::Value as Json;

use super::place::Place;
use crate::workbook::load::Op;

mod cells;
mod clipboard;
mod formats;
mod interactive;
mod named_views;
mod pivot;
pub(super) mod lines;
pub(super) mod objects;
mod seen;
mod sheets;
pub(crate) mod tables;

/// What an edit is worked out with besides the workbook shown.
#[allow(dead_code)] // until the families that read them are written
pub struct Context<'a> {
    pub is_among_several: bool,
    /// The edit's `newIdCode`: what the ids of what it adds are made of (`sht_<code>.0`, `row_<code>.<n>`, …).
    pub code: &'a str,
    /// The page's time zone, when it sent one (`timeZoneOfTheBrowser`).
    pub browser_zone: Option<&'a str>,
    /// What the page says the person was shown (`shownToThePerson`): the texts no cell shows of an earlier
    /// `toBeShownFirst`. None (null or left out): the edit shows nothing first.
    pub shown_to_the_person: Option<&'a [crate::typing::TextThatNoCellShows]>,
    /// The order the person sees a sheet's rows in (`ownRowOrder`), when they put them in one of their own.
    pub own_row_order: Option<&'a super::OwnRowOrder>,
    /// The order the edit is made in, of the sheet it is on (`seen`): set for the families while they make it.
    pub seen: Option<&'a seen::Seen>,
}

/// An edit worked out: its operations, and the place it changed when that is not where the operations change.
pub struct Made {
    pub ops: Vec<Op>,
    pub place: Option<Place>,
}

impl Made {
    pub fn ops(ops: Vec<Op>) -> Made {
        Made { ops, place: None }
    }

    pub fn nothing() -> Made {
        Made { ops: Vec::new(), place: None }
    }
}

#[allow(dead_code)]
pub enum Refused {
    /// The edit is not one the session reads.
    Unreadable,
    /// The edit cannot be made: why, as the page reads it (`{"kind": "refused", "refusal": …}`).
    Because(&'static str),
    /// The edit is answered otherwise than queued or refused: the whole answer (`toBeShownFirst`,
    /// `textThatNoCellShows`, …).
    Answer(Json),
    /// The edit is refused once its operations are tried: they are applied, the workbook found broken (`why`)
    /// and they are taken back, and what they touched is told all the same.
    Tried(&'static str, Vec<Op>),
}

impl From<crate::workbook::load::Refusal> for Refused {
    fn from(refusal: crate::workbook::load::Refusal) -> Refused {
        match serde_json::to_value(refusal) {
            Ok(Json::String(s)) => Refused::Because(Box::leak(s.into_boxed_str())),
            _ => Refused::Unreadable,
        }
    }
}

/// An edit of one of the families.
pub enum Edit {
    Sheets(sheets::Edit),
    Cells(cells::Edit),
    Clipboard(clipboard::Edit),
    Formats(formats::Edit),
    Interactive(interactive::Edit),
    NamedViews(named_views::Edit),
    Lines(lines::Edit),
    Tables(tables::Edit),
    Pivot(pivot::Edit),
    Objects(objects::Edit),
}

pub struct EditLimits {
    pub check_cell_count: bool,
    pub send_whole: bool,
}

impl Edit {
    /// Whether the edit measures what cells show, or pastes their values: formulas waiting for `calculate` are worked
    /// out before it is made.
    pub fn measures_values(&self) -> bool {
        matches!(self, Edit::Lines(edit) if edit.measures_values())
            || matches!(self, Edit::Clipboard(edit) if edit.measures_values())
    }

    /// Whether the edit is held to the most cells a workbook holds (`tooManyCells`): every edit but `enter`, which
    /// gives one cell (found by probing: a workbook at the limit takes one more cell from `enter`, and none from any
    /// other edit).
    pub fn limits(&self) -> EditLimits {
        EditLimits {
            check_cell_count: !matches!(self, Edit::Cells(cells::Edit::Enter(_))),
            // format_cells already enforces its own 240 KiB limit, including values made by checkboxes.
            send_whole: matches!(self, Edit::Formats(formats::Edit::FormatCells { .. })),
        }
    }

    /// What the edit adds once made, as a part of its own after it, worked out on the workbook it leaves: an imported
    /// table's look.
    pub fn follow_up(&self, code: &str) -> Option<FollowUp> {
        match self {
            Edit::Tables(edit) => tables::follow_up(edit, code).map(FollowUp::Tables),
            Edit::Pivot(edit) => Some(FollowUp::Pivot(pivot::follow_up(edit, code))),
            _ => None,
        }
    }
}

/// What an edit adds once made (`Edit::follow_up`).
pub enum FollowUp {
    Tables(tables::FollowUp),
    Pivot(pivot::FollowUp),
}

/// The operations of what an edit adds once made, on the workbook it leaves (none: nothing to add).
pub fn follow_up_ops(workbook: &crate::workbook::Workbook, follow_up: FollowUp) -> Vec<Op> {
    match follow_up {
        FollowUp::Tables(follow_up) => tables::follow_up_ops(workbook, follow_up),
        FollowUp::Pivot(follow_up) => pivot::follow_up_ops(workbook, follow_up),
    }
}

/// The edit as the session reads it, before anything else about it, by its kind.
pub fn read(edit: Json) -> Option<Edit> {
    // Typing keeps the edit as it came (a paste's texts may be many: taken, not copied).
    let typed = matches!(
        edit.get("kind")?.as_str()?,
        "enter" | "enterInCells" | "enterTextWithLooksInCells" | "pasteTexts" | "pasteRowsOfTexts" | "clearCells"
            | "addUserToCell" | "removeUserFromCell" | "setListLineChecked"
    );
    if typed {
        return cells::read(edit).map(Edit::Cells);
    }
    let edit = &edit;
    let kind = edit.get("kind")?.as_str()?;
    Some(match kind {
        "addSheet" | "renameSheet" | "moveSheet" | "deleteSheet" | "setLocale" | "setTimeZone" => {
            Edit::Sheets(sheets::read(edit)?)
        }
        "pasteCopiedCells" | "pasteValuesOfCopiedCells" | "pasteCellsOfAnotherProgram" | "pasteValuesOfCells"
        | "moveCells" | "fillCells" => Edit::Clipboard(clipboard::read(edit)?),
        "insertPivotTable" | "changePivotTable" => Edit::Pivot(pivot::read(edit)?),
        "formatCells" | "setBorders" | "mergeCells" | "unmergeCells" => Edit::Formats(formats::read(edit)?),
        "writeFromInteractive" | "resetInteractive" | "saveDefaultsOfInteractive" => Edit::Interactive(interactive::read(edit)?),
        "saveNamedView" | "removeNamedView" => Edit::NamedViews(named_views::read(edit)?),
        "setColumnWidths" | "setRowHeights" | "fitColumns" | "setSheetSettings" | "insertRows" | "insertColumns"
        | "deleteRows" | "deleteColumns" | "moveRows" | "moveColumns" | "hideRows" | "hideColumns" | "groupRows"
        | "groupColumns" | "ungroupRows" | "ungroupColumns" | "setRowGroupsCollapsed" | "setColumnGroupsCollapsed"
        | "showRowGroupsToDepth" | "showColumnGroupsToDepth" => Edit::Lines(lines::read(edit)?),
        "sortRows" | "sortCells" | "moveColumnsOfCells" | "declareCellTable" | "changeCellTable" | "removeCellTable"
        | "importTableAsNewSheet" | "importTableIntoSheet" | "duplicateSheet" => Edit::Tables(tables::read(edit)?),
        "addConditionalFormats" | "changeConditionalFormat" | "moveConditionalFormat" | "removeConditionalFormat"
        | "makeDropdown" | "addDropdownOption" | "setDropdownOptions" | "movePlacedView" | "resizePlacedView"
        | "deletePlacedView" | "copyPlacedView" | "addPlacedView" | "replaceWidgetNodeOfPlacedView"
        | "adoptTimeZone" => Edit::Objects(objects::read(edit)?),
        _ => return None,
    })
}

/// Whether the edit works the formulas out before anything else (sorts do, to sort by what they come to).
pub fn calculates_first(edit: &Edit) -> bool {
    matches!(edit, Edit::Pivot(_)) || matches!(edit, Edit::Tables(edit) if tables::calculates_first(edit))
}

/// The refusals of the edit after which the page is told everything changed.
pub fn refusals_that_redraw(edit: &Edit) -> &'static [&'static str] {
    match edit {
        Edit::Tables(edit) => tables::refusals_that_redraw(edit),
        _ => &[],
    }
}

/// An edit's operations as they are checked once applied (`typing::options_kept`): those that leave more cells
/// holding none of their dropdown's options are taken back (`cellOfDropdownHoldsNoOption`), what they touched told
/// with the next changes all the same. Typing, pasting, moving and filling cells are checked so; formatting cells is
/// not.
fn options_kept(workbook: &crate::workbook::Workbook, made: Made) -> Result<Made, Refused> {
    match crate::typing::options_kept(workbook, &made.ops) {
        true => Ok(made),
        false => Err(Refused::Tried("cellOfDropdownHoldsNoOption", made.ops)),
    }
}

/// The sheet whose rows an edit lays out in the order the person sees them, when they put them in one of their own
/// (`seen`): fills down or up, pastes, and borders.
fn in_seen_order(workbook: &crate::workbook::Workbook, edit: &Edit) -> Option<String> {
    match edit {
        Edit::Clipboard(edit) => edit.in_seen_order(workbook),
        Edit::Formats(edit) => edit.in_seen_order(),
        Edit::Cells(cells::Edit::PasteRowsOfTexts(edit)) => edit["selected"]["sheetId"].as_str(),
        _ => None,
    }
    .map(str::to_owned)
}

fn made_by_family(workbook: &crate::workbook::Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    match edit {
        Edit::Sheets(edit) => sheets::make(workbook, edit, context),
        Edit::Cells(edit) => cells::make(workbook, edit, context),
        Edit::Clipboard(edit) => clipboard::make(workbook, edit, context),
        Edit::Formats(edit) => formats::make(workbook, edit, context),
        Edit::Interactive(edit) => interactive::make(workbook, edit),
        Edit::NamedViews(edit) => named_views::make(workbook, edit, context.code),
        Edit::Lines(edit) => lines::make(workbook, edit, context),
        Edit::Tables(edit) => tables::make(workbook, edit, context),
        Edit::Pivot(edit) => pivot::make(workbook, edit, context),
        Edit::Objects(edit) => objects::make(workbook, edit, context),
    }
}

pub fn make(workbook: &crate::workbook::Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let interactive_edit = matches!(&edit, Edit::Interactive(_));
    let order = match (context.own_row_order, in_seen_order(workbook, &edit)) {
        (Some(order), Some(sheet_id)) => seen::read(workbook, order, &sheet_id)?,
        _ => None,
    };
    let mut made = match order {
        // Made on the workbook as the person sees it, its place by the rows as stored.
        Some((order, lines)) => {
            let shown = seen::shown(workbook, &order, &lines);
            let made = made_by_family(&shown, edit, &Context { seen: Some(&order), ..*context })?;
            seen::back(made, &shown, workbook, &order)
        }
        None => made_by_family(workbook, edit, context)?,
    };
    if !interactive_edit {
        interactive::check_grid_edits(workbook, &made.ops)?;
    }
    objects::adopt_time_zone(workbook, &mut made, context);
    Ok(made)
}
