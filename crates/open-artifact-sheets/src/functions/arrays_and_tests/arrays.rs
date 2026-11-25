//! ARRAYFORMULA, ARRAY_CONSTRAIN, CHOOSECOLS, CHOOSEROWS, DROP, FLATTEN, SORTBY, TAKE, TOCOL and TOROW: arrays
//! picked from the cells of their first argument, each value bringing what its cell brings.

use std::cmp::Ordering;

use super::{not_given, whole_or_none};
use crate::coerce::{compare_numbers, compare_texts, to_number};
use crate::evaluate::Operand;
use crate::functions::{array, value, Answer, Arg, CallContext, Cells, Sources};
use crate::locale::Locale;
use crate::value::{Array, CellError, Value};

/// An argument's cells; a left-out one is #VALUE!.
fn cells_of(arg: &Arg) -> Result<Cells, CellError> {
    match arg {
        Arg::Missing | Arg::Place(_) => Err(CellError::Value),
        arg => Ok(arg.cells()),
    }
}

/// An array picked from the cells of the arguments, row by row, and where each value came from (see
/// `CallContext::sources`).
#[derive(Default)]
struct Picked {
    values: Vec<Value>,
    from: Sources,
}

impl Picked {
    /// Takes the value of the cell (row, column) of argument `k`.
    fn take(&mut self, cells: &Cells, k: usize, row: usize, column: usize) {
        self.values.push(cells.get(row, column).clone());
        self.from.push(Some((k, row, column)));
    }

    fn answer(self, rows: usize, columns: usize, cx: &mut CallContext) -> Answer {
        cx.sources = Some(self.from);
        array(Array::new(rows, columns, self.values))
    }
}

/// The rows `rows` and columns `columns` of the first argument's cells.
fn block(cells: &Cells, rows: &[usize], columns: &[usize], cx: &mut CallContext) -> Answer {
    let mut picked = Picked::default();
    for &r in rows {
        for &c in columns {
            picked.take(cells, 0, r, c);
        }
    }
    picked.answer(rows.len(), columns.len(), cx)
}

/// ARRAYFORMULA(formula): what the formula gives (bringing what it brings), a range of more than one cell as an
/// array.
pub fn array_formula(args: &[Arg], cx: &mut CallContext) -> Answer {
    match &args[0] {
        Arg::Cells(cells) if cells.rows() == 1 && cells.columns() == 1 => match cells.part(0, 0, 1, 1) {
            Operand::Value(v) => {
                cx.sources = Some(vec![Some((0, 0, 0))]);
                value(v)
            }
            operand => Ok(operand),
        },
        Arg::Cells(cells) => {
            let (rows, columns) = (cells.rows(), cells.columns());
            block(cells, &(0..rows).collect::<Vec<_>>(), &(0..columns).collect::<Vec<_>>(), cx)
        }
        arg => {
            cx.sources = Some(vec![Some((0, 0, 0))]);
            value(arg.value()?)
        }
    }
}

/// ARRAY_CONSTRAIN(range, rows, columns): the first rows and columns of a range; fewer than 1 is #NUM!.
pub fn array_constrain(args: &[Arg], cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let count = |arg: &Arg| -> Result<usize, CellError> {
        let n = arg.number(locale)?.trunc();
        if n < 1.0 {
            return Err(CellError::Number);
        }
        Ok(n.min(usize::MAX as f64) as usize)
    };
    let rows = count(&args[1])?.min(cells.rows());
    let columns = count(&args[2])?.min(cells.columns());
    block(&cells, &(0..rows).collect::<Vec<_>>(), &(0..columns).collect::<Vec<_>>(), cx)
}

/// TAKE(range, rows, [columns]) and DROP(range, rows, [columns]): the first (last, for a negative count) rows and
/// columns of a range, or the range without them. Counts are cut toward zero; leaving nothing (taking 0) is #N/A.
pub fn take_or_drop(args: &[Arg], take: bool, cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let (rows, columns) = (whole_or_none(args.get(1), locale)?, whole_or_none(args.get(2), locale)?);
    let rows = kept(rows, cells.rows(), take)?;
    let columns = kept(columns, cells.columns(), take)?;
    block(&cells, &rows, &columns, cx)
}

/// The rows (columns) of `size` that TAKE (`take`) or DROP keep for a count; none is #N/A.
fn kept(count: Option<f64>, size: usize, take: bool) -> Result<Vec<usize>, CellError> {
    let all = (0..size).collect::<Vec<_>>();
    let Some(n) = count else { return Ok(all) };
    let k = n.abs().min(size as f64) as usize;
    let range = match (take, n >= 0.0) {
        (true, true) => 0..k,
        (true, false) => size - k..size,
        (false, true) => k..size,
        (false, false) => 0..size - k,
    };
    if range.is_empty() {
        return Err(CellError::NotAvailable);
    }
    Ok(range.collect())
}

/// CHOOSECOLS(range, column, …) and CHOOSEROWS(range, row, …): the columns (rows) numbered, counted from 1 (from
/// the end when negative), in the order given. Each argument may be a range or an array of numbers.
pub fn choose(args: &[Arg], rows: bool, cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let size = if rows { cells.rows() } else { cells.columns() };
    let mut numbers = Vec::new();
    for arg in &args[1..] {
        for v in cells_of(arg)?.values() {
            numbers.push(to_number(v, locale)?.trunc());
        }
    }
    let mut picked = Vec::with_capacity(numbers.len());
    for n in numbers {
        if n == 0.0 || n.abs() > size as f64 {
            return Err(CellError::Value);
        }
        picked.push(if n > 0.0 { n as usize - 1 } else { size - n.abs() as usize });
    }
    if rows {
        block(&cells, &picked, &(0..cells.columns()).collect::<Vec<_>>(), cx)
    } else {
        block(&cells, &(0..cells.rows()).collect::<Vec<_>>(), &picked, cx)
    }
}

