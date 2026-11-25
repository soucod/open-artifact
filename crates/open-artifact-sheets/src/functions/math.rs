//! The math functions.
//!
//! Numbers are read to 15 significant digits where a whole number is wanted: ROUND and its kin round the
//! number's 15-digit decimal; INT and RANDBETWEEN take a number that is all but whole as that whole number
//! (`INT(2.99999999999999)` is 3); QUOTIENT, MOD, CEILING, FLOOR and MROUND take a remainder lost in the number
//! as none (`MOD(0.7,0.1)` is 0).

use std::cmp::Ordering;

use crate::coerce;
use crate::criteria::Criterion;
use crate::evaluate::power;
use crate::functions::{number, numbers_of, Answer, Arg, CallContext, Cells};
use crate::locale::Locale;
use crate::value::{significant_digits, CellError, Value};

/// Calls a math function by name; `None` for one it doesn't have.
pub fn call(name: &str, args: &[Arg], cx: &mut CallContext) -> Option<Answer> {
    let locale = cx.locale;
    let x = || args[0].number(locale);
    // The second argument, or `default` when the call has only one.
    let second = |default: f64| args.get(1).map_or(Ok(default), |a| a.number(locale));
    Some(match name {
        "SUM" => numbers_of(args, locale).and_then(|n| number(n.into_iter().fold(0.0, coerce::add))),
        "ABS" => x().and_then(|n| number(n.abs())),
        "SIGN" => x().and_then(|n| number(sign(n))),
        "INT" => x().and_then(|n| number(snapped(n, f64::floor))),
        "TRUNC" => x().and_then(|n| round_to_places(n, second(0.0)?, Rounding::TowardZero)),
        "ROUND" => x().and_then(|n| round_to_places(n, second(0.0)?, Rounding::HalfAwayFromZero)),
        "ROUNDUP" => x().and_then(|n| round_to_places(n, second(0.0)?, Rounding::AwayFromZero)),
        "ROUNDDOWN" => x().and_then(|n| round_to_places(n, second(0.0)?, Rounding::TowardZero)),
        "CEILING" => x().and_then(|n| to_multiple(n, second(1.0)?, true)),
        "FLOOR" => x().and_then(|n| to_multiple(n, second(1.0)?, false)),
        "MROUND" => x().and_then(|n| nearest_multiple(n, second(0.0)?)),
        "MOD" => x().and_then(|n| modulo(n, second(0.0)?)),
        "QUOTIENT" => x().and_then(|n| {
            let divisor = second(0.0)?;
            if divisor == 0.0 {
                return Err(CellError::DivideByZero);
            }
            number(divide(n, divisor).count)
        }),
        "EXP" => x().and_then(|n| number(n.exp())),
        "LN" => x().and_then(|n| positive(n).and_then(|n| number(n.ln()))),
        "LOG10" => x().and_then(|n| positive(n).and_then(|n| number(n.log10()))),
        "LOG" => x().and_then(|n| logarithm(n, second(10.0)?)),
        "SQRT" => x().and_then(|n| if n < 0.0 { Err(CellError::Number) } else { number(n.sqrt()) }),
        "POWER" => x().and_then(|n| power(n, second(0.0)?)).and_then(number),
        "PI" => number(std::f64::consts::PI),
        "RADIANS" => x().and_then(|n| number(n.to_radians())),
        "N" => match args[0].value() {
            Ok(Value::Number(n)) => number(n),
            Ok(Value::Boolean(b)) => number(if b { 1.0 } else { 0.0 }),
            Ok(Value::Error(e)) | Err(e) => Err(e),
            Ok(Value::Text(_) | Value::Blank) => number(0.0),
        },
        "RAND" => number((cx.random)()),
        "RANDBETWEEN" => x().and_then(|low| {
            let low = snapped(low, f64::ceil);
            let high = snapped(second(0.0)?, f64::floor);
            if low > high {
                return Err(CellError::Number);
            }
            number(low + ((cx.random)() * (high - low + 1.0)).floor())
        }),
        "PRODUCT" => product(args, locale),
        "SUMSQ" => {
            numbers_of(args, locale).and_then(|n| number(n.into_iter().fold(0.0, |sum, n| coerce::add(sum, n * n))))
        }
        "SUMPRODUCT" => sum_product(args),
        "SUMIF" => sum_if(args, locale),
        "SUMIFS" => sum_ifs(args, locale),
        "SUBTOTAL" => subtotal(args, cx),
        _ => return None,
    })
}

