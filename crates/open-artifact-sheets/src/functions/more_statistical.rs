//! The descriptive and regression statistics.
//!
//! AVEDEV AVERAGE.WEIGHTED CORREL COUNTUNIQUE COUNTUNIQUEIFS COVAR COVARIANCE.P COVARIANCE.S DEVSQ FORECAST
//! FORECAST.LINEAR FREQUENCY GEOMEAN GROWTH HARMEAN INTERCEPT KURT LINEST LOGEST MAXA MINA MODE.MULT PEARSON
//! PERCENTILE.EXC PERCENTRANK PERCENTRANK.EXC PERCENTRANK.INC PERMUT QUARTILE.EXC RANK.AVG RSQ SKEW SKEW.P
//! SLOPE STANDARDIZE STEYX TREND TRIMMEAN
//!
//! The sums decide the last digits, so they are done just so: deviations are taken from the first
//! number before the mean is taken off, counts are added up as numbers, and sums start from -0.

mod regression;

use std::cmp::Ordering;

use hashbrown::{HashMap, HashSet};

use crate::coerce::{self, compare_numbers, compared_number};
use crate::criteria::Criterion;
use crate::functions::{array, number, Answer, Arg, CallContext, Cells};
use crate::locale::Locale;
use crate::value::{significant_digits, Array, CellError, Value};

/// Calls one of these functions by name; `None` for any other name.
pub fn call(name: &str, args: &[Arg], cx: &mut CallContext) -> Option<Answer> {
    let locale = cx.locale;
    Some(match name {
        "AVEDEV" => numbers(args, locale).and_then(|n| average_deviation(&n)),
        "AVERAGE.WEIGHTED" => average_weighted(args),
        "CORREL" | "PEARSON" => paired(args).and_then(|s| number(s.correlation()?.sqrt().copysign(s.sab))),
        "COUNTUNIQUE" => count_unique(args),
        "COUNTUNIQUEIFS" => count_unique_ifs(args, locale),
        "COVAR" | "COVARIANCE.P" => paired(args).and_then(|s| number(s.sab / s.n)),
        "COVARIANCE.S" => paired(args).and_then(|s| {
            if s.n < 2.0 {
                return Err(CellError::DivideByZero);
            }
            number(s.sab / (s.n - 1.0))
        }),
        "DEVSQ" => numbers(args, locale).and_then(|n| deviation_squares(&n)),
        "FORECAST" | "FORECAST.LINEAR" => forecast(args, locale),
        "FREQUENCY" => frequency(args, locale),
        "GEOMEAN" => numbers(args, locale).and_then(|n| geometric_mean(&n)),
        "GROWTH" => regression::trend(args, locale, true),
        "HARMEAN" => numbers(args, locale).and_then(|n| harmonic_mean(&n)),
        "INTERCEPT" => paired(args).and_then(|s| s.predict(0.0)),
        "KURT" => numbers(args, locale).and_then(|n| kurtosis(&n)),
        "LINEST" => regression::estimate(args, locale, false),
        "LOGEST" => regression::estimate(args, locale, true),
        "MAXA" => numbers_and_others(args, locale).and_then(|n| number(n.into_iter().reduce(f64::max).unwrap_or(0.0))),
        "MINA" => numbers_and_others(args, locale).and_then(|n| number(n.into_iter().reduce(f64::min).unwrap_or(0.0))),
        "MODE.MULT" => numbers(args, locale).and_then(|n| modes(&n)),
        "PERCENTILE.EXC" => percentile_exclusive_of(args, locale),
        "PERCENTRANK" | "PERCENTRANK.INC" => percent_rank(args, locale, false),
        "PERCENTRANK.EXC" => percent_rank(args, locale, true),
        "PERMUT" => permutations(args, locale),
        "QUARTILE.EXC" => quartile_exclusive(args, locale),
        "RANK.AVG" => rank_average(args, locale),
        "RSQ" => paired(args).and_then(|s| number(s.correlation()?)),
        "SKEW" => numbers(args, locale).and_then(|n| skew(&n, true)),
        "SKEW.P" => numbers(args, locale).and_then(|n| skew(&n, false)),
        "SLOPE" => paired(args).and_then(|s| number(s.slope()?)),
        "STANDARDIZE" => standardize(args, locale),
        "STEYX" => paired(args).and_then(|s| s.standard_error()),
        "TREND" => regression::trend(args, locale, false),
        "TRIMMEAN" => trimmed_mean(args, locale),
        _ => return None,
    })
}

