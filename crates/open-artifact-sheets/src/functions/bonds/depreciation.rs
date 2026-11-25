//! Depreciation (DB, DDB, VDB, SYD) and rates (EFFECT, NOMINAL, PDURATION, RRI, FVSCHEDULE, ISPMT, DOLLARDE,
//! DOLLARFR).

use super::math::{declined, exp_m1, ln_1p, ln_ratio, max, min, periods_log, round};
use super::{answer, numbers};
use crate::coerce;
use crate::functions::{Answer, Arg};
use crate::locale::Locale;
use crate::value::{CellError, Value};

pub fn call(name: &str, args: &[Arg], locale: &Locale) -> Option<Answer> {
    let n = |defaults: &[f64]| numbers(args, defaults, locale);
    Some(match name {
        "DB" => n(&[0.0, 0.0, 0.0, 0.0, 12.0]).and_then(|n| fixed_declining(n[0], n[1], n[2], n[3], n[4])),
        "DDB" => n(&[0.0, 0.0, 0.0, 0.0, 2.0]).and_then(|n| double_declining(n[0], n[1], n[2], n[3], n[4])),
        "VDB" => n(&[0.0, 0.0, 0.0, 0.0, 0.0, 2.0]).and_then(|n| {
            let keep = args.get(6).map_or(Ok(false), |a| a.boolean())?;
            variable_declining(n[0], n[1], n[2], n[3], n[4], n[5], keep)
        }),
        "SYD" => n(&[0.0, 0.0, 0.0, 0.0]).and_then(|n| {
            let [cost, salvage, life, period] = n[..] else { unreachable!() };
            if !(period >= 1.0) || !(period <= life) {
                return Err(CellError::Number);
            }
            let x = ((life - period) + 1.0) * (cost - salvage);
            answer((x + x) / (life * (life + 1.0)))
        }),
        "EFFECT" => n(&[0.0, 0.0]).and_then(|n| {
            let [rate, per_year] = n[..] else { unreachable!() };
            if rate <= 0.0 || per_year < 1.0 {
                return Err(CellError::Number);
            }
            let per_year = per_year.trunc();
            answer(exp_m1(per_year * ln_1p(rate / per_year)))
        }),
        "NOMINAL" => n(&[0.0, 0.0]).and_then(|n| {
            let [rate, per_year] = n[..] else { unreachable!() };
            if rate <= 0.0 || per_year < 1.0 {
                return Err(CellError::Number);
            }
            let per_year = per_year.trunc();
            answer(per_year * exp_m1(ln_1p(rate) / per_year))
        }),
        "PDURATION" => n(&[0.0, 0.0, 0.0]).and_then(|n| {
            let [rate, present, future] = n[..] else { unreachable!() };
            if rate <= 0.0 || present <= 0.0 || future <= 0.0 {
                return Err(CellError::Number);
            }
            answer(ln_ratio(present, future) / ln_1p(rate))
        }),
        "RRI" => n(&[0.0, 0.0, 0.0]).and_then(|n| {
            let [periods, present, future] = n[..] else { unreachable!() };
            if periods <= 0.0 {
                return Err(CellError::Number);
            }
            answer(exp_m1(ln_ratio(present, future) / periods))
        }),
        "ISPMT" => n(&[0.0, 0.0, 0.0, 0.0]).and_then(|n| {
            let [rate, period, periods, present] = n[..] else { unreachable!() };
            if periods == 0.0 {
                return Err(CellError::DivideByZero);
            }
            answer(present * rate * ((period - periods) / periods))
        }),
        "DOLLARDE" | "DOLLARFR" => n(&[0.0, 0.0]).and_then(|n| dollar(n[0], n[1], name == "DOLLARDE")),
        "FVSCHEDULE" => future_value(args, locale),
        _ => return None,
    })
}

/// DB: the declining balance at a rate of `1 − (salvage/cost)^(1/life)` rounded to 3 places, the first year
/// `months` long (1 to 12) and the year after the life the rest of it.
fn fixed_declining(cost: f64, salvage: f64, life: f64, period: f64, months: f64) -> Answer {
    let months = months.trunc();
    let last = if months < 12.0 { life + 1.0 } else { life };
    if !(cost > 0.0) || !(salvage >= 0.0) || !(life > 0.0) || !(1.0..=12.0).contains(&months) || !(period >= 1.0)
        || !(period <= last)
    {
        return Err(CellError::Number);
    }
    let rate = round(-exp_m1(ln_ratio(cost, salvage) / life), 3);
    let first = months / 12.0 * (cost * rate);
    let period = period.trunc();
    if period < 2.0 {
        return answer(first);
    }
    let left = declined(cost - first, rate, period - 2.0);
    let part = if period > life { (12.0 - months) / 12.0 } else { 1.0 };
    answer(part * (rate * left))
}