/// SUBTOTAL: the code, cut to a whole number, picks the function the ranges are given to; a code other than 1 to
/// 11 is #VALUE!. The evaluator has already checked the ranges (written as ranges, none holding a SUBTOTAL).
fn subtotal(args: &[Arg], cx: &mut CallContext) -> Answer {
    let name = match args[0].number(cx.locale)?.trunc() as i64 {
        1 => "AVERAGE",
        2 => "COUNT",
        3 => "COUNTA",
        4 => "MAX",
        5 => "MIN",
        6 => "PRODUCT",
        7 => "STDEV",
        8 => "STDEVP",
        9 => "SUM",
        10 => "VAR",
        11 => "VARP",
        _ => return Err(CellError::Value),
    };
    let ranges = &args[1..];
    let answer = match name {
        "PRODUCT" | "SUM" => call(name, ranges, cx),
        _ => super::statistical::call(name, ranges, cx),
    };
    answer.expect("SUBTOTAL's functions are all present")
}

fn sign(n: f64) -> f64 {
    if n > 0.0 {
        1.0
    } else if n < 0.0 {
        -1.0
    } else {
        0.0
    }
}

/// A number a logarithm is taken of: 0 and below are #NUM!.
fn positive(n: f64) -> Result<f64, CellError> {
    if n <= 0.0 {
        Err(CellError::Number)
    } else {
        Ok(n)
    }
}

/// LOG: the base-10 logarithm of the number over that of the base (`LOG(125,5)` is 2.9999999999999996). A base
/// of 1 is #DIV/0!.
fn logarithm(n: f64, base: f64) -> Answer {
    let n = positive(n)?;
    let base = positive(base)?;
    if base == 1.0 {
        return Err(CellError::DivideByZero);
    }
    number(n.log10() / base.log10())
}

/// Whether two numbers count as the same: equal to 15 significant digits, or apart by only what is
/// left of rounding (their difference is 0 to [`coerce::add`]).
fn close(a: f64, b: f64) -> bool {
    coerce::compare_numbers(a, b) == Ordering::Equal || coerce::add(a, -b) == 0.0
}

/// `n` as the whole number nearest it (halves away from zero) when it is [`close`] to it; else `whole` of it
/// (floor, ceil or trunc).
fn snapped(n: f64, whole: fn(f64) -> f64) -> f64 {
    let nearest = n.round();
    if close(n, nearest) {
        nearest
    } else {
        whole(n)
    }
}

/// How many whole times `y` goes into `x` (toward zero) and the remainder (with the sign of `x`, or 0).
struct Division {
    count: f64,
    remainder: f64,
}

/// Divides `x` by `y` for QUOTIENT, CEILING, FLOOR and MROUND: exactly for whole numbers below
/// 2⁵³; otherwise a remainder lost in `x` (the nearer multiple, halves away from zero, is [`close`] to `x`) is
/// none, and the count is that multiple's (`QUOTIENT(1E17,7)` counts up to 14285714285714288).
fn divide(x: f64, y: f64) -> Division {
    let remainder = x % y;
    let count = (x / y - remainder / y).round();
    if is_safe_whole(x) && is_safe_whole(y) {
        return Division { count, remainder };
    }
    let (nearer_count, nearer) = if 2.0 * remainder.abs() >= y.abs() {
        (count + sign(x) * sign(y), x - remainder + sign(x) * y.abs())
    } else {
        (count, x - remainder)
    };
    if close(x, nearer) {
        Division { count: nearer_count, remainder: 0.0 }
    } else {
        Division { count, remainder }
    }
}

/// CEILING and FLOOR: the multiple of `step` above (`up`) or below the number, counted in steps: with a negative
/// step, a negative number goes away from zero for CEILING and toward it for FLOOR. A step of 0 is 0; a positive
/// number with a negative step is #NUM!.
fn to_multiple(n: f64, step: f64, up: bool) -> Answer {
    if n == 0.0 || step == 0.0 {
        return number(0.0);
    }
    if n > 0.0 && step < 0.0 {
        return Err(CellError::Number);
    }
    let Division { mut count, remainder } = divide(n, step);
    // Which way the remainder points, in steps: +1 when the number is past the counted multiple going up.
    let ahead = sign(remainder) * sign(step);
    if ahead > 0.0 && up || ahead < 0.0 && !up {
        count += ahead;
    }
    number(count * step)
}