/// How one of these functions reads its arguments early (as `functions::early_reads` writes it), if it does.
pub fn early_reads(name: &str) -> Option<&'static str> {
    Some(match name {
        "AVEDEV" | "DEVSQ" | "GEOMEAN" | "HARMEAN" | "KURT" | "MAXA" | "MINA" | "MODE.MULT" | "SKEW" | "SKEW.P" => "n*",
        "PERCENTRANK" | "PERCENTRANK.EXC" | "PERCENTRANK.INC" | "STANDARDIZE" => "nn",
        "FORECAST" | "FORECAST.LINEAR" | "FREQUENCY" | "PERCENTILE.EXC" | "QUARTILE.EXC" | "RANK.AVG" | "TRIMMEAN" => {
            "n"
        }
        "PERMUT" => "y",
        "GROWTH" | "TREND" => ".n",
        _ => return None,
    })
}

/// The numbers AVEDEV, GEOMEAN, SKEW and the like look at: in a range or an array only numbers (an error there is
/// the answer); an argument written as one value read as a number; a left-out argument is 0.
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

/// The numbers MAXA and MINA look at: as [`numbers`], but in a range or an array text is 0 and booleans are 1 and
/// 0 (blanks are still passed over).
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

/// The differences from the mean: from the first number, then less their mean. Also the
/// count, added up as a number.
fn deviations(n: &[f64]) -> (Vec<f64>, f64) {
    let first = n.first().copied().unwrap_or(0.0);
    let mut d: Vec<f64> = n.iter().map(|x| x - first).collect();
    let mut count = -0.0;
    let mut sum = -0.0;
    for x in &d {
        count += 1.0;
        sum += x;
    }
    let mean = sum / count;
    for x in &mut d {
        *x -= mean;
    }
    (d, count)
}

/// AVEDEV: the mean of the distances from the mean; no numbers is #NUM!.
fn average_deviation(n: &[f64]) -> Answer {
    if n.is_empty() {
        return Err(CellError::Number);
    }
    let (d, count) = deviations(n);
    number(d.iter().fold(-0.0, |s, x| s + x.abs()) / count)
}

/// DEVSQ: the sum of the squared differences from the mean; no numbers is #NUM!.
fn deviation_squares(n: &[f64]) -> Answer {
    if n.is_empty() {
        return Err(CellError::Number);
    }
    number(deviations(n).0.iter().fold(-0.0, |s, x| s + x * x))
}

/// SKEW (`sample`) and SKEW.P: fewer than 3 numbers, or no spread, is #DIV/0!.
fn skew(n: &[f64], sample: bool) -> Answer {
    if n.len() < 3 {
        return Err(CellError::DivideByZero);
    }
    let (d, count) = deviations(n);
    let squares = d.iter().fold(-0.0, |s, x| s + x * x);
    let v = squares / if sample { count - 1.0 } else { count };
    if v == 0.0 {
        return Err(CellError::DivideByZero);
    }
    let cubes = d.iter().fold(-0.0, |s, x| s + x * (x * x));
    let ratio = cubes / v / v.sqrt();
    if sample {
        number(count * ratio / ((count - 1.0) * (count - 2.0)))
    } else {
        number(ratio / count)
    }
}

