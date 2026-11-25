//! Working out one formula's expression.
//!
//! What an expression works out to is an [`Operand`]: one value, a range (a place on a sheet, read when needed),
//! or an array. Arrays come in two kinds, and the difference shows at the top of a formula: an array written in
//! the formula (`{1,2}`) or answered by a function that answers arrays (TRANSPOSE, FILTER, …) spills there, while
//! one worked out cell by cell by an operator (`A1:A3*2`) or taken out of an argument (INDEX, XLOOKUP) must be one
//! value there and is #VALUE! when it is more. In a function's argument that takes several cells, both are read
//! cell by cell: `SUM(A1:A3*2)`.
//!
//! IF, IFERROR, IFNA, IFS, SWITCH, CHOOSE and LET are worked out here: they read only the arguments they need, and
//! answer one of them as it came (a range stays a range).
//!
//! Working an expression out also leaves what number format it brings (`Calculation::brought`, see [`brought`]).

pub(crate) mod pivot;

use std::rc::Rc;

use crate::brought::{self, Brought};
use crate::calculate::{Calculation, Slot, SpillFormats};
use crate::coerce;
use crate::formula::{BinaryOp, Expr, UnaryOp};
use crate::functions::{self, Arg, CallContext, Cells, ErrorInIt, FunctionId, Shape, Takes};
use crate::locale::Locale;
use crate::number_format::Kind;
use crate::value::{Array, CellError, Value};

/// A rectangle of cells on a sheet, by position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Place {
    pub sheet: usize,
    pub top: usize,
    pub left: usize,
    pub bottom: usize,
    pub right: usize,
}

impl Place {
    pub fn rows(&self) -> usize {
        self.bottom - self.top + 1
    }

    pub fn columns(&self) -> usize {
        self.right - self.left + 1
    }

    pub fn is_single(&self) -> bool {
        self.top == self.bottom && self.left == self.right
    }

    /// Part of this place: `rows` × `columns` from (`top`, `left`), counted from its corner.
    pub fn part(&self, top: usize, left: usize, rows: usize, columns: usize) -> Place {
        Place {
            sheet: self.sheet,
            top: self.top + top,
            left: self.left + left,
            bottom: self.top + top + rows - 1,
            right: self.left + left + columns - 1,
        }
    }
}

/// What an expression works out to.
#[derive(Clone, Debug)]
pub enum Operand {
    Value(Value),
    Range(Place),
    /// An array that spills at the top of a formula.
    Array(Rc<Array>),
    /// An array worked out cell by cell, or part of an argument: at the top of a formula, only one value.
    Values(Rc<Array>),
}

impl Operand {
    pub fn error(e: CellError) -> Operand {
        Operand::Value(Value::Error(e))
    }
}

/// One value, or an array, as operators work on them.
enum Grid {
    One(Value),
    Many(Rc<Array>),
}

