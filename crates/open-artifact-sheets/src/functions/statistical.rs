//! The statistical functions: averages, counts, the largest and smallest, medians, modes, percentiles, ranks,
//! variances and standard deviations, and the conditional ones (COUNTIF, COUNTIFS, AVERAGEIF, AVERAGEIFS, MAXIFS,
//! MINIFS).

use std::cmp::Ordering;
use hashbrown::HashMap;

use crate::coerce::{self, compare_numbers, compared_number};
use crate::criteria::Criterion;
use crate::functions::{number, Answer, Arg, CallContext, Cells};
use crate::locale::Locale;
use crate::value::{CellError, Value};

/// Calls a statistical function by name; `None` for one it doesn't have.
pub fn call(name: &str, args: &[Arg], cx: &mut CallContext) -> Option<Answer> {
    let locale = cx.locale;
    Some(match name {
        "AVERAGE" => numbers(args, locale).and_then(|n| average(&n)),
        "AVERAGEA" => numbers_and_others(args, locale).and_then(|n| average(&n)),
        "AVERAGEIF" => average_if(args, locale),
        "AVERAGEIFS" => matched_numbers(args, locale).and_then(|n| average(&n)),
        "COUNT" => number(count(args, locale) as f64),
        "COUNTA" => number(count_all(args) as f64),
        "COUNTBLANK" => count_blank(&args[0]),
        "COUNTIF" => count_if(args, locale),
        "COUNTIFS" => count_ifs(args, locale),
        "MAX" => numbers(args, locale).and_then(|n| number(n.into_iter().reduce(f64::max).unwrap_or(0.0))),
        "MIN" => numbers(args, locale).and_then(|n| number(n.into_iter().reduce(f64::min).unwrap_or(0.0))),
        "MAXIFS" => matched_numbers(args, locale).and_then(|n| number(n.into_iter().reduce(f64::max).unwrap_or(0.0))),
        "MINIFS" => matched_numbers(args, locale).and_then(|n| number(n.into_iter().reduce(f64::min).unwrap_or(0.0))),
        "MEDIAN" => numbers(args, locale).and_then(median),
        "MODE" | "MODE.SNGL" => numbers(args, locale).and_then(|n| mode(&n)),
        "LARGE" => large(args, locale),
        "SMALL" => small(args, locale),
        "PERCENTILE" | "PERCENTILE.INC" => percentile_of(args, locale),
        "QUARTILE" | "QUARTILE.INC" => quartile(args, locale),
        "RANK" | "RANK.EQ" => rank(args, locale),
        "VAR" | "VAR.S" => numbers(args, locale).and_then(|n| number(variance(&n, true)?)),
        "VARP" | "VAR.P" => numbers(args, locale).and_then(|n| number(variance(&n, false)?)),
        "STDEV" | "STDEV.S" => numbers(args, locale).and_then(|n| number(variance(&n, true)?.sqrt())),
        "STDEVP" | "STDEV.P" => numbers(args, locale).and_then(|n| number(variance(&n, false)?.sqrt())),
        _ => return None,
    })
}

