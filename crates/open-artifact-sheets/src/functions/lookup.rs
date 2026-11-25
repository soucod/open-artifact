//! The lookup functions: ROW, COLUMN, ROWS, COLUMNS; INDEX; MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP, LOOKUP;
//! FILTER, SORT, SORTN, UNIQUE, TRANSPOSE, HSTACK, VSTACK; HYPERLINK. (CHOOSE is worked out by the evaluator.)
//!
//! How lookups find a value:
//!
//! - A lookup value that is blank is the number 0. It is compared only with cells of its own kind (number, text,
//!   boolean): blank cells and errors are passed over. Numbers are equal to 15 significant digits, texts in any
//!   case.
//! - **Exact** (MATCH 0, VLOOKUP and HLOOKUP unsorted): the first cell equal to the value; a text value is a
//!   wildcard pattern (`*`, `?`, `~`).
//! - **Sorted** (MATCH 1 and -1, VLOOKUP and HLOOKUP sorted, LOOKUP): every cell is looked at, sorted or not: the
//!   last cell equal to the value, else the last one smaller (larger for MATCH -1).
//! - **XMATCH and XLOOKUP**: in search order (first to last, or last to first; the binary search modes are the
//!   same), the first cell equal to the value (a wildcard pattern in match mode 2), else for match mode -1 the
//!   largest smaller cell and for 1 the smallest larger one, the first of equals in search order.

use std::cmp::Ordering;
use hashbrown::HashMap;
use std::rc::Rc;

use crate::coerce::{compare_numbers, compare_texts, compared_number};
use crate::criteria::Wildcard;
use crate::evaluate::Operand;
use crate::functions::{array, number, text, value, Answer, Arg, CallContext, Cells, Sources};
use crate::locale::Locale;
use crate::value::{Array, CellError, Value};

/// Calls a lookup function by name; `None` for one it doesn't have.
pub fn call(name: &str, args: &[Arg], cx: &mut CallContext) -> Option<Answer> {
    let locale = cx.locale;
    Some(match name {
        "ROW" => place_number(args, cx.cell.top, true),
        "COLUMN" => place_number(args, cx.cell.left, false),
        "ROWS" => size(&args[0], true),
        "COLUMNS" => size(&args[0], false),
        "INDEX" => index(args, cx),
        "MATCH" => match_(args, locale),
        "XMATCH" => xmatch(args, locale),
        "XLOOKUP" => xlookup(args, locale),
        "VLOOKUP" => vlookup(args, true, cx),
        "HLOOKUP" => vlookup(args, false, cx),
        "LOOKUP" => lookup(args, cx),
        "FILTER" => filter(args, cx),
        "SORT" => sort(args, cx),
        "SORTN" => sortn(args, cx),
        "UNIQUE" => unique(args, cx),
        "TRANSPOSE" => transpose(args, cx),
        "HSTACK" => stack(args, true, cx),
        "VSTACK" => stack(args, false, cx),
        "HYPERLINK" => hyperlink(args, locale),
        _ => return None,
    })
}

/// An argument's cells; a left-out one is #VALUE!.
fn cells_of(arg: &Arg) -> Result<Cells, CellError> {
    match arg {
        Arg::Missing | Arg::Place(_) => Err(CellError::Value),
        arg => Ok(arg.cells()),
    }
}

/// An array picked from the cells of a function's arguments, row by row, and where each value came from: what each
/// brings is what its cell does (see `CallContext::sources`).
#[derive(Default)]
struct Picked {
    rows: usize,
    columns: usize,
    values: Vec<Value>,
    from: Sources,
}

impl Picked {
    /// Takes the value of the cell (row, column) of an argument.
    fn take(&mut self, v: &Value, from: (usize, usize, usize)) {
        self.values.push(v.clone());
        self.from.push(Some(from));
    }

    fn made(&mut self, v: Value) {
        self.values.push(v);
        self.from.push(None);
    }

    fn shaped(mut self, rows: usize, columns: usize) -> Picked {
        (self.rows, self.columns) = (rows, columns);
        self
    }

    fn answer(self, cx: &mut CallContext) -> Answer {
        cx.sources = Some(self.from);
        array(Array::new(self.rows, self.columns, self.values))
    }
}