impl Calculation {
    /// What an expression works out to; what it brings is left in `self.brought`.
    pub(crate) fn eval(&mut self, f: usize, expr: &Expr) -> Operand {
        self.brought = None;
        self.link = None;
        match expr {
            Expr::Number(n) => Operand::Value(Value::number(*n)),
            Expr::Text(s) => Operand::Value(Value::Text(s.clone())),
            Expr::Boolean(b) => Operand::Value(Value::Boolean(*b)),
            Expr::Error(e) => Operand::error(*e),
            Expr::Missing => Operand::Value(Value::Blank),
            Expr::Reference(i) => match self.formulas[f].places.get(*i).copied().flatten() {
                Some(place) => {
                    self.brought = self.range_brought(place);
                    Operand::Range(place)
                }
                None => Operand::error(CellError::Reference),
            },
            Expr::Name(name) => match self.scopes.iter().rev().find(|(n, ..)| n == name) {
                Some((_, operand, brought, link)) => {
                    let operand = operand.clone();
                    self.brought = brought.clone();
                    self.link = link.clone();
                    operand
                }
                None => Operand::error(CellError::Name),
            },
            Expr::Array(a) => Operand::Array(a.clone()),
            Expr::Call { name, arguments, .. } if name.as_ref() == "PIVOT" => self.pivot(f, arguments),
            Expr::Call { function: None, .. } => Operand::error(CellError::Name),
            Expr::Call { function: Some(id), arguments, index, .. } => self.call(f, *id, arguments, *index),
            Expr::Unary(op, operand) => {
                let x = self.eval(f, operand);
                // A sign keeps what the number brings, but a minus a date's or a time's; a percent sign keeps none.
                let brought = self.brought.take().filter(|b| match op {
                    UnaryOp::Plus => true,
                    UnaryOp::Negate => !matches!(b.kind, Kind::Date | Kind::Time | Kind::DateAndTime),
                    UnaryOp::Percent => false,
                });
                let grid = self.grid(x);
                self.brought = brought;
                self.link = None;
                let locale = self.locale;
                self.map(grid, |v| unary(*op, v, locale))
            }
            Expr::Binary(op, a, b) => {
                let x = self.eval(f, a);
                let p = self.brought.take();
                let x = self.grid(x);
                let y = self.eval(f, b);
                let q = self.brought.take();
                let y = self.grid(y);
                self.brought = brought::of_operator(*op, p.as_ref(), q.as_ref());
                self.link = None;
                broadcast(x, y, |p, q| binary(*op, p, q, self.locale))
            }
        }
    }

    fn grid(&mut self, operand: Operand) -> Grid {
        match operand {
            Operand::Value(v) => Grid::One(v),
            Operand::Range(place) if place.is_single() => Grid::One(self.cell_value(place.sheet, place.top, place.left)),
            Operand::Range(place) => Grid::Many(Rc::new(self.range_values(place))),
            Operand::Array(a) | Operand::Values(a) if a.is_single() => Grid::One(a.get(0, 0).clone()),
            Operand::Array(a) | Operand::Values(a) => Grid::Many(a),
        }
    }

    fn map(&mut self, grid: Grid, f: impl Fn(&Value) -> Value) -> Operand {
        match grid {
            Grid::One(v) => Operand::Value(f(&v)),
            Grid::Many(a) => Operand::Values(Rc::new(a.map(f))),
        }
    }

    /// An operand as one value: a range or array of one cell is that cell's value; of more, #VALUE!.
    pub(crate) fn one_value(&mut self, operand: Operand) -> Value {
        match self.grid(operand) {
            Grid::One(v) => v,
            Grid::Many(_) => Value::Error(CellError::Value),
        }
    }

    /// An operand's cells, for an argument that takes several.
    fn cells(&mut self, operand: Operand) -> Arg {
        match operand {
            Operand::Value(v) => Arg::Value(v),
            Operand::Range(place) => Arg::Cells(Cells { array: Rc::new(self.range_values(place)), place: Some(place) }),
            Operand::Array(a) | Operand::Values(a) => Arg::Cells(Cells { array: a, place: None }),
        }
    }

    fn place_of(&mut self, f: usize, expr: &Expr) -> Arg {
        let operand = match expr {
            Expr::Reference(i) => match self.formulas[f].places.get(*i).copied().flatten() {
                Some(place) => Operand::Range(place),
                None => Operand::error(CellError::Reference),
            },
            other => self.eval(f, other),
        };
        match operand {
            Operand::Range(place) => Arg::Place(Shape { rows: place.rows(), columns: place.columns(), place: Some(place) }),
            Operand::Array(a) | Operand::Values(a) => Arg::Place(Shape { rows: a.rows(), columns: a.columns(), place: None }),
            Operand::Value(v) => Arg::Value(v),
        }
    }

