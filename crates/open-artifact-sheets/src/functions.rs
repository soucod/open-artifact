//! The functions a formula may call.
//!
//! Every function has a description (`description.rs`): its family, its arguments and what it answers. The
//! evaluator prepares a call's arguments from the description before the function sees them:
//!
//! - an argument that takes **one value** is evaluated to one value; a range or array of more than one cell in its
//!   place is #VALUE!;
//! - one that takes **several cells** keeps its range or array (`Arg::Cells`); operators in it work cell by cell;
//! - one that takes **only the place** (ROW, ROWS, …) is where its reference points, not what is there;
//! - when an error in an argument **is the answer**, the call answers the first such error and the function is
//!   never called (in a range of several cells, the first error row by row);
//! - an argument of several cells whose errors **may be passed over** must be given (left out, the call is #VALUE!),
//!   and an error written as its one value is the answer;
//! - a call with too few or too many arguments answers #N/A.
//!
//! The functions whose arguments may never be read (IF, IFERROR, IFNA, IFS, SWITCH, CHOOSE, LET) are not here:
//! the evaluator works them out itself (`evaluate.rs`), reading only the arguments it needs.

pub mod arrays_and_tests;
pub mod bonds;
pub mod database;
pub mod date_and_time;
pub mod description;
pub mod distributions;
pub mod financial;
pub mod logical;
pub mod lookup;
pub mod math;
pub mod more_math;
pub mod more_statistical;
pub mod statistical;
pub mod text;

/// The function groups added later, each in a module of its own: `call` and `early_reads`.
type Call = fn(&str, &[Arg], &mut CallContext) -> Option<Answer>;
const ADDED: [(Call, fn(&str) -> Option<&'static str>); 6] = [
    (more_math::call, more_math::early_reads),
    (database::call, database::early_reads),
    (distributions::call, distributions::early_reads),
    (more_statistical::call, more_statistical::early_reads),
    (bonds::call, bonds::early_reads),
    (arrays_and_tests::call, arrays_and_tests::early_reads),
];

use std::rc::Rc;

use serde::Serialize;

use crate::coerce;
use crate::evaluate::{Operand, Place};
use crate::locale::Locale;
use crate::value::{Array, CellError, Value};

pub use description::{description_of, Answers, Argument, Description, ErrorInIt, Takes, DESCRIPTIONS};

/// The families the formula help groups the functions in, in its order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Family {
    Math,
    Statistical,
    Logical,
    Lookup,
    Text,
    DateAndTime,
    Financial,
}

impl Family {
    pub const ALL: &'static [Family] = &[
        Family::Math,
        Family::Statistical,
        Family::Logical,
        Family::Lookup,
        Family::Text,
        Family::DateAndTime,
        Family::Financial,
    ];
}

/// A function, by its place in [`DESCRIPTIONS`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FunctionId(pub u16);

impl FunctionId {
    pub fn description(self) -> &'static Description {
        &DESCRIPTIONS[self.0 as usize]
    }

    pub fn name(self) -> &'static str {
        self.description().name
    }
}

/// The function a name calls, in any case.
pub fn find(name: &str) -> Option<FunctionId> {
    let upper = name.to_ascii_uppercase();
    DESCRIPTIONS.binary_search_by(|d| d.name.cmp(upper.as_str())).ok().map(|i| FunctionId(i as u16))
}

/// What a call answers: a value, or a range, an array or part of an argument; or an error.
pub type Answer = Result<Operand, CellError>;

/// One argument, prepared as the function's description says.
#[derive(Clone, Debug)]
pub enum Arg {
    /// An argument left out: `ROUND(1.5,)`, or `SUM(1,,2)`'s second.
    Missing,
    /// One value: what a `oneValue` argument always is, and a `severalCells` one written as one value (`SUM(1,"2")`).
    Value(Value),
    /// A range or an array, for a `severalCells` argument.
    Cells(Cells),
    /// Where an `onlyThePlace` argument points: a range's place, or an array's size.
    Place(Shape),
}

/// The cells of a range, or an array's values, row by row.
#[derive(Clone, Debug)]
pub struct Cells {
    pub array: Rc<Array>,
    /// Where the cells are, when they are a range's (an array has no place).
    pub place: Option<Place>,
}

impl Cells {
    pub fn rows(&self) -> usize {
        self.array.rows()
    }

    pub fn columns(&self) -> usize {
        self.array.columns()
    }

    pub fn get(&self, row: usize, column: usize) -> &Value {
        self.array.get(row, column)
    }