/// An optional argument as a number, `default` when it is not given or left out.
fn number_or(args: &[Arg], i: usize, default: f64, locale: &Locale) -> Result<f64, CellError> {
    match args.get(i) {
        None | Some(Arg::Missing) => Ok(default),
        Some(arg) => arg.number(locale),
    }
}

/// An optional argument as a boolean, false when it is not given or left out.
fn boolean_or_false(args: &[Arg], i: usize) -> Result<bool, CellError> {
    match args.get(i) {
        None => Ok(false),
        Some(arg) => arg.boolean(),
    }
}

// ROW, COLUMN, ROWS, COLUMNS

/// ROW and COLUMN: of the formula's own cell, or of a reference one row (column) high; else #VALUE!.
fn place_number(args: &[Arg], own: usize, row: bool) -> Answer {
    let Some(arg) = args.first() else {
        return number((own + 1) as f64);
    };
    match arg {
        Arg::Place(shape) => match shape.place {
            Some(p) if row && p.rows() == 1 => number((p.top + 1) as f64),
            Some(p) if !row && p.columns() == 1 => number((p.left + 1) as f64),
            _ => Err(CellError::Value),
        },
        Arg::Value(Value::Error(e)) => Err(*e),
        _ => Err(CellError::Value),
    }
}

/// ROWS and COLUMNS: of a range or an array; one value is one row and one column.
fn size(arg: &Arg, rows: bool) -> Answer {
    match arg {
        Arg::Place(shape) => number(if rows { shape.rows } else { shape.columns } as f64),
        Arg::Cells(cells) => number(if rows { cells.rows() } else { cells.columns() } as f64),
        Arg::Value(Value::Error(e)) => Err(*e),
        Arg::Value(_) => number(1.0),
        Arg::Missing => Err(CellError::Value),
    }
}

// INDEX

/// A row or column position: a number, not negative, without its fraction.
fn position(arg: &Arg, locale: &Locale) -> Result<f64, CellError> {
    let n = arg.number(locale)?;
    if n < 0.0 {
        return Err(CellError::Value);
    }
    Ok(n.trunc())
}

/// INDEX(range, row, [column], [area]): the cell at a row and column; 0 (or a left-out one) for a whole column or
/// row. With one index, a range one row high takes it as the column. The area must be 1.
fn index(args: &[Arg], cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let row = position(&args[1], locale)?;
    let column = match args.get(2) {
        Some(arg) => Some(position(arg, locale)?),
        None => None,
    };
    if let Some(area) = args.get(3) {
        if area.number(locale)?.trunc() != 1.0 {
            return Err(CellError::Reference);
        }
    }
    let (rows, columns) = (cells.rows(), cells.columns());
    let (row, column) = match column {
        Some(c) => (row, c),
        None if rows == 1 => (0.0, row),
        None => (row, 0.0),
    };
    if row > rows as f64 || column > columns as f64 {
        return Err(CellError::Reference);
    }
    let (top, height) = if row == 0.0 { (0, rows) } else { (row as usize - 1, 1) };
    let (left, width) = if column == 0.0 { (0, columns) } else { (column as usize - 1, 1) };
    // A part of an array brings what its values do.
    if cells.place.is_none() {
        let cells = (top..top + height).flat_map(|r| (left..left + width).map(move |c| Some((0, r, c))));
        cx.sources = Some(cells.collect());
    }
    Ok(cells.part(top, left, height, width))
}

// Finding a value

/// The first row or the first column of some cells, to look in.
struct Line<'a> {
    cells: &'a Cells,
    /// The first row (else the first column).
    across: bool,
}

impl<'a> Line<'a> {
    /// The cells as a line: one column, or one row; `None` for more rows and columns.
    fn of(cells: &'a Cells) -> Option<Line<'a>> {
        if cells.columns() == 1 {
            Some(Line { cells, across: false })
        } else if cells.rows() == 1 {
            Some(Line { cells, across: true })
        } else {
            None
        }
    }

    fn len(&self) -> usize {
        if self.across {
            self.cells.columns()
        } else {
            self.cells.rows()
        }
    }

    fn get(&self, i: usize) -> &Value {
        if self.across {
            self.cells.get(0, i)
        } else {
            self.cells.get(i, 0)
        }
    }
}

/// A lookup value as lookups compare it: blank is the number 0.
fn lookup_value(v: Value) -> Value {
    match v {
        Value::Blank => Value::Number(0.0),
        v => v,
    }
}

/// How a cell compares with a value when both are of one kind (number, text or boolean); `None` otherwise.
fn compare_same_kind(cell: &Value, x: &Value) -> Option<Ordering> {
    match (cell, x) {
        (Value::Number(a), Value::Number(b)) => Some(compare_numbers(*a, *b)),
        (Value::Text(a), Value::Text(b)) => Some(compare_texts(a, b)),
        (Value::Boolean(a), Value::Boolean(b)) => Some(a.cmp(b)),
        _ => None,
    }
}

/// What a lookup value matches exactly: itself, or the cells a text pattern matches.
struct Exactly<'a> {
    x: &'a Value,
    pattern: Option<Wildcard>,
}