    fn call(&mut self, f: usize, id: FunctionId, arguments: &[Expr], index: u32) -> Operand {
        let description = id.description();
        let Some(slots) = functions::match_arguments(description, arguments.len()) else {
            return Operand::error(CellError::NotAvailable);
        };
        match description.name {
            "IF" => return self.if_(f, arguments),
            "IFERROR" => return self.if_error(f, arguments, false),
            "IFNA" => return self.if_error(f, arguments, true),
            "IFS" => return self.ifs(f, arguments),
            "SWITCH" => return self.switch(f, arguments),
            "CHOOSE" => return self.choose(f, arguments),
            "LET" => return self.let_(f, arguments),
            _ => {}
        }
        let mut args = Vec::with_capacity(arguments.len());
        let mut brought: Vec<Option<Brought>> = Vec::with_capacity(arguments.len());
        // Arguments for one value given several cells, where that works cell by cell.
        let mut lifted: Vec<(usize, Rc<Array>)> = Vec::new();
        // These read their numbers before they look at errors in their ranges (not an error written as one value).
        let reads_numbers_first = matches!(description.name, "PROB" | "T.TEST" | "TTEST");
        let mut error_in_range = None;
        for (i, (expr, &slot)) in arguments.iter().zip(&slots).enumerate() {
            brought.push(None);
            if matches!(expr, Expr::Missing) {
                // Cells whose errors may be passed over must be given.
                if slot.takes == Takes::SeveralCells && slot.error_in_it == ErrorInIt::MayBePassedOver {
                    return Operand::error(CellError::Value);
                }
                args.push(Arg::Missing);
                continue;
            }
            let answers_errors = slot.error_in_it == ErrorInIt::IsTheAnswer;
            let arg = match slot.takes {
                Takes::OneValue => {
                    let operand = self.eval(f, expr);
                    brought[i] = self.brought.take();
                    // Several cells where one value goes is the call's answer, #VALUE!, even for a function that
                    // looks at errors (ISERROR(A1:A5)).
                    let v = match self.grid(operand) {
                        Grid::One(v) => v,
                        Grid::Many(a) if self.lifting => {
                            lifted.push((i, a));
                            args.push(Arg::Missing);
                            continue;
                        }
                        Grid::Many(_) => return Operand::error(CellError::Value),
                    };
                    if let (Value::Error(e), true) = (&v, answers_errors) {
                        return Operand::error(*e);
                    }
                    if let Err(e) = functions::check_early(id, i, &v, self.locale) {
                        return Operand::error(e);
                    }
                    Arg::Value(v)
                }
                Takes::SeveralCells => {
                    let lifting = std::mem::replace(&mut self.lifting, true);
                    let operand = self.eval(f, expr);
                    self.lifting = lifting;
                    brought[i] = self.brought.take();
                    let arg = self.cells(operand);
                    // An error written as one value (not a range or an array) is the answer even where errors in
                    // cells may be passed over: COUNTIF(1/0, …), VLOOKUP(1, #N/A, 1).
                    if let (Arg::Value(Value::Error(e)), ErrorInIt::MayBePassedOver) = (&arg, slot.error_in_it) {
                        return Operand::error(*e);
                    }
                    if answers_errors {
                        let first_error = match &arg {
                            Arg::Value(v) => v.error(),
                            Arg::Cells(cells) => cells.values().find_map(Value::error),
                            _ => None,
                        };
                        if let Some(e) = first_error {
                            if !reads_numbers_first || matches!(arg, Arg::Value(_)) {
                                return Operand::error(e);
                            }
                            error_in_range = error_in_range.or(Some(e));
                        }
                    }
                    if let Arg::Value(v) = &arg {
                        if let Err(e) = functions::check_early(id, i, v, self.locale) {
                            return Operand::error(e);
                        }
                    }
                    arg
                }
                Takes::OnlyThePlace => self.place_of(f, expr),
                Takes::AName => Arg::Missing,
            };
            args.push(arg);
        }
        if lifted.is_empty() && !self.total_ranges_are_readable(description.name, &args) {
            return Operand::error(CellError::Value);
        }
        if let Some(e) = error_in_range {
            return Operand::error(e);
        }
        // ISFORMULA asks what one cell holds, which the function is not told.
        if description.name == "ISFORMULA" {
            if let Some(Arg::Cells(Cells { place: Some(p), .. })) = args.first() {
                if p.top == p.bottom && p.left == p.right {
                    let held = self.grids[p.sheet].slots.get(&(p.top, p.left));
                    return Operand::Value(Value::Boolean(matches!(held, Some(Slot::Formula(_)))));
                }
            }
        }
        if !lifted.is_empty() {
            return self.lifted_call(f, id, index, args, &lifted, &brought, &slots);
        }
        let cell = {
            let fc = &self.formulas[f];
            Place { sheet: fc.sheet, top: fc.row, left: fc.column, bottom: fc.row, right: fc.column }
        };
        let now = self.now;
        let locale = self.locale;
        let mut random = || self.random(f, index);
        let mut cx = CallContext { cell, now, random: &mut random, locale, sources: None };
        let operand = match functions::call(id, &args, &mut cx) {
            Ok(operand) => operand,
            Err(e) => Operand::error(e),
        };
        let sources = cx.sources.take();
        // A function that picks cells of its arguments (SORT, FILTER, …) gives each value what its cell brings.
        let formats: Option<Vec<Option<Brought>>> = match (&operand, sources) {
            (Operand::Value(_) | Operand::Array(_) | Operand::Values(_), Some(from)) => Some(
                from.iter().map(|s| s.and_then(|(k, r, c)| self.brought_in(&args[k], &brought[k], r, c))).collect(),
            ),
            _ => None,
        };
        // A function that answers part of a range (INDEX, XLOOKUP) brings what its first cell brings; one that picks
        // cells, what its first value brings.
        self.brought = match (&operand, formats) {
            (Operand::Range(place), _) => self.cell_brought(place.sheet, place.top, place.left),
            (_, Some(formats)) => {
                let first = formats.first().cloned().flatten();
                if let Operand::Array(a) | Operand::Values(a) = &operand {
                    self.array_formats.insert(Rc::as_ptr(a), (a.clone(), SpillFormats::Dense(formats.into())));
                }
                first
            }
            _ => {
                let first = match args.first() {
                    Some(Arg::Value(Value::Number(n))) => Some(*n),
                    _ => None,
                };
                brought::of_call(description.name, &brought, first, self.locale.pattern_of_a_time_of_day)
            }
        };
        // A HYPERLINK is its link; what any other function answers is none.
        self.link = match (description.name, args.first()) {
            ("HYPERLINK", Some(url)) => url.text(self.locale).ok().filter(|url| !url.is_empty()),
            _ => None,
        };
        operand
    }

