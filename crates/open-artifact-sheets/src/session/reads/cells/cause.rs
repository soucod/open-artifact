//! Why a formula comes to an error (`readCauseOfError`), as far as the workbook can tell: `None` for a cell that holds
//! no formula, a formula that comes to no error, one that cannot be read (#ERROR!, which the page tells of itself),
//! one whose array is blocked (#SPILL!, the same), and an error a function comes to by itself (`NA()`, `SQRT(-1)`).
//!
//! A formula in a cycle reads itself (`refersToItself`: a reference holds its cell, before anything else), or a cell
//! that leads back to it (`leadsBackToTheFormula`): the first of the cells it reads, in the order it names them, that
//! does, or else in a reference the formula whose array may fill some of its cells. A formula that comes to several
//! cells without spilling them (`=A1:A3`, `=A1:A3+1`) is told so whatever else it holds. Otherwise the error is
//! followed down the formula to where it comes from, an operand's error before the operator's:
//!
//! - an error written in it (`errorIsWritten`), a reference to cells deleted since (`cellsAreGone`);
//! - a cell that shows the error (`showsTheSameError`): the cell named, or the first of a range's cells (row by
//!   row) that shows it;
//! - a function called with too few arguments (`argumentIsMissing`: the first not given), too many
//!   (`tooManyArguments`), or half a pair (`pairIsIncomplete`); a name that is a function written without
//!   parentheses (`functionWithoutParentheses`), a cell past the sheet's end (`noSuchCell`), one nobody knows
//!   (`unknownName`, as written), a function nobody knows (`noSuchFunction`);
//! - a function's argument that comes to the error: the first that does (a function that reads only where a
//!   reference points reads no cells); else a lookup that finds nothing (`lookupFindsNothing`), a FILTER that keeps
//!   nothing (`filterKeepsNothing`);
//! - arithmetic on a cell that holds text that is no number (`holdsTextWhereANumberIsNeeded`), the left operand
//!   first; a division by a written 0 (`dividesByAWrittenZero`), or by a cell that is blank (`isBlankAndDividedBy`)
//!   or holds 0 (`isZeroAndDividedBy`).
//!
//! A LET's names are followed to the values given them. The cells' values are those the last calculation worked
//! out; while formulas wait for `calculate`, no cause is told for any cell.

use hashbrown::HashSet;
use std::rc::Rc;

use serde_json::{json, Value as Json};

use crate::calculate::{Calculation, Slot, SpillOutcome, State};
use crate::coerce;
use crate::evaluate::{Operand, Place};
use crate::formula::{BinaryOp, Expr, UnaryOp};
use crate::functions::{self, Description, ErrorInIt, FunctionId, Takes};
use crate::ids::LineId;
use crate::value::{CellError, Value};
use crate::workbook::{Input, Workbook};

/// The functions that come to #N/A when they find nothing.
const LOOKUPS: [&str; 6] = ["HLOOKUP", "LOOKUP", "MATCH", "VLOOKUP", "XLOOKUP", "XMATCH"];
/// The functions whose ranges are all of a size.
const SIZED_ALIKE: [&str; 5] = ["AVERAGEIFS", "COUNTIFS", "MAXIFS", "MINIFS", "SUMIFS"];

/// Why the formula in a cell (`s` is its sheet's index) comes to an error, as `readCauseOfError` tells it.
pub fn of(workbook: &Workbook, s: usize, (r, c): (LineId, LineId)) -> Option<Json> {
    // Formulas waiting for `calculate` (the page asked to be answered before calculating): no cause is told.
    if workbook.needs_calculation {
        return None;
    }
    let sheet = &workbook.sheets[s];
    let cell = sheet.cells.get(&(r, c))?;
    let Input::Formula { formula } = &cell.input else {
        return None;
    };
    let outcome = workbook.outcome(&sheet.id, r, c)?;
    let error = outcome.value.error()?;
    if matches!(outcome.spill, Some(SpillOutcome::Blocked { .. })) {
        return None;
    }
    let parsed = cell.parsed.clone()?;
    let Ok(expr) = &*parsed else {
        return None;
    };
    let (row, column) = (sheet.rows.position(r)?, sheet.columns.position(c)?);
    let calculation = worked_out(workbook);
    let Some(Slot::Formula(f)) = calculation.grids[s].slots.get(&(row, column)) else {
        return None;
    };
    let f = *f;
    let written = &formula.text_between_references;
    let mut finder = Finder { workbook, calculation, f, error, bound: Vec::new(), written };
    if finder.calculation.formulas[f].in_cycle {
        return finder.cycle();
    }
    match finder.calculation.eval(f, expr) {
        Operand::Range(place) if !place.is_single() => {
            return Some(json!({"kind": "comesToSeveralCellsThatDoNotSpill"}));
        }
        Operand::Values(a) if !a.is_single() => return Some(json!({"kind": "comesToSeveralCellsThatDoNotSpill"})),
        _ => {}
    }
    finder.cause(expr)
}