    pub fn values(&self) -> impl ExactSizeIterator<Item = &Value> + '_ {
        self.array.values()
    }

    pub fn is_range(&self) -> bool {
        self.place.is_some()
    }

    /// Part of these cells (rows `top..top+rows`, columns `left..left+columns`): a range of a range, else an array.
    pub fn part(&self, top: usize, left: usize, rows: usize, columns: usize) -> Operand {
        if rows == 1 && columns == 1 {
            if let Some(place) = self.place {
                return Operand::Range(place.part(top, left, 1, 1));
            }
            return Operand::Value(self.get(top, left).clone());
        }
        match self.place {
            Some(place) => Operand::Range(place.part(top, left, rows, columns)),
            None => {
                let mut values = Vec::with_capacity(rows * columns);
                for r in top..top + rows {
                    for c in left..left + columns {
                        values.push(self.get(r, c).clone());
                    }
                }
                Operand::Values(Rc::new(Array::new(rows, columns, values)))
            }
        }
    }
}

/// The size of what an `onlyThePlace` argument points at, and where it is when it is a range.
#[derive(Clone, Copy, Debug)]
pub struct Shape {
    pub rows: usize,
    pub columns: usize,
    pub place: Option<Place>,
}

impl Arg {
    pub fn is_missing(&self) -> bool {
        matches!(self, Arg::Missing)
    }

    /// The argument's one value: a left-out argument is blank, cells are #VALUE!.
    pub fn value(&self) -> Result<Value, CellError> {
        match self {
            Arg::Missing => Ok(Value::Blank),
            Arg::Value(v) => Ok(v.clone()),
            Arg::Cells(cells) if cells.array.is_single() => Ok(cells.get(0, 0).clone()),
            Arg::Cells(_) | Arg::Place(_) => Err(CellError::Value),
        }
    }

    /// The argument as a number (text is read as typed in the locale, `TRUE` is 1, blank is 0).
    pub fn number(&self, locale: &Locale) -> Result<f64, CellError> {
        coerce::to_number(&self.value()?, locale)
    }

    /// The argument as a number, or `default` when it was left out.
    pub fn number_or(&self, default: f64, locale: &Locale) -> Result<f64, CellError> {
        if self.is_missing() {
            Ok(default)
        } else {
            self.number(locale)
        }
    }

    /// The argument as text (a number as the locale writes it).
    pub fn text(&self, locale: &Locale) -> Result<Rc<str>, CellError> {
        coerce::to_text(&self.value()?, locale)
    }

    pub fn boolean(&self) -> Result<bool, CellError> {
        coerce::to_boolean(&self.value()?)
    }

    pub fn boolean_or(&self, default: bool) -> Result<bool, CellError> {
        if self.is_missing() {
            Ok(default)
        } else {
            self.boolean()
        }
    }

    /// The argument's cells: a range or an array as it is, one value as an array of one.
    pub fn cells(&self) -> Cells {
        match self {
            Arg::Cells(cells) => cells.clone(),
            Arg::Value(v) => Cells { array: Rc::new(Array::single(v.clone())), place: None },
            Arg::Missing | Arg::Place(_) => Cells { array: Rc::new(Array::single(Value::Blank)), place: None },
        }
    }
}

/// Where a call is made from, and what it may ask of the world.
pub struct CallContext<'a> {
    /// The cell whose formula makes the call.
    pub cell: Place,
    /// The workbook's time, in days since 1899-12-30 in the workbook's time zone; `None` when not known (NOW() and
    /// TODAY() are then #N/A).
    pub now: Option<f64>,
    /// Random numbers for RAND and RANDBETWEEN.
    pub random: &'a mut dyn FnMut() -> f64,
    /// The workbook's locale: text is read as a number, and a number written as text, as it writes them.
    pub locale: &'static Locale,
    /// Where each value of what a function that picks cells of its arguments (SORT, FILTER, INDEX of an array…)
    /// answers came from, left for the evaluator to work out what each value brings.
    pub sources: Option<Sources>,
}

/// For each value of an array (row by row), the argument and the cell of it (row, column) it was picked from, or
/// `None` for one made (the #N/A that fills out a stack).
pub type Sources = Vec<Option<(usize, usize, usize)>>;