    /// A call given several cells where it reads one value, inside an argument that takes several cells:
    /// the function is called cell by cell, the arrays stretching as an operator's do (`broadcast`), and
    /// answers the array of what each call gives. `=ARRAYFORMULA(LEN(C1:C3))` spills 3 lengths and
    /// `=SUM(LEN(C1:C3))` adds them up, where `=LEN(C1:C3)` is #VALUE!.
    #[allow(clippy::too_many_arguments)]
    fn lifted_call(
        &mut self,
        f: usize,
        id: FunctionId,
        index: u32,
        args: Vec<Arg>,
        lifted: &[(usize, Rc<Array>)],
        brought: &[Option<Brought>],
        slots: &[&functions::Argument],
    ) -> Operand {
        let (rows, columns) = stretched(lifted.iter().map(|(_, a)| a.as_ref()));
        let cell = {
            let fc = &self.formulas[f];
            Place { sheet: fc.sheet, top: fc.row, left: fc.column, bottom: fc.row, right: fc.column }
        };
        let (now, locale) = (self.now, self.locale);
        let mut values = Vec::with_capacity(rows * columns);
        let mut one = args;
        for r in 0..rows {
            for c in 0..columns {
                let mut answer = None;
                for (i, a) in lifted {
                    let v = stretched_at(a, r, c).unwrap_or(Value::Error(CellError::NotAvailable));
                    let checked = match (&v, slots[*i].error_in_it == ErrorInIt::IsTheAnswer) {
                        (Value::Error(e), true) => Err(*e),
                        _ => functions::check_early(id, *i, &v, locale),
                    };
                    if let (Err(e), None) = (checked, &answer) {
                        answer = Some(Value::Error(e));
                    }
                    one[*i] = Arg::Value(v);
                }
                let value = match answer {
                    Some(e) => e,
                    None if !self.total_ranges_are_readable(id.description().name, &one) => Value::Error(CellError::Value),
                    None => {
                        let mut random = || self.random(f, index);
                        let mut cx = CallContext { cell, now, random: &mut random, locale, sources: None };
                        let operand = functions::call(id, &one, &mut cx).unwrap_or_else(Operand::error);
                        self.one_value(operand)
                    }
                };
                values.push(value);
            }
        }
        let first = match one.first() {
            Some(Arg::Value(Value::Number(n))) => Some(*n),
            _ => None,
        };
        self.brought = brought::of_call(id.description().name, brought, first, self.locale.pattern_of_a_time_of_day);
        self.link = None;
        Operand::Values(Rc::new(Array::new(rows, columns, values)))
    }

