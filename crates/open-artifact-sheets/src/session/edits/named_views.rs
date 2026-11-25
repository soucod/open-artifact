use serde::Deserialize;
use serde_json::Value as Json;

use super::{Made, Refused};
use crate::workbook::load::Op;
use crate::workbook::objects::{NamedView, NamedViewToSet, MOST_NAMED_VIEWS};
use crate::workbook::Workbook;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    SaveNamedView {
        sheet_id: String,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        named_view_id: Option<String>,
        named_view: NamedView,
    },
    #[serde(rename_all = "camelCase")]
    RemoveNamedView { sheet_id: String, named_view_id: String },
}

pub fn read(edit: &Json) -> Option<Edit> {
    let edit = serde_json::from_value(edit.clone()).ok()?;
    if matches!(&edit, Edit::SaveNamedView { named_view, .. } if !named_view.is_readable()) {
        return None;
    }
    Some(edit)
}

pub fn make(workbook: &Workbook, edit: Edit, code: &str) -> Result<Made, Refused> {
    let (sheet_id, named_view_id, named_view) = match edit {
        Edit::SaveNamedView {
            sheet_id,
            named_view_id,
            named_view,
        } => (sheet_id, named_view_id, Some(named_view)),
        Edit::RemoveNamedView {
            sheet_id,
            named_view_id,
        } => (sheet_id, Some(named_view_id), None),
    };
    let index = workbook
        .sheet_index(&sheet_id)
        .ok_or(Refused::Because("unknownSheet"))?;
    let sheet = &workbook.sheets[index];
    if let Some(given) = &named_view {
        // The columns it names come first, then its name, then its limits.
        workbook.named_view_columns_known(&sheet_id, given)?;
        if !given.name_is_allowed() {
            return Err(Refused::Because("nameOfNamedViewNotAllowed"));
        }
        let name = given.name.to_lowercase();
        if sheet
            .named_views
            .values()
            .any(|(id, view)| Some(id) != named_view_id.as_ref() && name == view.name.to_lowercase())
        {
            return Err(Refused::Because("nameOfNamedViewTaken"));
        }
        if named_view_id.is_none() && sheet.named_views.len() >= MOST_NAMED_VIEWS {
            return Err(Refused::Because("tooManyNamedViews"));
        }
        given.check_limits().map_err(Refused::Because)?;
        given.check_conditions().map_err(Refused::Because)?;
    }
    let named_view_id = match named_view_id {
        Some(id) => {
            let (_, before) = sheet
                .named_views
                .get(id.as_str())
                .ok_or(Refused::Because("unknownNamedView"))?;
            if named_view.as_ref() == Some(before) {
                return Ok(Made::nothing());
            }
            id
        }
        None => format!("nvw_{code}.0"),
    };
    Ok(Made::ops(vec![Op::SetNamedViews {
        sheet_id,
        named_views: vec![NamedViewToSet {
            named_view_id,
            named_view,
        }],
    }]))
}