/// MROUND: the nearest multiple of `step`, halves away from zero; the signs need not agree (`MROUND(10,-3)` is 9).
/// Unless the number is a multiple to [`divide`], it is the multiple below the number's size plus half a step,
/// [`divide`]d again (so `MROUND(0.15,0.1)`, whose half is lost in that sum, is 0.2).
fn nearest_multiple(n: f64, step: f64) -> Answer {
    if step == 0.0 {
        return number(0.0);
    }
    let Division { count, remainder } = divide(n, step);
    if remainder == 0.0 {
        return number(count * step);
    }
    let step = step.abs();
    number(sign(n) * divide(n.abs() + step / 2.0, step).count * step)
}

/// MOD: the remainder of [`divide`] (so a remainder lost in the number is 0: `MOD(0.7,0.1)` and `MOD(1E16,7)` are
/// 0), moved to the divisor's sign; one that is then the whole divisor is 0 (`MOD(-1E-20,1)`).
fn modulo(n: f64, divisor: f64) -> Answer {
    if divisor == 0.0 {
        return Err(CellError::DivideByZero);
    }
    let mut r = divide(n, divisor).remainder;
    if r != 0.0 && (r < 0.0) != (divisor < 0.0) {
        r += divisor;
    }
    number(if r == divisor { 0.0 } else { r })
}

