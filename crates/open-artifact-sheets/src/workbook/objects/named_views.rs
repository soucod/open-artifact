//! A sheet's saved filters and sorts. A view can outlive the cell table it named.

use hashbrown::HashSet;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use super::super::layout::id_key;
use super::super::load::{Lines, Op, Refusal};
use crate::session::reads::tables::filter::Filter;
use crate::workbook::Workbook;

pub(crate) const MOST_VIEWS: usize = 20;
const MOST_NAME_CHARACTERS: usize = 100;
const MOST_TESTS: usize = 20;
const MOST_KEYS: usize = 10;
const MOST_BYTES: usize = 8192;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedView {
    pub name: String,
    pub cell_table_id: String,
    #[serde(deserialize_with = "super::super::layout::written::maybe_null")]
    pub filter: Option<Json>,
    pub sort_by: Vec<SortBy>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SortBy {
    pub c: String,
    pub direction: Direction,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Ascending,
    Descending,
}

impl NamedView {
    pub(crate) fn move_columns(&mut self, mut destination: impl FnMut(&str) -> Option<String>) {
        for key in &mut self.sort_by {
            if let Some(column) = destination(&key.c) {
                key.c = column;
            }
        }
        if let Some(lines) = self.filter.as_mut().and_then(|filter| filter["allOf"].as_array_mut()) {
            for test in lines
                .iter_mut()
                .filter_map(|line| line["anyOf"].as_array_mut())
                .flatten()
            {
                if let Some(column) = test["c"].as_str().and_then(&mut destination) {
                    test["c"] = Json::String(column);
                }
                if let Some(condition) = test.get_mut("asked").and_then(|asked| asked.get_mut("condition")) {
                    for key in ["operand", "oneEnd", "otherEnd"] {
                        let Some(operand) = condition.get_mut(key) else { continue };
                        if let Some(column) = operand["c"].as_str().and_then(&mut destination) {
                            operand["c"] = Json::String(column);
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn is_readable(&self) -> bool {
        self.filter.as_ref().is_none_or(|filter| {
            serde_json::from_value::<Filter>(filter.clone()).is_ok_and(|filter| filter.is_readable())
        })
    }

    pub(crate) fn name_is_allowed(&self) -> bool {
        !self.name.is_empty()
            && self.name == self.name.trim()
            && self.name.chars().count() <= MOST_NAME_CHARACTERS
            && !self.name.chars().any(char::is_control)
    }

    /// What a named view saved by the page is held to: at most 20 tests, 10 keys to sort by, 8 KiB
    /// as written (each id two characters, numbers as decimals), no text asked for holding a control
    /// character; then the conditions' own limits.
    pub(crate) fn check_limits(&self) -> Result<(), &'static str> {
        let filter = match &self.filter {
            Some(filter) => Some(serde_json::from_value::<Filter>(filter.clone()).map_err(|_| "unreadableRequest")?),
            None => None,
        };
        if filter.as_ref().is_some_and(|filter| filter.count_of_tests() > MOST_TESTS) {
            return Err("tooManyTestsInNamedView");
        }
        if self.sort_by.len() > MOST_KEYS {
            return Err("tooManyKeysInNamedView");
        }
        if self.size_as_written() > MOST_BYTES {
            return Err("namedViewTooLarge");
        }
        if filter.as_ref().is_some_and(Filter::asks_for_a_value_not_allowed) {
            return Err("valueInNamedViewNotAllowed");
        }
        Ok(())
    }

    /// The view's size as measured for its limit: written as JSON, its ids (the cell table's, the columns') as two
    /// characters each, the numbers of its values as decimals (`1.0`).
    fn size_as_written(&self) -> usize {
        fn written(value: &mut Json, key: Option<&str>) {
            match value {
                Json::Object(fields) => {
                    for (k, v) in fields.iter_mut() {
                        written(v, Some(k));
                    }
                }
                Json::Array(values) => values.iter_mut().for_each(|v| written(v, None)),
                Json::String(text) if key == Some("c") => text.clear(),
                Json::Number(number) if key == Some("value") => {
                    if let Some(n) = number.as_f64().and_then(serde_json::Number::from_f64) {
                        *number = n;
                    }
                }
                _ => {}
            }
        }
        let mut view = serde_json::to_value(self).unwrap_or(Json::Null);
        written(&mut view, None);
        if let Some(table) = view.get_mut("cellTableId") {
            *table = Json::String(String::new());
        }
        serde_json::to_string(&view).map_or(0, |text| text.len())
    }

    pub(crate) fn check_conditions(&self) -> Result<(), &'static str> {
        if let Some(filter) = &self.filter {
            let filter = serde_json::from_value::<Filter>(filter.clone()).map_err(|_| "unreadableRequest")?;
            filter.check_conditions()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedViewToSet {
    pub named_view_id: String,
    #[serde(deserialize_with = "super::super::layout::written::maybe_null")]
    pub named_view: Option<NamedView>,
}

impl Workbook {
    /// The columns a named view names (its keys, then its filter's), each one of the sheet's.
    pub(crate) fn named_view_columns_known(&self, sheet_id: &str, view: &NamedView) -> Result<(), Refusal> {
        let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        let sheet = &self.sheets[index];
        for sort in &view.sort_by {
            self.known_line(sheet, Lines::Columns, &sort.c)?;
        }
        if let Some(filter) = &view.filter {
            let filter: Filter = serde_json::from_value(filter.clone()).map_err(|_| Refusal::UnreadableRequest)?;
            for column in filter.columns() {
                self.known_line(sheet, Lines::Columns, column)?;
            }
        }
        Ok(())
    }

    pub(super) fn apply_named_views(&mut self, sheet_id: &str, named_views: &[NamedViewToSet]) -> Result<Op, Refusal> {
        let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        let mut seen = HashSet::new();
        if !named_views
            .iter()
            .all(|entry| seen.insert(entry.named_view_id.as_str()))
        {
            return Err(Refusal::NamedViewNamedTwice);
        }
        for view in named_views.iter().filter_map(|entry| entry.named_view.as_ref()) {
            self.named_view_columns_known(sheet_id, view)?;
        }
        let sheet = &mut self.sheets[index];
        let mut reverse = Vec::with_capacity(named_views.len());
        for entry in named_views {
            let key = id_key(&entry.named_view_id);
            let before = match &entry.named_view {
                Some(view) => sheet
                    .named_views
                    .insert(key, (entry.named_view_id.clone(), view.clone())),
                None => sheet.named_views.remove(&key),
            };
            reverse.push(NamedViewToSet {
                named_view_id: entry.named_view_id.clone(),
                named_view: before.map(|(_, view)| view),
            });
        }
        Ok(Op::SetNamedViews {
            sheet_id: sheet_id.to_owned(),
            named_views: reverse,
        })
    }
}