/// KURT: fewer than 4 numbers, or no spread, is #DIV/0!.
fn kurtosis(n: &[f64]) -> Answer {
    if n.len() < 4 {
        return Err(CellError::DivideByZero);
    }
    let (d, count) = deviations(n);
    let v = d.iter().fold(-0.0, |s, x| s + x * x) / (count - 1.0);
    if v == 0.0 {
        return Err(CellError::DivideByZero);
    }
    let fourths = d.iter().fold(-0.0, |s, x| s + (x * x) * (x * x));
    let k = count * (fourths / v / v);
    number(
        ((count + 1.0) * k / (count - 1.0) + (count - 1.0) * ((count - 1.0) * -3.0)) / ((count - 2.0) * (count - 3.0)),
    )
}

/// GEOMEAN: the product of the ratios to the first number, carried as logarithms when it would leave the normal
/// range. A number that is not above 0, or none at all, is #NUM!.
fn geometric_mean(n: &[f64]) -> Answer {
    let Some(&first) = n.first() else {
        return Err(CellError::Number);
    };
    let (mut count, mut logs, mut product) = (0.0, 0.0, 1.0);
    for &x in n {
        if x <= 0.0 {
            return Err(CellError::Number);
        }
        let next = product * (x / first);
        if (next.to_bits() & 0x7fff_ffff_ffff_ffff).wrapping_sub(0x0010_0000_0000_0000) >= 0x7fe0_0000_0000_0000 {
            logs += f64::ln(product) + f64::ln(x) - f64::ln(first);
            product = 1.0;
        } else {
            product = next;
        }
        count += 1.0;
    }
    number(first * (product.powf(1.0 / count) * (logs / count).exp()))
}

/// HARMEAN: scaled by the smallest number, which must be above 0; none at all is #NUM!.
fn harmonic_mean(n: &[f64]) -> Answer {
    let Some(least) = n.iter().copied().reduce(f64::min) else {
        return Err(CellError::Number);
    };
    if least <= 0.0 {
        return Err(CellError::Number);
    }
    let (mut count, mut sum) = (0.0, 0.0);
    for x in n {
        count += 1.0;
        sum += least / x;
    }
    number(least * (count / sum))
}

/// MODE.MULT: every number (as compared) that comes most often, more than once, in the order they first come; a
/// column when there are several. None repeated is #N/A.
fn modes(n: &[f64]) -> Answer {
    let mut seen: HashMap<u64, usize> = HashMap::new();
    let mut found: Vec<(f64, usize)> = Vec::new();
    for x in n {
        let key = (compared_number(*x) + 0.0).to_bits();
        match seen.get(&key) {
            Some(&i) => found[i].1 += 1,
            None => {
                seen.insert(key, found.len());
                found.push((*x, 1));
            }
        }
    }
    let most = found.iter().map(|f| f.1).max().unwrap_or(0);
    if most < 2 {
        return Err(CellError::NotAvailable);
    }
    let values: Vec<Value> = found.iter().filter(|f| f.1 == most).map(|f| Value::number(f.0)).collect();
    if values.len() == 1 {
        return number(found.iter().find(|f| f.1 == most).map_or(0.0, |f| f.0));
    }
    array(Array::new(values.len(), 1, values))
}

/// The numbers of a range argument read as one value (the first argument of PERCENTILE.EXC and the like).
fn range_numbers(arg: &Arg, locale: &Locale) -> Result<Vec<f64>, CellError> {
    numbers(std::slice::from_ref(arg), locale)
}

/// PERCENTILE.EXC and QUARTILE.EXC: the position is p × (n + 1), which must fall from 1 to n.
fn percentile_exclusive(mut n: Vec<f64>, p: f64) -> Answer {
    let h = p * (n.len() as f64 + 1.0);
    if compare_numbers(h, 1.0) == Ordering::Less || compare_numbers(h, n.len() as f64) == Ordering::Greater {
        return Err(CellError::Number);
    }
    n.sort_by(f64::total_cmp);
    let r = (h - 1.0).max(0.0);
    let i = r.trunc() as usize;
    if i >= n.len() {
        return Err(CellError::Number);
    }
    let fraction = r - r.trunc();
    if n.len() - i > 1 && fraction > 0.0 {
        return number(n[i] + fraction * (n[i + 1] - n[i]));
    }
    number(n[i])
}

