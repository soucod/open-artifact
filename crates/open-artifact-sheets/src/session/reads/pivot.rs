//! The formula behind a pivot table, its source table, and the offered values of a filter column.

use std::ops::RangeInclusive;

use hashbrown::{HashMap, HashSet};
use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::calculate::SpillOutcome;
use crate::formula::pivot::{source_column, Formula, Keeps, Key, Order, Source, Spec, WrittenValue};
use crate::value::Value;
use crate::workbook::layout::CellIds;
use crate::workbook::{Cell, Input, Sheet, Workbook};

use super::tables::{self, values::SheetValues};

pub(super) const KINDS: &[&str] = &["readPivotTableAt", "readValuesToFilterPivotTableBy"];

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    #[serde(rename_all = "camelCase")]
    ReadPivotTableAt { sheet_id: String, cell: CellIds },
    ReadValuesToFilterPivotTableBy {
        source: Source,
        c: String,
        keeps: Keeps,
        listed: Vec<Option<WrittenValue>>,
    },
}

pub(super) fn answer(workbook: &Workbook, request: &Json) -> String {
    let request = match serde_json::from_value(request.clone()) {
        Ok(request) => request,
        Err(_) => return super::unreadable(),
    };
    let result = match request {
        Request::ReadPivotTableAt { sheet_id, cell } => at(workbook, &sheet_id, &cell),
        Request::ReadValuesToFilterPivotTableBy {
            source,
            c,
            keeps,
            listed,
        } => values(workbook, &source, &c, keeps, &listed),
    };
    result
        .unwrap_or_else(|refusal| json!({"kind": "refused", "refusal": refusal}))
        .to_string()
}

pub(crate) fn source_tables(workbook: &Workbook, source: &Source) -> Vec<Json> {
    let Some(index) = workbook.sheet_index(&source.sheet_id) else {
        return Vec::new();
    };
    tables::guess::tables_of_sheet(workbook, &workbook.sheets[index])
        .into_iter()
        .filter(|t| t["headerRows"]["lastRow"] == source.header_row)
        .collect()
}

pub(crate) fn table_has_column(table: &Json, column: &str) -> bool {
    table["columns"]
        .as_array()
        .is_some_and(|columns| columns.iter().any(|c| c["c"] == column))
}

pub(crate) fn matching_table<'a>(tables: &'a [Json], spec: &Spec) -> Option<&'a Json> {
    tables.iter().find(|table| table_has_column(table, &spec.values[0].column))
}

pub(crate) fn reads_just_records(formula: &Formula, stored: &crate::formula::StoredFormula, table: &Json) -> bool {
    let last_record = table["body"]
        .as_array()
        .into_iter()
        .flatten()
        .rev()
        .find(|run| run["role"] == "record")
        .and_then(|run| run["lastRow"].as_str());
    formula
        .columns_used()
        .all(|index| source_column(&stored.references[index]).is_some_and(|(_, _, end)| end.is_none() || end == last_record))
}

fn pivot_cell(workbook: &Workbook, sheet: &Sheet, row: usize, column: usize) -> Option<(usize, usize)> {
    if sheet
        .cells
        .contains_key(&(sheet.rows.line(row)?, sheet.columns.line(column)?))
    {
        return Some((row, column));
    }
    sheet.cells.keys().find_map(|&(r, c)| {
        let (top, left) = (sheet.rows.position(r)?, sheet.columns.position(c)?);
        if top > row || left > column {
            return None;
        }
        match &workbook.outcome(&sheet.id, r, c)?.spill {
            Some(SpillOutcome::Fills { to: (bottom, right), .. }) if row <= *bottom && column <= *right => Some((top, left)),
            _ => None,
        }
    })
}

pub(crate) fn formula_in(cell: &Cell) -> Option<(&crate::formula::StoredFormula, Result<Formula, crate::value::CellError>)> {
    let Input::Formula { formula } = &cell.input else {
        return None;
    };
    let expr = cell.parsed.as_deref()?.as_ref().ok()?;
    Some((formula, Formula::from_expr(expr)?))
}