/// DDB: the period's depreciation at `factor / life` of the value left (at most 1), never below the salvage.
fn double_declining(cost: f64, salvage: f64, life: f64, period: f64, factor: f64) -> Answer {
    if cost < 0.0 || salvage < 0.0 || factor <= 0.0 || !(period >= 1.0) || !(period <= life) {
        return Err(CellError::Number);
    }
    let rate = min(factor / life, 1.0);
    let before = declined(cost, rate, period - 1.0);
    answer(min(rate * before, max(coerce::add(before, -salvage), 0.0)))
}

/// VDB: declining balance from `start` to `end` (fractions of periods count in part), switching to straight line
/// over the life left from the first whole period where that is more (unless told to keep declining).
fn variable_declining(cost: f64, salvage: f64, life: f64, start: f64, end: f64, factor: f64, keep: bool) -> Answer {
    if !(start >= 0.0) || !(start <= end) || !(end <= life) || cost < 0.0 || salvage < 0.0 || !(life > 0.0)
        || factor <= 0.0
    {
        return Err(CellError::Number);
    }
    let rate = min(factor / life, 1.0);
    // Whether straight line has taken over by period `x`, or nothing is left to depreciate.
    let switched = |x: f64| {
        let value = cost * periods_log(rate, x).exp();
        let left = max(coerce::add(value, -salvage), 0.0);
        let declining = value * rate;
        if left <= declining {
            return true;
        }
        !keep && left / (life - x) > declining
    };
    // The first such period, by halving (the end, rounded up, when none).
    let mut high = end.ceil();
    let mut middle = ((high + 1.0) * 0.5 + -1.0).floor();
    if !(middle <= -1.0) && !(middle >= high) {
        let mut low = -1.0;
        loop {
            if switched(middle) {
                high = middle;
            } else {
                low = middle;
            }
            middle = (low + (high - low) * 0.5).floor();
            if middle <= low || !(middle < high) {
                break;
            }
        }
    }
    let part = declining_between(cost, rate, min(start, high), min(end, high));
    if high >= end {
        return answer(part);
    }
    let at = declined(cost, rate, high);
    let left = max(coerce::add(at, -salvage), 0.0);
    let mut periods = 1.0;
    if !keep {
        periods = life - high;
        if left <= at * rate {
            periods = min(periods, 1.0);
        }
    }
    let share = |x: f64| {
        let s = (x - high) / periods;
        let s = if s < 0.0 { 0.0 } else { s };
        if s > 1.0 {
            1.0
        } else {
            s
        }
    };
    answer(part + left * (share(end) - share(start)))
}

/// The declining balance's depreciation from period `a` to `b`, a part period counting in part.
fn declining_between(cost: f64, rate: f64, a: f64, b: f64) -> f64 {
    let (fa, fb) = (a.floor(), b.floor());
    let whole = exp_m1(periods_log(rate, fb - fa));
    let at_a = periods_log(rate, fa).exp();
    let at_b = periods_log(rate, fb).exp();
    (-whole - (a - fa) * rate) * (cost * at_a) + ((b - fb) * rate) * (cost * at_b)
}

/// DOLLARDE and DOLLARFR: a price's fraction read as a count of `1/denominator`s (DOLLARDE) or written as one
/// (DOLLARFR), the count taking as many decimal places as the denominator has digits.
fn dollar(price: f64, denominator: f64, decimal: bool) -> Answer {
    if denominator < 0.0 {
        return Err(CellError::Number);
    }
    let denominator = denominator.trunc();
    if denominator == 0.0 {
        return Err(CellError::DivideByZero);
    }
    let power = 10f64.powf(denominator.log10().ceil());
    let (over, under) = if decimal { (power, denominator) } else { (denominator, power) };
    let rounded = (price + 0.5f64.copysign(price)).trunc();
    let is_whole = coerce::add(price, -rounded) == 0.0;
    let int = if is_whole { rounded } else { price.trunc() };
    let fraction = if is_whole { 0.0 } else { price - price.trunc() };
    answer(int + fraction * over / under)
}

/// FVSCHEDULE: the present value grown by each rate in turn; in a range blanks are passed over, and anything
/// else not a number is #VALUE! (an error, itself).
fn future_value(args: &[Arg], locale: &Locale) -> Answer {
    let mut value = args[0].number(locale)?;
    let rates: Vec<Value> = match &args[1] {
        Arg::Cells(cells) => cells.values().filter(|v| !matches!(v, Value::Blank)).cloned().collect(),
        Arg::Value(v) => vec![v.clone()],
        Arg::Missing | Arg::Place(_) => vec![Value::Blank],
    };
    for rate in rates {
        match rate {
            Value::Number(r) => value *= r + 1.0,
            Value::Error(e) => return Err(e),
            _ => return Err(CellError::Value),
        }
    }
    answer(value)
}