fn percentile_exclusive_of(args: &[Arg], locale: &Locale) -> Answer {
    let n = range_numbers(&args[0], locale)?;
    percentile_exclusive(n, args[1].number(locale)?)
}

/// QUARTILE.EXC(range, quart): the quart's fraction is dropped; it must be 1, 2 or 3.
fn quartile_exclusive(args: &[Arg], locale: &Locale) -> Answer {
    let n = range_numbers(&args[0], locale)?;
    let p = match args[1].number(locale)?.trunc() {
        1.0 => 0.25,
        2.0 => 0.5,
        3.0 => 0.75,
        _ => return Err(CellError::Number),
    };
    percentile_exclusive(n, p)
}

/// The numbers of a range argument as RANK reads them: only numbers, even written as one value.
fn ranked_numbers(arg: &Arg) -> Result<Vec<f64>, CellError> {
    match arg {
        Arg::Value(Value::Number(v)) => Ok(vec![*v]),
        Arg::Value(_) => Ok(Vec::new()),
        Arg::Cells(cells) => Ok(cells
            .values()
            .filter_map(|v| match v {
                Value::Number(v) => Some(*v),
                _ => None,
            })
            .collect()),
        Arg::Missing | Arg::Place(_) => Err(CellError::Value),
    }
}

/// RANK.AVG(number, range, [order]): ties share the average of their places; #N/A when the number is not there.
fn rank_average(args: &[Arg], locale: &Locale) -> Answer {
    let x = args[0].number(locale)?;
    let n = ranked_numbers(&args[1])?;
    let order = match args.get(2) {
        Some(order) => order.number_or(0.0, locale)?,
        None => 0.0,
    };
    let (mut greater, mut equal, mut less) = (0.0, 0.0, 0.0);
    for v in n {
        match compare_numbers(v, x) {
            Ordering::Greater => greater += 1.0,
            Ordering::Equal => equal += 1.0,
            Ordering::Less => less += 1.0,
        }
    }
    if equal == 0.0 {
        return Err(CellError::NotAvailable);
    }
    let before = if order == 0.0 { greater } else { less };
    number(before + (equal + 1.0) * 0.5)
}

/// PERCENTRANK, PERCENTRANK.INC and PERCENTRANK.EXC (`exclusive`)(range, number, [digits]): a number between two
/// of the range's is placed between them; the answer is cut (not rounded) to the digits: 3 when not given, and a left-out one is #NUM!.
fn percent_rank(args: &[Arg], locale: &Locale, exclusive: bool) -> Answer {
    let n = range_numbers(&args[0], locale)?;
    let x = args[1].number(locale)?;
    let places = match args.get(2) {
        Some(arg) => arg.number(locale)?.trunc(),
        None => 3.0,
    };
    if n.is_empty() || places < 1.0 {
        return Err(CellError::Number);
    }
    let (mut count, mut less, mut found) = (0.0, 0.0, false);
    let (mut low, mut high) = (f64::NEG_INFINITY, f64::INFINITY);
    for &v in &n {
        count += 1.0;
        match compare_numbers(v, x) {
            Ordering::Equal => found = true,
            Ordering::Less => {
                less += 1.0;
                low = low.max(v);
            }
            Ordering::Greater => high = high.min(v),
        }
    }
    if !found {
        if !low.is_finite() || !high.is_finite() {
            return Err(CellError::NotAvailable);
        }
        less = (less - 1.0) + (x - low) / (high - low);
    }
    let r = if exclusive {
        (less + 1.0) / (count + 1.0)
    } else if count > 1.0 {
        less / (count - 1.0)
    } else {
        1.0
    };
    let r = round_to_places(r, places + 6.0, Rounding::HalfAwayFromZero);
    number(round_to_places(r, places, Rounding::TowardZero))
}