fn at(workbook: &Workbook, sheet_id: &str, cell: &CellIds) -> Result<Json, &'static str> {
    let sheet = tables::sheet(workbook, sheet_id)?;
    let (row, column) = tables::cell_at(workbook, sheet, cell)?;
    let read = pivot_cell(workbook, sheet, row, column).and_then(|(r, c)| {
        let (r, c) = (sheet.rows.line(r)?, sheet.columns.line(c)?);
        let (stored, parsed) = formula_in(sheet.cells.get(&(r, c))?)?;
        let spec = parsed
            .as_ref()
            .ok()
            .and_then(|formula| formula.specification(&stored.references));
        let sources = spec.as_ref().map(|s| source_tables(workbook, &s.source));
        let table = spec
            .as_ref()
            .zip(sources.as_deref())
            .and_then(|(spec, candidates)| matching_table(candidates, spec));
        let reads_just_records = table
            .zip(parsed.as_ref().ok())
            .is_some_and(|(t, f)| reads_just_records(f, stored, t));
        Some(json!({
            "cell": {"r": workbook.bases.text(r), "c": workbook.bases.text(c)},
            "pivotTable": spec,
            "table": table,
            "readsJustTheRecords": reads_just_records,
        }))
    });
    Ok(json!({"kind": "pivotTableAt", "read": read}))
}

pub(crate) fn record_runs(workbook: &Workbook, sheet: &Sheet, table: &Json) -> Option<Vec<RangeInclusive<usize>>> {
    let row = |id: &Json| sheet.rows.position(workbook.bases.parse(id.as_str()?)?);
    table["body"]
        .as_array()?
        .iter()
        .filter(|run| run["role"] == "record")
        .map(|run| Some(row(&run["firstRow"])?..=row(&run["lastRow"])?))
        .collect()
}

fn values(
    workbook: &Workbook,
    source: &Source,
    column: &str,
    keeps: Keeps,
    listed: &[Option<WrittenValue>],
) -> Result<Json, &'static str> {
    let tables = source_tables(workbook, source);
    let table = tables
        .iter()
        .find(|t| table_has_column(t, column))
        .ok_or("pivotTableSourceHasNoHeader")?;
    let sheet = tables::sheet(workbook, &source.sheet_id)?;
    let column = workbook
        .bases
        .parse(column)
        .and_then(|c| sheet.columns.position(c))
        .ok_or("unknownColumn")?;
    let records = record_runs(workbook, sheet, table).ok_or("pivotTableSourceHasNoRecords")?;
    let data = SheetValues::of(workbook, sheet);
    let mut indices = HashMap::new();
    let mut values = Vec::new();
    for row in records.into_iter().flatten() {
        let value = data.get(row, column);
        let key = Key::of(value);
        let i = *indices.entry(key.clone()).or_insert_with(|| {
            values.push((key, value.clone(), row, 0));
            values.len() - 1
        });
        values[i].3 += 1;
    }
    values.sort_by(|a, b| a.0.cmp(&b.0, Order::Ascending));
    let keys: HashSet<_> = listed
        .iter()
        .map(|v| Key::of(&v.as_ref().map_or(Value::Blank, WrittenValue::value)))
        .collect();
    const MOST_VALUES: usize = 10_000;
    let are_more_left_out = values.len() > MOST_VALUES;
    let values: Vec<_> = values
        .into_iter()
        .take(MOST_VALUES)
        .map(|(key, value, row, records)| {
            json!({
                "value": WrittenValue::from_value(&value),
                "firstInRow": sheet.rows.line(row).map(|row| workbook.bases.text(row)),
                "records": records,
                "meetsTheLinesOfItsColumn": keys.is_empty() || keys.contains(&key) == (keeps == Keeps::OneOf),
            })
        })
        .collect();
    Ok(json!({"kind": "valuesOfFilteredColumn", "values": values, "areMoreLeftOut": are_more_left_out}))
}