    /// IF given several tests inside an argument that takes several cells: each test picks from the values beside it.
    fn lifted_if(&mut self, f: usize, tests: Rc<Array>, arguments: &[Expr]) -> Operand {
        let mut grid = |k: usize, default: Value| match arguments.get(k) {
            None | Some(Expr::Missing) if k == 2 && arguments.len() < 3 => Grid::One(Value::Boolean(false)),
            None | Some(Expr::Missing) => Grid::One(default),
            Some(e) => {
                let operand = self.eval(f, e);
                self.grid(operand)
            }
        };
        let (yes, no) = (grid(1, Value::Number(0.0)), grid(2, Value::Number(0.0)));
        let as_array = |g: Grid| match g {
            Grid::One(v) => Rc::new(Array::single(v)),
            Grid::Many(a) => a,
        };
        let (yes, no) = (as_array(yes), as_array(no));
        let (rows, columns) = stretched([tests.as_ref(), yes.as_ref(), no.as_ref()].into_iter());
        let mut values = Vec::with_capacity(rows * columns);
        for r in 0..rows {
            for c in 0..columns {
                let pick = |a: &Array| stretched_at(a, r, c).unwrap_or(Value::Error(CellError::NotAvailable));
                values.push(match stretched_at(&tests, r, c).map(|t| coerce::to_boolean(&t)) {
                    None => Value::Error(CellError::NotAvailable),
                    Some(Err(e)) => Value::Error(e),
                    Some(Ok(true)) => pick(&yes),
                    Some(Ok(false)) => pick(&no),
                });
            }
        }
        self.brought = None;
        self.link = None;
        Operand::Values(Rc::new(Array::new(rows, columns, values)))
    }

    /// What the cell (row, column) of an argument brings to a function that picks it: a range's cell what it brings,
    /// a value of an array picked so what it was given, one value what its expression brings.
    fn brought_in(&mut self, arg: &Arg, expression: &Option<Brought>, r: usize, c: usize) -> Option<Brought> {
        match arg {
            Arg::Cells(Cells { place: Some(p), .. }) => self.cell_brought(p.sheet, p.top + r, p.left + c),
            Arg::Cells(Cells { array, place: None }) => {
                self.array_formats.get(&Rc::as_ptr(array))?.1.get(array.columns(), (r, c)).cloned()
            }
            Arg::Value(_) => expression.clone(),
            _ => None,
        }
    }

    /// SUBTOTAL and AGGREGATE options 0–3 refuse ranges containing either kind of nested total.
    fn total_ranges_are_readable(&self, name: &str, args: &[Arg]) -> bool {
        let ranges = match name {
            "SUBTOTAL" => &args[1..],
            "AGGREGATE" if args[1].number(self.locale).is_ok_and(|n| (0.0..4.0).contains(&n.trunc())) => {
                // LARGE, SMALL and the percentile/quartile functions use the last argument as a parameter.
                if args[0].number(self.locale).is_ok_and(|n| n.trunc() >= 14.0) {
                    &args[2..3]
                } else {
                    &args[2..]
                }
            }
            _ => return true,
        };
        ranges.iter().all(|arg| match arg {
            Arg::Cells(Cells { place: Some(place), .. }) => self.grids[place.sheet]
                .slots
                .range((place.top, 0)..=(place.bottom, usize::MAX))
                .all(|(&(_, column), slot)| match slot {
                    Slot::Formula(i) if (place.left..=place.right).contains(&column) => !self.formulas[*i].contains_total,
                    _ => true,
                }),
            _ => false,
        })
    }