/// TRIMMEAN(range, fraction): the fraction, from 0 up to (not including) 1, of the numbers is left out, half from
/// each end (rounded down to a whole count each).
fn trimmed_mean(args: &[Arg], locale: &Locale) -> Answer {
    let mut n = range_numbers(&args[0], locale)?;
    let p = args[1].number(locale)?;
    if !(0.0..1.0).contains(&p) {
        return Err(CellError::Number);
    }
    n.sort_by(f64::total_cmp);
    let cut = round_to_places(p * n.len() as f64 * 0.5, 0.0, Rounding::TowardZero).trunc() as usize;
    let kept = n.len().saturating_sub(cut);
    if kept <= cut {
        return Err(CellError::Number);
    }
    number(n[cut..kept].iter().copied().fold(0.0, coerce::add) / (kept - cut) as f64)
}

/// STANDARDIZE(x, mean, standard deviation): the deviation must be above 0.
fn standardize(args: &[Arg], locale: &Locale) -> Answer {
    let x = args[0].number(locale)?;
    let mean = args[1].number(locale)?;
    let sd = args[2].number(locale)?;
    if sd <= 0.0 {
        return Err(CellError::Number);
    }
    number((x - mean) / sd)
}

/// PERMUT(n, k): n and k lose their fractions; k must be from 0 to n, and n not more than 2⁵³ − 1. The product is
/// kept in 128 bits, shifted down to stay within 75 bits before each step.
fn permutations(args: &[Arg], locale: &Locale) -> Answer {
    let n = args[0].number(locale)?.trunc();
    let k = args[1].number(locale)?.trunc();
    if n > 9_007_199_254_740_991.0 || k > n || k < 0.0 {
        return Err(CellError::Number);
    }
    let (n, k) = (n.max(0.0) as u64, k.max(0.0) as u64);
    let mut product: u128 = 1;
    let mut shifts: u32 = 0;
    for i in 1..=k {
        let bits = 128 - product.leading_zeros();
        let shift = bits.saturating_sub(75);
        product = (product >> shift).saturating_mul(u128::from(n - k + i));
        shifts += shift;
        if shifts > 1024 {
            return Err(CellError::Number);
        }
    }
    number(2f64.powi(shifts as i32) * product as f64)
}

/// The pairs of two ranges of the same size, place by place, where both are numbers. The first range's first
/// error is the answer, then the second's; a range left out, or sizes that differ, is #VALUE!.
fn pairs(a: &Arg, b: &Arg) -> Result<Vec<(f64, f64)>, CellError> {
    let (a, b) = (range_of(a)?, range_of(b)?);
    if a.rows() != b.rows() || a.columns() != b.columns() {
        return Err(CellError::Value);
    }
    for cells in [&a, &b] {
        if let Some(e) = cells.values().find_map(Value::error) {
            return Err(e);
        }
    }
    Ok(a.values()
        .zip(b.values())
        .filter_map(|(x, y)| match (x, y) {
            (Value::Number(x), Value::Number(y)) => Some((*x, *y)),
            _ => None,
        })
        .collect())
}

/// A range argument's cells: one value is a range of one; left out is #VALUE!.
fn range_of(arg: &Arg) -> Result<Cells, CellError> {
    match arg {
        Arg::Missing | Arg::Place(_) => Err(CellError::Value),
        arg => Ok(arg.cells()),
    }
}

/// The sums of a pair of ranges (a: the first, the y values; b: the second, the x values), taken from their first
/// pair and then less their means.
struct PairSums {
    n: f64,
    mean_a: f64,
    first_b: f64,
    mean_b: f64,
    saa: f64,
    sbb: f64,
    sab: f64,
    da: Vec<f64>,
    db: Vec<f64>,
}

fn paired(args: &[Arg]) -> Result<PairSums, CellError> {
    pair_sums(&pairs(&args[args.len() - 2], &args[args.len() - 1])?)
}