impl<'a> Exactly<'a> {
    fn new(x: &'a Value, wildcards: bool) -> Exactly<'a> {
        let pattern = match x {
            Value::Text(t) if wildcards => Some(Wildcard::new(t)),
            _ => None,
        };
        Exactly { x, pattern }
    }

    fn matches(&self, cell: &Value) -> bool {
        match (&self.pattern, cell) {
            (Some(p), Value::Text(t)) => p.matches(t),
            (Some(_), _) => false,
            (None, cell) => compare_same_kind(cell, self.x) == Some(Ordering::Equal),
        }
    }
}

/// The first cell matching a value exactly, wildcards and all.
fn first_exact(line: &Line, x: &Value) -> Option<usize> {
    let exactly = Exactly::new(x, true);
    (0..line.len()).find(|&i| exactly.matches(line.get(i)))
}

/// A sorted lookup: the last cell equal to the value, else the last one smaller (`larger`: larger) than it.
fn last_sorted(line: &Line, x: &Value, larger: bool) -> Option<usize> {
    let mut found = None;
    let mut exact = false;
    let wanted = if larger { Ordering::Greater } else { Ordering::Less };
    for i in 0..line.len() {
        match compare_same_kind(line.get(i), x) {
            Some(Ordering::Equal) => {
                found = Some(i);
                exact = true;
            }
            Some(o) if o == wanted && !exact => found = Some(i),
            _ => {}
        }
    }
    found
}

/// XMATCH's and XLOOKUP's search: `mode` -1 (exact or next smaller), 0 (exact), 1 (exact or next larger) or 2
/// (wildcards); `backwards` from the last cell.
fn search(line: &Line, x: &Value, mode: i32, backwards: bool) -> Option<usize> {
    let exactly = Exactly::new(x, mode == 2);
    let wanted = match mode {
        -1 => Some(Ordering::Less),
        1 => Some(Ordering::Greater),
        _ => None,
    };
    let n = line.len();
    let mut best: Option<usize> = None;
    for k in 0..n {
        let i = if backwards { n - 1 - k } else { k };
        let cell = line.get(i);
        if exactly.matches(cell) {
            return Some(i);
        }
        let Some(wanted) = wanted else { continue };
        if compare_same_kind(cell, x) != Some(wanted) {
            continue;
        }
        // Nearer the value than the best so far: smaller than it when the cells are larger, and the reverse.
        let nearer = match best {
            None => true,
            Some(b) => compare_same_kind(cell, line.get(b)) == Some(wanted.reverse()),
        };
        if nearer {
            best = Some(i);
        }
    }
    best
}

/// A mode argument without its fraction, `default` when not given; one not among `allowed` is #VALUE!.
fn mode_of(args: &[Arg], i: usize, default: i32, allowed: &[i32], locale: &Locale) -> Result<i32, CellError> {
    let n = match args.get(i) {
        None => return Ok(default),
        Some(arg) => arg.number(locale)?.trunc(),
    };
    allowed.iter().copied().find(|m| *m as f64 == n).ok_or(CellError::Value)
}

/// MATCH(value, range, [match type]): 1 (the default) sorted, 0 exact, -1 sorted largest first; a range of more
/// rows and columns is #N/A; another type #NUM!.
fn match_(args: &[Arg], locale: &Locale) -> Answer {
    let x = lookup_value(args[0].value()?);
    let kind = match args.get(2) {
        None => 1.0,
        Some(arg) => arg.number(locale)?.trunc(),
    };
    let cells = cells_of(&args[1])?;
    let line = Line::of(&cells).ok_or(CellError::NotAvailable)?;
    let found = if kind == 0.0 {
        first_exact(&line, &x)
    } else if kind == 1.0 {
        last_sorted(&line, &x, false)
    } else if kind == -1.0 {
        last_sorted(&line, &x, true)
    } else {
        return Err(CellError::Number);
    };
    found.map_or(Err(CellError::NotAvailable), |i| number((i + 1) as f64))
}

/// XMATCH's and XLOOKUP's match mode (-1, 0, 1 or 2; 0 by default) and search mode (1, -1, 2 or -2; 1 by default),
/// the arguments at `i` and `i + 1`; wildcards and a binary search mode together are #VALUE!.
fn modes(args: &[Arg], i: usize, locale: &Locale) -> Result<(i32, bool), CellError> {
    let mode = mode_of(args, i, 0, &[-1, 0, 1, 2], locale)?;
    let search_mode = mode_of(args, i + 1, 1, &[1, -1, 2, -2], locale)?;
    if mode == 2 && search_mode.abs() == 2 {
        return Err(CellError::Value);
    }
    Ok((mode, search_mode < 0))
}

/// XMATCH(value, range, [match mode], [search mode]).
fn xmatch(args: &[Arg], locale: &Locale) -> Answer {
    let x = lookup_value(args[0].value()?);
    let cells = cells_of(&args[1])?;
    let (mode, backwards) = modes(args, 2, locale)?;
    let line = Line::of(&cells).ok_or(CellError::Value)?;
    match search(&line, &x, mode, backwards) {
        Some(i) => number((i + 1) as f64),
        None => Err(CellError::NotAvailable),
    }
}

/// XLOOKUP(value, lookup range, result range, [if not found], [match mode], [search mode]): the result range's row
/// (lookup range a column) or column (a row) where the value is; the result range must be as long.
fn xlookup(args: &[Arg], locale: &Locale) -> Answer {
    let x = lookup_value(args[0].value()?);
    let looked = cells_of(&args[1])?;
    let results = cells_of(&args[2])?;
    let (mode, backwards) = modes(args, 4, locale)?;
    let line = Line::of(&looked).ok_or(CellError::Value)?;
    let fits = if line.across { results.columns() == looked.columns() } else { results.rows() == looked.rows() };
    if !fits {
        return Err(CellError::Value);
    }
    match search(&line, &x, mode, backwards) {
        Some(i) if line.across => Ok(results.part(0, i, results.rows(), 1)),
        Some(i) => Ok(results.part(i, 0, 1, results.columns())),
        None => match args.get(3) {
            None | Some(Arg::Missing) => Err(CellError::NotAvailable),
            Some(Arg::Value(v)) => Ok(Operand::Value(v.clone())),
            Some(arg) => {
                let cells = cells_of(arg)?;
                Ok(cells.part(0, 0, cells.rows(), cells.columns()))
            }
        },
    }
}

/// VLOOKUP and HLOOKUP(value, range, column (row), [sorted]): looks in the range's first column (row), sorted by
/// default; a column (row) below 1 is #VALUE!, past the range #REF!.
fn vlookup(args: &[Arg], vertical: bool, cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let x = lookup_value(args[0].value()?);
    let cells = cells_of(&args[1])?;
    let which = args[2].number(locale)?.trunc();
    let sorted = match args.get(3) {
        None => true,
        Some(arg) => arg.boolean()?,
    };
    let width = if vertical { cells.columns() } else { cells.rows() };
    if which < 1.0 {
        return Err(CellError::Value);
    }
    if which > width as f64 {
        return Err(CellError::Reference);
    }
    let line = Line { cells: &cells, across: !vertical };
    let found = if sorted { last_sorted(&line, &x, false) } else { first_exact(&line, &x) };
    let i = found.ok_or(CellError::NotAvailable)?;
    let which = which as usize - 1;
    let (r, c) = if vertical { (i, which) } else { (which, i) };
    found_at(&cells, (1, r, c), cx)
}

/// The value a lookup found, at the cell (row, column) of an argument: it brings what that cell does.
fn found_at(cells: &Cells, (k, r, c): (usize, usize, usize), cx: &mut CallContext) -> Answer {
    cx.sources = Some(vec![Some((k, r, c))]);
    value(cells.get(r, c).clone())
}

/// LOOKUP(value, sorted range, [result range]): a sorted lookup in the range's first column (first row when it has
/// more columns than rows); the answer is at the same place in the result range (a row or a column), else in the
/// range's last column (row).
fn lookup(args: &[Arg], cx: &mut CallContext) -> Answer {
    let x = lookup_value(args[0].value()?);
    let cells = cells_of(&args[1])?;
    let results = match args.get(2) {
        Some(arg) => Some(cells_of(arg)?),
        None => None,
    };
    let across = cells.columns() > cells.rows();
    let line = Line { cells: &cells, across };
    let i = last_sorted(&line, &x, false).ok_or(CellError::NotAvailable)?;
    match results {
        Some(results) => {
            let line = Line::of(&results).ok_or(CellError::NotAvailable)?;
            if i >= line.len() {
                return Err(CellError::Reference);
            }
            let at = if line.across { (0, i) } else { (i, 0) };
            found_at(&results, (2, at.0, at.1), cx)
        }
        None if across => found_at(&cells, (1, cells.rows() - 1, i), cx),
        None => found_at(&cells, (1, i, cells.columns() - 1), cx),
    }
}

// FILTER

/// FILTER(range, include, …, [if empty]): the rows (or, with includes that are rows, the columns) where every
/// include is true. An include is one column as high as the range (one value counts as one), or one row as wide.
/// The last of three or more arguments is "if empty" when it is one value other than a boolean. An include's cells
/// are booleans, numbers, `"TRUE"`/`"FALSE"` in any case, `""` or blank (false); other text is #VALUE!, an error
/// that error. Nothing left is "if empty" (#N/A when it is blank or not given).
fn filter(args: &[Arg], cx: &mut CallContext) -> Answer {
    let n = args.len();
    let last = cells_of(&args[n - 1])?;
    let last_is_if_empty = n >= 3 && last.array.is_single() && !matches!(last.get(0, 0), Value::Boolean(_));
    let (includes, if_empty) = if last_is_if_empty { (&args[1..n - 1], args.last()) } else { (&args[1..], None) };
    let range = cells_of(&args[0])?;
    let includes: Vec<Cells> = includes.iter().map(cells_of).collect::<Result<_, _>>()?;
    let (rows, columns) = (range.rows(), range.columns());
    // Whether the includes pick columns.
    let mut by_column = None;
    for include in &includes {
        let this = if include.columns() == 1 && include.rows() == rows {
            false
        } else if include.rows() == 1 && include.columns() > 1 && include.columns() == columns {
            true
        } else {
            return Err(CellError::Value);
        };
        if by_column.is_some_and(|b| b != this) {
            return Err(CellError::Value);
        }
        by_column = Some(this);
    }
    let by_column = by_column.unwrap_or(false);
    let count = if by_column { columns } else { rows };
    let mut keep = vec![true; count];
    for include in &includes {
        for (i, v) in include.values().enumerate() {
            if !included(v)? {
                keep[i] = false;
            }
        }
    }
    let if_empty = match if_empty {
        Some(arg) => match arg.value()? {
            Value::Error(e) => return Err(e),
            Value::Blank => None,
            v => Some(v),
        },
        None => None,
    };
    let kept: Vec<usize> = (0..count).filter(|&i| keep[i]).collect();
    if kept.is_empty() {
        return if_empty.map_or(Err(CellError::NotAvailable), value);
    }
    let mut picked = Picked::default();
    if by_column {
        for r in 0..rows {
            kept.iter().for_each(|&c| picked.take(range.get(r, c), (0, r, c)));
        }
        picked.shaped(rows, kept.len()).answer(cx)
    } else {
        for &r in &kept {
            (0..columns).for_each(|c| picked.take(range.get(r, c), (0, r, c)));
        }
        picked.shaped(kept.len(), columns).answer(cx)
    }
}

/// An include's cell as a boolean.
fn included(v: &Value) -> Result<bool, CellError> {
    match v {
        Value::Blank => Ok(false),
        Value::Number(n) => Ok(*n != 0.0),
        Value::Boolean(b) => Ok(*b),
        Value::Text(t) if t.is_empty() || t.eq_ignore_ascii_case("FALSE") => Ok(false),
        Value::Text(t) if t.eq_ignore_ascii_case("TRUE") => Ok(true),
        Value::Text(_) => Err(CellError::Value),
        Value::Error(e) => Err(*e),
    }
}

// SORT, SORTN

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

/// A sort order argument: 1 (or TRUE, the default) ascending, 0 (FALSE) or -1 descending; else #VALUE!.
fn descending(args: &[Arg], i: usize, locale: &Locale) -> Result<bool, CellError> {
    let n = number_or(args, i, 1.0, locale)?;
    if n == 1.0 {
        Ok(false)
    } else if n == 0.0 || n == -1.0 {
        Ok(true)
    } else {
        Err(CellError::Value)
    }
}

/// A column (or row) to sort by, counted from 1: one past `count` is #VALUE!.
fn sort_key(args: &[Arg], i: usize, count: usize, locale: &Locale) -> Result<usize, CellError> {
    let n = number_or(args, i, 1.0, locale)?.trunc();
    if n < 1.0 || n > count as f64 {
        return Err(CellError::Value);
    }
    Ok(n as usize - 1)
}

/// The rows of a range in sorted order, by the values in one column (stable: equal rows keep their order).
fn sorted_rows(cells: &Cells, key: usize, descending: bool) -> Vec<usize> {
    let mut order: Vec<usize> = (0..cells.rows()).collect();
    order.sort_by(|&p, &q| sort_order(cells.get(p, key), cells.get(q, key), descending));
    order
}

/// The rows of the first argument's cells, in the order given; `by_column`: `cells` is it turned on its side, and the
/// rows picked are its columns.
fn rows_of(cells: &Cells, rows: &[usize], by_column: bool) -> Picked {
    let mut picked = Picked::default();
    if by_column {
        for c in 0..cells.columns() {
            rows.iter().for_each(|&r| picked.take(cells.get(r, c), (0, c, r)));
        }
        picked.shaped(cells.columns(), rows.len())
    } else {
        for &r in rows {
            (0..cells.columns()).for_each(|c| picked.take(cells.get(r, c), (0, r, c)));
        }
        picked.shaped(rows.len(), cells.columns())
    }
}

/// SORT(range, [column], [order], [by column]): the rows sorted by one column; by column, the columns by one row.
fn sort(args: &[Arg], cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let range = cells_of(&args[0])?;
    let by_column = boolean_or_false(args, 3)?;
    let cells = if by_column { Cells { array: Rc::new(range.array.transposed()), place: None } } else { range };
    let key = sort_key(args, 1, cells.columns(), locale)?;
    let descending = descending(args, 2, locale)?;
    rows_of(&cells, &sorted_rows(&cells, key, descending), by_column).answer(cx)
}

/// SORTN(range, [count], [ties], [column], [order]): the first `count` rows (1 by default) sorted by one column.
/// Ties: 0 just those; 1 and the rows equal to the last of them; 2 one row of each value; 3 the rows of the first
/// `count` values.
fn sortn(args: &[Arg], cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let cells = cells_of(&args[0])?;
    let count = number_or(args, 1, 1.0, locale)?.trunc();
    let ties = number_or(args, 2, 0.0, locale)?.trunc();
    let key = sort_key(args, 3, cells.columns(), locale)?;
    let descending = descending(args, 4, locale)?;
    if count < 1.0 || !(0.0..=3.0).contains(&ties) {
        return Err(CellError::Value);
    }
    let order = sorted_rows(&cells, key, descending);
    let count = if count >= order.len() as f64 { order.len() } else { count as usize };
    let same = |p: usize, q: usize| sort_order(cells.get(p, key), cells.get(q, key), descending) == Ordering::Equal;
    let rows: Vec<usize> = match ties as u8 {
        0 => order[..count].to_vec(),
        1 => {
            let mut end = count;
            while end < order.len() && same(order[end], order[count - 1]) {
                end += 1;
            }
            order[..end].to_vec()
        }
        2 => {
            let mut out: Vec<usize> = Vec::new();
            for &r in &order {
                if out.len() == count {
                    break;
                }
                if out.last().is_none_or(|&p| !same(p, r)) {
                    out.push(r);
                }
            }
            out
        }
        _ => {
            let mut out: Vec<usize> = Vec::new();
            let mut values = 0;
            for &r in &order {
                if out.last().is_none_or(|&p| !same(p, r)) {
                    if values == count {
                        break;
                    }
                    values += 1;
                }
                out.push(r);
            }
            out
        }
    };
    rows_of(&cells, &rows, false).answer(cx)
}

// UNIQUE

/// A value as UNIQUE tells values apart: numbers to 15 significant digits, text in any case, errors by kind, and
/// blank the same as `""`.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Key {
    Number(u64),
    Text(String),
    Boolean(bool),
    Error(CellError),
    Empty,
}