    /// An argument that may be left out, as it came; left out, `default` (which brings nothing).
    fn as_it_came(&mut self, f: usize, expr: Option<&Expr>, default: Value) -> Operand {
        match expr {
            None | Some(Expr::Missing) => {
                self.brought = None;
                self.link = None;
                Operand::Value(default)
            }
            Some(e) => self.eval(f, e),
        }
    }

    fn one(&mut self, f: usize, expr: &Expr) -> Value {
        let operand = self.eval(f, expr);
        self.one_value(operand)
    }

    fn if_(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let test = self.eval(f, &arguments[0]);
        let test = match self.grid(test) {
            Grid::Many(tests) if self.lifting => return self.lifted_if(f, tests, arguments),
            Grid::Many(_) => Value::Error(CellError::Value),
            Grid::One(v) => v,
        };
        match coerce::to_boolean(&test) {
            Err(e) => Operand::error(e),
            Ok(true) => self.as_it_came(f, arguments.get(1), Value::Number(0.0)),
            Ok(false) => match arguments.get(2) {
                None => {
                    self.brought = None;
                    self.link = None;
                    Operand::Value(Value::Boolean(false))
                }
                Some(e) => self.as_it_came(f, Some(e), Value::Number(0.0)),
            },
        }
    }

    /// IFERROR (`only_not_available` false) and IFNA.
    fn if_error(&mut self, f: usize, arguments: &[Expr], only_not_available: bool) -> Operand {
        let value = self.as_it_came(f, arguments.first(), Value::Blank);
        let value = match value {
            Operand::Range(place) if place.is_single() => Operand::Value(self.cell_value(place.sheet, place.top, place.left)),
            // IFERROR reads its value as one value, and a range of more than one cell is an error it doesn't catch;
            // IFNA passes a range on.
            Operand::Range(_) if !only_not_available => return Operand::error(CellError::Value),
            other => other,
        };
        let caught = match &value {
            Operand::Value(Value::Error(e)) => !only_not_available || *e == CellError::NotAvailable,
            _ => false,
        };
        if caught {
            self.as_it_came(f, arguments.get(1), Value::Number(0.0))
        } else {
            value
        }
    }

    fn ifs(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        for pair in arguments.chunks(2) {
            let test = self.one(f, &pair[0]);
            match coerce::to_boolean(&test) {
                Err(e) => return Operand::error(e),
                Ok(true) => return self.as_it_came(f, pair.get(1), Value::Number(0.0)),
                Ok(false) => {}
            }
        }
        Operand::error(CellError::NotAvailable)
    }

    fn switch(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let value = self.one(f, &arguments[0]);
        if let Value::Error(e) = value {
            return Operand::error(e);
        }
        let rest = &arguments[1..];
        let pairs = rest.len() / 2;
        for i in 0..pairs {
            let case = self.one(f, &rest[2 * i]);
            if let Value::Error(e) = case {
                return Operand::error(e);
            }
            if same_value(&value, &case) {
                return self.as_it_came(f, Some(&rest[2 * i + 1]), Value::Number(0.0));
            }
        }
        if rest.len() % 2 == 1 {
            return self.as_it_came(f, rest.last(), Value::Number(0.0));
        }
        Operand::error(CellError::NotAvailable)
    }

    fn choose(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let position = self.one(f, &arguments[0]);
        let n = match coerce::to_number(&position, self.locale) {
            Ok(n) => n.trunc(),
            Err(e) => return Operand::error(e),
        };
        if n < 1.0 || n as usize >= arguments.len() {
            return Operand::error(CellError::Value);
        }
        self.as_it_came(f, Some(&arguments[n as usize]), Value::Number(0.0))
    }