/// No pairs is #DIV/0!; sums that are not finite are #NUM!.
fn pair_sums(p: &[(f64, f64)]) -> Result<PairSums, CellError> {
    let Some(&(first_a, first_b)) = p.first() else {
        return Err(CellError::DivideByZero);
    };
    let (mut n, mut sa, mut sb) = (0.0, 0.0, 0.0);
    for (a, b) in p {
        n += 1.0;
        sa += a - first_a;
        sb += b - first_b;
    }
    let (mean_a, mean_b) = (sa / n, sb / n);
    let (mut saa, mut sbb, mut sab) = (0.0, 0.0, 0.0);
    let (mut da, mut db) = (Vec::with_capacity(p.len()), Vec::with_capacity(p.len()));
    for (a, b) in p {
        let x = (a - first_a) - mean_a;
        let y = (b - first_b) - mean_b;
        saa += x * x;
        sbb += y * y;
        sab += x * y;
        da.push(x);
        db.push(y);
    }
    if !(saa + sbb).is_finite() {
        return Err(CellError::Number);
    }
    Ok(PairSums { n, mean_a: first_a + mean_a, first_b, mean_b, saa, sbb, sab, da, db })
}

impl PairSums {
    /// r², kept from 0 to 1; no spread in either range is #DIV/0!.
    fn correlation(&self) -> Result<f64, CellError> {
        if self.saa == 0.0 || self.sbb == 0.0 {
            return Err(CellError::DivideByZero);
        }
        let r2 = (self.sab / self.sbb) * (self.sab / self.saa);
        Ok(r2.clamp(0.0, 1.0))
    }

    fn slope(&self) -> Result<f64, CellError> {
        if self.sbb == 0.0 {
            return Err(CellError::DivideByZero);
        }
        Ok(self.sab / self.sbb)
    }

    /// The fitted line's value at `x`.
    fn predict(&self, x: f64) -> Answer {
        let slope = self.slope()?;
        number(self.mean_a + slope * ((x - self.first_b) - self.mean_b))
    }

    /// STEYX: fewer than 3 pairs is #DIV/0!.
    fn standard_error(&self) -> Answer {
        if self.n < 3.0 {
            return Err(CellError::DivideByZero);
        }
        let slope = self.slope()?;
        let errors = self.da.iter().zip(&self.db).fold(-0.0, |s, (a, b)| {
            let e = a - slope * b;
            s + e * e
        });
        number((errors / (self.n - 2.0)).sqrt())
    }
}

/// FORECAST(x, known y, known x).
fn forecast(args: &[Arg], locale: &Locale) -> Answer {
    let x = args[0].number(locale)?;
    paired(&args[1..])?.predict(x)
}

/// AVERAGE.WEIGHTED(values, weights, …): pairs of the same size; a weight below 0 is #NUM!, weights that add up
/// to 0 are #DIV/0!.
fn average_weighted(args: &[Arg]) -> Answer {
    let (mut sum, mut weights, mut negative) = (0.0, 0.0, false);
    for pair in args.chunks(2) {
        if pair.len() < 2 {
            return Err(CellError::NotAvailable);
        }
        for (v, w) in pairs(&pair[0], &pair[1])? {
            weights += w;
            negative |= w < 0.0;
            sum = coerce::add(sum, w * v);
        }
    }
    if negative {
        return Err(CellError::Number);
    }
    if weights == 0.0 {
        return Err(CellError::DivideByZero);
    }
    number(sum / weights)
}

/// What COUNTUNIQUE tells apart: numbers as compared, text in any case, booleans, errors.
#[derive(PartialEq, Eq, Hash)]
enum Distinct {
    Number(u64),
    Text(String),
    Boolean(bool),
    Error(u8),
}

/// A value as COUNTUNIQUE counts it; blanks and empty text are not counted.
fn distinct(v: &Value) -> Option<Distinct> {
    Some(match v {
        Value::Number(n) => Distinct::Number((compared_number(*n) + 0.0).to_bits()),
        Value::Text(t) if t.is_empty() => return None,
        Value::Text(t) => Distinct::Text(t.chars().flat_map(char::to_lowercase).collect()),
        Value::Boolean(b) => Distinct::Boolean(*b),
        Value::Error(e) => Distinct::Error(*e as u8),
        Value::Blank => return None,
    })
}