/// FLATTEN(range, …): every value of every argument, row by row, in one column.
pub fn flatten(args: &[Arg], cx: &mut CallContext) -> Answer {
    let mut picked = Picked::default();
    for (k, arg) in args.iter().enumerate() {
        let cells = cells_of(arg)?;
        for r in 0..cells.rows() {
            for c in 0..cells.columns() {
                picked.take(&cells, k, r, c);
            }
        }
    }
    let rows = picked.values.len();
    picked.answer(rows, 1, cx)
}

/// TOCOL(range, [skip], [by column]) and TOROW: the values of a range in one column (row), row by row or column by
/// column. Skip 1 passes over blank cells, 2 errors, 3 both; leaving nothing is #N/A.
pub fn to_line(args: &[Arg], column: bool, cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let skip = whole_or_none(args.get(1), locale)?.unwrap_or(0.0);
    if !(0.0..=3.0).contains(&skip) {
        return Err(CellError::Value);
    }
    let skip = skip as u8;
    let by_column = if not_given(args.get(2)) { false } else { args[2].boolean()? };
    let mut places = Vec::new();
    if by_column {
        for c in 0..cells.columns() {
            places.extend((0..cells.rows()).map(|r| (r, c)));
        }
    } else {
        for r in 0..cells.rows() {
            places.extend((0..cells.columns()).map(|c| (r, c)));
        }
    }
    let mut picked = Picked::default();
    for (r, c) in places {
        let passed_over = match cells.get(r, c) {
            Value::Blank => skip & 1 != 0,
            Value::Error(_) => skip & 2 != 0,
            _ => false,
        };
        if !passed_over {
            picked.take(&cells, 0, r, c);
        }
    }
    let n = picked.values.len();
    if n == 0 {
        return Err(CellError::NotAvailable);
    }
    if column {
        picked.answer(n, 1, cx)
    } else {
        picked.answer(1, n, cx)
    }
}

/// The order of kinds when sorting: numbers, text, booleans; then errors and then empty cells (blank or `""`),
/// last whichever way the sort goes.
fn sort_rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(t) if !t.is_empty() => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) => 3,
        Value::Blank | Value::Text(_) => 4,
    }
}

/// How two values sort, `descending` or not. Errors are all alike, and so are empty cells.
fn sort_order(a: &Value, b: &Value, descending: bool) -> Ordering {
    let (x, y) = (sort_rank(a), sort_rank(b));
    if x >= 3 || y >= 3 {
        return x.cmp(&y);
    }
    let o = match (a, b) {
        _ if x != y => x.cmp(&y),
        (Value::Number(p), Value::Number(q)) => compare_numbers(*p, *q),
        (Value::Text(p), Value::Text(q)) => compare_texts(p, q),
        (Value::Boolean(p), Value::Boolean(q)) => p.cmp(q),
        _ => Ordering::Equal,
    };
    if descending {
        o.reverse()
    } else {
        o
    }
}

/// A sort order: 1 (or TRUE; the default, also when left out or blank) ascending, 0 (FALSE) or -1 descending;
/// else #VALUE!.
fn descending(arg: Option<&Arg>, locale: &Locale) -> Result<bool, CellError> {
    if not_given(arg) {
        return Ok(false);
    }
    let n = arg.map_or(Ok(1.0), |a| a.number(locale))?;
    if n == 1.0 {
        Ok(false)
    } else if n == 0.0 || n == -1.0 {
        Ok(true)
    } else {
        Err(CellError::Value)
    }
}

/// SORTBY(range, sort range, [order], …): the rows of a range sorted by up to three columns as high as it (or its
/// columns, by rows as wide as it), each ascending or descending; equal rows keep their order. Sort ranges of
/// another size, or some by rows and some by columns, are #VALUE!.
pub fn sort_by(args: &[Arg], cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let (rows, columns) = (cells.rows(), cells.columns());
    let mut keys: Vec<(Cells, bool)> = Vec::new();
    let mut by_rows = None;
    for i in (1..args.len()).step_by(2) {
        let key = cells_of(&args[i])?;
        let these_rows = if key.columns() == 1 && key.rows() == rows {
            true
        } else if key.rows() == 1 && key.columns() == columns {
            false
        } else {
            return Err(CellError::Value);
        };
        if by_rows.is_some_and(|b| b != these_rows) {
            return Err(CellError::Value);
        }
        by_rows = Some(these_rows);
        keys.push((key, descending(args.get(i + 1), locale)?));
    }
    let by_rows = by_rows.unwrap_or(true);
    let count = if by_rows { rows } else { columns };
    let mut order: Vec<usize> = (0..count).collect();
    order.sort_by(|&p, &q| {
        for (key, descending) in &keys {
            let o = sort_order(key.array.get_flat(p), key.array.get_flat(q), *descending);
            if o != Ordering::Equal {
                return o;
            }
        }
        Ordering::Equal
    });
    if by_rows {
        block(&cells, &order, &(0..columns).collect::<Vec<_>>(), cx)
    } else {
        block(&cells, &(0..rows).collect::<Vec<_>>(), &order, cx)
    }
}