    fn let_(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let depth = self.scopes.len();
        let pairs = (arguments.len() - 1) / 2;
        let mut names: Vec<Rc<str>> = Vec::with_capacity(pairs);
        let mut answer = None;
        for i in 0..pairs {
            let name = match &arguments[2 * i] {
                // A name written as a cell's address (one past the sheet's end) is not one LET gives a value to.
                Expr::Name(n) if !names.contains(n) && !crate::formula::parse::looks_like_a_cell(n) => n.clone(),
                _ => {
                    answer = Some(Operand::error(CellError::Name));
                    break;
                }
            };
            let value = self.as_it_came(f, Some(&arguments[2 * i + 1]), Value::Blank);
            let brought = self.brought.take();
            let link = self.link.take();
            names.push(name.clone());
            self.scopes.push((name, value, brought, link));
        }
        let answer = match answer {
            Some(a) => a,
            None => {
                let operand = self.eval(f, &arguments[arguments.len() - 1]);
                match operand {
                    Operand::Value(Value::Error(e)) => Operand::error(e),
                    other => other,
                }
            }
        };
        self.scopes.truncate(depth);
        answer
    }
}

/// Whether two values are the same, as SWITCH matches its cases: of one kind, and equal.
fn same_value(a: &Value, b: &Value) -> bool {
    let kind = |v: &Value| match v {
        Value::Blank | Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) => 3,
    };
    kind(a) == kind(b) && coerce::compare(a, b) == std::cmp::Ordering::Equal
}

/// The size arrays stretch to together, as `broadcast` stretches two.
fn stretched<'a>(arrays: impl Iterator<Item = &'a Array>) -> (usize, usize) {
    let size = |m: usize, n: usize| if m == 1 { n } else if n == 1 { m } else { m.max(n) };
    arrays.fold((1, 1), |(rows, columns), a| (size(rows, a.rows()), size(columns, a.columns())))
}

/// A stretched array's value at (row, column): `None` past the end of a side that does not stretch.
fn stretched_at(a: &Array, r: usize, c: usize) -> Option<Value> {
    let rr = if a.rows() == 1 { 0 } else { r };
    let cc = if a.columns() == 1 { 0 } else { c };
    (rr < a.rows() && cc < a.columns()).then(|| a.get(rr, cc).clone())
}

/// An operator on two grids, cell by cell: a single value or a single row or column stretches across the other;
/// beyond the smaller of two sizes that do not fit, #N/A.
fn broadcast(x: Grid, y: Grid, op: impl Fn(&Value, &Value) -> Value) -> Operand {
    match (x, y) {
        (Grid::One(a), Grid::One(b)) => Operand::Value(op(&a, &b)),
        (Grid::One(a), Grid::Many(b)) => Operand::Values(Rc::new(b.map(|q| op(&a, q)))),
        (Grid::Many(a), Grid::One(b)) => Operand::Values(Rc::new(a.map(|p| op(p, &b)))),
        (Grid::Many(a), Grid::Many(b)) => {
            let size = |m: usize, n: usize| if m == 1 { n } else if n == 1 { m } else { m.max(n) };
            let rows = size(a.rows(), b.rows());
            let columns = size(a.columns(), b.columns());
            let at = |g: &Array, r: usize, c: usize| -> Option<Value> {
                let rr = if g.rows() == 1 { 0 } else { r };
                let cc = if g.columns() == 1 { 0 } else { c };
                (rr < g.rows() && cc < g.columns()).then(|| g.get(rr, cc).clone())
            };
            let mut values = Vec::with_capacity(rows * columns);
            for r in 0..rows {
                for c in 0..columns {
                    values.push(match (at(&a, r, c), at(&b, r, c)) {
                        (Some(p), Some(q)) => op(&p, &q),
                        _ => Value::Error(CellError::NotAvailable),
                    });
                }
            }
            Operand::Values(Rc::new(Array::new(rows, columns, values)))
        }
    }
}