/// The numbers AVERAGE, MAX, MEDIAN, VAR and the like look at: in a range or an array only numbers (text,
/// booleans and blanks are passed over); an argument written as one value read as a number (`MAX("3", TRUE)` is
/// 3), #VALUE! when it does not read as one; a left-out argument is 0.
fn numbers(args: &[Arg], locale: &Locale) -> Result<Vec<f64>, CellError> {
    let mut out = Vec::new();
    for arg in args {
        match arg {
            Arg::Missing => out.push(0.0),
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

/// The numbers AVERAGEA looks at: as [`numbers`], but in a range or an array text is 0 and booleans are 1 and 0
/// (blanks are still passed over).
fn numbers_and_others(args: &[Arg], locale: &Locale) -> Result<Vec<f64>, CellError> {
    let mut out = Vec::new();
    for arg in args {
        match arg {
            Arg::Missing => out.push(0.0),
            Arg::Value(v) => out.push(coerce::to_number(v, locale)?),
            Arg::Cells(cells) => {
                for v in cells.values() {
                    match v {
                        Value::Number(n) => out.push(*n),
                        Value::Boolean(b) => out.push(if *b { 1.0 } else { 0.0 }),
                        Value::Text(_) => out.push(0.0),
                        Value::Error(e) => return Err(*e),
                        Value::Blank => {}
                    }
                }
            }
            Arg::Place(_) => return Err(CellError::Value),
        }
    }
    Ok(out)
}

/// The sum (adding as `+` does) over the count; none at all is #DIV/0!.
fn average(n: &[f64]) -> Answer {
    if n.is_empty() {
        return Err(CellError::DivideByZero);
    }
    number(n.iter().copied().fold(0.0, coerce::add) / n.len() as f64)
}

/// COUNT: numbers in ranges and arrays; written values that read as numbers; left-out arguments.
fn count(args: &[Arg], locale: &Locale) -> usize {
    args.iter()
        .map(|arg| match arg {
            Arg::Missing => 1,
            Arg::Value(v) => usize::from(coerce::to_number(v, locale).is_ok()),
            Arg::Cells(cells) => cells.values().filter(|v| matches!(v, Value::Number(_))).count(),
            Arg::Place(_) => 0,
        })
        .sum()
}

/// COUNTA: every cell that is not blank (errors and empty text among them); every written or left-out argument.
fn count_all(args: &[Arg]) -> usize {
    args.iter()
        .map(|arg| match arg {
            Arg::Cells(cells) => cells.values().filter(|v| !matches!(v, Value::Blank)).count(),
            _ => 1,
        })
        .sum()
}

/// COUNTBLANK: blank cells and empty texts.
fn count_blank(arg: &Arg) -> Answer {
    let blank = |v: &Value| match v {
        Value::Blank => true,
        Value::Text(t) => t.is_empty(),
        _ => false,
    };
    let cells = range_of(arg)?;
    number(cells.values().filter(|v| blank(v)).count() as f64)
}

/// A range a condition is matched against (or whose cells are worked out): left out, #VALUE!.
fn range_of(arg: &Arg) -> Result<Cells, CellError> {
    match arg {
        Arg::Missing | Arg::Place(_) => Err(CellError::Value),
        arg => Ok(arg.cells()),
    }
}

fn count_if(args: &[Arg], locale: &Locale) -> Answer {
    let cells = range_of(&args[0])?;
    let criterion = Criterion::new(&args[1].value()?, locale);
    number(cells.values().filter(|v| criterion.matches(v)).count() as f64)
}

/// The cells where every (range, condition) pair matches, by their place in the ranges (row by row). The ranges
/// must all be as big as `size` (rows, columns), else #VALUE!.
fn matching(pairs: &[Arg], size: Option<(usize, usize)>, locale: &Locale) -> Result<Vec<bool>, CellError> {
    let mut size = size;
    let mut matched: Option<Vec<bool>> = None;
    for pair in pairs.chunks(2) {
        let cells = range_of(&pair[0])?;
        let this = (cells.rows(), cells.columns());
        match size {
            Some(s) if s != this => return Err(CellError::Value),
            _ => size = Some(this),
        }
        let criterion = Criterion::new(&pair[1].value()?, locale);
        let m = matched.get_or_insert_with(|| vec![true; cells.values().len()]);
        for (yes, v) in m.iter_mut().zip(cells.values()) {
            *yes = *yes && criterion.matches(v);
        }
    }
    Ok(matched.unwrap_or_default())
}

fn count_ifs(args: &[Arg], locale: &Locale) -> Answer {
    let matched = matching(args, None, locale)?;
    number(matched.iter().filter(|m| **m).count() as f64)
}

/// The numbers of AVERAGEIFS, MAXIFS and MINIFS: the first range's numbers where every condition matches. An
/// error there is the answer; text, booleans and blanks are passed over.
fn matched_numbers(args: &[Arg], locale: &Locale) -> Result<Vec<f64>, CellError> {
    let cells = range_of(&args[0])?;
    let matched = matching(&args[1..], Some((cells.rows(), cells.columns())), locale)?;
    let mut out = Vec::new();
    for (v, _) in cells.values().zip(&matched).filter(|(_, m)| **m) {
        match v {
            Value::Number(n) => out.push(*n),
            Value::Error(e) => return Err(*e),
            _ => {}
        }
    }
    Ok(out)
}

/// AVERAGEIF(range, condition, [average range]): the average range is not resized to the condition range; only
/// the matching cells' places that fall inside it count.
fn average_if(args: &[Arg], locale: &Locale) -> Answer {
    let cells = range_of(&args[0])?;
    let criterion = Criterion::new(&args[1].value()?, locale);
    let averaged = match args.get(2) {
        None => cells.clone(),
        Some(arg) => range_of(arg)?,
    };
    let mut n = Vec::new();
    for row in 0..cells.rows() {
        for column in 0..cells.columns() {
            if row >= averaged.rows() || column >= averaged.columns() || !criterion.matches(cells.get(row, column)) {
                continue;
            }
            match averaged.get(row, column) {
                Value::Number(x) => n.push(*x),
                Value::Error(e) => return Err(*e),
                _ => {}
            }
        }
    }
    average(&n)
}

/// The middle number, or the two middle ones' average; none at all is #NUM!.
fn median(mut n: Vec<f64>) -> Answer {
    if n.is_empty() {
        return Err(CellError::Number);
    }
    n.sort_by(f64::total_cmp);
    let half = n.len() / 2;
    if n.len() % 2 == 1 {
        number(n[half])
    } else {
        number(coerce::add(n[half - 1], n[half]) / 2.0)
    }
}

/// The number that comes most often (equal to 15 significant digits), the first to come among as many; #N/A when
/// none comes twice.
fn mode(n: &[f64]) -> Answer {
    // For each number (as compared): how often it comes, and where it first does.
    let mut seen: HashMap<u64, (usize, usize)> = HashMap::new();
    for (i, x) in n.iter().enumerate() {
        let key = compared_number(*x) + 0.0;
        seen.entry(key.to_bits()).or_insert((0, i)).0 += 1;
    }
    let best = seen.values().filter(|(count, _)| *count > 1).max_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    match best {
        Some((_, first)) => number(n[*first]),
        None => Err(CellError::NotAvailable),
    }
}

/// LARGE(range, position): the position is read to 15 significant digits and rounded up.
fn large(args: &[Arg], locale: &Locale) -> Answer {
    let mut n = numbers(&args[..1], locale)?;
    let k = compared_number(args[1].number(locale)?);
    if k < 1.0 || k.ceil() > n.len() as f64 {
        return Err(CellError::Number);
    }
    n.sort_by(|a, b| b.total_cmp(a));
    number(n[k.ceil() as usize - 1])
}

/// SMALL(range, position): the position's fraction is dropped.
fn small(args: &[Arg], locale: &Locale) -> Answer {
    let mut n = numbers(&args[..1], locale)?;
    let k = args[1].number(locale)?.trunc();
    if k < 1.0 || k > n.len() as f64 {
        return Err(CellError::Number);
    }
    n.sort_by(f64::total_cmp);
    number(n[k as usize - 1])
}

fn percentile_of(args: &[Arg], locale: &Locale) -> Answer {
    let n = numbers(&args[..1], locale)?;
    let p = args[1].number(locale)?;
    percentile(n, p)
}

/// QUARTILE(range, quarter mark): the mark's fraction is dropped; 0 to 4.
fn quartile(args: &[Arg], locale: &Locale) -> Answer {
    let n = numbers(&args[..1], locale)?;
    let q = args[1].number(locale)?;
    if q < 0.0 {
        return Err(CellError::Number);
    }
    let q = q.trunc();
    if q > 4.0 {
        return Err(CellError::Number);
    }
    percentile(n, q / 4.0)
}

/// The number a fraction of the way through the sorted numbers, from the first (0) to the last (1), between two
/// of them in proportion.
fn percentile(mut n: Vec<f64>, p: f64) -> Answer {
    if n.is_empty() || !(0.0..=1.0).contains(&p) {
        return Err(CellError::Number);
    }
    n.sort_by(f64::total_cmp);
    let h = p * (n.len() - 1) as f64;
    let low = h.floor();
    let i = low as usize;
    if i + 1 >= n.len() {
        return number(n[n.len() - 1]);
    }
    number(n[i] + (h - low) * (n[i + 1] - n[i]))
}

/// RANK(number, range, [order]): 1 more than how many numbers of the range are greater (order 0, the default) or
/// smaller (any other order); #N/A when the number is not in the range. Only numbers count in the range, even
/// written as one value.
fn rank(args: &[Arg], locale: &Locale) -> Answer {
    let x = args[0].number(locale)?;
    let mut n = Vec::new();
    match &args[1] {
        Arg::Value(Value::Number(v)) => n.push(*v),
        Arg::Value(_) => {}
        Arg::Cells(cells) => n.extend(cells.values().filter_map(|v| match v {
            Value::Number(v) => Some(*v),
            _ => None,
        })),
        Arg::Missing | Arg::Place(_) => return Err(CellError::Value),
    }
    let ascending = match args.get(2) {
        Some(order) => order.number_or(0.0, locale)? != 0.0,
        None => false,
    };
    if !n.iter().any(|v| compare_numbers(*v, x) == Ordering::Equal) {
        return Err(CellError::NotAvailable);
    }
    let before = if ascending { Ordering::Less } else { Ordering::Greater };
    number((1 + n.iter().filter(|v| compare_numbers(**v, x) == before).count()) as f64)
}

/// The variance of a sample (`sample`, over n − 1) or of a whole population (over n): the numbers are taken from
/// the first one, then their squared differences from their mean are added up. Too few numbers are #DIV/0!.
fn variance(n: &[f64], sample: bool) -> Result<f64, CellError> {
    let count = n.len();
    let over = if sample { count.saturating_sub(1) } else { count };
    if over == 0 {
        return Err(CellError::DivideByZero);
    }
    let first = n[0];
    let mean = n.iter().map(|x| x - first).sum::<f64>() / count as f64;
    let squares = n.iter().map(|x| {
        let d = (x - first) - mean;
        d * d
    });
    Ok(squares.sum::<f64>() / over as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variances_start_from_the_first_number() {
        let n = [5000000000000001.0, 5000000000000003.0, 5000000000000004.0, 5000000000000009.0, 5000000000000002.0];
        assert_eq!(variance(&n, true), Ok(9.700000000000001));
        assert_eq!(variance(&[5000000000000002.0, 5000000000000009.0, 5000000000000004.0, 5000000000000003.0, 5000000000000001.0], true), Ok(9.7));
        assert_eq!(variance(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], false), Ok(0.04));
        assert_eq!(variance(&[1.0], true), Err(CellError::DivideByZero));
        assert_eq!(variance(&[1.0], false), Ok(0.0));
    }

    #[test]
    fn modes() {
        let value = |a: Answer| match a {
            Ok(crate::evaluate::Operand::Value(Value::Number(n))) => Some(n),
            _ => None,
        };
        assert_eq!(value(mode(&[1.0, 2.0, 2.0, 1.0])), Some(1.0));
        assert_eq!(value(mode(&[2.0, 1.0, 1.0, 2.0])), Some(2.0));
        assert_eq!(value(mode(&[0.1 + 0.2, 0.3])), Some(0.1 + 0.2));
        assert_eq!(value(mode(&[1.0, 2.0])), None);
    }
}