/// The workbook's formulas as the last calculation worked them out (those it did not, worked out when read).
fn worked_out(workbook: &Workbook) -> Calculation {
    let mut calculation = Calculation::new(workbook, workbook.calculated_at);
    for i in 0..calculation.formulas.len() {
        let formula = &calculation.formulas[i];
        let (s, row, column) = (formula.sheet, formula.row, formula.column);
        let sheet = &workbook.sheets[s];
        let (Some(r), Some(c)) = (sheet.rows.line(row), sheet.columns.line(column)) else {
            continue;
        };
        let Some(outcome) = workbook.outcome(&sheet.id, r, c) else {
            continue;
        };
        if let Some(SpillOutcome::Fills { array, to: (bottom, right), .. }) = &outcome.spill {
            let area = Place { sheet: s, top: row, left: column, bottom: *bottom, right: *right };
            calculation.covered.add(i, area, array);
        }
        calculation.formulas[i].state = State::Done(outcome.clone());
    }
    calculation
}

struct Finder<'a> {
    workbook: &'a Workbook,
    calculation: Calculation,
    /// The formula, by its index in the calculation.
    f: usize,
    /// The error it comes to.
    error: CellError,
    /// The names a LET gives values to, and their values as written.
    bound: Vec<(Rc<str>, &'a Expr)>,
    /// The formula's text between its references, for names as they are written.
    written: &'a [String],
}

impl<'a> Finder<'a> {
    /// A cell as a cause names it.
    fn cell(&self, sheet: usize, row: usize, column: usize) -> Json {
        let sheet = &self.workbook.sheets[sheet];
        let id = |line: Option<LineId>| line.map(|l| self.workbook.bases.text(l)).unwrap_or_default();
        json!({"sheetId": sheet.id, "cell": {"r": id(sheet.rows.line(row)), "c": id(sheet.columns.line(column))}})
    }

    /// Where the formula's nth reference points, if its cells are there.
    fn place(&self, i: usize) -> Option<Place> {
        self.calculation.formulas[self.f].places.get(i).copied().flatten()
    }

    /// The formula itself, when it reads its own cell; else the first of the cells it reads, in the order it names
    /// them, that leads back to it: in each reference, a formula a cell of it holds, else another whose array may
    /// fill some of its cells, named by its own cell (`first_read_through`).
    fn cycle(&mut self) -> Option<Json> {
        let me = &self.calculation.formulas[self.f];
        let (sheet, row, column) = (me.sheet, me.row, me.column);
        let holds_me = |p: &Place| {
            p.sheet == sheet && (p.top..=p.bottom).contains(&row) && (p.left..=p.right).contains(&column)
        };
        if me.reads.iter().any(holds_me) {
            return Some(json!({"kind": "refersToItself"}));
        }
        let f = self.f;
        for place in self.calculation.formulas[f].reads.clone() {
            if let Some(j) = self.calculation.first_read_through(&place, |j| j != f && self.leads_back(j)) {
                let f = &self.calculation.formulas[j];
                let cell = self.cell(f.sheet, f.row, f.column);
                return Some(json!({"kind": "leadsBackToTheFormula", "cell": cell}));
            }
        }
        None
    }

    /// Whether formula `j` reads the formula, by way of others or not.
    fn leads_back(&self, j: usize) -> bool {
        let mut seen: HashSet<_> = [j].into_iter().collect();
        let mut next = vec![j];
        while let Some(k) = next.pop() {
            for &l in &self.calculation.formulas[k].reads_formulas {
                if l == self.f {
                    return true;
                }
                if seen.insert(l) {
                    next.push(l);
                }
            }
        }
        false
    }