fn unary(op: UnaryOp, v: &Value, locale: &Locale) -> Value {
    match op {
        UnaryOp::Plus => v.clone(),
        UnaryOp::Negate => match coerce::to_number(v, locale) {
            Ok(n) => Value::number(-n),
            Err(e) => Value::Error(e),
        },
        UnaryOp::Percent => match coerce::to_number(v, locale) {
            Ok(n) => Value::number(n / 100.0),
            Err(e) => Value::Error(e),
        },
    }
}

pub fn binary(op: BinaryOp, a: &Value, b: &Value, locale: &Locale) -> Value {
    if let Value::Error(e) = a {
        return Value::Error(*e);
    }
    // Arithmetic reads the left number before the right: `"a"*(1/0)` is #VALUE!.
    let is_arithmetic =
        matches!(op, BinaryOp::Add | BinaryOp::Subtract | BinaryOp::Multiply | BinaryOp::Divide | BinaryOp::Power);
    if let (Value::Error(e), false) = (b, is_arithmetic) {
        return Value::Error(*e);
    }
    let number = |v| coerce::to_number(v, locale);
    let numbers = || -> Result<(f64, f64), CellError> { Ok((number(a)?, number(b)?)) };
    let arithmetic = |f: &dyn Fn(f64, f64) -> Result<f64, CellError>| match numbers().and_then(|(x, y)| f(x, y)) {
        Ok(n) => Value::number(n),
        Err(e) => Value::Error(e),
    };
    let comparison = |f: &dyn Fn(std::cmp::Ordering) -> bool| Value::Boolean(f(coerce::compare(a, b)));
    use std::cmp::Ordering::*;
    match op {
        BinaryOp::Add => arithmetic(&|x, y| Ok(coerce::add(x, y))),
        BinaryOp::Subtract => arithmetic(&|x, y| Ok(coerce::add(x, -y))),
        BinaryOp::Multiply => arithmetic(&|x, y| Ok(x * y)),
        BinaryOp::Divide => arithmetic(&|x, y| if y == 0.0 { Err(CellError::DivideByZero) } else { Ok(x / y) }),
        BinaryOp::Power => arithmetic(&power),
        BinaryOp::Concat => match (coerce::to_text(a, locale), coerce::to_text(b, locale)) {
            // A text longer than 32767 bytes is #VALUE!.
            (Ok(x), Ok(y)) if x.len() + y.len() > crate::functions::text::LONGEST_TEXT_IN_BYTES => {
                Value::Error(CellError::Value)
            }
            (Ok(x), Ok(y)) => Value::Text(format!("{x}{y}").into()),
            (Err(e), _) | (_, Err(e)) => Value::Error(e),
        },
        BinaryOp::Equal => comparison(&|o| o == Equal),
        BinaryOp::NotEqual => comparison(&|o| o != Equal),
        BinaryOp::Less => comparison(&|o| o == Less),
        BinaryOp::LessOrEqual => comparison(&|o| o != Greater),
        BinaryOp::Greater => comparison(&|o| o == Greater),
        BinaryOp::GreaterOrEqual => comparison(&|o| o != Less),
    }
}

/// `x ^ y`: 0^0 is #NUM!; a negative number to a fraction is #NUM! unless the fraction is one over an odd number
/// (an odd root: `(-8)^(1/3)` is -2).
pub fn power(x: f64, y: f64) -> Result<f64, CellError> {
    if x == 0.0 && y == 0.0 {
        return Err(CellError::Number);
    }
    if x == 0.0 && y < 0.0 {
        return Err(CellError::DivideByZero);
    }
    if x < 0.0 && y.fract() != 0.0 {
        let root = 1.0 / y;
        let odd = root.round();
        if coerce::add(root, -odd) == 0.0 && odd % 2.0 != 0.0 {
            return Ok(-(-x).powf(y));
        }
        return Err(CellError::Number);
    }
    Ok(x.powf(y))
}
