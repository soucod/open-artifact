//! LINEST, LOGEST, TREND and GROWTH: least squares. Each x variable is centred (when there
//! is a constant) and made orthogonal to the ones kept before it (modified Gram–Schmidt); one that is left with
//! nothing but rounding is dropped and gets a coefficient of 0.

use crate::coerce;
use crate::functions::{array, value, Answer, Arg, Cells};
use crate::locale::Locale;
use crate::value::{Array, CellError, Value};

/// The known values: y (row by row) and the x variables, each as long as y.
struct Known {
    y: Vec<f64>,
    xs: Vec<Vec<f64>>,
    /// How the variables lie: in rows of x (y is a row), in columns (y is a column), or one variable shaped as y.
    layout: Layout,
    y_rows: usize,
    y_columns: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Layout {
    Single,
    Rows,
    Columns,
}

/// A variable after the fit: its mean (0 without a constant), coefficient and the factor of its variance.
struct Variable {
    mean: f64,
    coefficient: f64,
    variance: f64,
}

struct Fit {
    variables: Vec<Variable>,
    y_mean: f64,
    intercept_error: f64,
    ss_regression: f64,
    ss_residual: f64,
    kept: f64,
    freedom: f64,
    variance: f64,
}

/// A variable kept: its tolerance, its sum of squares, which variable it is, what is left of it once made
/// orthogonal, and that as a sum of the variables kept before it and itself.
struct Kept {
    tolerance: f64,
    squares: f64,
    index: usize,
    values: Vec<f64>,
    combination: Vec<f64>,
}

/// The numbers of a range: an error is the answer; anything that is not a number is #VALUE!.
fn all_numbers(cells: &Cells) -> Result<Vec<f64>, CellError> {
    cells
        .values()
        .map(|v| match v {
            Value::Number(n) => Ok(*n),
            _ => Err(CellError::Value),
        })
        .collect()
}

fn first_error(cells: &Cells) -> Result<(), CellError> {
    match cells.values().find_map(Value::error) {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn cells_of(arg: &Arg) -> Result<Cells, CellError> {
    match arg {
        Arg::Missing | Arg::Place(_) => Err(CellError::Value),
        arg => Ok(arg.cells()),
    }
}

/// A true-or-false argument given as one value: left out is `default`; a range of more than one cell is #VALUE!.
fn flag(arg: Option<&Arg>, default: bool) -> Result<bool, CellError> {
    match arg {
        None | Some(Arg::Missing) => Ok(default),
        Some(Arg::Cells(cells)) if !cells.array.is_single() => Err(CellError::Value),
        Some(arg) => coerce::to_boolean(&arg.value()?),
    }
}

/// Reads known y and known x (left out: 1, 2, 3, … in y's shape). An x of y's shape is one variable; else y must
/// be a column with as many rows as x (x's columns are the variables) or a row as long as x (x's rows), or #REF!.
fn known(y: &Arg, x: Option<&Arg>, constant: Option<&Arg>) -> Result<(Known, bool), CellError> {
    let y = cells_of(y)?;
    let x = match x {
        None | Some(Arg::Missing) => None,
        Some(arg) => Some(cells_of(arg)?),
    };
    first_error(&y)?;
    if let Some(x) = &x {
        first_error(x)?;
    }
    let constant = flag(constant, true)?;
    let (rows, columns) = (y.rows(), y.columns());
    let y_values = all_numbers(&y)?;
    let n = y_values.len();
    let (layout, xs) = match &x {
        None => (Layout::Single, vec![(1..=n).map(|i| i as f64).collect()]),
        Some(x) => {
            let values = all_numbers(x)?;
            if x.rows() == rows && x.columns() == columns {
                (Layout::Single, vec![values])
            } else if columns == 1 && x.rows() == rows {
                let k = x.columns();
                (Layout::Columns, (0..k).map(|c| (0..rows).map(|r| values[r * k + c]).collect()).collect())
            } else if rows == 1 && x.columns() == columns {
                (Layout::Rows, values.chunks(columns).map(<[f64]>::to_vec).collect())
            } else {
                return Err(CellError::Reference);
            }
        }
    };
    Ok((Known { y: y_values, xs, layout, y_rows: rows, y_columns: columns }, constant))
}

/// Takes the mean off a variable (from its first value); answers the mean.
fn centre(values: &mut [f64]) -> f64 {
    let Some(&first) = values.first() else {
        return f64::NAN;
    };
    let sum = values.iter().fold(-0.0, |s, v| s + (v - first));
    let mean = sum / values.len() as f64;
    for v in values.iter_mut() {
        *v = (*v - first) - mean;
    }
    first + mean
}

fn largest(values: &[f64]) -> f64 {
    values.iter().fold(0.0, |m: f64, v| v.abs().max(m))
}

/// How much of `kept` is in `values`; that much is taken out of `values`.
fn project(kept: &Kept, values: &mut [f64]) -> f64 {
    let dot = kept.values.iter().zip(values.iter()).fold(-0.0, |s, (q, v)| s + q * v);
    let c = dot / kept.squares;
    for (v, q) in values.iter_mut().zip(&kept.values) {
        *v -= c * q;
    }
    c
}

/// Fits y (as logarithms when `exponential`, which needs every y above 0) to the variables.
fn fit(known: Known, constant: bool, exponential: bool) -> Result<Fit, CellError> {
    let mut y = known.y;
    if exponential {
        for v in &mut y {
            if *v <= 0.0 {
                return Err(CellError::Number);
            }
            *v = v.ln();
        }
    }
    let n = y.len();
    let limit = n.saturating_sub(usize::from(constant));
    let mut variables = Vec::with_capacity(known.xs.len());
    let mut kept: Vec<Kept> = Vec::new();
    for (index, mut x) in known.xs.into_iter().enumerate() {
        let original = largest(&x);
        let mean = if constant { centre(&mut x) } else { 0.0 };
        variables.push(Variable { mean, coefficient: 0.0, variance: 0.0 });
        if kept.len() >= limit {
            continue;
        }
        let mut tolerance = if x.is_empty() { 0.0 } else { largest(&x) * 1e-13 };
        let mut combination = vec![0.0; kept.len()];
        for k in &kept {
            let c = project(k, &mut x);
            for (r, q) in combination.iter_mut().zip(&k.combination) {
                *r -= c * q;
            }
        }
        tolerance += original * f64::powi(2.0, -50);
        let carried = combination.iter().zip(&kept).fold(-0.0, |s, (r, k)| s + r.abs() * k.tolerance);
        if largest(&x) <= tolerance + carried {
            continue;
        }
        let squares = x.iter().fold(-0.0, |s, v| s + v * v);
        if !squares.is_normal() {
            return Err(CellError::Number);
        }
        combination.push(1.0);
        kept.push(Kept { tolerance, squares, index, values: x, combination });
    }
    let y_mean = if constant { centre(&mut y) } else { 0.0 };
    let mut ss_regression = 0.0;
    let mut intercept_factor = 1.0 / n as f64;
    for j in 0..kept.len() {
        let c = project(&kept[j], &mut y);
        let squares = kept[j].squares;
        ss_regression += c * c * squares;
        let mut along = 0.0;
        if !kept[j].combination.is_empty() {
            for (i, r) in kept[j].combination.iter().enumerate() {
                let v = &mut variables[kept[i].index];
                v.coefficient += c * r;
                v.variance += r * r / squares;
                along += v.mean * r;
            }
            along *= along;
        }
        intercept_factor += along / squares;
    }
    let ss_residual = y.iter().fold(-0.0, |s, v| s + v * v);
    let freedom = limit.saturating_sub(kept.len()) as f64;
    let variance = if limit > kept.len() { ss_residual / freedom } else { 0.0 };
    Ok(Fit {
        variables,
        y_mean,
        intercept_error: (intercept_factor * variance).sqrt(),
        ss_regression,
        ss_residual,
        kept: kept.len() as f64,
        freedom,
        variance,
    })
}

/// LINEST and LOGEST (`exponential`)(known y, [known x], [constant], [statistics]).
pub fn estimate(args: &[Arg], _locale: &Locale, exponential: bool) -> Answer {
    let (known, constant) = known(&args[0], args.get(1), args.get(2))?;
    let statistics = flag(args.get(3), false)?;
    let fit = fit(known, constant, exponential)?;
    let shown = |v: f64| Value::number(if exponential { v.exp() } else { v });
    let intercept = fit.variables.iter().fold(-0.0, |s, v| s + v.coefficient * (0.0 - v.mean));
    let mut first: Vec<Value> = fit.variables.iter().rev().map(|v| shown(v.coefficient)).collect();
    first.push(shown(fit.y_mean + intercept));
    if !statistics {
        let width = first.len();
        return array(Array::new(1, width, first));
    }
    let width = first.len();
    let mut errors: Vec<Value> =
        fit.variables.iter().rev().map(|v| Value::number((fit.variance * v.variance).sqrt())).collect();
    errors.push(if constant { Value::number(fit.intercept_error) } else { Value::Error(CellError::NotAvailable) });
    let r2 = if fit.ss_residual == 0.0 { 1.0 } else { fit.ss_regression / (fit.ss_regression + fit.ss_residual) };
    let rest = [
        [r2, fit.variance.sqrt()],
        [fit.ss_regression / fit.kept / fit.variance, fit.freedom],
        [fit.ss_regression, fit.ss_residual],
    ];
    let mut values = first;
    values.extend(errors);
    for pair in rest {
        values.extend(pair.iter().map(|v| Value::number(*v)));
        values.extend((2..width).map(|_| Value::Error(CellError::NotAvailable)));
    }
    array(Array::new(5, width, values))
}

/// TREND and GROWTH (`exponential`)(known y, [known x], [new x], [constant]): the fitted values at new x (not
/// given: known x; given but left out: #VALUE!), shaped as new x is; with several variables, one for each row (or
/// column) of new x.
pub fn trend(args: &[Arg], _locale: &Locale, exponential: bool) -> Answer {
    let given_x = args.get(1).filter(|a| !a.is_missing());
    let new = match args.get(2) {
        None => None,
        Some(arg) => Some(cells_of(arg)?),
    };
    let (known, constant) = known(&args[0], given_x, args.get(3))?;
    let layout = known.layout;
    let k = known.xs.len();
    let (points, rows, columns): (Vec<Vec<f64>>, usize, usize) = match &new {
        Some(new) => {
            first_error(new)?;
            let values = all_numbers(new)?;
            match layout {
                Layout::Single => (values.iter().map(|v| vec![*v]).collect(), new.rows(), new.columns()),
                Layout::Columns if new.columns() == k => {
                    (values.chunks(k).map(<[f64]>::to_vec).collect(), new.rows(), 1)
                }
                Layout::Rows if new.rows() == k => {
                    let c = new.columns();
                    ((0..c).map(|j| (0..k).map(|i| values[i * c + j]).collect()).collect(), 1, c)
                }
                _ => return Err(CellError::Reference),
            }
        }
        None => {
            let n = known.y.len();
            let points = (0..n).map(|i| known.xs.iter().map(|x| x[i]).collect()).collect();
            (points, known.y_rows, known.y_columns)
        }
    };
    let fit = fit(known, constant, exponential)?;
    let mut values: Vec<Value> = points
        .iter()
        .map(|p| {
            let sum = fit.variables.iter().zip(p).fold(-0.0, |s, (v, x)| s + v.coefficient * (x - v.mean));
            let y = fit.y_mean + sum;
            Value::number(if exponential { y.exp() } else { y })
        })
        .collect();
    if values.len() == 1 {
        return value(values.remove(0));
    }
    array(Array::new(rows, columns, values))
}