    /// The first of a range's cells, row by row, that shows the error.
    fn cell_with_the_error(&mut self, place: Place) -> Option<(usize, usize)> {
        for r in place.top..=place.bottom {
            for c in place.left..=place.right {
                if self.calculation.cell_value(place.sheet, r, c) == Value::Error(self.error) {
                    return Some((r, c));
                }
            }
        }
        None
    }

    /// Whether an expression comes to the error, or to cells one of which is it.
    fn has_the_error(&mut self, expr: &Expr) -> bool {
        match self.calculation.eval(self.f, expr) {
            Operand::Value(v) => v == Value::Error(self.error),
            Operand::Range(place) => self.cell_with_the_error(place).is_some(),
            Operand::Array(a) | Operand::Values(a) => a.values().any(|v| v.error() == Some(self.error)),
        }
    }

    /// Why an expression that comes to the error does.
    fn cause(&mut self, expr: &'a Expr) -> Option<Json> {
        match expr {
            Expr::Error(_) => Some(json!({"kind": "errorIsWritten"})),
            Expr::Reference(i) => {
                let Some(place) = self.place(*i) else {
                    return Some(json!({"kind": "cellsAreGone"}));
                };
                let (row, column) = self.cell_with_the_error(place)?;
                Some(json!({"kind": "showsTheSameError", "cell": self.cell(place.sheet, row, column)}))
            }
            Expr::Name(name) => {
                if let Some(&(_, value)) = self.bound.iter().rev().find(|(n, _)| n == name) {
                    return self.cause(value);
                }
                match functions::find(name) {
                    Some(id) => Some(json!({"kind": "functionWithoutParentheses", "function": id.name()})),
                    // A cell past the sheet's end, its address in capitals.
                    None if crate::formula::parse::looks_like_a_cell(name) => {
                        Some(json!({"kind": "noSuchCell", "address": name.to_ascii_uppercase()}))
                    }
                    None => Some(json!({"kind": "unknownName", "name": self.as_written(name)})),
                }
            }
            Expr::Call { function: None, name, arguments, .. } if name.as_ref() == "PIVOT" => self.pivot(arguments),
            Expr::Call { function: None, name, .. } => Some(json!({"kind": "noSuchFunction", "name": &**name})),
            Expr::Call { function: Some(id), arguments, .. } => self.call(expr, *id, arguments),
            Expr::Unary(op, operand) => self.operands(&[operand], *op != UnaryOp::Plus),
            Expr::Binary(op, a, b) => {
                let arithmetic = matches!(
                    op,
                    BinaryOp::Add | BinaryOp::Subtract | BinaryOp::Multiply | BinaryOp::Divide | BinaryOp::Power
                );
                if let Some(cause) = self.operands(&[a, b], arithmetic) {
                    return Some(cause);
                }
                if *op == BinaryOp::Divide && self.error == CellError::DivideByZero {
                    return self.divisor(b);
                }
                None
            }
            _ => None,
        }
    }

