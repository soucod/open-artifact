//! Cell grids share formulas within a block. Relative formula references are offsets from the cell's id
//! numbers, even when the referenced rows or columns moved or were deleted.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use super::axes::{expand_ids, grouped_ids, Ids};
use crate::ids::{Bases, LineId};
use crate::workbook::grid::formulas::{Formula, Formulas};
use crate::workbook::{Cell, Input, Sheet};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Grid {
    rows: Vec<Ids>,
    columns: Vec<Ids>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    formulas: Vec<Formula>,
    inputs: Vec<Vec<Json>>,
}

type At<'a> = ((&'a str, u32), (&'a str, u32));

impl Grid {
    fn write(cells: &[(At<'_>, &Input)]) -> Self {
        let mut rows: Vec<_> = cells.iter().map(|(at, _)| at.0).collect();
        rows.dedup();
        let mut columns: Vec<_> = cells.iter().map(|(at, _)| at.1).collect();
        columns.sort_unstable();
        columns.dedup();
        let mut formulas = Formulas::default();
        let mut inputs = vec![vec![Json::Array(Vec::new()); columns.len()]; rows.len()];
        for &((row, column), cell) in cells {
            let input = match cell {
                Input::Formula { formula } => {
                    if let Some(index) = formulas.index(formula, row, column) {
                        json!({"f": index})
                    } else {
                        // Legacy references may use ids without a number; keep their full spelling.
                        json!(cell)
                    }
                }
                Input::Number { value } => json!(value),
                Input::Text { value } => json!(value),
                Input::Boolean { value } => json!(value),
                other => json!(other),
            };
            inputs[rows.binary_search(&row).unwrap()][columns.binary_search(&column).unwrap()] =
                input;
        }
        Self {
            rows: grouped_ids(&rows),
            columns: grouped_ids(&columns),
            formulas: formulas.entries,
            inputs,
        }
    }

    pub(super) fn read(self, sheet: &mut Sheet, bases: &Bases) -> Option<()> {
        let rows = expand_ids(&self.rows)?;
        let columns = expand_ids(&self.columns)?;
        if rows.len() != self.inputs.len() || rows.is_empty() || columns.is_empty() {
            return None;
        }
        for (row, inputs) in rows.into_iter().zip(self.inputs) {
            if inputs.len() != columns.len() {
                return None;
            }
            let r = LineId {
                base: bases.find(row.0)?,
                n: row.1,
            };
            for (&column, input) in columns.iter().zip(inputs) {
                let input = match input {
                    Json::Array(list) if list.is_empty() => continue,
                    Json::Number(value) => Input::Number {
                        value: value.as_f64()?,
                    },
                    Json::String(value) => Input::Text { value },
                    Json::Bool(value) => Input::Boolean { value },
                    Json::Object(ref object) if object.len() == 1 && object.contains_key("f") => {
                        let formula = self
                            .formulas
                            .get(usize::try_from(object["f"].as_u64()?).ok()?)?;
                        Input::Formula {
                            formula: formula.read(row, column)?,
                        }
                    }
                    input => serde_json::from_value(input).ok()?,
                };
                let c = LineId {
                    base: bases.find(column.0)?,
                    n: column.1,
                };
                if !sheet.rows.contains(r)
                    || !sheet.columns.contains(c)
                    || sheet.cells.insert((r, c), Cell::new(input)).is_some()
                {
                    return None;
                }
            }
        }
        Some(())
    }
}

pub(super) fn written(sheet: &Sheet, bases: &Bases) -> Vec<Grid> {
    let mut cells: Vec<_> = sheet
        .cells
        .iter()
        .filter(|((r, c), _)| sheet.rows.contains(*r) && sheet.columns.contains(*c))
        .map(|((r, c), cell)| {
            (
                ((bases.name(r.base), r.n), (bases.name(c.base), c.n)),
                &cell.input,
            )
        })
        .collect();
    cells.sort_unstable_by_key(|&(at, _)| at);
    // Split sparse sheets before the rectangular grid would use much more space than its inputs.
    let mut grids = Vec::new();
    let mut start = 0;
    let mut rows = 0usize;
    let mut previous_row = None;
    let mut columns = hashbrown::HashSet::new();
    for (index, &((row, column), _)) in cells.iter().enumerate() {
        if previous_row != Some(row) {
            rows += 1;
            previous_row = Some(row);
        }
        columns.insert(column);
        if rows * columns.len() > 16_384 {
            grids.push(Grid::write(&cells[start..index]));
            start = index;
            rows = 1;
            columns.clear();
            columns.insert(column);
        }
    }
    if start < cells.len() {
        grids.push(Grid::write(&cells[start..]));
    }
    grids
}
