//! Working out the groups and summaries of PIVOT's records.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::rc::Rc;

use hashbrown::{HashMap, HashSet};

use crate::brought::Brought;
use crate::calculate::{Calculation, SpillFormats};
use crate::coerce;
use crate::dates::{date_from_serial, serial_from_date};
use crate::formula::pivot::{count_is_wrong, Axis, Criterion, Formula, Keeps, Key, Measure, Order, Period, Total};
use crate::formula::Expr;
use crate::value::{Array, CellError, Value};

use super::{Operand, Place};

const MOST_PIVOT_VALUES: usize = 200_000;

impl Calculation {
    pub(super) fn pivot(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        if count_is_wrong(arguments.len()) {
            return Operand::error(CellError::NotAvailable);
        }
        let (arguments, worked) = match self.pivot_read(f, arguments) {
            Ok(read) => read,
            Err(error) => return Operand::error(error),
        };
        self.pivot_table(
            f,
            &match Formula::read(&arguments) {
                Ok(formula) => formula,
                Err(error) => return Operand::error(error),
            },
            &worked,
        )
        .unwrap_or_else(Operand::error)
    }

    /// The arguments as PIVOT reads them: a use or a value worked out (a reference in a use's place
    /// as its cell's value, an array of one value as that value), the first error one comes to answered; references
    /// in a field's place as they are; each worked out as an argument that takes several cells. In a field's place (one that is not an option's value) a range or an array
    /// written or worked out is a field of its own, read as a reference past the formula's own: `IF(1,A1:A6)` as the
    /// range, `A1:A6&""` or `{"N";"a";"b"}` as a column of values.
    pub(crate) fn pivot_read(&mut self, f: usize, arguments: &[Expr]) -> Result<(Vec<Expr>, Vec<Field>), CellError> {
        let own = self.formulas[f].places.len();
        let mut read = Vec::with_capacity(arguments.len());
        let mut worked = Vec::new();
        let field = |worked: &mut Vec<Field>, field: Field| {
            worked.push(field);
            Expr::Reference(own + worked.len() - 1)
        };
        for (i, argument) in arguments.iter().enumerate() {
            let in_a_field = i % 2 == 0 && !is_an_option_value(i, arguments);
            if let Expr::Array(array) = argument {
                read.push(match (array.rows(), array.columns()) {
                    (1, 1) => scalar_expr(array.get(0, 0)),
                    _ if in_a_field => field(&mut worked, Field::Worked(Rc::new((**array).clone()), None)),
                    _ => argument.clone(),
                });
                continue;
            }
            if !pivot_works_out(i, argument, arguments) {
                read.push(argument.clone());
                continue;
            }
            // Worked out as an argument that takes several cells (`IF(A1:A6="",0,A1:A6)` cell by cell).
            let lifting = std::mem::replace(&mut self.lifting, true);
            let operand = self.eval(f, argument);
            self.lifting = lifting;
            let value = match operand {
                Operand::Value(value) => value,
                Operand::Range(place) if in_a_field => {
                    read.push(field(&mut worked, Field::Range(place)));
                    continue;
                }
                Operand::Array(array) | Operand::Values(array) if in_a_field => {
                    let brought = self.brought.take();
                    read.push(field(&mut worked, Field::Worked(array, brought)));
                    continue;
                }
                Operand::Range(place) if place.is_single() => self.range_values(place).get(0, 0).clone(),
                Operand::Array(array) | Operand::Values(array) if array.is_single() => array.get(0, 0).clone(),
                _ => {
                    read.push(argument.clone());
                    continue;
                }
            };
            read.push(match value {
                Value::Error(error) => return Err(error),
                Value::Blank => Expr::Missing,
                Value::Number(n) => Expr::Number(n),
                Value::Text(text) => Expr::Text(text),
                Value::Boolean(b) => Expr::Boolean(b),
            });
        }
        Ok((read, worked))
    }