    /// Why operands, in order, make the error: one comes to it, or holds text where a number is needed. `Some` only
    /// when the cause is told; an operand that makes the error without one leaves it untold.
    fn operands(&mut self, operands: &[&'a Expr], need_numbers: bool) -> Option<Json> {
        for &operand in operands {
            let value = match self.calculation.eval(self.f, operand) {
                Operand::Value(v) => v,
                Operand::Range(place) if place.is_single() => {
                    self.calculation.cell_value(place.sheet, place.top, place.left)
                }
                Operand::Array(a) | Operand::Values(a) if a.is_single() => a.get(0, 0).clone(),
                _ => {
                    if self.has_the_error(operand) {
                        return self.cause(operand);
                    }
                    continue;
                }
            };
            match value {
                Value::Error(e) if e == self.error => return self.cause(operand),
                Value::Error(_) => return None,
                Value::Text(_) if need_numbers && coerce::to_number(&value, self.calculation.locale).is_err() => {
                    return self.holds_text(operand);
                }
                _ => {}
            }
        }
        None
    }

    /// A cell named that holds text where a number is needed.
    fn holds_text(&mut self, expr: &Expr) -> Option<Json> {
        let Expr::Reference(i) = expr else {
            return None;
        };
        let place = self.place(*i).filter(Place::is_single)?;
        Some(json!({"kind": "holdsTextWhereANumberIsNeeded", "cell": self.cell(place.sheet, place.top, place.left)}))
    }

    /// Why a division is by zero: a 0 written, or a cell that is blank or holds 0.
    fn divisor(&mut self, divisor: &Expr) -> Option<Json> {
        match divisor {
            Expr::Number(n) if *n == 0.0 => Some(json!({"kind": "dividesByAWrittenZero"})),
            Expr::Reference(i) => {
                let place = self.place(*i).filter(Place::is_single)?;
                let cell = self.cell(place.sheet, place.top, place.left);
                match self.calculation.cell_value(place.sheet, place.top, place.left) {
                    Value::Blank => Some(json!({"kind": "isBlankAndDividedBy", "cell": cell})),
                    Value::Number(n) if n == 0.0 => Some(json!({"kind": "isZeroAndDividedBy", "cell": cell})),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Why a PIVOT comes to the error: arguments it does not take, an argument that comes to it, a word
    /// it does not read, no total, columns with several totals, or fields of different sizes.
    fn pivot(&mut self, arguments: &'a [Expr]) -> Option<Json> {
        use crate::formula::pivot::{count_of_arguments, Formula, NotRead};
        if let Some(cause) = count_of_arguments(arguments.len()) {
            return (self.error == CellError::NotAvailable).then_some(cause);
        }
        for (i, argument) in arguments.iter().enumerate() {
            if crate::evaluate::pivot::pivot_works_out(i, argument, arguments) && self.has_the_error(argument) {
                return self.cause(argument);
            }
        }
        let (read, worked) = self.calculation.pivot_read(self.f, arguments).ok()?;
        match Formula::read_telling_why(&read) {
            Ok(formula) => {
                // Fields of cells and fields written or worked out as arrays alike.
                let own = self.calculation.formulas[self.f].places.len();
                let sizes = formula
                    .columns_used()
                    .map(|i| match i.checked_sub(own) {
                        None => self.place(i).map(|p| (p.rows(), p.columns())),
                        Some(k) => worked.get(k).map(|field| (field.rows(), field.columns())),
                    })
                    .collect::<Option<Vec<_>>>()?;
                let differ = sizes.iter().all(|&(_, columns)| columns == 1) && sizes.iter().any(|&(rows, _)| rows != sizes[0].0);
                (self.error == CellError::Value && differ).then(|| json!({"kind": "rangesOfDifferentSizes", "function": "PIVOT"}))
            }
            Err((error, _)) if error != self.error => None,
            Err((_, NotRead::Word(word))) => Some(json!({"kind": "wordIsNotRead", "function": "PIVOT", "word": word})),
            Err((_, NotRead::TotalsNothing)) => Some(json!({"kind": "pivotTotalsNothing"})),
            Err((_, NotRead::WithColumnsTotalsSeveral)) => Some(json!({"kind": "pivotWithColumnsTotalsSeveral"})),
            Err((_, NotRead::SeveralValues)) => {
                Some(json!({"kind": "severalCellsForOneValue", "function": "PIVOT", "argument": "use"}))
            }
            Err((_, NotRead::Other)) => None,
        }
    }

    /// Why a call of a known function comes to the error.
    fn call(&mut self, call: &'a Expr, id: FunctionId, arguments: &'a [Expr]) -> Option<Json> {
        let description = id.description();
        let Some(slots) = functions::match_arguments(description, arguments.len()) else {
            return (self.error == CellError::NotAvailable).then(|| count_of_arguments(description, arguments.len()))?;
        };
        match description.name {
            "LET" => return self.let_(arguments),
            "FILTER" => return self.filter(arguments),
            _ => {}
        }
        for (expr, slot) in arguments.iter().zip(&slots) {
            match (expr, slot.takes) {
                (Expr::Missing, _) | (_, Takes::AName) => continue,
                // Only where the reference points is read.
                (Expr::Reference(i), Takes::OnlyThePlace) => {
                    if self.place(*i).is_none() && self.error == CellError::Reference {
                        return Some(json!({"kind": "cellsAreGone"}));
                    }
                    continue;
                }
                _ => {}
            }
            if slot.takes == Takes::SeveralCells && slot.error_in_it == ErrorInIt::MayBePassedOver {
                // Of cells whose errors the call may pass over, the one whose error it answers; an error written as
                // one value is the answer.
                match self.calculation.eval(self.f, expr) {
                    Operand::Range(place) => {
                        if let Some((row, column)) = self.cell_answered(call, place) {
                            let cell = self.cell(place.sheet, row, column);
                            return Some(json!({"kind": "showsTheSameError", "cell": cell}));
                        }
                    }
                    Operand::Value(v) if v == Value::Error(self.error) => return self.cause(expr),
                    _ => {}
                }
                continue;
            }
            if self.has_the_error(expr) {
                return self.cause(expr);
            }
        }
        if self.error == CellError::Value && SIZED_ALIKE.contains(&description.name) {
            let mut sizes = arguments.iter().zip(&slots).filter(|(_, slot)| slot.takes == Takes::SeveralCells);
            let first = sizes.next().map(|(expr, _)| self.size(expr));
            if sizes.any(|(expr, _)| Some(self.size(expr)) != first) {
                return Some(json!({"kind": "rangesOfDifferentSizes", "function": description.name}));
            }
        }
        if self.error == CellError::NotAvailable && LOOKUPS.contains(&description.name) {
            return Some(json!({"kind": "lookupFindsNothing", "function": description.name}));
        }
        None
    }

    /// The first of a range's cells, row by row, whose error a call answers: given another error, the call comes
    /// to that one.
    fn cell_answered(&mut self, call: &Expr, place: Place) -> Option<(usize, usize)> {
        let other = if self.error == CellError::Number { CellError::Null } else { CellError::Number };
        for r in place.top..=place.bottom {
            for c in place.left..=place.right {
                if self.calculation.cell_value(place.sheet, r, c) != Value::Error(self.error) {
                    continue;
                }
                let slots = &mut self.calculation.grids[place.sheet].slots;
                let was = slots.insert((r, c), Slot::Constant(Value::Error(other)));
                let answer = self.calculation.eval(self.f, call);
                let answers_the_other = self.comes_to(answer, other);
                let slots = &mut self.calculation.grids[place.sheet].slots;
                match was {
                    Some(slot) => slots.insert((r, c), slot),
                    None => slots.remove(&(r, c)),
                };
                if answers_the_other {
                    return Some((r, c));
                }
            }
        }
        None
    }

    /// Whether an operand is an error, or cells one of which is it.
    fn comes_to(&mut self, operand: Operand, error: CellError) -> bool {
        match operand {
            Operand::Value(v) => v == Value::Error(error),
            Operand::Range(place) => {
                let values = self.calculation.range_values(place);
                let found = values.values().any(|v| v.error() == Some(error));
                found
            }
            Operand::Array(a) | Operand::Values(a) => a.values().any(|v| v.error() == Some(error)),
        }
    }

    /// The rows and columns an expression comes to.
    fn size(&mut self, expr: &Expr) -> (usize, usize) {
        match self.calculation.eval(self.f, expr) {
            Operand::Value(_) => (1, 1),
            Operand::Range(place) => (place.rows(), place.columns()),
            Operand::Array(a) | Operand::Values(a) => (a.rows(), a.columns()),
        }
    }

    /// Why a FILTER comes to the error: a range that is one value, the error (as `=FILTER(#REF!,TRUE)`; not a name
    /// nobody knows), its conditions do not fit its range, or keep none of it. An error in a condition, or in what
    /// the range holds, is not told.
    fn filter(&mut self, arguments: &'a [Expr]) -> Option<Json> {
        let range = self.calculation.eval(self.f, &arguments[0]);
        if matches!(range, Operand::Value(v) if v == Value::Error(self.error)) {
            return (!matches!(arguments[0], Expr::Name(_))).then(|| self.cause(&arguments[0])).flatten();
        }
        let description = functions::description_of("FILTER")?;
        let names = |i: usize| description.arguments[i].name;
        let n = arguments.len();
        let (rows, columns) = self.size(&arguments[0]);
        // The last of three or more arguments is "if empty" when it is one value other than a boolean.
        let last_is_if_empty = n >= 3 && self.size(&arguments[n - 1]) == (1, 1) && {
            let last = self.calculation.eval(self.f, &arguments[n - 1]);
            !matches!(self.calculation.one_value(last), Value::Boolean(_))
        };
        let includes = &arguments[1..n - usize::from(last_is_if_empty)];
        let several = includes.len() > 1;
        // Each condition is a column as tall as the range, or a row as wide; all of them the one or the other.
        let mut by_column = None;
        for include in includes {
            let this = match self.size(include) {
                (r, 1) if r == rows => Some(false),
                (1, c) if c > 1 && c == columns => Some(true),
                _ => None,
            };
            if this.is_none() || by_column.is_some_and(|b| Some(b) != this) {
                return (self.error == CellError::Value).then(|| {
                    json!({
                        "kind": "conditionsDoNotFitTheRange",
                        "function": description.name,
                        "range": names(0),
                        "condition": names(1),
                        "hasSeveralConditions": several,
                        "canBeARow": columns > 1 || rows == 1,
                    })
                });
            }
            by_column = this;
        }
        if self.error != CellError::NotAvailable {
            return None;
        }
        for include in includes {
            let operand = self.calculation.eval(self.f, include);
            let values = match operand {
                Operand::Value(v) => vec![v],
                Operand::Range(place) => self.calculation.range_values(place).values().cloned().collect(),
                Operand::Array(a) | Operand::Values(a) => a.values().cloned().collect(),
            };
            if values.iter().any(|v| v.error().is_some()) {
                return None;
            }
        }
        Some(json!({
            "kind": "filterKeepsNothing",
            "function": description.name,
            "argumentToAdd": names(2),
            "hasSeveralConditions": several,
        }))
    }

    /// Why a LET comes to the error: its formula, with the values its names are given.
    fn let_(&mut self, arguments: &'a [Expr]) -> Option<Json> {
        let (scopes, bound) = (self.calculation.scopes.len(), self.bound.len());
        let (pairs, formula) = arguments.split_at(arguments.len() - 1);
        let mut cause = None;
        let mut named = true;
        for pair in pairs.chunks(2) {
            let (Expr::Name(name), [_, value]) = (&pair[0], pair) else {
                named = false;
                break;
            };
            let operand = self.calculation.eval(self.f, value);
            let (brought, link) = (self.calculation.brought.take(), self.calculation.link.take());
            self.calculation.scopes.push((name.clone(), operand, brought, link));
            self.bound.push((name.clone(), value));
        }
        if named && self.has_the_error(&formula[0]) {
            cause = self.cause(&formula[0]);
        }
        self.calculation.scopes.truncate(scopes);
        self.bound.truncate(bound);
        cause
    }

    /// A name as the formula writes it (it is kept in capitals).
    fn as_written(&self, name: &str) -> String {
        for piece in self.written {
            let mut in_quotes = false;
            let mut word = String::new();
            for ch in piece.chars().chain([' ']) {
                if ch == '"' {
                    in_quotes = !in_quotes;
                }
                if !in_quotes && (ch.is_alphanumeric() || ch == '_' || ch == '.' || ch == '\\') {
                    word.push(ch);
                    continue;
                }
                if !word.is_empty() && word.to_uppercase() == name {
                    return word;
                }
                word.clear();
            }
        }
        name.to_owned()
    }
}

/// Why a call with a number of arguments the function does not take comes to #N/A: the first argument missing, too
/// many, or half of a pair of arguments that repeat.
fn count_of_arguments(description: &Description, given: usize) -> Option<Json> {
    let (name, arguments) = (description.name, description.arguments);
    let missing = |argument: &functions::Argument| {
        json!({"kind": "argumentIsMissing", "function": name, "argument": argument.name})
    };
    let Some(start) = arguments.iter().position(|a| a.repeats) else {
        if given > arguments.len() {
            let takes_no_fewer = arguments.iter().all(|a| !a.is_optional);
            return Some(json!({
                "kind": "tooManyArguments",
                "function": name,
                "most": arguments.len(),
                "given": given,
                "takesNoFewer": takes_no_fewer,
            }));
        }
        return arguments.get(given).map(missing);
    };
    let length = arguments[start..].iter().take_while(|a| a.repeats).count();
    let (prefix, rest) = arguments.split_at(start);
    let (group, suffix) = rest.split_at(length);
    if given < prefix.len() {
        return Some(missing(&prefix[given]));
    }
    if given - prefix.len() < group.len() {
        return Some(missing(&group[given - prefix.len()]));
    }
    if let Some(required) = suffix.iter().find(|a| !a.is_optional) {
        return Some(missing(required));
    }
    match group {
        [first, second, ..] => {
            Some(json!({"kind": "pairIsIncomplete", "function": name, "first": first.name, "second": second.name}))
        }
        _ => None,
    }
}