/// A whole number every whole number up to is exact (below 2⁵³).
fn is_safe_whole(n: f64) -> bool {
    n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Rounding {
    HalfAwayFromZero,
    AwayFromZero,
    TowardZero,
}

/// ROUND, ROUNDUP, ROUNDDOWN and TRUNC: the number's 15-significant-digit decimal (halves to even) rounded at
/// `places` decimal places (negative: tens, hundreds, …; a fraction is cut toward zero), read back as the nearest
/// number. `ROUND(1.005,2)` is 1.01; `ROUND(1E15+0.5,0)` is 1E15.
fn round_to_places(n: f64, places: f64, how: Rounding) -> Answer {
    if n == 0.0 {
        return number(0.0);
    }
    let places = places.trunc().clamp(-1000.0, 1000.0) as i32;
    let (negative, digits, exponent) = significant_digits(n, 15);
    let digits = digits.as_bytes();
    // The digits are d₁d₂… × 10^(exponent + 1 - len); the ones kept are those before the place rounded at.
    let keep = exponent + 1 + places;
    let (mut kept, scale, dropped) = if keep >= digits.len() as i32 {
        (digits.to_vec(), exponent + 1 - digits.len() as i32, None)
    } else if keep <= 0 {
        let first = if keep == 0 { digits[0] } else { b'0' };
        (vec![b'0'], -places, Some(first))
    } else {
        (digits[..keep as usize].to_vec(), -places, Some(digits[keep as usize]))
    };
    let up = match (how, dropped) {
        (_, None) | (Rounding::TowardZero, _) => false,
        (Rounding::AwayFromZero, Some(_)) => true,
        (Rounding::HalfAwayFromZero, Some(d)) => d >= b'5',
    };
    if up {
        increment(&mut kept);
    }
    let text = format!("{}{}e{}", if negative { "-" } else { "" }, String::from_utf8_lossy(&kept), scale);
    number(text.parse().unwrap_or(f64::NAN))
}

/// Adds 1 to a decimal's digits.
fn increment(digits: &mut Vec<u8>) {
    for d in digits.iter_mut().rev() {
        if *d == b'9' {
            *d = b'0';
        } else {
            *d += 1;
            return;
        }
    }
    digits.insert(0, b'1');
}

/// PRODUCT: the numbers multiplied in order; a left-out argument is 0, and none at all is 0.
fn product(args: &[Arg], locale: &Locale) -> Answer {
    let mut numbers = Vec::new();
    for arg in args {
        if arg.is_missing() {
            numbers.push(0.0);
        } else {
            numbers.extend(numbers_of(std::slice::from_ref(arg), locale)?);
        }
    }
    number(if numbers.is_empty() { 0.0 } else { numbers.into_iter().product() })
}

/// SUMPRODUCT: the arrays must be the same size; then the first error in them, array by array, is the answer; else
/// the products of their numbers place by place (anything else is 0) are summed.
fn sum_product(args: &[Arg]) -> Answer {
    let arrays: Vec<Cells> = args.iter().map(Arg::cells).collect();
    let (rows, columns) = (arrays[0].rows(), arrays[0].columns());
    if arrays.iter().any(|a| a.rows() != rows || a.columns() != columns) {
        return Err(CellError::Value);
    }
    if let Some(e) = arrays.iter().find_map(|a| a.values().find_map(Value::error)) {
        return Err(e);
    }
    let mut sum = 0.0;
    for i in 0..rows * columns {
        let mut product = 1.0;
        for a in &arrays {
            product *= match a.array.get_flat(i) {
                Value::Number(n) => *n,
                _ => 0.0,
            };
        }
        sum = coerce::add(sum, product);
    }
    number(sum)
}

/// SUMIF: the numbers of the sum range (the condition range when it is not given) where the condition range's
/// cells match, place by place from the corner; the sum range keeps its own size, so condition cells beyond it
/// count for nothing. An error in a cell summed is the answer.
fn sum_if(args: &[Arg], locale: &Locale) -> Answer {
    let criterion = Criterion::new(&args[1].value()?, locale);
    let range = args[0].cells();
    let summed = args.get(2).map_or_else(|| range.clone(), Arg::cells);
    let mut sum = 0.0;
    for r in 0..range.rows().min(summed.rows()) {
        for c in 0..range.columns().min(summed.columns()) {
            if criterion.matches(range.get(r, c)) {
                match summed.get(r, c) {
                    Value::Number(n) => sum = coerce::add(sum, *n),
                    Value::Error(e) => return Err(*e),
                    _ => {}
                }
            }
        }
    }
    number(sum)
}

/// SUMIFS: every condition range the sum range's size (else #VALUE!); the numbers of the sum range where every
/// condition matches. An error in a cell summed is the answer.
fn sum_ifs(args: &[Arg], locale: &Locale) -> Answer {
    let summed = args[0].cells();
    let mut conditions = Vec::new();
    for pair in args[1..].chunks(2) {
        let range = pair[0].cells();
        if range.rows() != summed.rows() || range.columns() != summed.columns() {
            return Err(CellError::Value);
        }
        conditions.push((range, Criterion::new(&pair[1].value()?, locale)));
    }
    let mut sum = 0.0;
    for (i, v) in summed.values().enumerate() {
        if conditions.iter().all(|(range, criterion)| criterion.matches(range.array.get_flat(i))) {
            match v {
                Value::Number(n) => sum = coerce::add(sum, *n),
                Value::Error(e) => return Err(*e),
                _ => {}
            }
        }
    }
    number(sum)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round(n: f64, places: f64) -> f64 {
        match round_to_places(n, places, Rounding::HalfAwayFromZero) {
            Ok(crate::evaluate::Operand::Value(Value::Number(n))) => n,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn rounds_the_15_digit_decimal() {
        assert_eq!(round(2.5, 0.0), 3.0);
        assert_eq!(round(-2.5, 0.0), -3.0);
        assert_eq!(round(1.005, 2.0), 1.01);
        assert_eq!(round(1e15 + 0.5, 0.0), 1e15);
        assert_eq!(round(1234.5678, -1.9), 1230.0);
        assert_eq!(round(1.5, -400.0), 0.0);
        assert_eq!(round(0.1 + 0.2, 17.0), 0.3);
    }

    #[test]
    fn snaps_to_whole_numbers() {
        assert_eq!(snapped(2.9999999999999996, f64::floor), 3.0);
        assert_eq!(snapped(1e14 + 0.5, f64::floor), 1e14);
        assert_eq!(snapped(1e15 + 0.5, f64::floor), 1e15 + 1.0);
        assert_eq!(snapped(-0.5, f64::floor), -1.0);
    }

    fn count_and_remainder(x: f64, y: f64) -> (f64, f64) {
        let d = divide(x, y);
        (d.count, d.remainder)
    }

    #[test]
    fn divides_with_lost_remainders() {
        // Exact for whole numbers below 2⁵³.
        assert_eq!(count_and_remainder(1125899906842625.0, 7.0), (160842843834660.0, 5.0));
        // 0.7 is 7 tenths; 1E16 is all but 1428571428571429 sevens.
        assert_eq!(count_and_remainder(0.7, 0.1), (7.0, 0.0));
        assert_eq!(count_and_remainder(1e16, 7.0), (1428571428571429.0, 0.0));
        assert_eq!(count_and_remainder(1e16, 3.0), (3333333333333333.0, 0.0));
        assert_eq!(count_and_remainder(1e17, 7.0), (14285714285714288.0, 0.0));
        // A remainder that shows in the number is kept.
        assert_eq!(count_and_remainder(7846539616584706.0, 3.594).1, 1.7404996762539038);
    }
}