    fn pivot_table(&mut self, f: usize, formula: &Formula, worked: &[Field]) -> Result<Operand, CellError> {
        let cell = &self.formulas[f];
        let places = cell.places.clone();
        let own = places.len();
        let place = |i: usize| match i.checked_sub(own) {
            None => places.get(i).copied().flatten().map(Field::Range).ok_or(CellError::Reference),
            Some(k) => Ok(worked[k].clone()),
        };
        let first = place(formula.values[0].column)?;
        let columns = formula.columns_used().map(place).collect::<Result<Vec<_>, _>>()?;
        let records = cell.pivot_records.clone();
        if columns
            .iter()
            .any(|p| p.columns() != 1 || (records.is_none() && p.rows() != first.rows()))
        {
            return Err(CellError::Value);
        }
        // Records are counted from the fields' first row (their headers).
        let top = match &first {
            Field::Range(p) => p.top,
            Field::Worked(..) => 0,
        };
        let locale = self.locale;
        let filters = formula
            .filters
            .iter()
            .map(|filter| {
                // A range lists the values of its cells that are not blank, and none is no filter;
                // an array written or worked out lists all of its values.
                let values: HashSet<Key> = match &filter.listed {
                    Criterion::Values(values) => values.iter().map(Key::of).collect(),
                    Criterion::Reference(i) => match place(*i)? {
                        Field::Range(at) => {
                            let listed: HashSet<Key> =
                                self.range_values(at).values().map(Key::of).filter(|key| *key != Key::Blank).collect();
                            if listed.is_empty() {
                                return Ok(None);
                            }
                            listed
                        }
                        Field::Worked(array, _) => array.values().map(Key::of).collect(),
                    },
                };
                Ok(Some((place(filter.column)?, filter.keeps, values)))
            })
            .collect::<Result<Vec<Option<(_, _, HashSet<_>)>>, CellError>>()?;

        let rows: Vec<std::ops::RangeInclusive<usize>> =
            match records {
                Some(records) => records.iter().map(|rows| rows.start() - top..=rows.end() - top).collect(),
                None => {
                    // A field of one row, its header alone, is #VALUE!.
                    if first.rows() <= 1 {
                        return Err(CellError::Value);
                    }
                    let mut offsets = HashSet::new();
                    let mut regions: HashMap<(usize, usize, usize), (usize, usize)> = HashMap::new();
                    for field in &columns {
                        let p = match field {
                            Field::Range(p) => *p,
                            // A row of an array worked out is a record when its value is not empty: no blank, 0,
                            // FALSE or text of spaces alone; an error is one.
                            Field::Worked(array, _) => {
                                offsets.extend((1..array.rows()).filter(|&r| !empty_in_an_array(array.get(r, 0))));
                                continue;
                            }
                        };
                        let (left, right) = regions.entry((p.sheet, p.top, p.bottom)).or_insert((p.left, p.right));
                        *left = (*left).min(p.left);
                        *right = (*right).max(p.right);
                    }
                    for ((sheet, top, bottom), (left, right)) in regions {
                        let grid = &self.grids[sheet];
                        offsets.extend(
                            grid.slots
                                .range((top + 1, 0)..=(bottom, usize::MAX))
                                .filter_map(|(&(row, column), _)| (left..=right).contains(&column).then_some(row - top)),
                        );
                        let place = Place { sheet, top: top + 1, bottom, left, right };
                        let mut spilled = HashSet::new();
                        if place.top <= place.bottom {
                            self.covered.add_rows(place, &mut spilled);
                            self.covered_before.add_rows(place, &mut spilled);
                        }
                        offsets.extend(spilled.into_iter().map(|r| r - top));
                    }
                    let mut rows: Vec<_> = offsets.into_iter().collect();
                    rows.sort_unstable();
                    rows.into_iter().map(|r| r..=r).collect()
                }
            };
        let mut all = Measures::new(&formula.values);
        let mut groups = Groups::default();
        let mut across = Groups::default();
        let mut intersections = HashMap::new();
        for row in rows.into_iter().flatten() {
            let mut keep = true;
            for (column, keeps, listed) in filters.iter().flatten() {
                let value = self.field_value(column, row);
                if listed.contains(&Key::of(&value)) != (*keeps == Keeps::OneOf) {
                    keep = false;
                    break;
                }
            }
            if !keep {
                continue;
            }
            let values = formula
                .values
                .iter()
                .map(|measure| Ok(self.field_value(&place(measure.column)?, row)))
                .collect::<Result<Vec<_>, CellError>>()?;
            all.add(&values);
            let r = if formula.rows.is_empty() {
                None
            } else {
                let labels = formula
                    .rows
                    .iter()
                    .map(|axis| {
                        let p = place(axis.column)?;
                        Ok(self.pivot_axis(&p, row, axis.by))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let r = groups.add(labels, &formula.values);
                groups.list[r].1.add(&values);
                Some(r)
            };
            if let Some(axis) = &formula.columns {
                let p = place(axis.column)?;
                let label = self.pivot_axis(&p, row, axis.by);
                let c = across.add(vec![label], &formula.values);
                across.list[c].1.add(&values);
                if let Some(r) = r {
                    intersections
                        .entry((r, c))
                        .or_insert_with(|| Measures::new(&formula.values))
                        .add(&values);
                }
            }
        }

        let width = formula.rows.len().max(1);
        // A field's header as it heads the output: its value with its looks (an error or a blank cell as no text), or
        // the name asked for it.
        let header = |calculation: &mut Calculation, index, asked: Option<&str>| -> Result<(Value, Option<Brought>), CellError> {
            if let Some(asked) = asked {
                return Ok((Value::text(asked), None));
            }
            let p = place(index)?;
            Ok(match calculation.field_value(&p, 0) {
                Value::Blank | Value::Error(_) => (Value::text(""), None),
                value => (value, calculation.field_brought(&p, 0)),
            })
        };
        let mut values = Vec::new();
        let mut formats = BTreeMap::new();
        let mut store = |r, c, value, format: Option<&Brought>| {
            if !matches!(value, Value::Blank) {
                values.push(((r, c), value));
                if let Some(format) = format {
                    formats.insert((r, c), format.clone());
                }
            }
        };
        for (c, axis) in formula.rows.iter().enumerate() {
            let (value, brought) = header(self, axis.column, axis.name.as_deref())?;
            store(0, c, value, brought.as_ref());
        }
        if formula.rows.is_empty() {
            // With no rows, the columns' header heads the first column.
            let (value, brought) = match &formula.columns {
                Some(axis) => header(self, axis.column, axis.name.as_deref())?,
                None => (Value::text(""), None),
            };
            store(0, 0, value, brought.as_ref());
        }
        store(1, 0, Value::text("Total"), None);
        let metric_formats = formula
            .values
            .iter()
            .map(|m| {
                Ok(match m.total {
                    Total::ShareOfTotal => Brought::of_pattern("0.0%"),
                    Total::Count | Total::DistinctCount => None,
                    // The looks the records bring, not the header's; a sum's as a sum brings them (of dates no date, of
                    // times a duration).
                    total => {
                        let brought = match place(m.column)? {
                            Field::Range(p) => (p.bottom > p.top).then(|| self.range_brought(Place { top: p.top + 1, ..p })).flatten(),
                            Field::Worked(_, brought) => brought,
                        };
                        if total == Total::Sum { crate::brought::summed(brought) } else { brought }
                    }
                })
            })
            .collect::<Result<Vec<_>, CellError>>()?;
        for (i, measure) in formula.values.iter().enumerate() {
            let label = match &measure.name {
                Some(name) => name.clone(),
                None => {
                    let p = place(measure.column)?;
                    match self.field_value(&p, 0) {
                        // Of no header, the total alone.
                        Value::Blank | Value::Error(_) => match measure.total {
                            Total::ShareOfTotal => "% of total".to_owned(),
                            total => total.label().trim_end_matches(" of").to_owned(),
                        },
                        value => format!("{} {}", measure.total.label(), coerce::to_text(&value, locale)?),
                    }
                }
            };
            store(0, width + i, Value::text(label), None);
            store(1, width + i, all.at(i, &all), metric_formats[i].as_ref());
        }
        let across_order = formula
            .columns
            .as_ref()
            .map_or_else(Vec::new, |axis| across.sorted(std::slice::from_ref(axis), &[], &all));
        let mut columns_at = vec![0; across_order.len()];
        for (index, &c) in across_order.iter().enumerate() {
            let (labels, totals_for_column) = &across.list[c];
            let column = width + formula.values.len() + index;
            columns_at[c] = column;
            store(0, column, shown(&labels[0].0), labels[0].1.as_ref());
            store(1, column, totals_for_column.at(0, &all), metric_formats[0].as_ref());
        }
        let mut rows_at = vec![0; groups.list.len()];
        for (index, r) in groups.sorted(&formula.rows, &formula.values, &all).into_iter().enumerate() {
            let (labels, totals) = &groups.list[r];
            let row = index + 2;
            rows_at[r] = row;
            for (c, (label, format)) in labels.iter().enumerate() {
                store(row, c, shown(label), format.as_ref());
            }
            for (i, format) in metric_formats.iter().enumerate() {
                store(row, width + i, totals.at(i, &all), format.as_ref());
            }
        }
        for ((r, c), measures) in intersections {
            store(rows_at[r], columns_at[c], measures.at(0, &all), metric_formats[0].as_ref());
        }
        if values.len() >= MOST_PIVOT_VALUES {
            return Err(CellError::Number);
        }
        let columns = width + formula.values.len() + columns_at.len();
        let array = Rc::new(Array::sparse(2 + rows_at.len(), columns, values));
        // The first cell's looks are what the formula's own cell shows (a header of dates).
        self.brought = formats.get(&(0, 0)).cloned();
        self.array_formats.insert(Rc::as_ptr(&array), (array.clone(), SpillFormats::Sparse(Rc::new(formats))));
        Ok(Operand::Array(array))
    }

    /// A field's value in a row, counted from its header.
    fn field_value(&mut self, field: &Field, row: usize) -> Value {
        match field {
            Field::Range(p) => self.cell_value(p.sheet, p.top + row, p.left),
            Field::Worked(array, _) => array.get(row, 0).clone(),
        }
    }

    /// The looks of a field's value in a row: a cell's, or what the array worked out brings.
    fn field_brought(&mut self, field: &Field, row: usize) -> Option<Brought> {
        match field {
            Field::Range(p) => self.cell_brought(p.sheet, p.top + row, p.left),
            Field::Worked(_, brought) => brought.clone(),
        }
    }

    fn pivot_axis(&mut self, field: &Field, row: usize, period: Option<Period>) -> Label {
        let value = self.field_value(field, row);
        let brought = self.field_brought(field, row);
        let Some(period) = period else { return (value, brought) };
        // What is not a number groups by itself, as with no period.
        let Value::Number(number) = value else {
            return (value, brought);
        };
        // A number too far from any day groups as #NUM!.
        if !(-1_000_000.0..=4_000_000.0).contains(&number) {
            return (Value::Error(CellError::Number), None);
        }
        let (year, month, _) = date_from_serial(number.floor() as i64);
        match period {
            Period::Day => (Value::number(number.floor()), Brought::of_pattern("m/d/yyyy")),
            Period::Month => (
                Value::number(serial_from_date(year, month, 1) as f64),
                Brought::of_pattern("mmm yyyy"),
            ),
            Period::Quarter => (Value::text(format!("{year} Q{}", (month - 1) / 3 + 1)), None),
            Period::Year => (Value::number(year as f64), None),
        }
    }
}

type Label = (Value, Option<Brought>);

/// A field PIVOT reads: a column of cells, or a column of values written or worked out, with what they bring.
#[derive(Clone)]
pub(crate) enum Field {
    Range(Place),
    Worked(Rc<Array>, Option<Brought>),
}

impl Field {
    pub(crate) fn rows(&self) -> usize {
        match self {
            Field::Range(p) => p.rows(),
            Field::Worked(array, _) => array.rows(),
        }
    }

    pub(crate) fn columns(&self) -> usize {
        match self {
            Field::Range(p) => p.columns(),
            Field::Worked(array, _) => array.columns(),
        }
    }
}

fn empty_in_an_array(value: &Value) -> bool {
    match value {
        Value::Blank | Value::Boolean(false) => true,
        Value::Number(n) => *n == 0.0,
        Value::Text(text) => text.trim().is_empty(),
        _ => false,
    }
}

/// A value written in an array of one as the argument it is.
fn scalar_expr(value: &Value) -> Expr {
    match value {
        Value::Blank => Expr::Missing,
        Value::Number(n) => Expr::Number(*n),
        Value::Text(text) => Expr::Text(text.clone()),
        Value::Boolean(b) => Expr::Boolean(*b),
        Value::Error(error) => Expr::Error(*error),
    }
}

/// Whether an argument is an option's value (`by`, `order` or `named` before it).
fn is_an_option_value(i: usize, arguments: &[Expr]) -> bool {
    i > 0
        && matches!(&arguments[i - 1], Expr::Text(word)
            if ["by", "order", "named"].iter().any(|option| word.eq_ignore_ascii_case(option)))
}

fn shown(value: &Value) -> Value {
    if matches!(value, Value::Blank) || matches!(value, Value::Text(text) if text.trim().is_empty()) {
        Value::text("(blank)")
    } else {
        value.clone()
    }
}

fn compare(a: &Value, b: &Value, order: Order) -> Ordering {
    Key::of(a).cmp(&Key::of(b), order)
}

#[derive(Default)]
struct Groups {
    by_key: HashMap<Vec<Key>, usize>,
    list: Vec<(Vec<Label>, Measures)>,
}

impl Groups {
    fn add(&mut self, labels: Vec<Label>, measures: &[Measure<usize>]) -> usize {
        let key = labels.iter().map(|(v, _)| Key::of(v)).collect();
        *self.by_key.entry(key).or_insert_with(|| {
            self.list.push((labels, Measures::new(measures)));
            self.list.len() - 1
        })
    }

    fn sorted(&self, axes: &[Axis<usize>], measures: &[Measure<usize>], all: &Measures) -> Vec<usize> {
        let mut rows: Vec<_> = (0..self.list.len()).collect();
        rows.sort_by(|&a, &b| {
            let (one, x) = &self.list[a];
            let (other, y) = &self.list[b];
            measures
                .iter()
                .enumerate()
                .filter_map(|(i, measure)| measure.order.map(|order| compare(&x.at(i, all), &y.at(i, all), order)))
                .chain(
                    axes.iter()
                        .enumerate()
                        .map(|(i, axis)| compare(&one[i].0, &other[i].0, axis.order)),
                )
                .find(|order| *order != Ordering::Equal)
                .unwrap_or(Ordering::Equal)
        });
        rows
    }
}

struct Measures(Vec<Aggregate>);

impl Measures {
    fn new(measures: &[Measure<usize>]) -> Self {
        Self(measures.iter().map(|m| Aggregate::new(m.total)).collect())
    }

    fn add(&mut self, values: &[Value]) {
        for (measure, value) in self.0.iter_mut().zip(values) {
            measure.add(value);
        }
    }

    fn at(&self, i: usize, all: &Measures) -> Value {
        self.0[i].value(&all.0[i])
    }
}

struct Aggregate {
    total: Total,
    count: usize,
    sum: f64,
    extreme: Option<f64>,
    error: Option<CellError>,
    distinct: HashSet<Key>,
}

impl Aggregate {
    fn new(total: Total) -> Self {
        Self {
            total,
            count: 0,
            sum: 0.0,
            extreme: None,
            error: None,
            distinct: HashSet::new(),
        }
    }

    fn add(&mut self, v: &Value) {
        match self.total {
            Total::Count => self.count += usize::from(Key::of(v) != Key::Blank),
            Total::DistinctCount => {
                let key = Key::of(v);
                if key != Key::Blank {
                    self.distinct.insert(key);
                }
            }
            _ => {
                if let Value::Error(error) = v {
                    self.error.get_or_insert(*error);
                }
                if let Value::Number(number) = v {
                    self.count += 1;
                    self.sum += *number;
                    let extreme = self.extreme.unwrap_or(*number);
                    self.extreme = Some(if self.total == Total::Min {
                        extreme.min(*number)
                    } else {
                        extreme.max(*number)
                    });
                }
            }
        }
    }

    fn value(&self, all: &Aggregate) -> Value {
        let error = if self.total == Total::ShareOfTotal {
            all.error.or(self.error)
        } else {
            self.error
        };
        if let Some(error) = error {
            return Value::Error(error);
        }
        match self.total {
            Total::Sum => Value::number(self.sum),
            Total::Count => Value::number(self.count as f64),
            Total::DistinctCount => Value::number(self.distinct.len() as f64),
            Total::ShareOfTotal if all.sum == 0.0 => Value::Error(CellError::DivideByZero),
            Total::ShareOfTotal => Value::number(self.sum / all.sum),
            Total::Average if self.count == 0 => Value::Blank,
            Total::Average => Value::number(self.sum / self.count as f64),
            Total::Min | Total::Max => self.extreme.map_or(Value::Blank, Value::number),
        }
    }
}

/// Whether PIVOT works out an argument before reading it: one that is not written as it is read (a word, a number, an
/// array, one left out), nor a reference in a field's place (one after an option's word is its value).
pub(crate) fn pivot_works_out(i: usize, argument: &Expr, arguments: &[Expr]) -> bool {
    match argument {
        Expr::Missing | Expr::Text(_) | Expr::Number(_) | Expr::Boolean(_) | Expr::Array(_) => false,
        Expr::Reference(_) => {
            i % 2 == 1
                || i > 0
                    && matches!(&arguments[i - 1], Expr::Text(word)
                        if ["by", "order", "named"].iter().any(|option| word.eq_ignore_ascii_case(option)))
        }
        _ => true,
    }
}