fn key_of(v: &Value) -> Key {
    match v {
        Value::Number(n) => {
            let n = compared_number(*n);
            Key::Number(if n == 0.0 { 0 } else { n.to_bits() })
        }
        Value::Text(t) if t.is_empty() => Key::Empty,
        Value::Text(t) => Key::Text(t.chars().flat_map(char::to_lowercase).collect()),
        Value::Boolean(b) => Key::Boolean(*b),
        Value::Error(e) => Key::Error(*e),
        Value::Blank => Key::Empty,
    }
}

/// UNIQUE(range, [by column], [exactly once]): the rows (columns) without repeats, each where it first comes, or
/// only those that come once; `""` comes back blank. None is #N/A.
fn unique(args: &[Arg], cx: &mut CallContext) -> Answer {
    let range = cells_of(&args[0])?;
    let by_column = boolean_or_false(args, 1)?;
    let exactly_once = boolean_or_false(args, 2)?;
    let cells = if by_column { Cells { array: Rc::new(range.array.transposed()), place: None } } else { range };
    // Each line where it first comes, and how many times it comes.
    let mut first: Vec<(usize, usize)> = Vec::new();
    let mut seen: HashMap<Vec<Key>, usize> = HashMap::new();
    for r in 0..cells.rows() {
        let key: Vec<Key> = (0..cells.columns()).map(|c| key_of(cells.get(r, c))).collect();
        let k = *seen.entry(key).or_insert_with(|| {
            first.push((r, 0));
            first.len() - 1
        });
        first[k].1 += 1;
    }
    let rows: Vec<usize> = first.into_iter().filter(|&(_, n)| !exactly_once || n == 1).map(|(r, _)| r).collect();
    if rows.is_empty() {
        return Err(CellError::NotAvailable);
    }
    let mut picked = rows_of(&cells, &rows, by_column);
    for v in &mut picked.values {
        if matches!(v, Value::Text(t) if t.is_empty()) {
            *v = Value::Blank;
        }
    }
    picked.answer(cx)
}

