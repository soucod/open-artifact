//! The number format a formula brings from what it reads (`numberFormatBrought`): a formula whose cell has no number
//! format of its own shows its number the way the cells it reads show theirs. `=A1` with A1 a currency is a currency;
//! `=A1+1` with A1 a date is a date; `=SUM(B1:B3)` brings B1's format; `=DATE(2020,1,2)` is a date.
//!
//! A cell brings its own pattern when it holds a number (or a formula) and the pattern is neither `General` itself
//! nor for text (`[Red]General` and `general` bring theirs, as plain numbers); a formula without a pattern of its own brings what its formula brings. A range brings its first cell's.
//! Operators put two together (a date and a number make a date, two times a duration, a currency and a percent
//! nothing); the functions that keep their arguments' kind of number (SUM, ROUND, MAX, FILTER…) bring their first
//! argument's, or the first that brings anything; those that make a date or a time bring one of their own; the rest
//! nothing. What a formula's cell brings is kept only when its answer is a number.

use std::rc::Rc;

use crate::formula::BinaryOp;
use crate::number_format::{Kind, NumberFormat};

/// A number format brought: its kind, and the pattern.
#[derive(Clone, Debug, PartialEq)]
pub struct Brought {
    pub kind: Kind,
    pub pattern: Rc<str>,
}

/// The pattern a date and a time put together bring.
const DATE_AND_TIME: &str = "m/d h:mm";
/// The pattern two times put together bring, and a sum of times.
const DURATION: &str = "[h]:mm";
/// The pattern the functions that make a date bring, in every locale (the page shows it the locale's way).
const DATE: &str = "m/d/yyyy";

impl Brought {
    /// What a cell's pattern brings: nothing for `General` (spelled just so), or one for text.
    pub fn of_pattern(pattern: &str) -> Option<Brought> {
        if pattern == "General" {
            return None;
        }
        match NumberFormat::parse(pattern).ok()?.kind() {
            Kind::Text => None,
            kind => Some(Brought { kind, pattern: pattern.into() }),
        }
    }

    fn new(kind: Kind, pattern: &str) -> Brought {
        Brought { kind, pattern: pattern.into() }
    }
}

/// Kinds as operators see them: the plain numbers (General, a number, in scientific notation, or as a fraction) are
/// one.
#[derive(Clone, Copy, PartialEq)]
enum Class {
    Nothing,
    Plain,
    Percent,
    Currency,
    Date,
    Time,
    DateAndTime,
    Duration,
}

fn class(b: Option<&Brought>) -> Class {
    match b.map(|b| b.kind) {
        None | Some(Kind::Text) => Class::Nothing,
        Some(Kind::General | Kind::Number | Kind::Scientific | Kind::Fraction) => Class::Plain,
        Some(Kind::Percent) => Class::Percent,
        Some(Kind::Currency) => Class::Currency,
        Some(Kind::Date) => Class::Date,
        Some(Kind::Time) => Class::Time,
        Some(Kind::DateAndTime) => Class::DateAndTime,
        Some(Kind::Duration) => Class::Duration,
    }
}

/// What an operator brings from its two sides.
pub fn of_operator(op: BinaryOp, a: Option<&Brought>, b: Option<&Brought>) -> Option<Brought> {
    match op {
        BinaryOp::Add => sum(a, b, false),
        BinaryOp::Subtract => sum(a, b, true),
        BinaryOp::Multiply => product(a, b),
        BinaryOp::Divide => quotient(a, b),
        _ => None,
    }
}

/// `a + b`, or `a - b`. Nothing on one side brings the other's (though nothing minus a date or a time is no date);
/// a date or a time and a plain number make a date or a time (a plain number minus one, nothing); a date and a time
/// make a date with a time (a time minus a date, nothing); two times a duration; two dates nothing; a currency or a
/// percent with a plain number stays one; anything else of one kind keeps the first's pattern. A duration goes with a
/// date as a time does, but a plain number minus one is a duration, and with a time it is the time (a duration minus
/// a time, the duration).
fn sum(a: Option<&Brought>, b: Option<&Brought>, subtract: bool) -> Option<Brought> {
    use Class::*;
    let keep = |x: Option<&Brought>| x.cloned();
    let date_and_time = || Some(Brought::new(Kind::DateAndTime, DATE_AND_TIME));
    match (class(a), class(b)) {
        (_, Nothing) => keep(a),
        (Nothing, Date | Time | DateAndTime) if subtract => None,
        (Nothing, _) => keep(b),
        (Date | DateAndTime, Date | DateAndTime) => None,
        (Time, Time) => Some(Brought::new(Kind::Duration, DURATION)),
        (Date, Time | Duration) => date_and_time(),
        (Time | Duration, Date) => if subtract { None } else { date_and_time() },
        (DateAndTime, Time | Duration) => keep(a),
        (Time | Duration, DateAndTime) => if subtract { None } else { keep(b) },
        (Time, Duration) => keep(a),
        (Duration, Time) => if subtract { keep(a) } else { keep(b) },
        (Date | Time | DateAndTime | Duration, Plain) => keep(a),
        (Plain, Duration) => keep(b),
        (Plain, Date | Time | DateAndTime) => if subtract { None } else { keep(b) },
        (Currency | Percent, Plain) => keep(a),
        (Plain, Currency | Percent) => keep(b),
        (x, y) if x == y => keep(a),
        _ => None,
    }
}