/// COUNTUNIQUE: errors in ranges count too; an argument left out is #VALUE!.
fn count_unique(args: &[Arg]) -> Answer {
    let mut seen = HashSet::new();
    for arg in args {
        match arg {
            Arg::Missing | Arg::Place(_) => return Err(CellError::Value),
            Arg::Value(Value::Error(e)) => return Err(*e),
            Arg::Value(v) => seen.extend(distinct(v)),
            Arg::Cells(cells) => seen.extend(cells.values().filter_map(distinct)),
        }
    }
    number(seen.len() as f64)
}

/// COUNTUNIQUEIFS(range, condition range, condition, …): the condition ranges must be the range's size.
fn count_unique_ifs(args: &[Arg], locale: &Locale) -> Answer {
    let cells = range_of(&args[0])?;
    let mut matched = vec![true; cells.values().len()];
    for pair in args[1..].chunks(2) {
        let tested = range_of(&pair[0])?;
        if tested.rows() != cells.rows() || tested.columns() != cells.columns() {
            return Err(CellError::Value);
        }
        let Some(condition) = pair.get(1) else {
            return Err(CellError::NotAvailable);
        };
        let criterion = Criterion::new(&condition.value()?, locale);
        for (yes, v) in matched.iter_mut().zip(tested.values()) {
            *yes = *yes && criterion.matches(v);
        }
    }
    let seen: HashSet<Distinct> =
        cells.values().zip(&matched).filter(|(_, m)| **m).filter_map(|(v, _)| distinct(v)).collect();
    number(seen.len() as f64)
}

/// FREQUENCY(data, bins): how many numbers fall at or below each bin and above the next smaller one (bins sorted,
/// ties going to the first), in the bins' order, then how many are above them all; a column.
fn frequency(args: &[Arg], locale: &Locale) -> Answer {
    let data = range_numbers(&args[0], locale)?;
    let bins = range_numbers(&args[1], locale)?;
    let mut order: Vec<usize> = (0..bins.len()).collect();
    order.sort_by(|a, b| bins[*a].total_cmp(&bins[*b]));
    let mut counts = vec![0.0; bins.len() + 1];
    for x in data {
        let i =
            order.iter().find(|&&i| compare_numbers(x, bins[i]) != Ordering::Greater).copied().unwrap_or(bins.len());
        counts[i] += 1.0;
    }
    if counts.len() == 1 {
        return number(counts[0]);
    }
    array(Array::new(counts.len(), 1, counts.into_iter().map(Value::Number).collect()))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Rounding {
    HalfAwayFromZero,
    TowardZero,
}

/// A number's 15-significant-digit decimal rounded at `places` decimal places, read back as the nearest number
/// (as ROUND and ROUNDDOWN do).
fn round_to_places(n: f64, places: f64, how: Rounding) -> f64 {
    if n == 0.0 || !n.is_finite() {
        return n;
    }
    let places = places.trunc().clamp(-400.0, 400.0) as i32;
    let (negative, digits, exponent) = significant_digits(n, 15);
    let digits = digits.as_bytes();
    let keep = exponent + 1 + places;
    let (mut kept, scale, dropped) = if keep >= digits.len() as i32 {
        (digits.to_vec(), exponent + 1 - digits.len() as i32, None)
    } else if keep <= 0 {
        let first = if keep == 0 { digits[0] } else { b'0' };
        (vec![b'0'], -places, Some(first))
    } else {
        (digits[..keep as usize].to_vec(), -places, Some(digits[keep as usize]))
    };
    if how == Rounding::HalfAwayFromZero && dropped.is_some_and(|d| d >= b'5') {
        increment(&mut kept);
    }
    let text = format!("{}{}e{}", if negative { "-" } else { "" }, String::from_utf8_lossy(&kept), scale);
    text.parse().unwrap_or(f64::NAN)
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