/// A call's argument list against its description: which description argument each given argument is.
/// `None` when there are too few or too many (the call answers #N/A).
pub fn match_arguments(description: &Description, given: usize) -> Option<Vec<&'static Argument>> {
    let arguments: &'static [Argument] = description.arguments;
    let group_start = arguments.iter().position(|a| a.repeats);
    let Some(group_start) = group_start else {
        let required = arguments.iter().filter(|a| !a.is_optional).count();
        if given < required || given > arguments.len() {
            return None;
        }
        return Some(arguments[..given].iter().collect());
    };
    let group_len = arguments[group_start..].iter().take_while(|a| a.repeats).count();
    let prefix = &arguments[..group_start];
    let group = &arguments[group_start..group_start + group_len];
    let suffix = &arguments[group_start + group_len..];
    let prefix_required = prefix.iter().filter(|a| !a.is_optional).count();
    let suffix_required = suffix.iter().filter(|a| !a.is_optional).count();
    // The prefix is given in full when the group is (its optional arguments before a group cannot be left out by
    // count alone); the group at least once; the suffix as far as it goes.
    let _ = prefix_required;
    if given < prefix.len() + group_len + suffix_required {
        return None;
    }
    let after_prefix = given - prefix.len();
    // As many whole groups as leave a suffix that fits.
    let mut groups = after_prefix / group_len;
    loop {
        if groups == 0 {
            return None;
        }
        let rest = after_prefix - groups * group_len;
        if rest >= suffix_required && rest <= suffix.len() {
            let mut out: Vec<&'static Argument> = prefix.iter().collect();
            for _ in 0..groups {
                out.extend(group.iter());
            }
            out.extend(suffix[..rest].iter());
            return Some(out);
        }
        groups -= 1;
    }
}

/// Calls a function with its prepared arguments.
pub fn call(id: FunctionId, args: &[Arg], cx: &mut CallContext) -> Answer {
    let description = id.description();
    let name = description.name;
    let answer = match description.family {
        Family::Math => math::call(name, args, cx),
        Family::Statistical => statistical::call(name, args, cx),
        Family::Logical => logical::call(name, args, cx),
        Family::Lookup => lookup::call(name, args, cx),
        Family::Text => text::call(name, args, cx),
        Family::DateAndTime => date_and_time::call(name, args, cx),
        Family::Financial => financial::call(name, args, cx),
    };
    let answer = answer.or_else(|| ADDED.iter().find_map(|(call, _)| call(name, args, cx)));
    answer.unwrap_or(Err(CellError::Name))
}

/// Checks an argument written as one value as soon as it is worked out, before the arguments after it. A
/// call's arguments are worked out in order and some read as they go, so a problem with one is the answer even when
/// an argument after it is an error: `ROUND("x",NA())` and `MID("abc",0,NA())` are #VALUE!, `DATE(-1,NA(),1)` is
/// #NUM!. Ranges and arrays are not read early.
pub fn check_early(id: FunctionId, index: usize, v: &Value, locale: &Locale) -> Result<(), CellError> {
    let reads = early_reads(id.description().name).as_bytes();
    let read = match reads.get(index) {
        Some(b'*') => reads[reads.len() - 2],
        Some(&read) => read,
        None if reads.last() == Some(&b'*') => reads[reads.len() - 2],
        None => b'.',
    };
    let at_least = |n: f64, least: f64, error: CellError| if n < least { Err(error) } else { Ok(()) };
    match read {
        b'n' => coerce::to_number(v, locale).map(|_| ()),
        b'b' => coerce::to_boolean(v).map(|_| ()),
        b'1' => at_least(coerce::to_number(v, locale)?, 1.0, CellError::Value),
        b'0' => at_least(coerce::to_number(v, locale)?, 0.0, CellError::Value),
        b'y' => at_least(coerce::to_number(v, locale)?, 0.0, CellError::Number),
        b'p' => at_least(coerce::to_number(v, locale)?, 1.0, CellError::Number),
        _ => Ok(()),
    }
}