// TRANSPOSE

fn transpose(args: &[Arg], cx: &mut CallContext) -> Answer {
    let cells = cells_of(&args[0])?;
    let mut picked = Picked::default();
    for c in 0..cells.columns() {
        (0..cells.rows()).for_each(|r| picked.take(cells.get(r, c), (0, r, c)));
    }
    picked.shaped(cells.columns(), cells.rows()).answer(cx)
}

// HSTACK, VSTACK

/// HSTACK and VSTACK: the arguments side by side (one under another); a shorter one is filled out with #N/A.
fn stack(args: &[Arg], side_by_side: bool, cx: &mut CallContext) -> Answer {
    let parts: Vec<Cells> = args.iter().map(cells_of).collect::<Result<_, _>>()?;
    let mut picked = Picked::default();
    let filler = || Value::Error(CellError::NotAvailable);
    if side_by_side {
        let rows = parts.iter().map(Cells::rows).max().unwrap_or(0);
        for r in 0..rows {
            for (k, part) in parts.iter().enumerate() {
                for c in 0..part.columns() {
                    if r < part.rows() { picked.take(part.get(r, c), (k, r, c)) } else { picked.made(filler()) }
                }
            }
        }
        picked.shaped(rows, parts.iter().map(Cells::columns).sum()).answer(cx)
    } else {
        let columns = parts.iter().map(Cells::columns).max().unwrap_or(0);
        for (k, part) in parts.iter().enumerate() {
            for r in 0..part.rows() {
                for c in 0..columns {
                    if c < part.columns() { picked.take(part.get(r, c), (k, r, c)) } else { picked.made(filler()) }
                }
            }
        }
        picked.shaped(parts.iter().map(Cells::rows).sum(), columns).answer(cx)
    }
}

/// HYPERLINK(link, [text]): the text to show when there is one (as it is; blank is 0), else the link as text.
fn hyperlink(args: &[Arg], locale: &Locale) -> Answer {
    match args.get(1) {
        Some(label) => value(lookup_value(label.value()?)),
        None => text(args[0].text(locale)?),
    }
}