/// `a * b`: a currency times nothing, a plain number or a percent stays a currency; a percent times a percent a
/// percent; anything else nothing.
fn product(a: Option<&Brought>, b: Option<&Brought>) -> Option<Brought> {
    use Class::*;
    match (class(a), class(b)) {
        (Currency, Nothing | Plain | Percent) | (Percent, Percent) => a.cloned(),
        (Nothing | Plain | Percent, Currency) => b.cloned(),
        _ => None,
    }
}

/// `a / b`: a currency over nothing, a plain number or a percent stays a currency; a percent over nothing or a plain
/// number a percent; anything else nothing.
fn quotient(a: Option<&Brought>, b: Option<&Brought>) -> Option<Brought> {
    use Class::*;
    match (class(a), class(b)) {
        (Currency, Nothing | Plain | Percent) | (Percent, Nothing | Plain) => a.cloned(),
        _ => None,
    }
}

/// What a sum brings of what its numbers bring: a sum of dates is no date, of times a duration.
pub(crate) fn summed(b: Option<Brought>) -> Option<Brought> {
    match class(b.as_ref()) {
        Class::Date | Class::DateAndTime => None,
        Class::Time => Some(Brought::new(Kind::Duration, DURATION)),
        _ => b,
    }
}

/// What a call brings, from what each of its arguments brings (`None` for one left out or not brought), the first
/// argument's value when it is a number (SUBTOTAL's function), and the locale's pattern of a time of day.
pub fn of_call(name: &str, arguments: &[Option<Brought>], first: Option<f64>, time_of_day: &str) -> Option<Brought> {
    let first_brought = || arguments.iter().flatten().next().cloned();
    let first_argument = || arguments.first().cloned().flatten();
    match name {
        "SUM" => summed(first_brought()),
        "AVERAGE" | "AVERAGEA" | "MAX" | "MAXA" | "MIN" | "MINA" | "MEDIAN" | "MODE" | "MODE.SNGL" | "GEOMEAN"
        | "HARMEAN" => first_brought(),
        "ABS" | "CEILING" | "FLOOR" | "INT" | "MROUND" | "ROUND" | "ROUNDDOWN" | "ROUNDUP" | "TRUNC" | "FILTER"
        | "SORT" | "SORTN" | "UNIQUE" | "TRANSPOSE" | "HSTACK" | "VSTACK" | "AVERAGEIF" | "AVERAGEIFS" | "MAXIFS"
        | "MINIFS" | "LARGE" | "SMALL" | "PERCENTILE" | "PERCENTILE.INC" | "QUARTILE" | "QUARTILE.INC" | "TRIMMEAN"
        | "PERCENTILE.EXC" | "QUARTILE.EXC" | "AVERAGE.WEIGHTED" | "INTERCEPT" => first_argument(),
        // FORECAST(x, known y, known x): what the known y bring.
        "FORECAST" | "FORECAST.LINEAR" => arguments.get(1).cloned().flatten(),
        "SUMIFS" => summed(first_argument()),
        // HYPERLINK(link, [text]): what its text brings.
        "HYPERLINK" => arguments.get(1).cloned().flatten(),
        // SUMIF(range, criterion, [sum range]): what the sum range brings, else the range.
        "SUMIF" => summed(match arguments.get(2) {
            Some(_) => arguments[2].clone(),
            None => first_argument(),
        }),
        // SUBTOTAL(function, ranges…): as the function its number names.
        "SUBTOTAL" => match first.map(|n| n.trunc() as i64 % 100) {
            Some(1 | 4 | 5) => arguments[1..].iter().flatten().next().cloned(),
            Some(9) => summed(arguments[1..].iter().flatten().next().cloned()),
            _ => None,
        },
        // COUPNCD(settlement, …), COUPPCD(settlement, …): the settlement's pattern when it is a date's.
        "COUPNCD" | "COUPPCD" => {
            first_argument().filter(|b| b.kind == Kind::Date).or_else(|| Some(Brought::new(Kind::Date, DATE)))
        }
        "DATE" | "DATEVALUE" | "EDATE" | "EOMONTH" | "TODAY" | "WORKDAY" | "WORKDAY.INTL" | "TO_DATE" => {
            Some(Brought::new(Kind::Date, DATE))
        }
        "NOW" | "EPOCHTODATE" => Some(Brought::new(Kind::DateAndTime, DATE_AND_TIME)),
        "TIME" | "TIMEVALUE" => Some(Brought::new(Kind::Time, time_of_day)),
        _ => None,
    }
}