/// How a function reads its arguments early, one letter each: `n` as a number, `b` as a boolean, `1` as a number
/// of 1 or more (else #VALUE!), `0` as one of 0 or more (else #VALUE!), `y` as a year (0 or more, else #NUM!), `p`
/// as a count of 1 or more (else #NUM!), `.` not until all are worked out. `*` repeats the letter before it for the arguments after; past the end, `.`.
fn early_reads(name: &str) -> &'static str {
    match name {
        "AND" | "OR" | "XOR" => "b*",
        "AVERAGE" | "AVERAGEA" | "MAX" | "MEDIAN" | "MIN" | "MODE" | "MODE.SNGL" | "NPV" | "PRODUCT" | "STDEV"
        | "STDEV.P" | "STDEV.S" | "STDEVP" | "SUM" | "SUMSQ" | "VAR" | "VAR.P" | "VAR.S" | "VARP" => "n*",
        "CEILING" | "DAYS" | "EDATE" | "EOMONTH" | "FLOOR" | "IRR" | "LARGE" | "LOG" | "MOD" | "MROUND" | "PERCENTILE"
        | "PERCENTILE.INC" | "POWER" | "QUARTILE" | "QUARTILE.INC" | "QUOTIENT" | "RANDBETWEEN" | "RANK" | "RANK.EQ"
        | "ROUND" | "ROUNDDOWN" | "ROUNDUP" | "SMALL" | "TRUNC" | "WEEKDAY" | "WEEKNUM" | "XNPV" => "n",
        "CUMIPMT" | "CUMPRINC" | "IPMT" | "PPMT" | "RATE" => "nnnnn",
        "DATE" => "yn",
        "DATEDIF" | "DAYS360" | "MIRR" | "NETWORKDAYS" | "SLN" | "TIME" | "WORKDAY" => "nn",
        "FV" | "NPER" | "PMT" | "PV" => "nnnn",
        "HLOOKUP" | "VLOOKUP" => "..1",
        "INDEX" => ".00",
        "MID" => ".1",
        "REPLACE" => ".10",
        "SORTN" | "XMATCH" => "..n",
        "SPLIT" => "..b",
        "SUBTOTAL" => "n.*",
        "TEXTJOIN" => ".b.*",
        "UNIQUE" => ".b",
        "XLOOKUP" => "....n",
        _ => ADDED.iter().find_map(|(_, reads)| reads(name)).unwrap_or(""),
    }
}

/// A number answer: one that is not finite is #NUM!.
pub fn number(n: f64) -> Answer {
    match Value::number(n) {
        Value::Error(e) => Err(e),
        v => Ok(Operand::Value(v)),
    }
}

pub fn text(s: impl Into<Rc<str>>) -> Answer {
    Ok(Operand::Value(Value::Text(s.into())))
}

pub fn boolean(b: bool) -> Answer {
    Ok(Operand::Value(Value::Boolean(b)))
}

pub fn value(v: Value) -> Answer {
    match v {
        Value::Error(e) => Err(e),
        v => Ok(Operand::Value(v)),
    }
}

/// An array answer (it spills).
pub fn array(a: Array) -> Answer {
    Ok(Operand::Array(Rc::new(a)))
}

/// The numbers of `severalCells` arguments, as SUM, AVERAGE, MAX and the like read them: in a range or an array
/// only numbers count (text, booleans and blanks are passed over); an argument written as one value is read as a
/// number (`SUM("3", TRUE)` is 4), and is #VALUE! when it does not read as one.
pub fn numbers_of(args: &[Arg], locale: &Locale) -> Result<Vec<f64>, CellError> {
    let mut out = Vec::new();
    for arg in args {
        match arg {
            Arg::Missing => {}
            Arg::Value(v) => out.push(coerce::to_number(v, locale)?),
            Arg::Cells(cells) => {
                for v in cells.values() {
                    match v {
                        Value::Number(n) => out.push(*n),
                        Value::Error(e) => return Err(*e),
                        _ => {}
                    }
                }
            }
            Arg::Place(_) => return Err(CellError::Value),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_functions() {
        assert_eq!(find("sum").map(FunctionId::name), Some("SUM"));
        assert_eq!(find("MODE.SNGL").map(FunctionId::name), Some("MODE.SNGL"));
        assert!(find("SEQUENCE").is_none());
    }

    #[test]
    fn matches_arguments() {
        let d = |n| find(n).unwrap().description();
        assert!(match_arguments(d("ABS"), 0).is_none());
        assert!(match_arguments(d("ABS"), 2).is_none());
        assert_eq!(match_arguments(d("ROUND"), 1).unwrap().len(), 1);
        assert!(match_arguments(d("SUM"), 0).is_none());
        assert_eq!(match_arguments(d("SUM"), 3).unwrap().len(), 3);
        // SWITCH(value, case, result, [default])
        let s = match_arguments(d("SWITCH"), 4).unwrap();
        assert_eq!(s[3].name, "default");
        let s = match_arguments(d("SWITCH"), 5).unwrap();
        assert_eq!(s[4].name, "result");
        assert!(match_arguments(d("SWITCH"), 2).is_none());
        // LET(name, value, formula)
        assert_eq!(match_arguments(d("LET"), 3).unwrap()[2].name, "formula");
        assert_eq!(match_arguments(d("LET"), 5).unwrap()[4].name, "formula");
        assert!(match_arguments(d("LET"), 4).is_none());
        // SUMIFS(sum range, condition range, condition, …)
        assert!(match_arguments(d("SUMIFS"), 4).is_none());
        assert_eq!(match_arguments(d("SUMIFS"), 5).unwrap().len(), 5);
    }
}
